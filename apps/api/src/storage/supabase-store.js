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
  if (!raw || !raw.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Supabase response JSON parse failed (${response.status}) on ${path}: ${error.message}`
    );
  }
}

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

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function cleanDailyMetric(row) {
  if (!row) return null;
  return {
    id: row.id,
    serviceDate: row.service_date,
    serviceType: row.service_type,
    ridesCount: Number(row.rides_count),
    registeredPassengers: Number(row.registered_passengers),
    issuesCount: Number(row.issues_count),
    affectedPassengers: Number(row.affected_passengers),
    taxiCount: Number(row.taxi_count || 0),
    largeVehicleCount: Number(row.large_vehicle_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function cleanContractor(row) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function cleanDailyMetricContractor(row) {
  return {
    id: row.id,
    serviceDate: row.service_date,
    serviceType: row.service_type,
    contractorId: row.contractor_id,
    contractorName: row.contractors?.name || null,
    contractorCode: row.contractors?.code || null,
    ridesCount: Number(row.rides_count),
    taxiCount: Number(row.taxi_count),
    largeVehicleCount: Number(row.large_vehicle_count),
    registeredPassengers: Number(row.registered_passengers),
    issuesCount: Number(row.issues_count),
    affectedPassengers: Number(row.affected_passengers),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function cleanIncident(row) {
  return {
    id: row.id,
    serviceDate: row.service_date,
    serviceType: row.service_type,
    origin: row.origin,
    destination: row.destination,
    shiftTime: row.shift_time,
    passengersCount: Number(row.passengers_count),
    issueType: row.issue_type,
    description: row.description,
    delayMinutes: row.delay_minutes === null ? null : Number(row.delay_minutes),
    contractorId: row.contractor_id || null,
    contractorName: row.contractors?.name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
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

async function findUserByGoogleSubOrEmail(googleSub, email) {
  const bySub = await supabaseRequest(
    `/rest/v1/users?select=*&google_sub=eq.${encodeURIComponent(googleSub)}&limit=1`,
    { method: "GET" }
  );
  if (bySub.length > 0) return bySub[0];

  const byEmail = await supabaseRequest(
    `/rest/v1/users?select=*&email=eq.${encodeURIComponent(email)}&limit=1`,
    { method: "GET" }
  );
  if (byEmail.length > 0) return byEmail[0];
  return null;
}

async function upsertUser(profile) {
  const timestamp = nowIso();
  const existing = await findUserByGoogleSubOrEmail(profile.googleSub, profile.email);

  if (existing) {
    const before = toUserModel(existing);
    const updatedRows = await supabaseRequest(
      `/rest/v1/users?id=eq.${existing.id}&select=*`,
      {
        method: "PATCH",
        prefer: "return=representation",
        body: {
          google_sub: profile.googleSub,
          email: profile.email,
          full_name: profile.fullName,
          updated_at: timestamp
        }
      }
    );

    const user = toUserModel(updatedRows[0]);
    return { user, before, after: { ...user }, created: false };
  }

  const rows = await supabaseRequest("/rest/v1/users?select=*", {
    method: "POST",
    prefer: "return=representation",
    body: {
      google_sub: profile.googleSub,
      email: profile.email,
      full_name: profile.fullName,
      is_active: true,
      updated_at: timestamp
    }
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
    body: {
      user_id: userId,
      session_token: token,
      created_at: timestamp,
      expires_at: expiresAt
    }
  });

  return toSessionModel(rows[0]);
}

async function revokeSession(token) {
  const rows = await supabaseRequest(
    `/rest/v1/sessions?session_token=eq.${token}&revoked_at=is.null&select=*`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: { revoked_at: nowIso() }
    }
  );
  return rows.length > 0;
}

async function getActiveSession(token) {
  const sessions = await supabaseRequest(
    `/rest/v1/sessions?select=*&session_token=eq.${encodeURIComponent(token)}&revoked_at=is.null&limit=1`,
    { method: "GET" }
  );
  if (sessions.length === 0) return null;

  const session = toSessionModel(sessions[0]);
  if (new Date(session.expiresAt).getTime() <= Date.now()) return null;

  const users = await supabaseRequest(
    `/rest/v1/users?select=*&id=eq.${encodeURIComponent(session.userId)}&limit=1`,
    { method: "GET" }
  );
  if (users.length === 0 || !users[0].is_active) return null;

  return { session, user: toUserModel(users[0]) };
}

async function appendAudit(entry) {
  await supabaseRequest("/rest/v1/audit_log", {
    method: "POST",
    prefer: "return=minimal",
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

async function getDailyMetricsByDate(serviceDate) {
  const rows = await supabaseRequest(
    `/rest/v1/daily_metrics?select=*&service_date=eq.${encodeURIComponent(serviceDate)}`,
    { method: "GET" }
  );
  const pickup = cleanDailyMetric(rows.find((row) => row.service_type === "pickup"));
  const dropoff = cleanDailyMetric(rows.find((row) => row.service_type === "dropoff"));

  const dayTypes = await supabaseRequest(
    `/rest/v1/day_types?select=*&service_date=eq.${encodeURIComponent(serviceDate)}&limit=1`,
    { method: "GET" }
  );
  const dayType = dayTypes[0] || null;

  return {
    serviceDate,
    pickup,
    dropoff,
    dayType: dayType
      ? {
          serviceDate: dayType.service_date,
          dayType: dayType.day_type,
          reason: dayType.reason,
          isPartial: Boolean(dayType.is_partial),
          noActivity: Boolean(dayType.no_activity),
          updatedAt: dayType.updated_at
        }
      : null
  };
}

async function upsertDailyMetric(input) {
  const serviceType = normalizeServiceType(input.serviceType);
  const existingRows = await supabaseRequest(
    `/rest/v1/daily_metrics?select=*&service_date=eq.${encodeURIComponent(input.serviceDate)}&service_type=eq.${serviceType}&limit=1`,
    { method: "GET" }
  );
  const timestamp = nowIso();

  if (existingRows.length > 0) {
    const before = cleanDailyMetric(existingRows[0]);
    const updated = await supabaseRequest(
      `/rest/v1/daily_metrics?id=eq.${existingRows[0].id}&select=*`,
      {
        method: "PATCH",
        prefer: "return=representation",
        body: {
          rides_count: input.ridesCount,
          registered_passengers: input.registeredPassengers,
          issues_count: input.issuesCount,
          affected_passengers: input.affectedPassengers,
          taxi_count: input.taxiCount ?? 0,
          large_vehicle_count: input.largeVehicleCount ?? 0,
          updated_at: timestamp
        }
      }
    );
    const metric = cleanDailyMetric(updated[0]);
    return { before, after: metric, metric };
  }

  const inserted = await supabaseRequest("/rest/v1/daily_metrics?select=*", {
    method: "POST",
    prefer: "return=representation",
    body: {
      service_date: input.serviceDate,
      service_type: serviceType,
      rides_count: input.ridesCount,
      registered_passengers: input.registeredPassengers,
      issues_count: input.issuesCount,
      affected_passengers: input.affectedPassengers,
      taxi_count: input.taxiCount ?? 0,
      large_vehicle_count: input.largeVehicleCount ?? 0,
      created_at: timestamp,
      updated_at: timestamp
    }
  });

  const metric = cleanDailyMetric(inserted[0]);
  return { before: null, after: metric, metric };
}

async function listIncidents(filters) {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "created_at.desc");
  if (filters.serviceDate) params.set("service_date", `eq.${filters.serviceDate}`);
  if (filters.serviceType) params.set("service_type", `eq.${normalizeServiceType(filters.serviceType)}`);

  const rows = await supabaseRequest(`/rest/v1/incidents?${params.toString()}`, { method: "GET" });
  return rows.map(cleanIncident);
}

async function createIncident(input) {
  const timestamp = nowIso();
  const rows = await supabaseRequest("/rest/v1/incidents?select=*", {
    method: "POST",
    prefer: "return=representation",
    body: {
      service_date: input.serviceDate,
      service_type: normalizeServiceType(input.serviceType),
      origin: input.origin,
      destination: input.destination,
      shift_time: input.shiftTime,
      passengers_count: input.passengersCount,
      issue_type: input.issueType,
      description: input.description,
      delay_minutes: input.delayMinutes ?? null,
      contractor_id: input.contractorId || null,
      created_at: timestamp,
      updated_at: timestamp
    }
  });
  const incident = cleanIncident(rows[0]);
  return { before: null, after: incident, incident };
}

async function updateIncident(incidentId, input) {
  const existing = await supabaseRequest(
    `/rest/v1/incidents?select=*&id=eq.${encodeURIComponent(incidentId)}&limit=1`,
    { method: "GET" }
  );
  if (existing.length === 0) return null;
  const before = cleanIncident(existing[0]);

  const rows = await supabaseRequest(
    `/rest/v1/incidents?id=eq.${encodeURIComponent(incidentId)}&select=*`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        service_date: input.serviceDate,
        service_type: normalizeServiceType(input.serviceType),
        origin: input.origin,
        destination: input.destination,
        shift_time: input.shiftTime,
        passengers_count: input.passengersCount,
        issue_type: input.issueType,
        description: input.description,
        delay_minutes: input.delayMinutes ?? null,
        contractor_id: input.contractorId || null,
        updated_at: nowIso()
      }
    }
  );
  const incident = cleanIncident(rows[0]);
  return { before, after: incident, incident };
}

async function recalculateIncidents(serviceDate, serviceType) {
  const normalizedType = normalizeServiceType(serviceType);
  const incidents = await supabaseRequest(
    `/rest/v1/incidents?select=passengers_count&service_date=eq.${encodeURIComponent(serviceDate)}&service_type=eq.${normalizedType}`,
    { method: "GET" }
  );
  const existingRows = await supabaseRequest(
    `/rest/v1/daily_metrics?select=*&service_date=eq.${encodeURIComponent(serviceDate)}&service_type=eq.${normalizedType}&limit=1`,
    { method: "GET" }
  );
  if (existingRows.length === 0) {
    throw new Error("daily metric row must exist before recalculation");
  }

  const before = cleanDailyMetric(existingRows[0]);
  const affectedPassengers = incidents.reduce((sum, row) => sum + Number(row.passengers_count || 0), 0);
  const rows = await supabaseRequest(
    `/rest/v1/daily_metrics?id=eq.${existingRows[0].id}&select=*`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        issues_count: incidents.length,
        affected_passengers: affectedPassengers,
        updated_at: nowIso()
      }
    }
  );

  const metric = cleanDailyMetric(rows[0]);
  return { before, after: metric, metric, incidentsCount: incidents.length };
}

async function upsertDayType(input) {
  const existingRows = await supabaseRequest(
    `/rest/v1/day_types?select=*&service_date=eq.${encodeURIComponent(input.serviceDate)}&limit=1`,
    { method: "GET" }
  );
  const timestamp = nowIso();

  if (existingRows.length > 0) {
    const existing = existingRows[0];
    const before = {
      serviceDate: existing.service_date,
      dayType: existing.day_type,
      reason: existing.reason,
      isPartial: Boolean(existing.is_partial),
      noActivity: Boolean(existing.no_activity),
      updatedAt: existing.updated_at
    };
    const rows = await supabaseRequest(
      `/rest/v1/day_types?id=eq.${existing.id}&select=*`,
      {
        method: "PATCH",
        prefer: "return=representation",
        body: {
          day_type: input.dayType,
          reason: input.reason,
          is_partial: Boolean(input.isPartial),
          no_activity: Boolean(input.noActivity),
          updated_at: timestamp
        }
      }
    );
    const row = rows[0];
    const dayType = {
      serviceDate: row.service_date,
      dayType: row.day_type,
      reason: row.reason,
      isPartial: Boolean(row.is_partial),
      noActivity: Boolean(row.no_activity),
      updatedAt: row.updated_at
    };
    return { before, after: dayType, dayType };
  }

  const rows = await supabaseRequest("/rest/v1/day_types?select=*", {
    method: "POST",
    prefer: "return=representation",
    body: {
      service_date: input.serviceDate,
      day_type: input.dayType,
      reason: input.reason,
      is_partial: Boolean(input.isPartial),
      no_activity: Boolean(input.noActivity),
      created_at: timestamp,
      updated_at: timestamp
    }
  });
  const row = rows[0];
  const dayType = {
    serviceDate: row.service_date,
    dayType: row.day_type,
    reason: row.reason,
    isPartial: Boolean(row.is_partial),
    noActivity: Boolean(row.no_activity),
    updatedAt: row.updated_at
  };
  return { before: null, after: dayType, dayType };
}

async function listDayTypes(filters) {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "service_date.desc");
  if (filters.dateFrom) params.append("service_date", `gte.${filters.dateFrom}`);
  if (filters.dateTo) params.append("service_date", `lte.${filters.dateTo}`);

  const rows = await supabaseRequest(`/rest/v1/day_types?${params.toString()}`, { method: "GET" });
  return rows.map((row) => ({
    serviceDate: row.service_date,
    dayType: row.day_type,
    reason: row.reason,
    isPartial: Boolean(row.is_partial),
    noActivity: Boolean(row.no_activity),
    updatedAt: row.updated_at
  }));
}

async function getKpiSummary(filters) {
  const params = new URLSearchParams();
  params.set("select", "*");
  if (filters.dateFrom) params.append("service_date", `gte.${filters.dateFrom}`);
  if (filters.dateTo) params.append("service_date", `lte.${filters.dateTo}`);
  const rowsRaw = await supabaseRequest(`/rest/v1/daily_metrics?${params.toString()}`, { method: "GET" });
  const rows = rowsRaw.map(cleanDailyMetric);
  const pickup = rows.filter((row) => row.serviceType === "pickup");
  const dropoff = rows.filter((row) => row.serviceType === "dropoff");

  return {
    range: { dateFrom: filters.dateFrom || null, dateTo: filters.dateTo || null },
    pickup: aggregateRows(pickup),
    dropoff: aggregateRows(dropoff),
    total: aggregateRows(rows)
  };
}

async function getKpiTrends(filters) {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "service_date.asc");
  if (filters.dateFrom) params.append("service_date", `gte.${filters.dateFrom}`);
  if (filters.dateTo) params.append("service_date", `lte.${filters.dateTo}`);
  const rowsRaw = await supabaseRequest(`/rest/v1/daily_metrics?${params.toString()}`, { method: "GET" });
  const rows = rowsRaw.map(cleanDailyMetric);

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.serviceDate)) grouped.set(row.serviceDate, []);
    grouped.get(row.serviceDate).push(row);
  }

  const points = [...grouped.entries()].map(([serviceDate, groupedRows]) => ({
    serviceDate,
    pickup: aggregateRows(groupedRows.filter((row) => row.serviceType === "pickup")),
    dropoff: aggregateRows(groupedRows.filter((row) => row.serviceType === "dropoff")),
    total: aggregateRows(groupedRows)
  }));

  return {
    range: { dateFrom: filters.dateFrom || null, dateTo: filters.dateTo || null },
    points
  };
}

async function getKpiDrilldown(filters) {
  const metricsParams = new URLSearchParams();
  metricsParams.set("select", "*");
  if (filters.dateFrom) metricsParams.append("service_date", `gte.${filters.dateFrom}`);
  if (filters.dateTo) metricsParams.append("service_date", `lte.${filters.dateTo}`);
  if (filters.serviceType) metricsParams.set("service_type", `eq.${normalizeServiceType(filters.serviceType)}`);

  const incidentsParams = new URLSearchParams();
  incidentsParams.set("select", "*");
  if (filters.dateFrom) incidentsParams.append("service_date", `gte.${filters.dateFrom}`);
  if (filters.dateTo) incidentsParams.append("service_date", `lte.${filters.dateTo}`);
  if (filters.serviceType) incidentsParams.set("service_type", `eq.${normalizeServiceType(filters.serviceType)}`);

  const [metricsRaw, incidentsRaw] = await Promise.all([
    supabaseRequest(`/rest/v1/daily_metrics?${metricsParams.toString()}`, { method: "GET" }),
    supabaseRequest(`/rest/v1/incidents?${incidentsParams.toString()}`, { method: "GET" })
  ]);

  const dailyRows = metricsRaw.map(cleanDailyMetric);
  const incidents = incidentsRaw.map(cleanIncident);

  return {
    filters: {
      dateFrom: filters.dateFrom || null,
      dateTo: filters.dateTo || null,
      serviceType: filters.serviceType ? normalizeServiceType(filters.serviceType) : null,
      metricKey: filters.metricKey || null
    },
    summary: aggregateRows(dailyRows),
    dailyRows,
    incidents
  };
}

async function listTargets(filters) {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "effective_from.desc");
  if (filters.metricKey) params.set("metric_key", `eq.${filters.metricKey}`);
  if (filters.scopeKey) params.set("scope_key", `eq.${filters.scopeKey}`);

  const rows = await supabaseRequest(`/rest/v1/targets_history?${params.toString()}`, { method: "GET" });
  return rows.map((row) => ({
    id: row.id,
    metricKey: row.metric_key,
    scopeKey: row.scope_key,
    direction: row.direction,
    targetValue: Number(row.target_value),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to || null,
    updatedAt: row.updated_at
  }));
}

async function createTarget(input) {
  const timestamp = nowIso();
  const rows = await supabaseRequest("/rest/v1/targets_history?select=*", {
    method: "POST",
    prefer: "return=representation",
    body: {
      metric_key: input.metricKey,
      scope_key: input.scopeKey,
      direction: input.direction,
      target_value: input.targetValue,
      effective_from: input.effectiveFrom,
      effective_to: input.effectiveTo || null,
      created_at: timestamp,
      updated_at: timestamp
    }
  });

  const row = rows[0];
  const target = {
    id: row.id,
    metricKey: row.metric_key,
    scopeKey: row.scope_key,
    direction: row.direction,
    targetValue: Number(row.target_value),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  return { before: null, after: { ...target }, target };
}

async function listThresholds(filters) {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "metric_key.asc");
  if (filters && filters.metricKey) params.set("metric_key", `eq.${filters.metricKey}`);
  const rows = await supabaseRequest(`/rest/v1/kpi_thresholds?${params.toString()}`, { method: "GET" });

  return rows.map((row) => ({
    metricKey: row.metric_key,
    greenMin: Number(row.green_min),
    greenMax: Number(row.green_max),
    yellowMin: Number(row.yellow_min),
    yellowMax: Number(row.yellow_max),
    redMin: Number(row.red_min),
    redMax: Number(row.red_max),
    updatedAt: row.updated_at
  }));
}

async function upsertThreshold(metricKey, input) {
  const existingRows = await supabaseRequest(
    `/rest/v1/kpi_thresholds?select=*&metric_key=eq.${encodeURIComponent(metricKey)}&limit=1`,
    { method: "GET" }
  );
  const before = existingRows[0]
    ? {
        metricKey: existingRows[0].metric_key,
        greenMin: Number(existingRows[0].green_min),
        greenMax: Number(existingRows[0].green_max),
        yellowMin: Number(existingRows[0].yellow_min),
        yellowMax: Number(existingRows[0].yellow_max),
        redMin: Number(existingRows[0].red_min),
        redMax: Number(existingRows[0].red_max),
        updatedAt: existingRows[0].updated_at
      }
    : null;

  const timestamp = nowIso();
  let row;
  if (existingRows.length === 0) {
    const inserted = await supabaseRequest("/rest/v1/kpi_thresholds?select=*", {
      method: "POST",
      prefer: "return=representation",
      body: {
        metric_key: metricKey,
        green_min: input.greenMin,
        green_max: input.greenMax,
        yellow_min: input.yellowMin,
        yellow_max: input.yellowMax,
        red_min: input.redMin,
        red_max: input.redMax,
        created_at: timestamp,
        updated_at: timestamp
      }
    });
    row = inserted[0];
  } else {
    const updated = await supabaseRequest(
      `/rest/v1/kpi_thresholds?metric_key=eq.${encodeURIComponent(metricKey)}&select=*`,
      {
        method: "PATCH",
        prefer: "return=representation",
        body: {
          green_min: input.greenMin,
          green_max: input.greenMax,
          yellow_min: input.yellowMin,
          yellow_max: input.yellowMax,
          red_min: input.redMin,
          red_max: input.redMax,
          updated_at: timestamp
        }
      }
    );
    row = updated[0];
  }

  const threshold = {
    metricKey: row.metric_key,
    greenMin: Number(row.green_min),
    greenMax: Number(row.green_max),
    yellowMin: Number(row.yellow_min),
    yellowMax: Number(row.yellow_max),
    redMin: Number(row.red_min),
    redMax: Number(row.red_max),
    updatedAt: row.updated_at
  };
  return { before, after: threshold, threshold };
}

// ─── Contractors ─────────────────────────────────────────────────────────────

async function listContractors({ activeOnly = false } = {}) {
  let path = "/rest/v1/contractors?select=*&order=name.asc";
  if (activeOnly) path += "&active=eq.true";
  const rows = await supabaseRequest(path, { method: "GET" });
  return (rows || []).map(cleanContractor);
}

async function createContractor({ name, code }) {
  const timestamp = nowIso();
  const rows = await supabaseRequest("/rest/v1/contractors?select=*", {
    method: "POST",
    prefer: "return=representation",
    body: { name, code, active: true, created_at: timestamp, updated_at: timestamp }
  });
  return cleanContractor(rows[0]);
}

async function updateContractor(id, { name, code, active }) {
  const rows = await supabaseRequest(
    `/rest/v1/contractors?id=eq.${encodeURIComponent(id)}&select=*`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: { name, code, active, updated_at: nowIso() }
    }
  );
  return rows && rows[0] ? cleanContractor(rows[0]) : null;
}

// ─── Per-contractor daily metrics ─────────────────────────────────────────────

async function listDailyMetricsContractor(serviceDate, serviceType) {
  const type = normalizeServiceType(serviceType);
  const rows = await supabaseRequest(
    `/rest/v1/daily_metrics_contractor?select=*,contractors(name,code)&service_date=eq.${encodeURIComponent(serviceDate)}&service_type=eq.${type}&order=contractors(name).asc`,
    { method: "GET" }
  );
  return (rows || []).map(cleanDailyMetricContractor);
}

async function upsertDailyMetricContractor(serviceDate, serviceType, contractorId, input) {
  const type = normalizeServiceType(serviceType);
  const timestamp = nowIso();
  const existing = await supabaseRequest(
    `/rest/v1/daily_metrics_contractor?select=*&service_date=eq.${encodeURIComponent(serviceDate)}&service_type=eq.${type}&contractor_id=eq.${encodeURIComponent(contractorId)}&limit=1`,
    { method: "GET" }
  );
  const body = {
    rides_count: input.ridesCount ?? 0,
    taxi_count: input.taxiCount ?? 0,
    large_vehicle_count: input.largeVehicleCount ?? 0,
    registered_passengers: input.registeredPassengers ?? 0,
    issues_count: input.issuesCount ?? 0,
    affected_passengers: input.affectedPassengers ?? 0,
    updated_at: timestamp
  };
  if (existing && existing.length > 0) {
    const rows = await supabaseRequest(
      `/rest/v1/daily_metrics_contractor?id=eq.${existing[0].id}&select=*,contractors(name,code)`,
      { method: "PATCH", prefer: "return=representation", body }
    );
    return cleanDailyMetricContractor(rows[0]);
  }
  const rows = await supabaseRequest("/rest/v1/daily_metrics_contractor?select=*,contractors(name,code)", {
    method: "POST",
    prefer: "return=representation",
    body: {
      service_date: serviceDate,
      service_type: type,
      contractor_id: contractorId,
      ...body,
      created_at: timestamp
    }
  });
  return cleanDailyMetricContractor(rows[0]);
}

// ─── Contractors comparison dashboard ────────────────────────────────────────

async function getContractorsComparison({ dateFrom, dateTo, serviceType }) {
  const contractors = await listContractors({ activeOnly: true });
  if (!contractors.length) return { contractors: [], rows: [] };

  let path = `/rest/v1/daily_metrics_contractor?select=*,contractors(name,code)`;
  if (dateFrom) path += `&service_date=gte.${encodeURIComponent(dateFrom)}`;
  if (dateTo)   path += `&service_date=lte.${encodeURIComponent(dateTo)}`;
  if (serviceType) path += `&service_type=eq.${normalizeServiceType(serviceType)}`;
  path += `&order=service_date.asc`;

  const rows = await supabaseRequest(path, { method: "GET" });
  const data = (rows || []).map(cleanDailyMetricContractor);

  // Aggregate per contractor
  const byContractor = {};
  for (const row of data) {
    const cid = row.contractorId;
    if (!byContractor[cid]) {
      byContractor[cid] = {
        contractorId: cid,
        name: row.contractorName,
        code: row.contractorCode,
        rides: 0, taxis: 0, largeVehicles: 0,
        passengers: 0, issues: 0, affected: 0, days: 0
      };
    }
    const c = byContractor[cid];
    c.rides += row.ridesCount;
    c.taxis += row.taxiCount;
    c.largeVehicles += row.largeVehicleCount;
    c.passengers += row.registeredPassengers;
    c.issues += row.issuesCount;
    c.affected += row.affectedPassengers;
    c.days++;
  }

  const summaries = Object.values(byContractor).map(c => ({
    ...c,
    issuesRate: c.rides ? (c.issues / c.rides) * 100 : 0,
    affectedRate: c.passengers ? (c.affected / c.passengers) * 100 : 0,
    efficiency: c.rides ? c.passengers / c.rides : 0
  }));

  return { contractors, summaries, daily: data };
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
  getExportBundle,
  listContractors,
  createContractor,
  updateContractor,
  listDailyMetricsContractor,
  upsertDailyMetricContractor,
  getContractorsComparison
};
