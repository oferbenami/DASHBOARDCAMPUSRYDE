const { URL } = require("node:url");

const { getBearerToken, readJsonBody, sendJson } = require("./core/http");
const { verifyGoogleIdToken } = require("./auth/google-token");
const {
  upsertUser,
  createSession,
  revokeSession,
  getActiveSession,
  appendAudit,
  listAudit
} = require("./storage/identity-store");

const sessionTtlHours = Number(process.env.SESSION_TTL_HOURS || 10);

function unauthorized(res, message) {
  sendJson(res, 401, { error: message || "Unauthorized" });
}

async function handleGoogleCallback(req, res) {
  const body = await readJsonBody(req);
  if (!body.idToken || typeof body.idToken !== "string") {
    sendJson(res, 400, { error: "idToken is required" });
    return;
  }

  const verified = await verifyGoogleIdToken(body.idToken);
  if (!verified.ok) {
    sendJson(res, 401, { error: verified.reason });
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
  const token = getBearerToken(req);
  if (!token) {
    unauthorized(res);
    return;
  }

  const active = await getActiveSession(token);
  if (!active) {
    unauthorized(res);
    return;
  }

  await revokeSession(token);
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
  const token = getBearerToken(req);
  if (!token) {
    unauthorized(res);
    return;
  }

  const active = await getActiveSession(token);
  if (!active) {
    unauthorized(res);
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
  const token = getBearerToken(req);
  if (!token) {
    unauthorized(res);
    return;
  }

  const active = await getActiveSession(token);
  if (!active) {
    unauthorized(res);
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

async function handleRequest(req, res) {
  const host = req.headers.host || "localhost";
  const parsedUrl = new URL(req.url, `http://${host}`);

  try {
    if (req.method === "GET" && parsedUrl.pathname === "/health") {
      sendJson(res, 200, {
        status: "ok",
        stage: 2,
        infra: { database: "supabase", hosting: "vercel" }
      });
      return;
    }

    if (req.method === "POST" && parsedUrl.pathname === "/auth/google/callback") {
      await handleGoogleCallback(req, res);
      return;
    }

    if (req.method === "POST" && parsedUrl.pathname === "/auth/logout") {
      await handleLogout(req, res);
      return;
    }

    if (req.method === "GET" && parsedUrl.pathname === "/auth/me") {
      await handleMe(req, res);
      return;
    }

    if (req.method === "GET" && parsedUrl.pathname === "/audit-log") {
      await handleAudit(req, res, parsedUrl);
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
