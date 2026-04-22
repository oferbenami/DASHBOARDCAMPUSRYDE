const { URL } = require("node:url");

const { getBearerToken, readJsonBody, sendJson } = require("./core/http");
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
  upsertDayType
} = require("./storage/identity-store");
const {
  isDateString,
  normalizeDailyMetricInput,
  normalizeIncidentInput,
  normalizeDayTypeInput,
  normalizeServiceType
} = require("./core/daily-validation");

const sessionTtlHours = Number(process.env.SESSION_TTL_HOURS || 10);

function unauthorized(res, message) {
  sendJson(res, 401, { error: message || "Unauthorized" });
}

function badRequest(res, message) {
  sendJson(res, 400, { error: message });
}

async function requireAuth(req, res) {
  const token = getBearerToken(req);
  if (!token) {
    unauthorized(res);
    return null;
  }

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

async function handleRequest(req, res) {
  const host = req.headers.host || "localhost";
  const parsedUrl = new URL(req.url, `http://${host}`);
  const pathname = parsedUrl.pathname.startsWith("/api/")
    ? parsedUrl.pathname.slice("/api".length)
    : parsedUrl.pathname;

  try {
    if (req.method === "GET" && pathname === "/health") {
      const provider = providerName();
      sendJson(res, 200, {
        status: "ok",
        stage: 3,
        infra: { database: provider, hosting: "vercel" }
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

    sendJson(res, 404, { error: "Not Found" });
  } catch (error) {
    sendJson(res, 500, {
      error: "Internal Server Error",
      message: error.message
    });
  }
}

module.exports = {
  handleRequest
};
