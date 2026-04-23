const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const XLSX = require("xlsx");

const DEFAULT_DB_PATH = path.join(__dirname, "..", "..", ".data", "operations-store.xlsx");

function dbPath() {
  return process.env.EXCEL_DB_PATH || DEFAULT_DB_PATH;
}

function nowIso() {
  return new Date().toISOString();
}

function ensureWorkbook() {
  const target = dbPath();
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(target)) {
    return;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), "users");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), "sessions");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), "audit_log");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), "daily_metrics");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), "incidents");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), "day_types");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), "targets_history");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), "kpi_thresholds");
  XLSX.writeFile(workbook, target);
}

function readSheet(workbook, name) {
  const sheet = workbook.Sheets[name];
  if (!sheet) {
    return [];
  }
  return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

function loadWorkbookState() {
  ensureWorkbook();
  const workbook = XLSX.readFile(dbPath(), { cellDates: false });

  return {
    users: readSheet(workbook, "users"),
    sessions: readSheet(workbook, "sessions"),
    auditLog: readSheet(workbook, "audit_log"),
    dailyMetrics: readSheet(workbook, "daily_metrics"),
    incidents: readSheet(workbook, "incidents"),
    dayTypes: readSheet(workbook, "day_types"),
    targetsHistory: readSheet(workbook, "targets_history"),
    kpiThresholds: readSheet(workbook, "kpi_thresholds")
  };
}

function saveWorkbookState(state) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(state.users), "users");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(state.sessions), "sessions");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(state.auditLog), "audit_log");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(state.dailyMetrics), "daily_metrics");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(state.incidents), "incidents");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(state.dayTypes), "day_types");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(state.targetsHistory), "targets_history");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(state.kpiThresholds), "kpi_thresholds");
  XLSX.writeFile(workbook, dbPath());
}

function normalizeServiceType(serviceType) {
  const normalized = String(serviceType || "").toLowerCase();
  if (normalized !== "pickup" && normalized !== "dropoff") {
    throw new Error("serviceType must be pickup or dropoff");
  }
  return normalized;
}

function parseJson(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function dailyKey(serviceDate, serviceType) {
  return `${serviceDate}:${normalizeServiceType(serviceType)}`;
}

function cleanDailyMetric(row) {
  if (!row) {
    return null;
  }
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
    delayMinutes: row.delayMinutes === null ? null : Number(row.delayMinutes),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

async function upsertUser(profile) {
  const state = loadWorkbookState();
  const existing = state.users.find((u) => u.googleSub === profile.googleSub || u.email === profile.email);
  const timestamp = nowIso();

  if (existing) {
    const before = { ...existing };
    existing.googleSub = profile.googleSub;
    existing.email = profile.email;
    existing.fullName = profile.fullName;
    existing.updatedAt = timestamp;
    saveWorkbookState(state);
    return { user: existing, before, after: { ...existing }, created: false };
  }

  const user = {
    id: crypto.randomUUID(),
    googleSub: profile.googleSub,
    email: profile.email,
    fullName: profile.fullName,
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  state.users.push(user);
  saveWorkbookState(state);
  return { user, before: null, after: { ...user }, created: true };
}

async function createSession(userId, ttlHours) {
  const state = loadWorkbookState();
  const session = {
    id: crypto.randomUUID(),
    userId,
    sessionToken: crypto.randomBytes(32).toString("hex"),
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString(),
    revokedAt: null
  };

  state.sessions.push(session);
  saveWorkbookState(state);
  return session;
}

async function revokeSession(token) {
  const state = loadWorkbookState();
  const session = state.sessions.find((s) => s.sessionToken === token && !s.revokedAt);
  if (!session) {
    return false;
  }

  session.revokedAt = nowIso();
  saveWorkbookState(state);
  return true;
}

async function getActiveSession(token) {
  const state = loadWorkbookState();
  const session = state.sessions.find((s) => s.sessionToken === token && !s.revokedAt);
  if (!session) {
    return null;
  }

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  const user = state.users.find((u) => u.id === session.userId && u.isActive);
  if (!user) {
    return null;
  }

  return { session, user };
}

async function appendAudit(entry) {
  const state = loadWorkbookState();
  state.auditLog.push({
    id: crypto.randomUUID(),
    createdAt: nowIso(),
    actorUserId: entry.actorUserId || null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId || null,
    beforeData: JSON.stringify(entry.beforeData || null),
    afterData: JSON.stringify(entry.afterData || null),
    metadata: JSON.stringify(entry.metadata || null)
  });
  saveWorkbookState(state);
}

async function listAudit(filters) {
  const state = loadWorkbookState();
  let rows = [...state.auditLog];

  if (filters.actorUserId) {
    rows = rows.filter((r) => r.actorUserId === filters.actorUserId);
  }
  if (filters.entityType) {
    rows = rows.filter((r) => r.entityType === filters.entityType);
  }
  if (filters.action) {
    rows = rows.filter((r) => r.action === filters.action);
  }
  if (filters.dateFrom) {
    rows = rows.filter((r) => r.createdAt >= filters.dateFrom);
  }
  if (filters.dateTo) {
    rows = rows.filter((r) => r.createdAt <= filters.dateTo);
  }

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
  const state = loadWorkbookState();
  const rows = state.dailyMetrics.filter((row) => row.serviceDate === serviceDate);
  const pickup = cleanDailyMetric(rows.find((row) => row.serviceType === "pickup"));
  const dropoff = cleanDailyMetric(rows.find((row) => row.serviceType === "dropoff"));
  const dayType = state.dayTypes.find((row) => row.serviceDate === serviceDate) || null;

  return {
    serviceDate,
    pickup,
    dropoff,
    dayType: dayType
      ? {
          serviceDate: dayType.serviceDate,
          dayType: dayType.dayType,
          reason: dayType.reason,
          isPartial: Boolean(dayType.isPartial),
          noActivity: Boolean(dayType.noActivity),
          updatedAt: dayType.updatedAt
        }
      : null
  };
}

async function upsertDailyMetric(input) {
  const state = loadWorkbookState();
  const serviceType = normalizeServiceType(input.serviceType);
  const key = dailyKey(input.serviceDate, serviceType);
  const timestamp = nowIso();

  let existing = state.dailyMetrics.find((row) => row.key === key);
  const before = existing ? cleanDailyMetric(existing) : null;

  if (existing) {
    existing.ridesCount = input.ridesCount;
    existing.registeredPassengers = input.registeredPassengers;
    existing.issuesCount = input.issuesCount;
    existing.affectedPassengers = input.affectedPassengers;
    existing.updatedAt = timestamp;
  } else {
    existing = {
      id: crypto.randomUUID(),
      key,
      serviceDate: input.serviceDate,
      serviceType,
      ridesCount: input.ridesCount,
      registeredPassengers: input.registeredPassengers,
      issuesCount: input.issuesCount,
      affectedPassengers: input.affectedPassengers,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    state.dailyMetrics.push(existing);
  }

  saveWorkbookState(state);
  return {
    before,
    after: cleanDailyMetric(existing),
    metric: cleanDailyMetric(existing)
  };
}

async function listIncidents(filters) {
  const state = loadWorkbookState();
  let rows = [...state.incidents];

  if (filters.serviceDate) {
    rows = rows.filter((row) => row.serviceDate === filters.serviceDate);
  }
  if (filters.serviceType) {
    const serviceType = normalizeServiceType(filters.serviceType);
    rows = rows.filter((row) => row.serviceType === serviceType);
  }

  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return rows.map(cleanIncident);
}

async function createIncident(input) {
  const state = loadWorkbookState();
  const timestamp = nowIso();

  const row = {
    id: crypto.randomUUID(),
    serviceDate: input.serviceDate,
    serviceType: normalizeServiceType(input.serviceType),
    origin: input.origin,
    destination: input.destination,
    shiftTime: input.shiftTime,
    passengersCount: input.passengersCount,
    issueType: input.issueType,
    description: input.description,
    delayMinutes: input.delayMinutes ?? null,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  state.incidents.push(row);
  saveWorkbookState(state);
  return { before: null, after: cleanIncident(row), incident: cleanIncident(row) };
}

async function updateIncident(incidentId, input) {
  const state = loadWorkbookState();
  const row = state.incidents.find((item) => item.id === incidentId);
  if (!row) {
    return null;
  }

  const before = cleanIncident(row);
  row.serviceDate = input.serviceDate;
  row.serviceType = normalizeServiceType(input.serviceType);
  row.origin = input.origin;
  row.destination = input.destination;
  row.shiftTime = input.shiftTime;
  row.passengersCount = input.passengersCount;
  row.issueType = input.issueType;
  row.description = input.description;
  row.delayMinutes = input.delayMinutes ?? null;
  row.updatedAt = nowIso();

  saveWorkbookState(state);
  return { before, after: cleanIncident(row), incident: cleanIncident(row) };
}

async function recalculateIncidents(serviceDate, serviceType) {
  const normalizedType = normalizeServiceType(serviceType);
  const state = loadWorkbookState();
  const incidents = state.incidents.filter(
    (row) => row.serviceDate === serviceDate && row.serviceType === normalizedType
  );

  const key = dailyKey(serviceDate, normalizedType);
  const metricRow = state.dailyMetrics.find((row) => row.key === key);
  if (!metricRow) {
    throw new Error("daily metric row must exist before recalculation");
  }

  const before = cleanDailyMetric(metricRow);
  metricRow.issuesCount = incidents.length;
  metricRow.affectedPassengers = incidents.reduce((sum, row) => sum + Number(row.passengersCount || 0), 0);
  metricRow.updatedAt = nowIso();

  saveWorkbookState(state);
  return {
    before,
    after: cleanDailyMetric(metricRow),
    metric: cleanDailyMetric(metricRow),
    incidentsCount: incidents.length
  };
}

async function upsertDayType(input) {
  const state = loadWorkbookState();
  let row = state.dayTypes.find((item) => item.serviceDate === input.serviceDate);
  const timestamp = nowIso();
  const before = row
    ? {
        serviceDate: row.serviceDate,
        dayType: row.dayType,
        reason: row.reason,
        isPartial: Boolean(row.isPartial),
        noActivity: Boolean(row.noActivity),
        updatedAt: row.updatedAt
      }
    : null;

  if (row) {
    row.dayType = input.dayType;
    row.reason = input.reason;
    row.isPartial = Boolean(input.isPartial);
    row.noActivity = Boolean(input.noActivity);
    row.updatedAt = timestamp;
  } else {
    row = {
      id: crypto.randomUUID(),
      serviceDate: input.serviceDate,
      dayType: input.dayType,
      reason: input.reason,
      isPartial: Boolean(input.isPartial),
      noActivity: Boolean(input.noActivity),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    state.dayTypes.push(row);
  }

  saveWorkbookState(state);

  return {
    before,
    after: {
      serviceDate: row.serviceDate,
      dayType: row.dayType,
      reason: row.reason,
      isPartial: Boolean(row.isPartial),
      noActivity: Boolean(row.noActivity),
      updatedAt: row.updatedAt
    },
    dayType: {
      serviceDate: row.serviceDate,
      dayType: row.dayType,
      reason: row.reason,
      isPartial: Boolean(row.isPartial),
      noActivity: Boolean(row.noActivity),
      updatedAt: row.updatedAt
    }
  };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function safePercent(numerator, denominator) {
  if (!denominator) {
    return 0;
  }
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
    if (dateFrom && row.serviceDate < dateFrom) {
      return false;
    }
    if (dateTo && row.serviceDate > dateTo) {
      return false;
    }
    return true;
  });
}

async function getKpiSummary(filters) {
  const state = loadWorkbookState();
  const dateFrom = filters.dateFrom || null;
  const dateTo = filters.dateTo || null;
  const scoped = filterByDateRange(state.dailyMetrics, dateFrom, dateTo);

  const pickupRows = scoped.filter((row) => row.serviceType === "pickup");
  const dropoffRows = scoped.filter((row) => row.serviceType === "dropoff");

  return {
    range: { dateFrom, dateTo },
    pickup: aggregateRows(pickupRows),
    dropoff: aggregateRows(dropoffRows),
    total: aggregateRows(scoped)
  };
}

async function getKpiTrends(filters) {
  const state = loadWorkbookState();
  const dateFrom = filters.dateFrom || null;
  const dateTo = filters.dateTo || null;
  const scoped = filterByDateRange(state.dailyMetrics, dateFrom, dateTo);

  const grouped = new Map();
  for (const row of scoped) {
    if (!grouped.has(row.serviceDate)) {
      grouped.set(row.serviceDate, []);
    }
    grouped.get(row.serviceDate).push(row);
  }

  const points = [...grouped.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([serviceDate, rows]) => {
      const pickupRows = rows.filter((row) => row.serviceType === "pickup");
      const dropoffRows = rows.filter((row) => row.serviceType === "dropoff");
      return {
        serviceDate,
        pickup: aggregateRows(pickupRows),
        dropoff: aggregateRows(dropoffRows),
        total: aggregateRows(rows)
      };
    });

  return {
    range: { dateFrom, dateTo },
    points
  };
}

async function getKpiDrilldown(filters) {
  const state = loadWorkbookState();
  const dateFrom = filters.dateFrom || null;
  const dateTo = filters.dateTo || null;
  const serviceType = filters.serviceType ? normalizeServiceType(filters.serviceType) : null;
  const metricKey = filters.metricKey || null;

  const metricsScoped = filterByDateRange(state.dailyMetrics, dateFrom, dateTo).filter((row) => {
    if (!serviceType) {
      return true;
    }
    return row.serviceType === serviceType;
  });

  const incidentsScoped = filterByDateRange(state.incidents, dateFrom, dateTo).filter((row) => {
    if (!serviceType) {
      return true;
    }
    return row.serviceType === serviceType;
  });

  const summary = aggregateRows(metricsScoped);
  return {
    filters: { dateFrom, dateTo, serviceType, metricKey },
    summary,
    dailyRows: metricsScoped.map(cleanDailyMetric),
    incidents: incidentsScoped.map(cleanIncident)
  };
}

async function listDayTypes(filters) {
  const state = loadWorkbookState();
  const dateFrom = filters.dateFrom || null;
  const dateTo = filters.dateTo || null;
  const rows = filterByDateRange(state.dayTypes, dateFrom, dateTo)
    .sort((a, b) => (a.serviceDate < b.serviceDate ? 1 : -1))
    .map((row) => ({
      serviceDate: row.serviceDate,
      dayType: row.dayType,
      reason: row.reason,
      isPartial: Boolean(row.isPartial),
      noActivity: Boolean(row.noActivity),
      updatedAt: row.updatedAt
    }));
  return rows;
}

async function listTargets(filters) {
  const state = loadWorkbookState();
  let rows = [...state.targetsHistory];

  if (filters.metricKey) {
    rows = rows.filter((row) => row.metricKey === filters.metricKey);
  }
  if (filters.scopeKey) {
    rows = rows.filter((row) => row.scopeKey === filters.scopeKey);
  }

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
  const state = loadWorkbookState();
  const row = {
    id: crypto.randomUUID(),
    metricKey: input.metricKey,
    scopeKey: input.scopeKey,
    direction: input.direction,
    targetValue: input.targetValue,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo || null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.targetsHistory.push(row);
  saveWorkbookState(state);
  return { before: null, after: { ...row }, target: { ...row, targetValue: Number(row.targetValue) } };
}

async function listThresholds(filters) {
  const state = loadWorkbookState();
  let rows = [...state.kpiThresholds];
  if (filters.metricKey) {
    rows = rows.filter((row) => row.metricKey === filters.metricKey);
  }
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
  const state = loadWorkbookState();
  let row = state.kpiThresholds.find((item) => item.metricKey === metricKey);
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
      greenMin: input.greenMin,
      greenMax: input.greenMax,
      yellowMin: input.yellowMin,
      yellowMax: input.yellowMax,
      redMin: input.redMin,
      redMax: input.redMax,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    state.kpiThresholds.push(row);
  } else {
    row.greenMin = input.greenMin;
    row.greenMax = input.greenMax;
    row.yellowMin = input.yellowMin;
    row.yellowMax = input.yellowMax;
    row.redMin = input.redMin;
    row.redMax = input.redMax;
    row.updatedAt = nowIso();
  }

  saveWorkbookState(state);
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
  upsertThreshold
};
