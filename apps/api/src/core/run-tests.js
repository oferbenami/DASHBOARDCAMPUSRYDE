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
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers;
    },
    end(data) {
      this.payload = data ? JSON.parse(data) : null;
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

  await appendAudit({
    actorUserId: userWrite.user.id,
    action: "MANUAL_TEST_AUDIT",
    entityType: "test",
    entityId: "1"
  });
  const audit = await listAudit({ actorUserId: userWrite.user.id, limit: 50 });
  assert.ok(audit.length >= 1);
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
    ["google token validator", testGoogleValidatorMock]
  ];

  for (const [name, fn] of tests) {
    await fn();
    console.log(`PASS: ${name}`);
  }

  cleanupTestFile();
  console.log("Stage 3 test suite passed.");
}

run().catch((error) => {
  console.error("Stage 3 test suite failed:", error.message);
  cleanupTestFile();
  process.exit(1);
});
