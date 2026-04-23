function isDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function normalizeServiceType(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized !== "pickup" && normalized !== "dropoff") {
    throw new Error("serviceType must be pickup or dropoff");
  }
  return normalized;
}

function normalizeDailyMetricInput(payload, serviceDate, serviceType) {
  if (!isDateString(serviceDate)) {
    throw new Error("serviceDate must be in YYYY-MM-DD format");
  }

  const normalized = {
    serviceDate,
    serviceType: normalizeServiceType(serviceType),
    ridesCount: Number(payload.ridesCount),
    registeredPassengers: Number(payload.registeredPassengers),
    issuesCount: Number(payload.issuesCount),
    affectedPassengers: Number(payload.affectedPassengers)
  };

  for (const field of ["ridesCount", "registeredPassengers", "issuesCount", "affectedPassengers"]) {
    if (!isNonNegativeInteger(normalized[field])) {
      throw new Error(`${field} must be a non-negative integer`);
    }
  }

  if (normalized.affectedPassengers > normalized.registeredPassengers) {
    throw new Error("affectedPassengers cannot exceed registeredPassengers");
  }

  if (normalized.issuesCount > normalized.ridesCount) {
    throw new Error("issuesCount cannot exceed ridesCount");
  }

  return normalized;
}

function normalizeIncidentInput(payload) {
  if (!isDateString(payload.serviceDate)) {
    throw new Error("serviceDate must be in YYYY-MM-DD format");
  }

  const normalized = {
    serviceDate: payload.serviceDate,
    serviceType: normalizeServiceType(payload.serviceType),
    origin: String(payload.origin || "").trim(),
    destination: String(payload.destination || "").trim(),
    shiftTime: String(payload.shiftTime || "").trim(),
    passengersCount: Number(payload.passengersCount),
    issueType: String(payload.issueType || "").trim(),
    description: String(payload.description || "").trim(),
    delayMinutes:
      payload.delayMinutes === null || payload.delayMinutes === undefined || payload.delayMinutes === ""
        ? null
        : Number(payload.delayMinutes)
  };

  for (const field of ["origin", "destination", "shiftTime", "issueType"]) {
    if (!normalized[field]) {
      throw new Error(`${field} is required`);
    }
  }

  if (!isNonNegativeInteger(normalized.passengersCount)) {
    throw new Error("passengersCount must be a non-negative integer");
  }

  if (normalized.issueType.toLowerCase() === "delay") {
    if (!isNonNegativeInteger(normalized.delayMinutes)) {
      throw new Error("delayMinutes is required and must be a non-negative integer when issueType=delay");
    }
  }

  if (normalized.delayMinutes !== null && !isNonNegativeInteger(normalized.delayMinutes)) {
    throw new Error("delayMinutes must be a non-negative integer");
  }

  return normalized;
}

function normalizeDayTypeInput(payload, serviceDate) {
  if (!isDateString(serviceDate)) {
    throw new Error("serviceDate must be in YYYY-MM-DD format");
  }

  const dayType = String(payload.dayType || "").trim();
  if (!dayType) {
    throw new Error("dayType is required");
  }

  return {
    serviceDate,
    dayType,
    reason: String(payload.reason || "").trim() || null,
    isPartial: Boolean(payload.isPartial),
    noActivity: Boolean(payload.noActivity)
  };
}

function normalizeTargetInput(payload) {
  const metricKey = String(payload.metricKey || "").trim();
  const scopeKey = String(payload.scopeKey || "").trim();
  const direction = String(payload.direction || "").trim();
  const effectiveFrom = String(payload.effectiveFrom || "").trim();
  const effectiveTo = payload.effectiveTo ? String(payload.effectiveTo).trim() : null;
  const targetValue = Number(payload.targetValue);

  if (!metricKey) {
    throw new Error("metricKey is required");
  }
  if (!scopeKey) {
    throw new Error("scopeKey is required");
  }
  if (direction !== "at_least" && direction !== "at_most") {
    throw new Error("direction must be at_least or at_most");
  }
  if (!isDateString(effectiveFrom)) {
    throw new Error("effectiveFrom must be in YYYY-MM-DD format");
  }
  if (effectiveTo && !isDateString(effectiveTo)) {
    throw new Error("effectiveTo must be in YYYY-MM-DD format");
  }
  if (!Number.isFinite(targetValue) || targetValue < 0) {
    throw new Error("targetValue must be a non-negative number");
  }

  return {
    metricKey,
    scopeKey,
    direction,
    targetValue,
    effectiveFrom,
    effectiveTo
  };
}

function normalizeThresholdInput(payload) {
  const out = {
    greenMin: Number(payload.greenMin),
    greenMax: Number(payload.greenMax),
    yellowMin: Number(payload.yellowMin),
    yellowMax: Number(payload.yellowMax),
    redMin: Number(payload.redMin),
    redMax: Number(payload.redMax)
  };

  for (const [k, v] of Object.entries(out)) {
    if (!Number.isFinite(v)) {
      throw new Error(`${k} must be a number`);
    }
  }

  return out;
}

module.exports = {
  isDateString,
  normalizeDailyMetricInput,
  normalizeIncidentInput,
  normalizeDayTypeInput,
  normalizeServiceType,
  normalizeTargetInput,
  normalizeThresholdInput
};
