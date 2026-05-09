const crypto = require("node:crypto");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function supabaseConfig() {
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return { url: url.replace(/\/$/, ""), key };
}

async function supabaseRequest(path, options) {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}${path}`, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      apikey: key,
      authorization: `Bearer ${key}`,
      ...(options.prefer ? { prefer: options.prefer } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${errorText}`);
  }

  if (response.status === 204) {
    return null;
  }

  const raw = await response.text();
  return raw && raw.trim() ? JSON.parse(raw) : null;
}

function nowIso() {
  return new Date().toISOString();
}

function toUserModel(row) {
  return {
    id: row.id,
    googleSub: row.google_sub,
    email: row.email,
    fullName: row.full_name,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toSessionModel(row) {
  return {
    id: row.id,
    userId: row.user_id,
    sessionToken: row.session_token,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at
  };
}

function cleanOperator(row) {
  return {
    id: row.id,
    name: row.name,
    operatorCode: row.operator_code,
    legalName: row.legal_name || null,
    phone: row.phone || null,
    email: row.email || null,
    status: row.status || "active",
    notes: row.notes || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null
  };
}

function cleanOperatorRecipient(row) {
  return {
    id: row.id,
    operatorId: row.operator_id,
    name: row.name,
    role: row.role || null,
    email: row.email || null,
    phone: row.phone || null,
    recipientType: row.recipient_type || "other",
    isPrimary: Boolean(row.is_primary),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null
  };
}

function normalizeOperatorInput(input) {
  const name = String(input?.name || "").trim();
  const operatorCode = String(input?.operatorCode || input?.operator_code || "").trim();
  if (!name) throw new Error("operator name is required");
  if (!operatorCode) throw new Error("operatorCode is required");
  const status = String(input?.status || "active").toLowerCase();
  if (status !== "active" && status !== "inactive") throw new Error("status must be active or inactive");
  return {
    name,
    operator_code: operatorCode,
    legal_name: input?.legalName || input?.legal_name || null,
    phone: input?.phone || null,
    email: input?.email || null,
    status,
    notes: input?.notes || null
  };
}

function normalizeOperatorRecipientInput(input) {
  const name = String(input?.name || "").trim();
  if (!name) throw new Error("recipient name is required");
  const recipientType = String(input?.recipientType || input?.recipient_type || "other").toLowerCase();
  const allowed = new Set(["operations", "finance", "alerts", "reports", "other"]);
  if (!allowed.has(recipientType)) throw new Error("recipientType must be operations, finance, alerts, reports, or other");
  return {
    name,
    role: input?.role || null,
    email: input?.email || null,
    phone: input?.phone || null,
    recipient_type: recipientType,
    is_primary: Boolean(input?.isPrimary ?? input?.is_primary ?? false),
    is_active: Boolean(input?.isActive ?? input?.is_active ?? true)
  };
}

async function findUserByGoogleSubOrEmail(googleSub, email) {
  const bySub = await supabaseRequest(`/rest/v1/users?select=*&google_sub=eq.${encodeURIComponent(googleSub)}&limit=1`, { method: "GET" });
  if (bySub.length > 0) return bySub[0];
  const byEmail = await supabaseRequest(`/rest/v1/users?select=*&email=eq.${encodeURIComponent(email)}&limit=1`, { method: "GET" });
  if (byEmail.length > 0) return byEmail[0];
  return null;
}

async function upsertUser(profile) {
  const timestamp = nowIso();
  const existing = await findUserByGoogleSubOrEmail(profile.googleSub, profile.email);
  if (existing) {
    const before = toUserModel(existing);
    const updatedRows = await supabaseRequest(`/rest/v1/users?id=eq.${existing.id}&select=*`, {
      method: "PATCH",
      prefer: "return=representation",
      body: { google_sub: profile.googleSub, email: profile.email, full_name: profile.fullName, updated_at: timestamp }
    });
    const user = toUserModel(updatedRows[0]);
    return { user, before, after: { ...user }, created: false };
  }
  const rows = await supabaseRequest("/rest/v1/users?select=*", {
    method: "POST",
    prefer: "return=representation",
    body: { google_sub: profile.googleSub, email: profile.email, full_name: profile.fullName, is_active: true, updated_at: timestamp }
  });
  const user = toUserModel(rows[0]);
  return { user, before: null, after: { ...user }, created: true };
}

async function createSession(userId, ttlHours) {
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  const token = crypto.randomBytes(32).toString("hex");
  const rows = await supabaseRequest("/rest/v1/sessions?select=*", {
    method: "POST",
    prefer: "return=representation",
    body: { user_id: userId, session_token: token, created_at: timestamp, expires_at: expiresAt }
  });
  return toSessionModel(rows[0]);
}

async function revokeSession(token) {
  const rows = await supabaseRequest(`/rest/v1/sessions?session_token=eq.${token}&revoked_at=is.null&select=*`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { revoked_at: nowIso() }
  });
  return rows.length > 0;
}

async function getActiveSession(token) {
  const sessions = await supabaseRequest(`/rest/v1/sessions?select=*&session_token=eq.${encodeURIComponent(token)}&revoked_at=is.null&limit=1`, { method: "GET" });
  if (sessions.length === 0) return null;
  const session = toSessionModel(sessions[0]);
  if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
  const users = await supabaseRequest(`/rest/v1/users?select=*&id=eq.${encodeURIComponent(session.userId)}&limit=1`, { method: "GET" });
  if (users.length === 0 || !users[0].is_active) return null;
  return { session, user: toUserModel(users[0]) };
}

async function appendAudit(entry) {
  await supabaseRequest("/rest/v1/audit_log", {
    method: "POST",
    body: {
      actor_user_id: entry.actorUserId || null,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId || null,
      before_data: entry.beforeData || null,
      after_data: entry.afterData || null,
      metadata: entry.metadata || null
    }
  });
}

async function listAudit(filters) {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "created_at.desc");
  params.set("limit", String(Math.min(Math.max(Number(filters.limit || 100), 1), 500)));
  if (filters.actorUserId) params.set("actor_user_id", `eq.${filters.actorUserId}`);
  if (filters.entityType) params.set("entity_type", `eq.${filters.entityType}`);
  if (filters.action) params.set("action", `eq.${filters.action}`);
  if (filters.dateFrom) params.append("created_at", `gte.${filters.dateFrom}`);
  if (filters.dateTo) params.append("created_at", `lte.${filters.dateTo}`);
  const rows = await supabaseRequest(`/rest/v1/audit_log?${params.toString()}`, { method: "GET" });
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    actorUserId: row.actor_user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    beforeData: row.before_data,
    afterData: row.after_data,
    metadata: row.metadata
  }));
}

async function listOperators() {
  const rows = await supabaseRequest("/rest/v1/operators?select=*&deleted_at=is.null&order=name.asc", { method: "GET" });
  return rows.map(cleanOperator);
}

async function createOperator(input) {
  const payload = normalizeOperatorInput(input);
  const timestamp = nowIso();
  const rows = await supabaseRequest("/rest/v1/operators?select=*", {
    method: "POST",
    prefer: "return=representation",
    body: { ...payload, created_at: timestamp, updated_at: timestamp }
  });
  const operator = cleanOperator(rows[0]);
  return { before: null, after: operator, operator };
}

async function updateOperator(operatorId, input) {
  const existing = await supabaseRequest(`/rest/v1/operators?select=*&id=eq.${encodeURIComponent(operatorId)}&deleted_at=is.null&limit=1`, { method: "GET" });
  if (existing.length === 0) return null;
  const before = cleanOperator(existing[0]);
  const payload = normalizeOperatorInput({ ...before, ...input, operatorCode: input?.operatorCode || before.operatorCode });
  const rows = await supabaseRequest(`/rest/v1/operators?id=eq.${encodeURIComponent(operatorId)}&select=*`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { ...payload, updated_at: nowIso() }
  });
  const operator = cleanOperator(rows[0]);
  return { before, after: operator, operator };
}

async function deleteOperator(operatorId) {
  const existing = await supabaseRequest(`/rest/v1/operators?select=*&id=eq.${encodeURIComponent(operatorId)}&deleted_at=is.null&limit=1`, { method: "GET" });
  if (existing.length === 0) return null;
  const before = cleanOperator(existing[0]);
  const rows = await supabaseRequest(`/rest/v1/operators?id=eq.${encodeURIComponent(operatorId)}&select=*`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { deleted_at: nowIso(), updated_at: nowIso() }
  });
  const operator = cleanOperator(rows[0]);
  return { before, after: operator, operator };
}

async function listOperatorRecipients(operatorId) {
  const rows = await supabaseRequest(`/rest/v1/operator_recipients?select=*&operator_id=eq.${encodeURIComponent(operatorId)}&deleted_at=is.null&order=name.asc`, { method: "GET" });
  return rows.map(cleanOperatorRecipient);
}

async function createOperatorRecipient(operatorId, input) {
  const payload = normalizeOperatorRecipientInput(input);
  const timestamp = nowIso();
  const rows = await supabaseRequest("/rest/v1/operator_recipients?select=*", {
    method: "POST",
    prefer: "return=representation",
    body: { operator_id: operatorId, ...payload, created_at: timestamp, updated_at: timestamp }
  });
  const recipient = cleanOperatorRecipient(rows[0]);
  return { before: null, after: recipient, recipient };
}

async function updateOperatorRecipient(operatorId, recipientId, input) {
  const existing = await supabaseRequest(`/rest/v1/operator_recipients?select=*&id=eq.${encodeURIComponent(recipientId)}&operator_id=eq.${encodeURIComponent(operatorId)}&deleted_at=is.null&limit=1`, { method: "GET" });
  if (existing.length === 0) return null;
  const before = cleanOperatorRecipient(existing[0]);
  const payload = normalizeOperatorRecipientInput({
    ...before,
    ...input,
    recipientType: input?.recipientType || before.recipientType,
    isPrimary: input?.isPrimary ?? before.isPrimary,
    isActive: input?.isActive ?? before.isActive
  });
  const rows = await supabaseRequest(`/rest/v1/operator_recipients?id=eq.${encodeURIComponent(recipientId)}&operator_id=eq.${encodeURIComponent(operatorId)}&select=*`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { ...payload, updated_at: nowIso() }
  });
  const recipient = cleanOperatorRecipient(rows[0]);
  return { before, after: recipient, recipient };
}

async function deleteOperatorRecipient(operatorId, recipientId) {
  const existing = await supabaseRequest(`/rest/v1/operator_recipients?select=*&id=eq.${encodeURIComponent(recipientId)}&operator_id=eq.${encodeURIComponent(operatorId)}&deleted_at=is.null&limit=1`, { method: "GET" });
  if (existing.length === 0) return null;
  const before = cleanOperatorRecipient(existing[0]);
  const rows = await supabaseRequest(`/rest/v1/operator_recipients?id=eq.${encodeURIComponent(recipientId)}&operator_id=eq.${encodeURIComponent(operatorId)}&select=*`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { deleted_at: nowIso(), updated_at: nowIso() }
  });
  const recipient = cleanOperatorRecipient(rows[0]);
  return { before, after: recipient, recipient };
}

module.exports = {
  upsertUser,
  createSession,
  revokeSession,
  getActiveSession,
  appendAudit,
  listAudit,
  listOperators,
  createOperator,
  updateOperator,
  deleteOperator,
  listOperatorRecipients,
  createOperatorRecipient,
  updateOperatorRecipient,
  deleteOperatorRecipient,
  getDailyMetricsByDate: async () => { throw new Error("Stage 3 daily operations are not implemented for supabase provider yet"); },
  upsertDailyMetric: async () => { throw new Error("Stage 3 daily operations are not implemented for supabase provider yet"); },
  listIncidents: async () => { throw new Error("Stage 3 incidents are not implemented for supabase provider yet"); },
  createIncident: async () => { throw new Error("Stage 3 incidents are not implemented for supabase provider yet"); },
  updateIncident: async () => { throw new Error("Stage 3 incidents are not implemented for supabase provider yet"); },
  recalculateIncidents: async () => { throw new Error("Stage 3 incidents are not implemented for supabase provider yet"); },
  upsertDayType: async () => { throw new Error("Stage 3 day types are not implemented for supabase provider yet"); },
  getKpiSummary: async () => { throw new Error("Stage 4 KPI engine is not implemented for supabase provider yet"); },
  getKpiTrends: async () => { throw new Error("Stage 4 KPI engine is not implemented for supabase provider yet"); },
  getKpiDrilldown: async () => { throw new Error("Stage 5 drilldown is not implemented for supabase provider yet"); },
  listDayTypes: async () => { throw new Error("Stage 5 day types list is not implemented for supabase provider yet"); },
  listTargets: async () => { throw new Error("Stage 5 targets management is not implemented for supabase provider yet"); },
  createTarget: async () => { throw new Error("Stage 5 targets management is not implemented for supabase provider yet"); },
  listThresholds: async () => { throw new Error("Stage 5 thresholds management is not implemented for supabase provider yet"); },
  upsertThreshold: async () => { throw new Error("Stage 5 thresholds management is not implemented for supabase provider yet"); },
  getExportBundle: async () => { throw new Error("Stage 6 export is not implemented for supabase provider yet"); }
};
