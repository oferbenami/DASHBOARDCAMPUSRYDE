"use strict";

const crypto = require("node:crypto");

// ═══════════════════════════════════════════════════════════
// SERVICE ACCOUNT JWT AUTH
// ═══════════════════════════════════════════════════════════

let _tokenCache = null;

async function getAccessToken() {
  if (_tokenCache && _tokenCache.expiresAt > Date.now()) {
    return _tokenCache.token;
  }

  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL;
  const privateKey = (process.env.GOOGLE_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("GOOGLE_SA_CLIENT_EMAIL and GOOGLE_SA_PRIVATE_KEY must be set for DB_PROVIDER=sheets");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claimsObj = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };
  const claims = Buffer.from(JSON.stringify(claimsObj)).toString("base64url");
  const toSign = `${header}.${claims}`;
  const sig = crypto.createSign("RSA-SHA256").update(toSign).sign(privateKey, "base64url");
  const jwt = `${toSign}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Google token exchange returned no access_token: ${JSON.stringify(data)}`);
  }
  _tokenCache = { token: data.access_token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return _tokenCache.token;
}

// ═══════════════════════════════════════════════════════════
// SHEETS API HELPERS
// ═══════════════════════════════════════════════════════════

function spreadsheetId() {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID must be set for DB_PROVIDER=sheets");
  return id;
}

function sheetsBase() {
  return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId()}`;
}

async function sheetsGet(path) {
  const token = await getAccessToken();
  const res = await fetch(`${sheetsBase()}${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function sheetsPut(path, body) {
  const token = await getAccessToken();
  const res = await fetch(`${sheetsBase()}${path}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets PUT ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function sheetsPost(path, body) {
  const token = await getAccessToken();
  const res = await fetch(`${sheetsBase()}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Read entire sheet → array of objects (row 1 = header keys)
async function readSheet(name) {
  const data = await sheetsGet(`/values/${encodeURIComponent(name)}`);
  const rows = data.values || [];
  const expectedHeaders = HEADERS[name];

  // Auto-repair: if first row doesn't match expected headers, prepend them
  if (expectedHeaders) {
    const firstRowMatches =
      rows.length > 0 && expectedHeaders.every((h, i) => rows[0][i] === h);
    if (!firstRowMatches) {
      console.log(`[readSheet] ${name}: header missing or wrong — repairing (rows=${rows.length})`);
      const allValues = [expectedHeaders, ...rows];
      await sheetsPut(
        `/values/${encodeURIComponent(name)}!A1?valueInputOption=RAW`,
        { range: `${name}!A1`, majorDimension: "ROWS", values: allValues }
      );
      return rows.map((row) => {
        const obj = {};
        expectedHeaders.forEach((key, i) => {
          const val = row[i];
          obj[key] = val === undefined ? null : val === "" ? null : val;
        });
        return obj;
      });
    }
  }

  if (rows.length < 1) return [];
  const headers = rows[0];
  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((key, i) => {
      const val = row[i];
      obj[key] = val === undefined ? null : val === "" ? null : val;
    });
    return obj;
  });
}

// Overwrite all data rows (preserves header in row 1)
async function writeSheet(name, headers, rows) {
  const values = [headers, ...rows.map((row) => headers.map((h) => {
    const v = row[h];
    if (v === null || v === undefined) return "";
    return String(v);
  }))];

  await sheetsPut(
    `/values/${encodeURIComponent(name)}!A1?valueInputOption=RAW`,
    { range: `${name}!A1`, majorDimension: "ROWS", values }
  );
}

// Append a single row (faster than full writeSheet for inserts)
async function appendRow(name, headers, rowObj) {
  const values = [headers.map((h) => {
    const v = rowObj[h];
    if (v === null || v === undefined) return "";
    return String(v);
  })];
  await sheetsPost(
    `/values/${encodeURIComponent(name)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { range: `${name}!A1`, majorDimension: "ROWS", values }
  );
}

// ═══════════════════════════════════════════════════════════
// SHARED HEADERS (column order must match sheet setup)
// ═══════════════════════════════════════════════════════════

const HEADERS = {
  users: ["id", "googleSub", "email", "fullName", "isActive", "createdAt", "updatedAt"],
  sessions: ["id", "userId", "sessionToken", "createdAt", "expiresAt", "revokedAt"],
  audit_log: ["id", "createdAt", "actorUserId", "action", "entityType", "entityId", "beforeData", "afterData", "metadata"],
  daily_metrics: ["id", "key", "serviceDate", "serviceType", "ridesCount", "registeredPassengers", "issuesCount", "affectedPassengers", "createdAt", "updatedAt"],
  incidents: ["id", "serviceDate", "serviceType", "origin", "destination", "shiftTime", "passengersCount", "issueType", "description", "delayMinutes", "createdAt", "updatedAt"],
  day_types: ["id", "serviceDate", "dayType", "reason", "isPartial", "noActivity", "createdAt", "updatedAt"],
  targets_history: ["id", "metricKey", "scopeKey", "direction", "targetValue", "effectiveFrom", "effectiveTo", "createdAt", "updatedAt"],
  kpi_thresholds: ["metricKey", "greenMin", "greenMax", "yellowMin", "yellowMax", "redMin", "redMax", "createdAt", "updatedAt"]
};

// ═══════════════════════════════════════════════════════════
// HELPERS (mirrored from excel-store.js)
// ═══════════════════════════════════════════════════════════

function nowIso() {
  return new Date().toISOString();
}

function normalizeServiceType(serviceType) {
  const normalized = String(serviceType || "").toLowerCase();
  if (normalized !== "pickup" && normalized !== "dropoff") {
    throw new Error("serviceType must be pickup or dropoff");
  }
  return normalized;
}

function dailyKey(serviceDate, serviceType) {
  return `${serviceDate}:${normalizeServiceType(serviceType)}`;
}

function parseJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return value; }
}

function cleanDailyMetric(row) {
  if (!row) return null;
  return {
    id: row.id,
    serviceDate: row.serviceDate,
    serviceType: row.serviceType,
    ridesCount: Number(row.ridesCount),
    registeredPassengers: Number(row.registeredPassengers),
    issuesCount: Number(row.issuesCount),
    affectedPassengers: Number(row.affectedPassengers),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function cleanIncident(row) {
  return {
    id: row.id,
    serviceDate: row.serviceDate,
    serviceType: row.serviceType,
    origin: row.origin,
    destination: row.destination,
    shiftTime: row.shiftTime,
    passengersCount: Number(row.passengersCount),
    issueType: row.issueType,
    description: row.description,
    delayMinutes: row.delayMinutes === null || row.delayMinutes === "" ? null : Number(row.delayMinutes),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function safePercent(numerator, denominator) {
  if (!denominator) return 0;
  return (numerator / denominator) * 100;
}

function qualityScore(issuesRate, affectedRate) {
  return 100 - 0.5 * issuesRate - 0.5 * affectedRate;
}

function aggregateRows(rows) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.passengers += toNumber(row.registeredPassengers);
      acc.rides += toNumber(row.ridesCount);
      acc.issues += toNumber(row.issuesCount);
      acc.affected += toNumber(row.affectedPassengers);
      return acc;
    },
    { passengers: 0, rides: 0, issues: 0, affected: 0 }
  );

  const efficiency = totals.rides ? totals.passengers / totals.rides : 0;
  const issuesRate = safePercent(totals.issues, totals.rides);
  const affectedRate = safePercent(totals.affected, totals.passengers);

  return {
    passengers: totals.passengers,
    rides: totals.rides,
    efficiency,
    issues: totals.issues,
    affectedPassengers: totals.affected,
    issuesRate,
    affectedRate,
    serviceQuality: qualityScore(issuesRate, affectedRate)
  };
}

function filterByDateRange(rows, dateFrom, dateTo) {
  return rows.filter((row) => {
    if (dateFrom && row.serviceDate < dateFrom) return false;
    if (dateTo && row.serviceDate > dateTo) return false;
    return true;
  });
}

// ═══════════════════════════════════════════════════════════
// STORE FUNCTIONS
// ═══════════════════════════════════════════════════════════

async function upsertUser(profile) {
  const users = await readSheet("users");
  const existing = users.find((u) => u.googleSub === profile.googleSub || u.email === profile.email);
  const timestamp = nowIso();

  if (existing) {
    const before = { ...existing };
    existing.googleSub = profile.googleSub;
    existing.email = profile.email;
    existing.fullName = profile.fullName;
    existing.updatedAt = timestamp;
    await writeSheet("users", HEADERS.users, users);
    return { user: existing, before, after: { ...existing }, created: false };
  }

  const user = {
    id: crypto.randomUUID(),
    googleSub: profile.googleSub,
    email: profile.email,
    fullName: profile.fullName,
    isActive: "true",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await appendRow("users", HEADERS.users, user);
  return { user, before: null, after: { ...user }, created: true };
}

async function createSession(userId, ttlHours) {
  const session = {
    id: crypto.randomUUID(),
    userId,
    sessionToken: crypto.randomBytes(32).toString("hex"),
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString(),
    revokedAt: ""
  };
  await appendRow("sessions", HEADERS.sessions, session);
  return session;
}

async function revokeSession(token) {
  const sessions = await readSheet("sessions");
  const session = sessions.find((s) => s.sessionToken === token && !s.revokedAt);
  if (!session) return false;
  session.revokedAt = nowIso();
  await writeSheet("sessions", HEADERS.sessions, sessions);
  return true;
}

async function getActiveSession(token) {
  const [sessions, users] = await Promise.all([readSheet("sessions"), readSheet("users")]);
  console.log(`[getActiveSession] sessions=${sessions.length} users=${users.length} token=${token.slice(0, 8)}...`);
  const session = sessions.find((s) => s.sessionToken === token && !s.revokedAt);
  if (!session) {
    console.log(`[getActiveSession] session NOT FOUND. sheet tokens: [${sessions.map((s) => s.sessionToken?.slice(0, 8)).join(", ")}]`);
    return null;
  }
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    console.log(`[getActiveSession] session EXPIRED expiresAt=${session.expiresAt}`);
    return null;
  }
  const user = users.find((u) => u.id === session.userId && String(u.isActive).toLowerCase() === "true");
  if (!user) {
    console.log(`[getActiveSession] user NOT FOUND userId=${session.userId} isActive values: [${users.map((u) => u.isActive).join(", ")}]`);
    return null;
  }
  return { session, user };
}

async function appendAudit(entry) {
  const row = {
    id: crypto.randomUUID(),
    createdAt: nowIso(),
    actorUserId: entry.actorUserId || "",
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId || "",
    beforeData: JSON.stringify(entry.beforeData || null),
    afterData: JSON.stringify(entry.afterData || null),
    metadata: JSON.stringify(entry.metadata || null)
  };
  await appendRow("audit_log", HEADERS.audit_log, row);
}

async function listAudit(filters) {
  let rows = await readSheet("audit_log");

  if (filters.actorUserId) rows = rows.filter((r) => r.actorUserId === filters.actorUserId);
  if (filters.entityType) rows = rows.filter((r) => r.entityType === filters.entityType);
  if (filters.action) rows = rows.filter((r) => r.action === filters.action);
  if (filters.dateFrom) rows = rows.filter((r) => r.createdAt >= filters.dateFrom);
  if (filters.dateTo) rows = rows.filter((r) => r.createdAt <= filters.dateTo);

  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 500);

  return rows.slice(0, limit).map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    actorUserId: row.actorUserId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    beforeData: parseJson(row.beforeData),
    afterData: parseJson(row.afterData),
    metadata: parseJson(row.metadata)
  }));
}

async function getDailyMetricsByDate(serviceDate) {
  const [dailyMetrics, dayTypes] = await Promise.all([readSheet("daily_metrics"), readSheet("day_types")]);
  const rows = dailyMetrics.filter((row) => row.serviceDate === serviceDate);
  const pickup = cleanDailyMetric(rows.find((row) => row.serviceType === "pickup"));
  const dropoff = cleanDailyMetric(rows.find((row) => row.serviceType === "dropoff"));
  const dayType = dayTypes.find((row) => row.serviceDate === serviceDate) || null;

  return {
    serviceDate,
    pickup,
    dropoff,
    dayType: dayType
      ? {
          serviceDate: dayType.serviceDate,
          dayType: dayType.dayType,
          reason: dayType.reason,
          isPartial: dayType.isPartial === "true" || dayType.isPartial === true,
          noActivity: dayType.noActivity === "true" || dayType.noActivity === true,
          updatedAt: dayType.updatedAt
        }
      : null
  };
}

async function upsertDailyMetric(input) {
  const dailyMetrics = await readSheet("daily_metrics");
  const serviceType = normalizeServiceType(input.serviceType);
  const key = dailyKey(input.serviceDate, serviceType);
  const timestamp = nowIso();

  let existing = dailyMetrics.find((row) => row.key === key);
  const before = existing ? cleanDailyMetric(existing) : null;

  if (existing) {
    existing.ridesCount = String(input.ridesCount);
    existing.registeredPassengers = String(input.registeredPassengers);
    existing.issuesCount = String(input.issuesCount);
    existing.affectedPassengers = String(input.affectedPassengers);
    existing.updatedAt = timestamp;
    await writeSheet("daily_metrics", HEADERS.daily_metrics, dailyMetrics);
  } else {
    existing = {
      id: crypto.randomUUID(),
      key,
      serviceDate: input.serviceDate,
      serviceType,
      ridesCount: String(input.ridesCount),
      registeredPassengers: String(input.registeredPassengers),
      issuesCount: String(input.issuesCount),
      affectedPassengers: String(input.affectedPassengers),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await appendRow("daily_metrics", HEADERS.daily_metrics, existing);
  }

  return {
    before,
    after: cleanDailyMetric(existing),
    metric: cleanDailyMetric(existing)
  };
}

async function listIncidents(filters) {
  let rows = await readSheet("incidents");

  if (filters.serviceDate) rows = rows.filter((row) => row.serviceDate === filters.serviceDate);
  if (filters.serviceType) {
    const serviceType = normalizeServiceType(filters.serviceType);
    rows = rows.filter((row) => row.serviceType === serviceType);
  }

  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return rows.map(cleanIncident);
}

async function createIncident(input) {
  const timestamp = nowIso();
  const row = {
    id: crypto.randomUUID(),
    serviceDate: input.serviceDate,
    serviceType: normalizeServiceType(input.serviceType),
    origin: input.origin,
    destination: input.destination,
    shiftTime: input.shiftTime,
    passengersCount: String(input.passengersCount),
    issueType: input.issueType,
    description: input.description,
    delayMinutes: input.delayMinutes ?? "",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await appendRow("incidents", HEADERS.incidents, row);
  return { before: null, after: cleanIncident(row), incident: cleanIncident(row) };
}

async function updateIncident(incidentId, input) {
  const incidents = await readSheet("incidents");
  const row = incidents.find((item) => item.id === incidentId);
  if (!row) return null;

  const before = cleanIncident(row);
  row.serviceDate = input.serviceDate;
  row.serviceType = normalizeServiceType(input.serviceType);
  row.origin = input.origin;
  row.destination = input.destination;
  row.shiftTime = input.shiftTime;
  row.passengersCount = String(input.passengersCount);
  row.issueType = input.issueType;
  row.description = input.description;
  row.delayMinutes = input.delayMinutes ?? "";
  row.updatedAt = nowIso();

  await writeSheet("incidents", HEADERS.incidents, incidents);
  return { before, after: cleanIncident(row), incident: cleanIncident(row) };
}

async function recalculateIncidents(serviceDate, serviceType) {
  const normalizedType = normalizeServiceType(serviceType);
  const [incidents, dailyMetrics] = await Promise.all([readSheet("incidents"), readSheet("daily_metrics")]);
  const matching = incidents.filter(
    (row) => row.serviceDate === serviceDate && row.serviceType === normalizedType
  );

  const key = dailyKey(serviceDate, normalizedType);
  const metricRow = dailyMetrics.find((row) => row.key === key);
  if (!metricRow) throw new Error("daily metric row must exist before recalculation");

  const before = cleanDailyMetric(metricRow);
  metricRow.issuesCount = String(matching.length);
  metricRow.affectedPassengers = String(matching.reduce((sum, row) => sum + Number(row.passengersCount || 0), 0));
  metricRow.updatedAt = nowIso();

  await writeSheet("daily_metrics", HEADERS.daily_metrics, dailyMetrics);
  return {
    before,
    after: cleanDailyMetric(metricRow),
    metric: cleanDailyMetric(metricRow),
    incidentsCount: matching.length
  };
}

async function upsertDayType(input) {
  const dayTypes = await readSheet("day_types");
  let row = dayTypes.find((item) => item.serviceDate === input.serviceDate);
  const timestamp = nowIso();
  const before = row
    ? {
        serviceDate: row.serviceDate,
        dayType: row.dayType,
        reason: row.reason,
        isPartial: row.isPartial === "true" || row.isPartial === true,
        noActivity: row.noActivity === "true" || row.noActivity === true,
        updatedAt: row.updatedAt
      }
    : null;

  if (row) {
    row.dayType = input.dayType;
    row.reason = input.reason;
    row.isPartial = String(Boolean(input.isPartial));
    row.noActivity = String(Boolean(input.noActivity));
    row.updatedAt = timestamp;
    await writeSheet("day_types", HEADERS.day_types, dayTypes);
  } else {
    row = {
      id: crypto.randomUUID(),
      serviceDate: input.serviceDate,
      dayType: input.dayType,
      reason: input.reason,
      isPartial: String(Boolean(input.isPartial)),
      noActivity: String(Boolean(input.noActivity)),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await appendRow("day_types", HEADERS.day_types, row);
  }

  const result = {
    serviceDate: row.serviceDate,
    dayType: row.dayType,
    reason: row.reason,
    isPartial: row.isPartial === "true" || row.isPartial === true,
    noActivity: row.noActivity === "true" || row.noActivity === true,
    updatedAt: row.updatedAt
  };
  return { before, after: result, dayType: result };
}

async function listDayTypes(filters) {
  const rows = await readSheet("day_types");
  const dateFrom = filters.dateFrom || null;
  const dateTo = filters.dateTo || null;
  return filterByDateRange(rows, dateFrom, dateTo)
    .sort((a, b) => (a.serviceDate < b.serviceDate ? 1 : -1))
    .map((row) => ({
      serviceDate: row.serviceDate,
      dayType: row.dayType,
      reason: row.reason,
      isPartial: row.isPartial === "true" || row.isPartial === true,
      noActivity: row.noActivity === "true" || row.noActivity === true,
      updatedAt: row.updatedAt
    }));
}

async function getKpiSummary(filters) {
  const dailyMetrics = await readSheet("daily_metrics");
  const dateFrom = filters.dateFrom || null;
  const dateTo = filters.dateTo || null;
  const scoped = filterByDateRange(dailyMetrics, dateFrom, dateTo);

  return {
    range: { dateFrom, dateTo },
    pickup: aggregateRows(scoped.filter((r) => r.serviceType === "pickup")),
    dropoff: aggregateRows(scoped.filter((r) => r.serviceType === "dropoff")),
    total: aggregateRows(scoped)
  };
}

async function getKpiTrends(filters) {
  const dailyMetrics = await readSheet("daily_metrics");
  const dateFrom = filters.dateFrom || null;
  const dateTo = filters.dateTo || null;
  const scoped = filterByDateRange(dailyMetrics, dateFrom, dateTo);

  const grouped = new Map();
  for (const row of scoped) {
    if (!grouped.has(row.serviceDate)) grouped.set(row.serviceDate, []);
    grouped.get(row.serviceDate).push(row);
  }

  const points = [...grouped.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([serviceDate, rows]) => ({
      serviceDate,
      pickup: aggregateRows(rows.filter((r) => r.serviceType === "pickup")),
      dropoff: aggregateRows(rows.filter((r) => r.serviceType === "dropoff")),
      total: aggregateRows(rows)
    }));

  return { range: { dateFrom, dateTo }, points };
}

async function getKpiDrilldown(filters) {
  const [dailyMetrics, incidents] = await Promise.all([readSheet("daily_metrics"), readSheet("incidents")]);
  const dateFrom = filters.dateFrom || null;
  const dateTo = filters.dateTo || null;
  const serviceType = filters.serviceType ? normalizeServiceType(filters.serviceType) : null;
  const metricKey = filters.metricKey || null;

  const metricsScoped = filterByDateRange(dailyMetrics, dateFrom, dateTo).filter(
    (r) => !serviceType || r.serviceType === serviceType
  );
  const incidentsScoped = filterByDateRange(incidents, dateFrom, dateTo).filter(
    (r) => !serviceType || r.serviceType === serviceType
  );

  return {
    filters: { dateFrom, dateTo, serviceType, metricKey },
    summary: aggregateRows(metricsScoped),
    dailyRows: metricsScoped.map(cleanDailyMetric),
    incidents: incidentsScoped.map(cleanIncident)
  };
}

async function listTargets(filters) {
  let rows = await readSheet("targets_history");
  if (filters.metricKey) rows = rows.filter((r) => r.metricKey === filters.metricKey);
  if (filters.scopeKey) rows = rows.filter((r) => r.scopeKey === filters.scopeKey);
  rows.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return rows.map((row) => ({
    id: row.id,
    metricKey: row.metricKey,
    scopeKey: row.scopeKey,
    direction: row.direction,
    targetValue: Number(row.targetValue),
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo || null,
    updatedAt: row.updatedAt
  }));
}

async function createTarget(input) {
  const row = {
    id: crypto.randomUUID(),
    metricKey: input.metricKey,
    scopeKey: input.scopeKey,
    direction: input.direction,
    targetValue: String(input.targetValue),
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo || "",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  await appendRow("targets_history", HEADERS.targets_history, row);
  return { before: null, after: { ...row }, target: { ...row, targetValue: Number(row.targetValue) } };
}

async function listThresholds(filters) {
  let rows = await readSheet("kpi_thresholds");
  if (filters && filters.metricKey) rows = rows.filter((r) => r.metricKey === filters.metricKey);
  rows.sort((a, b) => (a.metricKey < b.metricKey ? -1 : 1));
  return rows.map((row) => ({
    metricKey: row.metricKey,
    greenMin: Number(row.greenMin),
    greenMax: Number(row.greenMax),
    yellowMin: Number(row.yellowMin),
    yellowMax: Number(row.yellowMax),
    redMin: Number(row.redMin),
    redMax: Number(row.redMax),
    updatedAt: row.updatedAt
  }));
}

async function upsertThreshold(metricKey, input) {
  const thresholds = await readSheet("kpi_thresholds");
  let row = thresholds.find((item) => item.metricKey === metricKey);
  const before = row
    ? {
        metricKey: row.metricKey,
        greenMin: Number(row.greenMin),
        greenMax: Number(row.greenMax),
        yellowMin: Number(row.yellowMin),
        yellowMax: Number(row.yellowMax),
        redMin: Number(row.redMin),
        redMax: Number(row.redMax),
        updatedAt: row.updatedAt
      }
    : null;

  if (!row) {
    row = {
      metricKey,
      greenMin: String(input.greenMin),
      greenMax: String(input.greenMax),
      yellowMin: String(input.yellowMin),
      yellowMax: String(input.yellowMax),
      redMin: String(input.redMin),
      redMax: String(input.redMax),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await appendRow("kpi_thresholds", HEADERS.kpi_thresholds, row);
  } else {
    row.greenMin = String(input.greenMin);
    row.greenMax = String(input.greenMax);
    row.yellowMin = String(input.yellowMin);
    row.yellowMax = String(input.yellowMax);
    row.redMin = String(input.redMin);
    row.redMax = String(input.redMax);
    row.updatedAt = nowIso();
    await writeSheet("kpi_thresholds", HEADERS.kpi_thresholds, thresholds);
  }

  const threshold = {
    metricKey: row.metricKey,
    greenMin: Number(row.greenMin),
    greenMax: Number(row.greenMax),
    yellowMin: Number(row.yellowMin),
    yellowMax: Number(row.yellowMax),
    redMin: Number(row.redMin),
    redMax: Number(row.redMax),
    updatedAt: row.updatedAt
  };
  return { before, after: threshold, threshold };
}

async function getExportBundle(filters) {
  const [summary, trends, drilldown, targets, thresholds, dayTypes] = await Promise.all([
    getKpiSummary(filters),
    getKpiTrends(filters),
    getKpiDrilldown(filters),
    listTargets({}),
    listThresholds({}),
    listDayTypes(filters)
  ]);

  return {
    generatedAt: nowIso(),
    range: { dateFrom: filters.dateFrom || null, dateTo: filters.dateTo || null },
    summary,
    trends,
    drilldown,
    targets,
    thresholds,
    dayTypes
  };
}

module.exports = {
  upsertUser,
  createSession,
  revokeSession,
  getActiveSession,
  appendAudit,
  listAudit,
  getDailyMetricsByDate,
  upsertDailyMetric,
  listIncidents,
  createIncident,
  updateIncident,
  recalculateIncidents,
  upsertDayType,
  listDayTypes,
  getKpiSummary,
  getKpiTrends,
  getKpiDrilldown,
  listTargets,
  createTarget,
  listThresholds,
  upsertThreshold,
  getExportBundle
};
