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

async function handleGoogleCallback(req, res) {
  const body = await readJsonBody(req);
  if (!body.idToken || typeof body.idToken !== "string") {
    badRequest(res, "idToken is required");
    return;
  }

  const verified = await verifyGoogleIdToken(body.idToken);
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
      sendJson(res, 200, {
        googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || ""
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
    sendJson(res, 500, {
      error: "Internal Server Error",
      message: error.message
    });
  }
}

module.exports = {
  handleRequest
};



