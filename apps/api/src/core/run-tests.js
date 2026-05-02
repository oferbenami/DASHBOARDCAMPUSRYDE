const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

process.env.DB_PROVIDER = "excel";
process.env.EXCEL_DB_PATH = path.join(__dirname, "..", "..", ".data", "test-operations-store.xlsx");

const {
  upsertUser,
  createSession,
  upsertDailyMetric,
  getDailyMetricsByDate,
  createIncident,
  updateIncident,
  listIncidents,
  recalculateIncidents,
  upsertDayType,
  appendAudit,
  listAudit
} = require("../storage/identity-store");
const {
  normalizeDailyMetricInput,
  normalizeIncidentInput
} = require("./daily-validation");
const { verifyGoogleIdToken } = require("../auth/google-token");
const { handleRequest } = require("../app");

function cleanupTestFile() {
  if (fs.existsSync(process.env.EXCEL_DB_PATH)) {
    fs.rmSync(process.env.EXCEL_DB_PATH, { force: true });
  }
}

function createReqRes({ method, pathName, body, token }) {
  const req = {
    method,
    url: pathName,
    headers: {
      host: "localhost:4000",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body
  };

  const res = {
    statusCode: 200,
    headers: {},
    payload: null,
    rawBody: null,
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = Object.fromEntries(
        Object.entries(headers || {}).map(([k, v]) => [String(k).toLowerCase(), v])
      );
    },
    end(data) {
      this.rawBody = data || null;
      const contentType = String(this.headers["content-type"] || "");
      if (data && contentType.includes("application/json")) {
        this.payload = JSON.parse(data);
      } else {
        this.payload = null;
      }
    }
  };

  return { req, res };
}

async function invokeApi({ method, pathName, body, token }) {
  const { req, res } = createReqRes({ method, pathName, body, token });
  await handleRequest(req, res);
  return res;
}

async function testStorageCrudFlow() {
  const daily = await upsertDailyMetric({
    serviceDate: "2026-04-22",
    serviceType: "pickup",
    ridesCount: 10,
    registeredPassengers: 100,
    issuesCount: 0,
    affectedPassengers: 0
  });

  assert.equal(daily.metric.serviceType, "pickup");

  const createdIncident = await createIncident({
    serviceDate: "2026-04-22",
    serviceType: "pickup",
    origin: "Gate A",
    destination: "Dorm B",
    shiftTime: "08:00",
    passengersCount: 5,
    issueType: "delay",
    description: "Traffic",
    delayMinutes: 12
  });

  assert.ok(createdIncident.incident.id);

  const updated = await updateIncident(createdIncident.incident.id, {
    serviceDate: "2026-04-22",
    serviceType: "pickup",
    origin: "Gate A",
    destination: "Dorm C",
    shiftTime: "08:15",
    passengersCount: 7,
    issueType: "delay",
    description: "Updated",
    delayMinutes: 15
  });
  assert.equal(updated.incident.destination, "Dorm C");

  const recalc = await recalculateIncidents("2026-04-22", "pickup");
  assert.equal(recalc.metric.issuesCount, 1);
  assert.equal(recalc.metric.affectedPassengers, 7);

  const dailyRead = await getDailyMetricsByDate("2026-04-22");
  assert.equal(dailyRead.pickup.affectedPassengers, 7);

  const incidents = await listIncidents({ serviceDate: "2026-04-22", serviceType: "pickup" });
  assert.equal(incidents.length, 1);

  const dayType = await upsertDayType({
    serviceDate: "2026-04-22",
    dayType: "regular",
    reason: null,
    isPartial: false,
    noActivity: false
  });
  assert.equal(dayType.dayType.dayType, "regular");
}

async function testValidationRules() {
  assert.throws(
    () =>
      normalizeDailyMetricInput(
        { ridesCount: 1, registeredPassengers: 5, issuesCount: 2, affectedPassengers: 1 },
        "2026-04-22",
        "pickup"
      ),
    /issuesCount cannot exceed ridesCount/
  );

  assert.throws(
    () =>
      normalizeIncidentInput({
        serviceDate: "2026-04-22",
        serviceType: "pickup",
        origin: "A",
        destination: "B",
        shiftTime: "08:00",
        passengersCount: 2,
        issueType: "delay",
        description: "Late"
      }),
    /delayMinutes is required/
  );
}

async function testApiFlow() {
  const userWrite = await upsertUser({
    googleSub: "sub-api",
    email: "api-user@example.com",
    fullName: "API User"
  });
  const session = await createSession(userWrite.user.id, 2);

  const unauthorized = await invokeApi({ method: "GET", pathName: "/daily-metrics?date=2026-04-22" });
  assert.equal(unauthorized.statusCode, 401);

  const saveDaily = await invokeApi({
    method: "PUT",
    pathName: "/daily-metrics/2026-04-22/pickup",
    token: session.sessionToken,
    body: {
      ridesCount: 15,
      registeredPassengers: 140,
      issuesCount: 0,
      affectedPassengers: 0
    }
  });
  assert.equal(saveDaily.statusCode, 200);

  const saveIncident = await invokeApi({
    method: "POST",
    pathName: "/incidents",
    token: session.sessionToken,
    body: {
      serviceDate: "2026-04-22",
      serviceType: "pickup",
      origin: "A",
      destination: "B",
      shiftTime: "09:00",
      passengersCount: 3,
      issueType: "delay",
      description: "Late",
      delayMinutes: 9
    }
  });
  assert.equal(saveIncident.statusCode, 201);

  const recalc = await invokeApi({
    method: "POST",
    pathName: "/incidents/recalculate",
    token: session.sessionToken,
    body: {
      serviceDate: "2026-04-22",
      serviceType: "pickup"
    }
  });
  assert.equal(recalc.statusCode, 200);
  assert.equal(recalc.payload.metric.issuesCount, 2);

  const summary = await invokeApi({
    method: "GET",
    pathName: "/kpi/summary?dateFrom=2026-04-22&dateTo=2026-04-22",
    token: session.sessionToken
  });
  assert.equal(summary.statusCode, 200);
  assert.ok(summary.payload.total.rides >= 15);
  assert.ok(summary.payload.total.issues >= 2);

  const trends = await invokeApi({
    method: "GET",
    pathName: "/kpi/trends?dateFrom=2026-04-22&dateTo=2026-04-22",
    token: session.sessionToken
  });
  assert.equal(trends.statusCode, 200);
  assert.ok(Array.isArray(trends.payload.points));
  assert.equal(trends.payload.points.length, 1);

  const drilldown = await invokeApi({
    method: "GET",
    pathName: "/kpi/drilldown?dateFrom=2026-04-22&dateTo=2026-04-22&serviceType=pickup",
    token: session.sessionToken
  });
  assert.equal(drilldown.statusCode, 200);
  assert.ok(Array.isArray(drilldown.payload.dailyRows));
  assert.ok(drilldown.payload.dailyRows.length >= 1);

  const createTargetRes = await invokeApi({
    method: "POST",
    pathName: "/management/targets",
    token: session.sessionToken,
    body: {
      metricKey: "serviceQuality",
      scopeKey: "total",
      direction: "at_least",
      targetValue: 98,
      effectiveFrom: "2026-04-01",
      effectiveTo: null
    }
  });
  assert.equal(createTargetRes.statusCode, 201);

  const listTargetsRes = await invokeApi({
    method: "GET",
    pathName: "/management/targets?metricKey=serviceQuality",
    token: session.sessionToken
  });
  assert.equal(listTargetsRes.statusCode, 200);
  assert.ok(listTargetsRes.payload.targets.length >= 1);

  const putThresholdRes = await invokeApi({
    method: "PUT",
    pathName: "/management/thresholds/serviceQuality",
    token: session.sessionToken,
    body: {
      greenMin: 95,
      greenMax: 100,
      yellowMin: 90,
      yellowMax: 95,
      redMin: 0,
      redMax: 90
    }
  });
  assert.equal(putThresholdRes.statusCode, 200);

  const listThresholdRes = await invokeApi({
    method: "GET",
    pathName: "/management/thresholds",
    token: session.sessionToken
  });
  assert.equal(listThresholdRes.statusCode, 200);
  assert.ok(listThresholdRes.payload.thresholds.length >= 1);

  const dashboardOverview = await invokeApi({
    method: "GET",
    pathName: "/dashboard/overview?dateFrom=2026-04-22&dateTo=2026-04-22&scope=pickup",
    token: session.sessionToken
  });
  assert.equal(dashboardOverview.statusCode, 200);
  assert.equal(dashboardOverview.payload.scope, "pickup");
  assert.ok(dashboardOverview.payload.cards.serviceQuality);

  const dashboardTrends = await invokeApi({
    method: "GET",
    pathName: "/dashboard/trends?dateFrom=2026-04-22&dateTo=2026-04-22&scope=pickup",
    token: session.sessionToken
  });
  assert.equal(dashboardTrends.statusCode, 200);
  assert.ok(Array.isArray(dashboardTrends.payload.points));

  const dashboardBenchmark = await invokeApi({
    method: "GET",
    pathName: "/dashboard/benchmark?serviceDate=2026-04-22&scope=pickup",
    token: session.sessionToken
  });
  assert.equal(dashboardBenchmark.statusCode, 200);
  assert.ok(dashboardBenchmark.payload.metrics.serviceQuality);

  const dashboardAlerts = await invokeApi({
    method: "GET",
    pathName: "/dashboard/alerts?dateFrom=2026-04-22&dateTo=2026-04-22&scope=pickup",
    token: session.sessionToken
  });
  assert.equal(dashboardAlerts.statusCode, 200);
  assert.ok(Array.isArray(dashboardAlerts.payload.redDays));

  const dashboardIncidentAnalysis = await invokeApi({
    method: "GET",
    pathName: "/dashboard/incidents-analysis?dateFrom=2026-04-22&dateTo=2026-04-22&scope=pickup",
    token: session.sessionToken
  });
  assert.equal(dashboardIncidentAnalysis.statusCode, 200);
  assert.ok(Array.isArray(dashboardIncidentAnalysis.payload.byType));

  const dashboardOperationsDaily = await invokeApi({
    method: "GET",
    pathName: "/dashboard/operations-daily?serviceDate=2026-04-22&scope=pickup",
    token: session.sessionToken
  });
  assert.equal(dashboardOperationsDaily.statusCode, 200);
  assert.ok(dashboardOperationsDaily.payload.summary.selected);

  const dashboardTargetsVsActual = await invokeApi({
    method: "GET",
    pathName: "/dashboard/targets-vs-actual?serviceDate=2026-04-22&scope=pickup",
    token: session.sessionToken
  });
  assert.equal(dashboardTargetsVsActual.statusCode, 200);
  assert.ok(Array.isArray(dashboardTargetsVsActual.payload.rows));

  const dashboardLoadEfficiency = await invokeApi({
    method: "GET",
    pathName: "/dashboard/load-efficiency?dateFrom=2026-04-22&dateTo=2026-04-22&scope=pickup",
    token: session.sessionToken
  });
  assert.equal(dashboardLoadEfficiency.statusCode, 200);
  assert.ok(Array.isArray(dashboardLoadEfficiency.payload.histogram));

  const dashboardPickupVsDropoff = await invokeApi({
    method: "GET",
    pathName: "/dashboard/pickup-vs-dropoff?dateFrom=2026-04-22&dateTo=2026-04-22",
    token: session.sessionToken
  });
  assert.equal(dashboardPickupVsDropoff.statusCode, 200);
  assert.ok(dashboardPickupVsDropoff.payload.metrics.serviceQuality);

  const dashboardDailyPdf = await invokeApi({
    method: "GET",
    pathName: "/dashboard/export/daily-pdf?serviceDate=2026-04-22&scope=pickup",
    token: session.sessionToken
  });
  assert.equal(dashboardDailyPdf.statusCode, 200);
  assert.equal(String(dashboardDailyPdf.headers["content-type"]), "application/pdf");
  assert.ok(dashboardDailyPdf.rawBody);

  const exportExcelRes = await invokeApi({
    method: "GET",
    pathName: "/export/excel?dateFrom=2026-04-22&dateTo=2026-04-22",
    token: session.sessionToken
  });
  assert.equal(exportExcelRes.statusCode, 200);
  assert.match(String(exportExcelRes.headers["content-type"]), /sheet/);
  assert.ok(exportExcelRes.rawBody);

  const exportPdfRes = await invokeApi({
    method: "GET",
    pathName: "/export/pdf?dateFrom=2026-04-22&dateTo=2026-04-22",
    token: session.sessionToken
  });
  assert.equal(exportPdfRes.statusCode, 200);
  assert.equal(String(exportPdfRes.headers["content-type"]), "application/pdf");
  assert.ok(exportPdfRes.rawBody);

  await appendAudit({
    actorUserId: userWrite.user.id,
    action: "MANUAL_TEST_AUDIT",
    entityType: "test",
    entityId: "1"
  });
  const audit = await listAudit({ actorUserId: userWrite.user.id, limit: 50 });
  assert.ok(audit.length >= 1);
}

async function testHardening() {
  const health = await invokeApi({ method: "GET", pathName: "/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.headers["x-content-type-options"], "nosniff");
  assert.equal(health.headers["x-frame-options"], "DENY");

  let rateLimited = false;
  for (let i = 0; i < 140; i += 1) {
    const res = await invokeApi({ method: "GET", pathName: "/health" });
    if (res.statusCode === 429) {
      rateLimited = true;
      break;
    }
  }
  assert.equal(rateLimited, true);
}

async function testSupabaseProviderRequiresConfiguration() {
  const prevProvider = process.env.DB_PROVIDER;
  const userWrite = await upsertUser({
    googleSub: "sub-provider-guard",
    email: "provider-guard@example.com",
    fullName: "Provider Guard"
  });
  const session = await createSession(userWrite.user.id, 2);
  process.env.DB_PROVIDER = "supabase";
  try {
    const dashboardRes = await invokeApi({
      method: "GET",
      pathName: "/dashboard/trends?dateFrom=2026-04-22&dateTo=2026-04-22&scope=pickup",
      token: session.sessionToken
    });
    assert.equal(dashboardRes.statusCode, 500);

    const kpiSummaryRes = await invokeApi({
      method: "GET",
      pathName: "/kpi/summary?dateFrom=2026-04-22&dateTo=2026-04-22",
      token: session.sessionToken
    });
    assert.equal(kpiSummaryRes.statusCode, 500);

    const kpiTrendsRes = await invokeApi({
      method: "GET",
      pathName: "/kpi/trends?dateFrom=2026-04-22&dateTo=2026-04-22",
      token: session.sessionToken
    });
    assert.equal(kpiTrendsRes.statusCode, 500);
  } finally {
    process.env.DB_PROVIDER = prevProvider || "excel";
  }
}

async function testGoogleValidatorMock() {
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sub: "google-sub",
        email: "user@example.com",
        name: "User Example",
        email_verified: "true",
        aud: "client-id"
      };
    }
  });

  process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
  const ok = await verifyGoogleIdToken("fake-token");
  assert.equal(ok.ok, true);

  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sub: "google-sub",
        email: "user@example.com",
        name: "User Example",
        email_verified: "true",
        aud: "other-client"
      };
    }
  });

  const bad = await verifyGoogleIdToken("fake-token");
  assert.equal(bad.ok, false);
  global.fetch = originalFetch;
}

async function run() {
  cleanupTestFile();

  const tests = [
    ["storage CRUD flow", testStorageCrudFlow],
    ["validation rules", testValidationRules],
    ["api flow", testApiFlow],
    ["supabase provider requires configuration", testSupabaseProviderRequiresConfiguration],
    ["hardening", testHardening],
    ["google token validator", testGoogleValidatorMock]
  ];

  for (const [name, fn] of tests) {
    await fn();
    console.log(`PASS: ${name}`);
  }

  cleanupTestFile();
  console.log("Stage 7 test suite passed.");
}

run().catch((error) => {
  console.error("Stage 7 test suite failed:", error.message);
  cleanupTestFile();
  process.exit(1);
});

