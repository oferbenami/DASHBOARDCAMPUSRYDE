const assert = require("node:assert/strict");

const {
  upsertUser,
  createSession,
  getActiveSession,
  revokeSession,
  appendAudit,
  listAudit
} = require("../storage/identity-store");
const { verifyGoogleIdToken } = require("../auth/google-token");

function createSupabaseMock() {
  const users = [];
  const sessions = [];
  const auditLog = [];

  function responseOk(payload, status = 200) {
    return {
      ok: true,
      status,
      async json() {
        return payload;
      },
      async text() {
        return JSON.stringify(payload);
      }
    };
  }

  return async (url, options) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const method = (options?.method || "GET").toUpperCase();
    const body = options?.body ? JSON.parse(options.body) : null;

    if (path.endsWith("/rest/v1/users") && method === "GET") {
      const googleSub = parsed.searchParams.get("google_sub")?.replace("eq.", "");
      const email = parsed.searchParams.get("email")?.replace("eq.", "");
      const id = parsed.searchParams.get("id")?.replace("eq.", "");

      let rows = users;
      if (googleSub) rows = rows.filter((u) => u.google_sub === decodeURIComponent(googleSub));
      if (email) rows = rows.filter((u) => u.email === decodeURIComponent(email));
      if (id) rows = rows.filter((u) => u.id === decodeURIComponent(id));
      return responseOk(rows.slice(0, 1));
    }

    if (path.endsWith("/rest/v1/users") && method === "POST") {
      const row = {
        id: `user-${users.length + 1}`,
        google_sub: body.google_sub,
        email: body.email,
        full_name: body.full_name,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: body.updated_at
      };
      users.push(row);
      return responseOk([row]);
    }

    if (path.endsWith("/rest/v1/users") && method === "PATCH") {
      const id = parsed.searchParams.get("id")?.replace("eq.", "");
      const row = users.find((u) => u.id === id);
      row.google_sub = body.google_sub;
      row.email = body.email;
      row.full_name = body.full_name;
      row.updated_at = body.updated_at;
      return responseOk([row]);
    }

    if (path.endsWith("/rest/v1/sessions") && method === "POST") {
      const row = {
        id: `session-${sessions.length + 1}`,
        user_id: body.user_id,
        session_token: body.session_token,
        created_at: body.created_at,
        expires_at: body.expires_at,
        revoked_at: null
      };
      sessions.push(row);
      return responseOk([row]);
    }

    if (path.endsWith("/rest/v1/sessions") && method === "GET") {
      const token = parsed.searchParams.get("session_token")?.replace("eq.", "");
      const rows = sessions.filter((s) => s.session_token === decodeURIComponent(token) && !s.revoked_at);
      return responseOk(rows.slice(0, 1));
    }

    if (path.endsWith("/rest/v1/sessions") && method === "PATCH") {
      const token = parsed.searchParams.get("session_token")?.replace("eq.", "");
      const row = sessions.find((s) => s.session_token === decodeURIComponent(token) && !s.revoked_at);
      if (!row) return responseOk([]);
      row.revoked_at = body.revoked_at;
      return responseOk([row]);
    }

    if (path.endsWith("/rest/v1/audit_log") && method === "POST") {
      const row = {
        id: `audit-${auditLog.length + 1}`,
        created_at: new Date().toISOString(),
        actor_user_id: body.actor_user_id,
        action: body.action,
        entity_type: body.entity_type,
        entity_id: body.entity_id,
        before_data: body.before_data,
        after_data: body.after_data,
        metadata: body.metadata
      };
      auditLog.push(row);
      return responseOk([], 201);
    }

    if (path.endsWith("/rest/v1/audit_log") && method === "GET") {
      const actor = parsed.searchParams.get("actor_user_id")?.replace("eq.", "");
      const action = parsed.searchParams.get("action")?.replace("eq.", "");
      let rows = [...auditLog];
      if (actor) rows = rows.filter((r) => r.actor_user_id === actor);
      if (action) rows = rows.filter((r) => r.action === action);
      return responseOk(rows);
    }

    throw new Error(`Unhandled mocked request: ${method} ${url}`);
  };
}

async function testIdentityStoreFlow() {
  const unique = Date.now();
  const write = await upsertUser({
    googleSub: `sub-${unique}`,
    email: `user-${unique}@example.com`,
    fullName: "Test User"
  });

  assert.equal(write.user.email, `user-${unique}@example.com`);

  const session = await createSession(write.user.id, 1);
  const active = await getActiveSession(session.sessionToken);
  assert.ok(active, "session should be active");
  assert.equal(active.user.id, write.user.id);

  const revoked = await revokeSession(session.sessionToken);
  assert.equal(revoked, true);
  assert.equal(await getActiveSession(session.sessionToken), null);
}

async function testAuditLogFilter() {
  await appendAudit({
    actorUserId: "actor-1",
    action: "USER_LOGIN",
    entityType: "user",
    entityId: "user-1"
  });

  const rows = await listAudit({ actorUserId: "actor-1", limit: 5 });
  assert.ok(rows.length >= 1);
  assert.equal(rows[0].actorUserId, "actor-1");
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
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = "https://mock.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-key";
  global.fetch = createSupabaseMock();

  const tests = [
    ["identity store flow", testIdentityStoreFlow],
    ["audit log filter", testAuditLogFilter]
  ];

  for (const [name, fn] of tests) {
    await fn();
    console.log(`PASS: ${name}`);
  }

  global.fetch = originalFetch;
  await testGoogleValidatorMock();
  console.log("PASS: google token validator");
  console.log("Stage 2 test suite passed.");
}

run().catch((error) => {
  console.error("Stage 2 test suite failed:", error.message);
  process.exit(1);
});
