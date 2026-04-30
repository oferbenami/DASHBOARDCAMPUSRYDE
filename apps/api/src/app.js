const { URL } = require("node:url");
const XLSX = require("xlsx");
const PDFDocument = require("pdfkit");

const { getBearerToken, readJsonBody, sendJson, securityHeaders } = require("./core/http");
const { verifyGoogleIdToken } = require("./auth/google-token");
const {
  providerName,
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
} = require("./storage/identity-store");
const {
  isDateString,
  normalizeDailyMetricInput,
  normalizeIncidentInput,
  normalizeDayTypeInput,
  normalizeServiceType,
  normalizeTargetInput,
  normalizeThresholdInput
} = require("./core/daily-validation");

const sessionTtlHours = Number(process.env.SESSION_TTL_HOURS || 10);
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const rateLimitMaxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 120);
const authRateLimitMaxRequests = Number(process.env.RATE_LIMIT_AUTH_MAX_REQUESTS || 20);
const rateLimitStore = new Map();

function unauthorized(res, message) {
  sendJson(res, 401, { error: message || "Unauthorized" });
}

function badRequest(res, message) {
  sendJson(res, 400, { error: message });
}

function providerMisconfigured(res) {
  sendJson(res, 503, {
    error: "Server is configured for DB_PROVIDER=excel only",
    code: "PROVIDER_MISCONFIGURED"
  });
}

function clientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function applyRateLimit(req, pathname) {
  const ip = clientIp(req);
  const key = `${ip}:${pathname.startsWith("/auth/") ? "auth" : "global"}`;
  const limit = pathname.startsWith("/auth/") ? authRateLimitMaxRequests : rateLimitMaxRequests;
  const now = Date.now();

  const current = rateLimitStore.get(key);
  if (!current || now > current.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
    return { ok: true };
  }

  if (current.count >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((current.resetAt - now) / 1000) };
  }

  current.count += 1;
  return { ok: true };
}

function sendRateLimitExceeded(res, retryAfterSec) {
  res.writeHead(429, {
    "content-type": "application/json; charset=utf-8",
    "retry-after": String(retryAfterSec),
    ...securityHeaders()
  });
  res.end(JSON.stringify({ error: "Too Many Requests" }));
}

async function requireAuth(req, res) {
  const token = getBearerToken(req);
  if (!token) {
    console.log("[requireAuth] no Bearer token in request");
    unauthorized(res);
    return null;
  }

  console.log(`[requireAuth] token=${token.slice(0, 8)}...`);
  const active = await getActiveSession(token);
  if (!active) {
    unauthorized(res);
    return null;
  }

  return active;
}

function escapeForJsSingleQuoted(str) {
  return String(str || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function readTextBody(req) {
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleGoogleCallback(req, res) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  let idToken = null;
  let redirectMode = false;

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const raw = await readTextBody(req);
    const params = new URLSearchParams(raw || "");
    idToken = params.get("credential");
    redirectMode = true;
  } else {
    const body = await readJsonBody(req);
    idToken = body.idToken;
  }

  if (!idToken || typeof idToken !== "string") {
    badRequest(res, "idToken is required");
    return;
  }

  const verified = await verifyGoogleIdToken(idToken);
  if (!verified.ok) {
    unauthorized(res, verified.reason);
    return;
  }

  const userWrite = await upsertUser(verified.profile);
  const session = await createSession(userWrite.user.id, sessionTtlHours);
  console.log(`[login] session created token=${session.sessionToken.slice(0, 8)}... userId=${userWrite.user.id} expiresAt=${session.expiresAt}`);

  await appendAudit({
    actorUserId: userWrite.user.id,
    action: userWrite.created ? "USER_CREATED_AND_LOGIN" : "USER_LOGIN",
    entityType: "user",
    entityId: userWrite.user.id,
    beforeData: userWrite.before,
    afterData: userWrite.after,
    metadata: { provider: "google" }
  });

  if (redirectMode) {
    const token = escapeForJsSingleQuoted(session.sessionToken);
    const html = `<!doctype html><html lang="he"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Redirecting…</title></head><body><script>try{localStorage.setItem('dr_session_token','${token}');window.location.replace('/');}catch(e){document.body.innerText='Login completed, please return to the app.';}</script></body></html>`;
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      ...securityHeaders()
    });
    res.end(html);
    return;
  }

  sendJson(res, 200, {
    user: {
      id: userWrite.user.id,
      email: userWrite.user.email,
      fullName: userWrite.user.fullName
    },
    session: {
      token: session.sessionToken,
      expiresAt: session.expiresAt
    }
  });
}

async function handleClientError(req, res) {
  const body = await readJsonBody(req).catch(() => ({}));
  const stage = String(body?.stage || "unknown");
  const message = String(body?.message || "unknown");
  const userAgent = String(body?.userAgent || "");
  console.warn("[client-errors]", { stage, message, userAgent });
  sendJson(res, 202, { ok: true });
}

async function handleLogout(req, res) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  await revokeSession(active.session.sessionToken);
  await appendAudit({
    actorUserId: active.user.id,
    action: "USER_LOGOUT",
    entityType: "session",
    entityId: active.session.id,
    beforeData: active.session,
    afterData: { ...active.session, revokedAt: new Date().toISOString() },
    metadata: { reason: "manual_logout" }
  });

  sendJson(res, 200, { ok: true });
}

async function handleMe(req, res) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  sendJson(res, 200, {
    user: {
      id: active.user.id,
      email: active.user.email,
      fullName: active.user.fullName
    },
    session: {
      id: active.session.id,
      expiresAt: active.session.expiresAt
    }
  });
}

async function handleAudit(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  const rows = await listAudit({
    actorUserId: parsedUrl.searchParams.get("actorUserId") || undefined,
    entityType: parsedUrl.searchParams.get("entityType") || undefined,
    action: parsedUrl.searchParams.get("action") || undefined,
    dateFrom: parsedUrl.searchParams.get("dateFrom") || undefined,
    dateTo: parsedUrl.searchParams.get("dateTo") || undefined,
    limit: parsedUrl.searchParams.get("limit") || undefined
  });

  sendJson(res, 200, { rows });
}

async function handleGetDailyMetrics(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  const serviceDate = parsedUrl.searchParams.get("date");
  if (!isDateString(serviceDate)) {
    badRequest(res, "date query param is required in YYYY-MM-DD format");
    return;
  }

  const result = await getDailyMetricsByDate(serviceDate);
  sendJson(res, 200, result);
}

async function handleUpsertDailyMetric(req, res, serviceDate, serviceType) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  const body = await readJsonBody(req);
  let normalized;
  try {
    normalized = normalizeDailyMetricInput(body, serviceDate, serviceType);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }

  const saved = await upsertDailyMetric(normalized);

  await appendAudit({
    actorUserId: active.user.id,
    action: saved.before ? "DAILY_METRIC_UPDATED" : "DAILY_METRIC_CREATED",
    entityType: "daily_metrics",
    entityId: saved.metric.id,
    beforeData: saved.before,
    afterData: saved.after,
    metadata: { serviceDate, serviceType: normalized.serviceType }
  });

  sendJson(res, 200, { metric: saved.metric });
}

async function handleListIncidents(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  const serviceDate = parsedUrl.searchParams.get("date") || undefined;
  const serviceTypeRaw = parsedUrl.searchParams.get("serviceType") || undefined;

  if (serviceDate && !isDateString(serviceDate)) {
    badRequest(res, "date query param must be in YYYY-MM-DD format");
    return;
  }

  let serviceType;
  if (serviceTypeRaw) {
    try {
      serviceType = normalizeServiceType(serviceTypeRaw);
    } catch (error) {
      badRequest(res, error.message);
      return;
    }
  }

  const incidents = await listIncidents({ serviceDate, serviceType });
  sendJson(res, 200, { incidents });
}

async function handleCreateIncident(req, res) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  const body = await readJsonBody(req);
  let normalized;
  try {
    normalized = normalizeIncidentInput(body);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }

  const saved = await createIncident(normalized);

  await appendAudit({
    actorUserId: active.user.id,
    action: "INCIDENT_CREATED",
    entityType: "incidents",
    entityId: saved.incident.id,
    beforeData: saved.before,
    afterData: saved.after,
    metadata: { serviceDate: normalized.serviceDate, serviceType: normalized.serviceType }
  });

  sendJson(res, 201, { incident: saved.incident });
}

async function handleUpdateIncident(req, res, incidentId) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  const body = await readJsonBody(req);
  let normalized;
  try {
    normalized = normalizeIncidentInput(body);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }

  const saved = await updateIncident(incidentId, normalized);
  if (!saved) {
    sendJson(res, 404, { error: "Incident not found" });
    return;
  }

  await appendAudit({
    actorUserId: active.user.id,
    action: "INCIDENT_UPDATED",
    entityType: "incidents",
    entityId: saved.incident.id,
    beforeData: saved.before,
    afterData: saved.after,
    metadata: { serviceDate: normalized.serviceDate, serviceType: normalized.serviceType }
  });

  sendJson(res, 200, { incident: saved.incident });
}

async function handleRecalculateIncidents(req, res) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  const body = await readJsonBody(req);
  const serviceDate = body.serviceDate;
  if (!isDateString(serviceDate)) {
    badRequest(res, "serviceDate is required in YYYY-MM-DD format");
    return;
  }

  let serviceType;
  try {
    serviceType = normalizeServiceType(body.serviceType);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }

  let recalculated;
  try {
    recalculated = await recalculateIncidents(serviceDate, serviceType);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }

  await appendAudit({
    actorUserId: active.user.id,
    action: "DAILY_METRIC_RECALCULATED_FROM_INCIDENTS",
    entityType: "daily_metrics",
    entityId: recalculated.metric.id,
    beforeData: recalculated.before,
    afterData: recalculated.after,
    metadata: { serviceDate, serviceType, incidentsCount: recalculated.incidentsCount }
  });

  sendJson(res, 200, { metric: recalculated.metric, incidentsCount: recalculated.incidentsCount });
}

async function handleUpsertDayType(req, res, serviceDate) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  const body = await readJsonBody(req);
  let normalized;
  try {
    normalized = normalizeDayTypeInput(body, serviceDate);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }

  const saved = await upsertDayType(normalized);

  await appendAudit({
    actorUserId: active.user.id,
    action: saved.before ? "DAY_TYPE_UPDATED" : "DAY_TYPE_CREATED",
    entityType: "day_types",
    entityId: serviceDate,
    beforeData: saved.before,
    afterData: saved.after,
    metadata: { serviceDate }
  });

  sendJson(res, 200, { dayType: saved.dayType });
}

async function handleListDayTypes(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  let range;
  try {
    range = resolveRange(parsedUrl);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }

  const rows = await listDayTypes(range);
  sendJson(res, 200, { dayTypes: rows });
}

function resolveRange(parsedUrl) {
  const dateFrom = parsedUrl.searchParams.get("dateFrom") || null;
  const dateTo = parsedUrl.searchParams.get("dateTo") || null;
  if (dateFrom && !isDateString(dateFrom)) {
    throw new Error("dateFrom must be in YYYY-MM-DD format");
  }
  if (dateTo && !isDateString(dateTo)) {
    throw new Error("dateTo must be in YYYY-MM-DD format");
  }
  return { dateFrom, dateTo };
}

function toDateValue(dateLike) {
  const d = new Date(`${dateLike}T12:00:00`);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftDate(dateValue, diffDays) {
  const d = new Date(`${dateValue}T12:00:00`);
  d.setDate(d.getDate() + diffDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function resolveDashboardScope(parsedUrl) {
  const raw = String(parsedUrl.searchParams.get("scope") || "total").toLowerCase();
  if (raw !== "total" && raw !== "pickup" && raw !== "dropoff") {
    throw new Error("scope must be total, pickup, or dropoff");
  }
  return raw;
}

function metricsList() {
  return ["passengers", "rides", "efficiency", "serviceQuality", "issues", "issuesRate", "affectedRate"];
}

function pickScopePoint(point, scope) {
  if (!point) return {};
  return point[scope] || point.total || {};
}

function defaultDirection(metricKey) {
  if (metricKey === "issues" || metricKey === "issuesRate" || metricKey === "affectedRate") {
    return "at_most";
  }
  return "at_least";
}

function computeGap(actual, target, direction) {
  if (target === null || target === undefined) return null;
  return direction === "at_most" ? target - actual : actual - target;
}

function resolveActiveTarget(targets, metricKey, scopeKey, focusDate) {
  const scopes = scopeKey === "total" ? ["total"] : [scopeKey, "total"];
  for (const scope of scopes) {
    const active = (targets || [])
      .filter((row) =>
        row.metricKey === metricKey &&
        row.scopeKey === scope &&
        row.effectiveFrom <= focusDate &&
        (!row.effectiveTo || row.effectiveTo >= focusDate)
      )
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
    if (active.length) return active[0];
  }
  return null;
}

function avg(values) {
  if (!values.length) return null;
  return values.reduce((acc, v) => acc + Number(v || 0), 0) / values.length;
}

function mapDayTypes(dayTypes) {
  const out = {};
  for (const row of dayTypes || []) {
    out[row.serviceDate] = row.dayType || "";
  }
  return out;
}

function computeBaselineByDayType(trendPoints, dayTypes, focusDate, scope) {
  const dayTypeByDate = mapDayTypes(dayTypes);
  const focusType = dayTypeByDate[focusDate] || null;
  const previous = (trendPoints || [])
    .filter((point) => point.serviceDate < focusDate)
    .sort((a, b) => (a.serviceDate < b.serviceDate ? 1 : -1));
  const chosen = focusType
    ? previous.filter((p) => dayTypeByDate[p.serviceDate] === focusType).slice(0, 7)
    : previous.slice(0, 7);

  const baseline = {};
  for (const metricKey of metricsList()) {
    baseline[metricKey] = avg(chosen.map((point) => Number(pickScopePoint(point, scope)[metricKey] || 0)));
  }
  return { baseline, focusDayType: focusType, sampleCount: chosen.length };
}

function statusFromThresholdsOrTarget(actual, metricKey, threshold, target, direction) {
  if (threshold) {
    if (actual >= threshold.greenMin && actual <= threshold.greenMax) return "green";
    if (actual >= threshold.yellowMin && actual <= threshold.yellowMax) return "yellow";
    if (actual >= threshold.redMin && actual <= threshold.redMax) return "red";
    return null;
  }
  if (target === null || target === undefined) return null;
  if (direction === "at_most") {
    if (actual <= target) return "green";
    if (actual <= target * 1.03) return "yellow";
    return "red";
  }
  if (actual >= target) return "green";
  if (actual >= target * 0.97) return "yellow";
  return "red";
}

function normalizeDayTypeBucket(dayTypeRaw) {
  const normalized = String(dayTypeRaw || "").toLowerCase().trim();
  if (!normalized) return "unknown";
  if (normalized.includes("שישי") || normalized.includes("friday")) return "friday";
  if (normalized.includes("ערב חג") || normalized.includes("holiday_eve")) return "holiday_eve";
  if (normalized.includes("חריג") || normalized.includes("exception")) return "exception";
  if (normalized.includes("א-ה") || normalized.includes("weekday") || normalized.includes("regular")) return "weekday";
  return normalized;
}

function filterRowsByDate(rows, dateFrom, dateTo) {
  return (rows || []).filter((row) => {
    const d = row.serviceDate;
    if (!d) return false;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });
}

function scopeToServiceType(scope) {
  return scope === "total" ? undefined : scope;
}

async function handleDashboardIncidentsAnalysis(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) return;

  let range;
  let scope;
  try {
    range = resolveRange(parsedUrl);
    scope = resolveDashboardScope(parsedUrl);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }
  if (!range.dateFrom || !range.dateTo) {
    badRequest(res, "dateFrom and dateTo are required");
    return;
  }

  const incidentsRaw = await listIncidents({
    serviceType: scopeToServiceType(scope)
  });
  const incidents = filterRowsByDate(incidentsRaw, range.dateFrom, range.dateTo);
  const byTypeMap = {};
  for (const incident of incidents) {
    byTypeMap[incident.issueType] = (byTypeMap[incident.issueType] || 0) + 1;
  }
  const byType = Object.entries(byTypeMap)
    .map(([issueType, count]) => ({ issueType, count }))
    .sort((a, b) => b.count - a.count);

  const delayIncidents = incidents.filter(
    (row) => row.issueType === "delay" && Number.isFinite(Number(row.delayMinutes))
  );
  const avgDelayMinutes = avg(delayIncidents.map((row) => Number(row.delayMinutes || 0)));

  const dateSet = new Set(incidents.map((row) => row.serviceDate));
  const dates = [...dateSet].sort((a, b) => (a < b ? -1 : 1));
  const trendSeries = byType.map((issueRow) => ({
    issueType: issueRow.issueType,
    points: dates.map((date) => ({
      serviceDate: date,
      count: incidents.filter((row) => row.serviceDate === date && row.issueType === issueRow.issueType).length
    }))
  }));

  sendJson(res, 200, {
    scope,
    range,
    byType,
    trendSeries,
    avgDelayMinutes: avgDelayMinutes === null ? null : Number(avgDelayMinutes.toFixed(2)),
    delayCount: delayIncidents.length,
    incidentsCount: incidents.length
  });
}

function buildTargetRowsForScope(summaryScoped, targets, thresholdsMap, scope, serviceDate, baseline) {
  const rows = [];
  for (const metricKey of metricsList()) {
    const actual = Number(summaryScoped[metricKey] || 0);
    const targetObj = resolveActiveTarget(targets || [], metricKey, scope, serviceDate);
    const target = targetObj ? Number(targetObj.targetValue) : null;
    const direction = targetObj?.direction || defaultDirection(metricKey);
    const gap = computeGap(actual, target, direction);
    rows.push({
      metricKey,
      actual,
      target,
      gap,
      status: statusFromThresholdsOrTarget(actual, metricKey, thresholdsMap[metricKey], target, direction),
      deltaVsWeekly:
        baseline && baseline[metricKey] !== null && baseline[metricKey] !== undefined
          ? actual - Number(baseline[metricKey] || 0)
          : null
    });
  }
  return rows;
}

async function handleDashboardOperationsDaily(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) return;

  let scope;
  try {
    scope = resolveDashboardScope(parsedUrl);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }

  const serviceDate = parsedUrl.searchParams.get("serviceDate");
  if (!isDateString(serviceDate)) {
    badRequest(res, "serviceDate is required in YYYY-MM-DD format");
    return;
  }
  const baselineFrom = shiftDate(serviceDate, -60);

  const [summary, incidentsRaw, targetsData, thresholdsData, dayTypes, trends] = await Promise.all([
    getKpiSummary({ dateFrom: serviceDate, dateTo: serviceDate }),
    listIncidents({ serviceDate, serviceType: scopeToServiceType(scope) }),
    listTargets({}),
    listThresholds({}),
    listDayTypes({ dateFrom: baselineFrom, dateTo: serviceDate }),
    getKpiTrends({ dateFrom: baselineFrom, dateTo: serviceDate })
  ]);

  const thresholdMap = {};
  for (const threshold of thresholdsData || []) thresholdMap[threshold.metricKey] = threshold;
  const baselineMeta = computeBaselineByDayType(trends.points || [], dayTypes || [], serviceDate, scope);
  const selectedSummary = summary[scope] || summary.total || {};
  const targetAttainment = buildTargetRowsForScope(
    selectedSummary,
    targetsData || [],
    thresholdMap,
    scope,
    serviceDate,
    baselineMeta.baseline
  );

  const issuesByTypeMap = {};
  for (const row of incidentsRaw || []) {
    issuesByTypeMap[row.issueType] = (issuesByTypeMap[row.issueType] || 0) + 1;
  }
  const issuesByType = Object.entries(issuesByTypeMap)
    .map(([issueType, count]) => ({ issueType, count }))
    .sort((a, b) => b.count - a.count);

  sendJson(res, 200, {
    serviceDate,
    scope,
    summary: {
      pickup: summary.pickup || {},
      dropoff: summary.dropoff || {},
      total: summary.total || {},
      selected: selectedSummary
    },
    incidentsCount: (incidentsRaw || []).length,
    issuesByType,
    targetAttainment
  });
}

async function handleDashboardTargetsVsActual(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) return;

  let scope;
  try {
    scope = resolveDashboardScope(parsedUrl);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }
  const serviceDate = parsedUrl.searchParams.get("serviceDate");
  if (!isDateString(serviceDate)) {
    badRequest(res, "serviceDate is required in YYYY-MM-DD format");
    return;
  }
  const baselineFrom = shiftDate(serviceDate, -60);

  const [summary, targetsData, thresholdsData, dayTypes, trends] = await Promise.all([
    getKpiSummary({ dateFrom: serviceDate, dateTo: serviceDate }),
    listTargets({}),
    listThresholds({}),
    listDayTypes({ dateFrom: baselineFrom, dateTo: serviceDate }),
    getKpiTrends({ dateFrom: baselineFrom, dateTo: serviceDate })
  ]);
  const thresholdMap = {};
  for (const threshold of thresholdsData || []) thresholdMap[threshold.metricKey] = threshold;
  const baselineMeta = computeBaselineByDayType(trends.points || [], dayTypes || [], serviceDate, scope);
  const rows = buildTargetRowsForScope(
    summary[scope] || summary.total || {},
    targetsData || [],
    thresholdMap,
    scope,
    serviceDate,
    baselineMeta.baseline
  );

  sendJson(res, 200, {
    serviceDate,
    scope,
    rows
  });
}

async function handleDashboardLoadEfficiency(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) return;

  let range;
  let scope;
  try {
    range = resolveRange(parsedUrl);
    scope = resolveDashboardScope(parsedUrl);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }
  if (!range.dateFrom || !range.dateTo) {
    badRequest(res, "dateFrom and dateTo are required");
    return;
  }

  const [trends, incidents] = await Promise.all([
    getKpiTrends(range),
    listIncidents({ serviceType: scopeToServiceType(scope) })
  ]);
  const points = (trends.points || []).map((point) => ({
    serviceDate: point.serviceDate,
    efficiency: Number((pickScopePoint(point, scope).efficiency || 0))
  }));

  const bins = [
    { key: "0-2", min: 0, max: 2, count: 0 },
    { key: "2-4", min: 2, max: 4, count: 0 },
    { key: "4-6", min: 4, max: 6, count: 0 },
    { key: "6-8", min: 6, max: 8, count: 0 },
    { key: "8+", min: 8, max: Number.POSITIVE_INFINITY, count: 0 }
  ];
  for (const point of points) {
    const bin = bins.find((item) => point.efficiency >= item.min && point.efficiency < item.max);
    if (bin) bin.count += 1;
  }

  const underloadedDays = points.filter((point) => point.efficiency > 0 && point.efficiency < 2.5);
  const overloadedDays = points.filter((point) => point.efficiency >= 6);
  const incidentsScoped = filterRowsByDate(incidents, range.dateFrom, range.dateTo);
  const overCapacityIncidents = incidentsScoped.filter((row) => row.issueType === "over_capacity").length;

  sendJson(res, 200, {
    scope,
    range,
    histogram: bins.map((item) => ({ bin: item.key, count: item.count })),
    series: points,
    flags: {
      underloadedDaysCount: underloadedDays.length,
      overloadedDaysCount: overloadedDays.length,
      overCapacityIncidents
    },
    flagDays: {
      underloaded: underloadedDays.slice(-20),
      overloaded: overloadedDays.slice(-20)
    }
  });
}

async function handleDashboardPickupVsDropoff(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) return;

  let range;
  try {
    range = resolveRange(parsedUrl);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }
  if (!range.dateFrom || !range.dateTo) {
    badRequest(res, "dateFrom and dateTo are required");
    return;
  }

  const summary = await getKpiSummary(range);
  const pickup = summary.pickup || {};
  const dropoff = summary.dropoff || {};
  const metrics = {};
  for (const metricKey of metricsList()) {
    metrics[metricKey] = {
      pickup: Number(pickup[metricKey] || 0),
      dropoff: Number(dropoff[metricKey] || 0),
      diff: Number(pickup[metricKey] || 0) - Number(dropoff[metricKey] || 0)
    };
  }
  sendJson(res, 200, {
    range,
    metrics
  });
}

async function handleDashboardExportDailyPdf(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) return;

  let scope;
  try {
    scope = resolveDashboardScope(parsedUrl);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }
  const serviceDate = parsedUrl.searchParams.get("serviceDate");
  if (!isDateString(serviceDate)) {
    badRequest(res, "serviceDate is required in YYYY-MM-DD format");
    return;
  }

  const operationsSummary = await getKpiSummary({ dateFrom: serviceDate, dateTo: serviceDate });
  const baselineFrom = shiftDate(serviceDate, -60);
  const [targetsData, thresholdsData, dayTypes, trends, pickupDropoff] = await Promise.all([
    listTargets({}),
    listThresholds({}),
    listDayTypes({ dateFrom: baselineFrom, dateTo: serviceDate }),
    getKpiTrends({ dateFrom: baselineFrom, dateTo: serviceDate }),
    getKpiSummary({ dateFrom: shiftDate(serviceDate, -6), dateTo: serviceDate })
  ]);
  const thresholdMap = {};
  for (const threshold of thresholdsData || []) thresholdMap[threshold.metricKey] = threshold;
  const baselineMeta = computeBaselineByDayType(trends.points || [], dayTypes || [], serviceDate, scope);
  const targetsVsActual = buildTargetRowsForScope(
    operationsSummary[scope] || operationsSummary.total || {},
    targetsData || [],
    thresholdMap,
    scope,
    serviceDate,
    baselineMeta.baseline
  );

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => {
      const filename = `dashboard_daily_report_${serviceDate}_${scope}.pdf`;
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=\"${filename}\"`,
        ...securityHeaders()
      });
      res.end(Buffer.concat(chunks));
      resolve();
    });

    const selected = operationsSummary[scope] || operationsSummary.total || {};
    const pickup = pickupDropoff.pickup || {};
    const dropoff = pickupDropoff.dropoff || {};
    doc.fontSize(18).text("DashboardRyde Daily Management Report", { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Service Date: ${serviceDate}`);
    doc.text(`Scope: ${scope}`);
    doc.moveDown(0.8);
    doc.fontSize(13).text("Daily KPI Summary", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10);
    for (const metricKey of metricsList()) {
      doc.text(`${metricKey}: ${Number(selected[metricKey] || 0).toFixed(2)}`);
    }
    doc.moveDown(0.8);
    doc.fontSize(13).text("Pickup vs Dropoff Snapshot", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10);
    doc.text(`Pickup serviceQuality: ${Number(pickup.serviceQuality || 0).toFixed(2)}`);
    doc.text(`Dropoff serviceQuality: ${Number(dropoff.serviceQuality || 0).toFixed(2)}`);
    doc.text(`Pickup issues: ${Number(pickup.issues || 0).toFixed(0)}`);
    doc.text(`Dropoff issues: ${Number(dropoff.issues || 0).toFixed(0)}`);
    doc.moveDown(0.8);
    doc.fontSize(13).text("Targets vs Actual", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10);
    for (const row of targetsVsActual) {
      doc.text(
        `${row.metricKey}: actual=${row.actual.toFixed(2)} target=${row.target === null ? "n/a" : Number(row.target).toFixed(2)} gap=${row.gap === null ? "n/a" : Number(row.gap).toFixed(2)} status=${row.status || "n/a"}`
      );
    }
    doc.end();
  });
}

async function handleDashboardOverview(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) return;

  let range;
  let scope;
  try {
    range = resolveRange(parsedUrl);
    scope = resolveDashboardScope(parsedUrl);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }

  const today = toDateValue(new Date().toISOString().slice(0, 10));
  const serviceDate = parsedUrl.searchParams.get("serviceDate") || range.dateTo || today;
  if (!isDateString(serviceDate)) {
    badRequest(res, "serviceDate must be in YYYY-MM-DD format");
    return;
  }
  const dateFrom = range.dateFrom || shiftDate(serviceDate, -6);
  const dateTo = range.dateTo || serviceDate;
  const baselineFrom = shiftDate(serviceDate, -60);

  const [summary, trends, dayTypes, targetsData, thresholdsData] = await Promise.all([
    getKpiSummary({ dateFrom, dateTo }),
    getKpiTrends({ dateFrom: baselineFrom, dateTo: serviceDate }),
    listDayTypes({ dateFrom: baselineFrom, dateTo: serviceDate }),
    listTargets({}),
    listThresholds({})
  ]);

  const thresholdMap = {};
  for (const threshold of thresholdsData || []) {
    thresholdMap[threshold.metricKey] = threshold;
  }
  const baselineMeta = computeBaselineByDayType(trends.points || [], dayTypes || [], serviceDate, scope);
  const scopedSummary = summary[scope] || summary.total || {};
  const cards = {};
  for (const metricKey of metricsList()) {
    const actual = Number(scopedSummary[metricKey] || 0);
    const targetObj = resolveActiveTarget(targetsData || [], metricKey, scope, serviceDate);
    const target = targetObj ? Number(targetObj.targetValue) : null;
    const direction = targetObj?.direction || defaultDirection(metricKey);
    const gap = computeGap(actual, target, direction);
    const baseline = baselineMeta.baseline[metricKey];
    const deltaVsWeekly = baseline === null || baseline === undefined ? null : actual - baseline;
    cards[metricKey] = {
      actual,
      target,
      gap,
      baseline,
      deltaVsWeekly,
      status: statusFromThresholdsOrTarget(actual, metricKey, thresholdMap[metricKey], target, direction)
    };
  }

  sendJson(res, 200, {
    scope,
    range: { dateFrom, dateTo },
    context: {
      pickupDateCurrent: today,
      dropoffDatePrevious: shiftDate(today, -1),
      focusDate: serviceDate,
      focusDayType: baselineMeta.focusDayType,
      baselineSampleCount: baselineMeta.sampleCount
    },
    summary: scopedSummary,
    cards
  });
}

async function handleDashboardTrends(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) return;

  let range;
  let scope;
  try {
    range = resolveRange(parsedUrl);
    scope = resolveDashboardScope(parsedUrl);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }
  if (!range.dateFrom || !range.dateTo) {
    badRequest(res, "dateFrom and dateTo are required");
    return;
  }

  const baselineFrom = shiftDate(range.dateTo, -60);
  const [trends, dayTypes, targetsData] = await Promise.all([
    getKpiTrends({ dateFrom: range.dateFrom, dateTo: range.dateTo }),
    listDayTypes({ dateFrom: baselineFrom, dateTo: range.dateTo }),
    listTargets({})
  ]);
  const baselineTrends = await getKpiTrends({ dateFrom: baselineFrom, dateTo: range.dateTo });
  const baselineMeta = computeBaselineByDayType(baselineTrends.points || [], dayTypes || [], range.dateTo, scope);
  const focusDate = range.dateTo;

  const targetLines = {};
  for (const metricKey of metricsList()) {
    const targetObj = resolveActiveTarget(targetsData || [], metricKey, scope, focusDate);
    targetLines[metricKey] = targetObj ? Number(targetObj.targetValue) : null;
  }

  const points = (trends.points || []).map((point) => {
    const scopedPoint = pickScopePoint(point, scope);
    return {
      serviceDate: point.serviceDate,
      passengers: Number(scopedPoint.passengers || 0),
      rides: Number(scopedPoint.rides || 0),
      efficiency: Number(scopedPoint.efficiency || 0),
      serviceQuality: Number(scopedPoint.serviceQuality || 0),
      issues: Number(scopedPoint.issues || 0),
      issuesRate: Number(scopedPoint.issuesRate || 0),
      affectedRate: Number(scopedPoint.affectedRate || 0)
    };
  });

  sendJson(res, 200, {
    scope,
    range,
    points,
    overlays: {
      target: targetLines,
      weeklyBaseline: baselineMeta.baseline
    },
    context: {
      focusDate,
      focusDayType: baselineMeta.focusDayType,
      baselineSampleCount: baselineMeta.sampleCount
    }
  });
}

async function handleDashboardBenchmark(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) return;

  let scope;
  try {
    scope = resolveDashboardScope(parsedUrl);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }
  const serviceDate = parsedUrl.searchParams.get("serviceDate");
  if (!isDateString(serviceDate)) {
    badRequest(res, "serviceDate is required in YYYY-MM-DD format");
    return;
  }
  const baselineFrom = shiftDate(serviceDate, -60);

  const [dailySummary, trends, dayTypes, targetsData] = await Promise.all([
    getKpiSummary({ dateFrom: serviceDate, dateTo: serviceDate }),
    getKpiTrends({ dateFrom: baselineFrom, dateTo: serviceDate }),
    listDayTypes({ dateFrom: baselineFrom, dateTo: serviceDate }),
    listTargets({})
  ]);

  const baselineMeta = computeBaselineByDayType(trends.points || [], dayTypes || [], serviceDate, scope);
  const scopedCurrent = dailySummary[scope] || dailySummary.total || {};
  const metrics = {};
  for (const metricKey of metricsList()) {
    const targetObj = resolveActiveTarget(targetsData || [], metricKey, scope, serviceDate);
    metrics[metricKey] = {
      current: Number(scopedCurrent[metricKey] || 0),
      baseline: baselineMeta.baseline[metricKey],
      target: targetObj ? Number(targetObj.targetValue) : null
    };
  }

  const dayTypeByDate = mapDayTypes(dayTypes || []);
  const grouped = {};
  for (const point of trends.points || []) {
    const key = normalizeDayTypeBucket(dayTypeByDate[point.serviceDate]);
    grouped[key] = grouped[key] || [];
    grouped[key].push(pickScopePoint(point, scope));
  }
  const byDayType = Object.entries(grouped).map(([dayTypeBucket, rows]) => ({
    dayType: dayTypeBucket,
    passengers: avg(rows.map((row) => Number(row.passengers || 0))),
    rides: avg(rows.map((row) => Number(row.rides || 0))),
    efficiency: avg(rows.map((row) => Number(row.efficiency || 0))),
    serviceQuality: avg(rows.map((row) => Number(row.serviceQuality || 0))),
    issues: avg(rows.map((row) => Number(row.issues || 0)))
  }));

  sendJson(res, 200, {
    scope,
    serviceDate,
    metrics,
    byDayType,
    context: {
      focusDayType: baselineMeta.focusDayType,
      baselineSampleCount: baselineMeta.sampleCount
    }
  });
}

async function handleDashboardAlerts(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) return;

  let range;
  let scope;
  try {
    range = resolveRange(parsedUrl);
    scope = resolveDashboardScope(parsedUrl);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }
  if (!range.dateFrom || !range.dateTo) {
    badRequest(res, "dateFrom and dateTo are required");
    return;
  }

  const [trends, incidents, thresholds] = await Promise.all([
    getKpiTrends(range),
    listIncidents({ serviceDate: undefined, serviceType: scope === "total" ? undefined : scope }),
    listThresholds({})
  ]);
  const thresholdMap = {};
  for (const threshold of thresholds || []) {
    thresholdMap[threshold.metricKey] = threshold;
  }
  const scopedPoints = (trends.points || [])
    .map((point) => ({ serviceDate: point.serviceDate, metrics: pickScopePoint(point, scope) }))
    .sort((a, b) => (a.serviceDate < b.serviceDate ? -1 : 1));

  const redDays = scopedPoints
    .filter(({ metrics }) => {
      const quality = Number(metrics.serviceQuality || 0);
      const threshold = thresholdMap.serviceQuality;
      if (!threshold) return quality < 90;
      return quality >= threshold.redMin && quality <= threshold.redMax;
    })
    .slice(-7)
    .reverse()
    .map((row) => ({ serviceDate: row.serviceDate, value: Number(row.metrics.serviceQuality || 0) }));

  const efficiencyDropDays = scopedPoints
    .filter((row, index, rows) => {
      if (index === 0) return false;
      const prev = Number(rows[index - 1].metrics.efficiency || 0);
      const current = Number(row.metrics.efficiency || 0);
      return prev > 0 && current < prev * 0.9;
    })
    .slice(-7)
    .reverse()
    .map((row) => ({ serviceDate: row.serviceDate, value: Number(row.metrics.efficiency || 0) }));

  const issueSpikeDays = scopedPoints
    .filter((row, index, rows) => {
      if (index < 3) return false;
      const current = Number(row.metrics.issues || 0);
      const baseline = avg(rows.slice(Math.max(0, index - 3), index).map((x) => Number(x.metrics.issues || 0))) || 0;
      return current > baseline * 1.25 && current > 0;
    })
    .slice(-7)
    .reverse()
    .map((row) => ({ serviceDate: row.serviceDate, value: Number(row.metrics.issues || 0) }));

  const topWorstQuality = [...scopedPoints]
    .sort((a, b) => Number(a.metrics.serviceQuality || 0) - Number(b.metrics.serviceQuality || 0))
    .slice(0, 5)
    .map((row) => ({ serviceDate: row.serviceDate, value: Number(row.metrics.serviceQuality || 0) }));
  const topIssueDays = [...scopedPoints]
    .sort((a, b) => Number(b.metrics.issues || 0) - Number(a.metrics.issues || 0))
    .slice(0, 5)
    .map((row) => ({ serviceDate: row.serviceDate, value: Number(row.metrics.issues || 0) }));

  const incidentCountsByDate = {};
  for (const incident of incidents || []) {
    if (!incident.serviceDate) continue;
    if (incident.serviceDate < range.dateFrom || incident.serviceDate > range.dateTo) continue;
    incidentCountsByDate[incident.serviceDate] = (incidentCountsByDate[incident.serviceDate] || 0) + 1;
  }

  sendJson(res, 200, {
    scope,
    range,
    redDays,
    efficiencyDropDays,
    issueSpikeDays,
    topWorstQuality,
    topIssueDays,
    incidentCountsByDate
  });
}

async function handleKpiSummary(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  let range;
  try {
    range = resolveRange(parsedUrl);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }

  const summary = await getKpiSummary(range);
  sendJson(res, 200, summary);
}

async function handleKpiTrends(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  let range;
  try {
    range = resolveRange(parsedUrl);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }

  const trends = await getKpiTrends(range);
  sendJson(res, 200, trends);
}

async function handleKpiDrilldown(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  let range;
  try {
    range = resolveRange(parsedUrl);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }

  const serviceTypeRaw = parsedUrl.searchParams.get("serviceType") || null;
  const metricKey = parsedUrl.searchParams.get("metricKey") || null;
  let serviceType = null;
  if (serviceTypeRaw) {
    try {
      serviceType = normalizeServiceType(serviceTypeRaw);
    } catch (error) {
      badRequest(res, error.message);
      return;
    }
  }

  const payload = await getKpiDrilldown({
    ...range,
    metricKey,
    serviceType
  });
  sendJson(res, 200, payload);
}

async function handleListTargets(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  const metricKey = parsedUrl.searchParams.get("metricKey") || undefined;
  const scopeKey = parsedUrl.searchParams.get("scopeKey") || undefined;
  const targets = await listTargets({ metricKey, scopeKey });
  sendJson(res, 200, { targets });
}

async function handleCreateTarget(req, res) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  const body = await readJsonBody(req);
  let normalized;
  try {
    normalized = normalizeTargetInput(body);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }

  const saved = await createTarget(normalized);
  await appendAudit({
    actorUserId: active.user.id,
    action: "TARGET_CREATED",
    entityType: "targets_history",
    entityId: saved.target.id,
    beforeData: saved.before,
    afterData: saved.after,
    metadata: { metricKey: normalized.metricKey, scopeKey: normalized.scopeKey }
  });
  sendJson(res, 201, { target: saved.target });
}

async function handleListThresholds(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  const metricKey = parsedUrl.searchParams.get("metricKey") || undefined;
  const thresholds = await listThresholds({ metricKey });
  sendJson(res, 200, { thresholds });
}

async function handleUpsertThreshold(req, res, metricKey) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  const body = await readJsonBody(req);
  let normalized;
  try {
    normalized = normalizeThresholdInput(body);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }

  const saved = await upsertThreshold(metricKey, normalized);
  await appendAudit({
    actorUserId: active.user.id,
    action: saved.before ? "THRESHOLD_UPDATED" : "THRESHOLD_CREATED",
    entityType: "kpi_thresholds",
    entityId: metricKey,
    beforeData: saved.before,
    afterData: saved.after,
    metadata: { metricKey }
  });
  sendJson(res, 200, { threshold: saved.threshold });
}

async function handleKpiStream(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  let range;
  try {
    range = resolveRange(parsedUrl);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...securityHeaders()
  });

  const emit = async () => {
    const summary = await getKpiSummary(range);
    res.write(`event: kpi_summary\n`);
    res.write(`data: ${JSON.stringify(summary)}\n\n`);
  };

  await emit();
  const timer = setInterval(() => {
    emit().catch(() => {});
  }, 10000);

  req.on("close", () => {
    clearInterval(timer);
  });
}

function toExportFilename(prefix, range) {
  const from = range.dateFrom || "all";
  const to = range.dateTo || "all";
  return `${prefix}_${from}_${to}`;
}

function buildExportWorkbook(bundle) {
  const workbook = XLSX.utils.book_new();
  const summaryRows = [
    { scope: "pickup", ...bundle.summary.pickup },
    { scope: "dropoff", ...bundle.summary.dropoff },
    { scope: "total", ...bundle.summary.total }
  ];

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "kpi_summary");
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(bundle.trends.points.map((p) => ({ serviceDate: p.serviceDate, ...p.total }))),
    "kpi_trends"
  );
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(bundle.drilldown.dailyRows), "daily_metrics");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(bundle.drilldown.incidents), "incidents");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(bundle.targets), "targets");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(bundle.thresholds), "thresholds");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(bundle.dayTypes), "day_types");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

async function handleExportExcel(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  let range;
  try {
    range = resolveRange(parsedUrl);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }

  const bundle = await getExportBundle(range);
  const fileBuffer = buildExportWorkbook(bundle);
  const filename = `${toExportFilename("dashboard_export", range)}.xlsx`;

  res.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename=\"${filename}\"`,
    ...securityHeaders()
  });
  res.end(fileBuffer);
}

async function handleExportPdf(req, res, parsedUrl) {
  const active = await requireAuth(req, res);
  if (!active) {
    return;
  }

  let range;
  try {
    range = resolveRange(parsedUrl);
  } catch (error) {
    badRequest(res, error.message);
    return;
  }

  const bundle = await getExportBundle(range);
  const summary = bundle.summary.total;
  const lines = [
    `Generated At: ${bundle.generatedAt}`,
    `Range: ${bundle.range.dateFrom || "all"} -> ${bundle.range.dateTo || "all"}`,
    "",
    "KPI Summary (total):",
    `Passengers: ${summary.passengers}`,
    `Rides: ${summary.rides}`,
    `Efficiency: ${summary.efficiency.toFixed(2)}`,
    `Issues: ${summary.issues}`,
    `Issues Rate: ${summary.issuesRate.toFixed(2)}%`,
    `Affected Rate: ${summary.affectedRate.toFixed(2)}%`,
    `Service Quality: ${summary.serviceQuality.toFixed(2)}%`,
    "",
    `Trend Points: ${bundle.trends.points.length}`,
    `Daily Rows: ${bundle.drilldown.dailyRows.length}`,
    `Incidents: ${bundle.drilldown.incidents.length}`,
    `Targets: ${bundle.targets.length}`,
    `Thresholds: ${bundle.thresholds.length}`
  ];

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => {
      const filename = `${toExportFilename("dashboard_export", range)}.pdf`;
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=\"${filename}\"`,
        ...securityHeaders()
      });
      res.end(Buffer.concat(chunks));
      resolve();
    });

    doc.fontSize(16).text("DashboardRyde Export", { underline: true });
    doc.moveDown();
    doc.fontSize(11);
    for (const line of lines) {
      doc.text(line);
    }
    doc.end();
  });
}

async function handleRequest(req, res) {
  const host = req.headers.host || "localhost";
  const parsedUrl = new URL(req.url, `http://${host}`);
  const pathname = parsedUrl.pathname.startsWith("/api/")
    ? parsedUrl.pathname.slice("/api".length)
    : parsedUrl.pathname;
  const rateLimit = applyRateLimit(req, pathname);
  if (!rateLimit.ok) {
    sendRateLimitExceeded(res, rateLimit.retryAfterSec);
    return;
  }

  try {
    if (req.method === "GET" && pathname === "/health") {
      const provider = providerName();
      sendJson(res, 200, {
        status: "ok",
        stage: 8,
        infra: { database: provider, hosting: "vercel" }
      });
      return;
    }

    if (req.method === "GET" && pathname === "/auth/config") {
      const origin = String(req.headers.origin || "");
      const host = String(req.headers.host || "");
      const proto = String(req.headers["x-forwarded-proto"] || "https");
      const effectiveOrigin = origin || `${proto}://${host}`;
      sendJson(res, 200, {
        googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
        googleClientIdPresent: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID),
        effectiveOrigin,
        effectiveLoginUri: `${effectiveOrigin}/auth/google/callback`
      });
      return;
    }

    if (req.method === "POST" && pathname === "/auth/google/callback") {
      await handleGoogleCallback(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/auth/logout") {
      await handleLogout(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/client-errors") {
      await handleClientError(req, res);
      return;
    }

    if (providerName() !== "excel") {
      providerMisconfigured(res);
      return;
    }

    if (req.method === "GET" && pathname === "/auth/me") {
      await handleMe(req, res);
      return;
    }

    if (req.method === "GET" && pathname === "/audit-log") {
      await handleAudit(req, res, parsedUrl);
      return;
    }

    if (req.method === "GET" && pathname === "/daily-metrics") {
      await handleGetDailyMetrics(req, res, parsedUrl);
      return;
    }

    const upsertDailyMatch = pathname.match(/^\/daily-metrics\/(\d{4}-\d{2}-\d{2})\/(pickup|dropoff)$/);
    if (req.method === "PUT" && upsertDailyMatch) {
      await handleUpsertDailyMetric(req, res, upsertDailyMatch[1], upsertDailyMatch[2]);
      return;
    }

    if (req.method === "GET" && pathname === "/incidents") {
      await handleListIncidents(req, res, parsedUrl);
      return;
    }

    if (req.method === "POST" && pathname === "/incidents") {
      await handleCreateIncident(req, res);
      return;
    }

    const updateIncidentMatch = pathname.match(/^\/incidents\/([a-zA-Z0-9-]+)$/);
    if (req.method === "PUT" && updateIncidentMatch) {
      await handleUpdateIncident(req, res, updateIncidentMatch[1]);
      return;
    }

    if (req.method === "POST" && pathname === "/incidents/recalculate") {
      await handleRecalculateIncidents(req, res);
      return;
    }

    const dayTypeMatch = pathname.match(/^\/day-types\/(\d{4}-\d{2}-\d{2})$/);
    if (req.method === "PUT" && dayTypeMatch) {
      await handleUpsertDayType(req, res, dayTypeMatch[1]);
      return;
    }

    if (req.method === "GET" && pathname === "/day-types") {
      await handleListDayTypes(req, res, parsedUrl);
      return;
    }

    if (req.method === "GET" && pathname === "/kpi/summary") {
      await handleKpiSummary(req, res, parsedUrl);
      return;
    }

    if (req.method === "GET" && pathname === "/kpi/trends") {
      await handleKpiTrends(req, res, parsedUrl);
      return;
    }

    if (req.method === "GET" && pathname === "/kpi/drilldown") {
      await handleKpiDrilldown(req, res, parsedUrl);
      return;
    }

    if (req.method === "GET" && pathname === "/kpi/stream") {
      await handleKpiStream(req, res, parsedUrl);
      return;
    }

    if (req.method === "GET" && pathname === "/dashboard/overview") {
      await handleDashboardOverview(req, res, parsedUrl);
      return;
    }

    if (req.method === "GET" && pathname === "/dashboard/trends") {
      await handleDashboardTrends(req, res, parsedUrl);
      return;
    }

    if (req.method === "GET" && pathname === "/dashboard/benchmark") {
      await handleDashboardBenchmark(req, res, parsedUrl);
      return;
    }

    if (req.method === "GET" && pathname === "/dashboard/alerts") {
      await handleDashboardAlerts(req, res, parsedUrl);
      return;
    }

    if (req.method === "GET" && pathname === "/dashboard/incidents-analysis") {
      await handleDashboardIncidentsAnalysis(req, res, parsedUrl);
      return;
    }

    if (req.method === "GET" && pathname === "/dashboard/operations-daily") {
      await handleDashboardOperationsDaily(req, res, parsedUrl);
      return;
    }

    if (req.method === "GET" && pathname === "/dashboard/targets-vs-actual") {
      await handleDashboardTargetsVsActual(req, res, parsedUrl);
      return;
    }

    if (req.method === "GET" && pathname === "/dashboard/load-efficiency") {
      await handleDashboardLoadEfficiency(req, res, parsedUrl);
      return;
    }

    if (req.method === "GET" && pathname === "/dashboard/pickup-vs-dropoff") {
      await handleDashboardPickupVsDropoff(req, res, parsedUrl);
      return;
    }

    if (req.method === "GET" && pathname === "/dashboard/export/daily-pdf") {
      await handleDashboardExportDailyPdf(req, res, parsedUrl);
      return;
    }

    if (req.method === "GET" && pathname === "/management/targets") {
      await handleListTargets(req, res, parsedUrl);
      return;
    }

    if (req.method === "POST" && pathname === "/management/targets") {
      await handleCreateTarget(req, res);
      return;
    }

    if (req.method === "GET" && pathname === "/management/thresholds") {
      await handleListThresholds(req, res, parsedUrl);
      return;
    }

    const thresholdMatch = pathname.match(/^\/management\/thresholds\/([a-zA-Z0-9_.-]+)$/);
    if (req.method === "PUT" && thresholdMatch) {
      await handleUpsertThreshold(req, res, thresholdMatch[1]);
      return;
    }

    if (req.method === "GET" && pathname === "/export/excel") {
      await handleExportExcel(req, res, parsedUrl);
      return;
    }

    if (req.method === "GET" && pathname === "/export/pdf") {
      await handleExportPdf(req, res, parsedUrl);
      return;
    }

    sendJson(res, 404, { error: "Not Found" });
  } catch (error) {
    console.error("[handleRequest] Unhandled error:", error);
    if (String(error?.message || "").includes("DB_PROVIDER=excel only")) {
      providerMisconfigured(res);
      return;
    }
    sendJson(res, 500, {
      error: "Internal Server Error",
      message: error.message
    });
  }
}

module.exports = {
  handleRequest
};
