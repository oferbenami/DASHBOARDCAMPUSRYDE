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

async function supabaseRequest(path, options = {}) {
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

  if (response.status === 204) return null;
  const raw = await response.text();
  return raw && raw.trim() ? JSON.parse(raw) : null;
}

function nowIso() {
  return new Date().toISOString();
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

function cleanRecipient(row) {
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

function normalizeOperatorInput(input = {}) {
  const name = String(input.name || "").trim();
  const operatorCode = String(input.operatorCode || input.operator_code || "").trim();
  if (!name) throw new Error("operator name is required");
  if (!operatorCode) throw new Error("operatorCode is required");

  const status = String(input.status || "active").toLowerCase();
  if (status !== "active" && status !== "inactive") throw new Error("status must be active or inactive");

  return {
    name,
    operator_code: operatorCode,
    legal_name: input.legalName || input.legal_name || null,
    phone: input.phone || null,
    email: input.email || null,
    status,
    notes: input.notes || null
  };
}

function normalizeRecipientInput(input = {}) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("recipient name is required");

  const recipientType = String(input.recipientType || input.recipient_type || "other").toLowerCase();
  const allowed = new Set(["operations", "finance", "alerts", "reports", "other"]);
  if (!allowed.has(recipientType)) {
    throw new Error("recipientType must be operations, finance, alerts, reports, or other");
  }

  return {
    name,
    role: input.role || null,
    email: input.email || null,
    phone: input.phone || null,
    recipient_type: recipientType,
    is_primary: Boolean(input.isPrimary ?? input.is_primary ?? false),
    is_active: Boolean(input.isActive ?? input.is_active ?? true)
  };
}

async function listOperators() {
  const rows = await supabaseRequest("/rest/v1/operators?select=*&deleted_at=is.null&order=name.asc");
  return (rows || []).map(cleanOperator);
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
  const existing = await supabaseRequest(`/rest/v1/operators?select=*&id=eq.${encodeURIComponent(operatorId)}&deleted_at=is.null&limit=1`);
  if (!existing || existing.length === 0) return null;

  const before = cleanOperator(existing[0]);
  const payload = normalizeOperatorInput({ ...before, ...input, operatorCode: input.operatorCode || before.operatorCode });
  const rows = await supabaseRequest(`/rest/v1/operators?id=eq.${encodeURIComponent(operatorId)}&select=*`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { ...payload, updated_at: nowIso() }
  });
  const operator = cleanOperator(rows[0]);
  return { before, after: operator, operator };
}

async function deleteOperator(operatorId) {
  const existing = await supabaseRequest(`/rest/v1/operators?select=*&id=eq.${encodeURIComponent(operatorId)}&deleted_at=is.null&limit=1`);
  if (!existing || existing.length === 0) return null;

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
  const rows = await supabaseRequest(`/rest/v1/operator_recipients?select=*&operator_id=eq.${encodeURIComponent(operatorId)}&deleted_at=is.null&order=name.asc`);
  return (rows || []).map(cleanRecipient);
}

async function createOperatorRecipient(operatorId, input) {
  const payload = normalizeRecipientInput(input);
  const timestamp = nowIso();
  const rows = await supabaseRequest("/rest/v1/operator_recipients?select=*", {
    method: "POST",
    prefer: "return=representation",
    body: { operator_id: operatorId, ...payload, created_at: timestamp, updated_at: timestamp }
  });
  const recipient = cleanRecipient(rows[0]);
  return { before: null, after: recipient, recipient };
}

async function updateOperatorRecipient(operatorId, recipientId, input) {
  const existing = await supabaseRequest(`/rest/v1/operator_recipients?select=*&id=eq.${encodeURIComponent(recipientId)}&operator_id=eq.${encodeURIComponent(operatorId)}&deleted_at=is.null&limit=1`);
  if (!existing || existing.length === 0) return null;

  const before = cleanRecipient(existing[0]);
  const payload = normalizeRecipientInput({
    ...before,
    ...input,
    recipientType: input.recipientType || before.recipientType,
    isPrimary: input.isPrimary ?? before.isPrimary,
    isActive: input.isActive ?? before.isActive
  });
  const rows = await supabaseRequest(`/rest/v1/operator_recipients?id=eq.${encodeURIComponent(recipientId)}&operator_id=eq.${encodeURIComponent(operatorId)}&select=*`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { ...payload, updated_at: nowIso() }
  });
  const recipient = cleanRecipient(rows[0]);
  return { before, after: recipient, recipient };
}

async function deleteOperatorRecipient(operatorId, recipientId) {
  const existing = await supabaseRequest(`/rest/v1/operator_recipients?select=*&id=eq.${encodeURIComponent(recipientId)}&operator_id=eq.${encodeURIComponent(operatorId)}&deleted_at=is.null&limit=1`);
  if (!existing || existing.length === 0) return null;

  const before = cleanRecipient(existing[0]);
  const rows = await supabaseRequest(`/rest/v1/operator_recipients?id=eq.${encodeURIComponent(recipientId)}&operator_id=eq.${encodeURIComponent(operatorId)}&select=*`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { deleted_at: nowIso(), updated_at: nowIso() }
  });
  const recipient = cleanRecipient(rows[0]);
  return { before, after: recipient, recipient };
}

module.exports = {
  listOperators,
  createOperator,
  updateOperator,
  deleteOperator,
  listOperatorRecipients,
  createOperatorRecipient,
  updateOperatorRecipient,
  deleteOperatorRecipient
};
