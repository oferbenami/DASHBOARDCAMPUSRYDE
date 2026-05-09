const { getBearerToken, readJsonBody, sendJson, securityHeaders } = require("../../../apps/api/src/core/http");
const { getActiveSession } = require("../../../apps/api/src/storage/identity-store");
const operatorsStore = require("../../../apps/api/src/storage/operators-store");

function unauthorized(res, message) {
  sendJson(res, 401, { error: message || "Unauthorized" });
}

function badRequest(res, message) {
  sendJson(res, 400, { error: message });
}

function notFound(res, message) {
  sendJson(res, 404, { error: message || "Not found" });
}

function isUniqueViolation(error) {
  const text = String(error?.message || "");
  return text.includes("23505") || text.includes("duplicate key value") || text.includes("Supabase request failed (409)");
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

function splitPath(req) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  return url.pathname.split("/").filter(Boolean);
}

async function handle(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, securityHeaders());
    res.end();
    return;
  }

  const active = await requireAuth(req, res);
  if (!active) return;

  const parts = splitPath(req);
  const operatorId = parts[2] || null;
  const resource = parts[3] || null;
  const recipientId = parts[4] || null;

  try {
    if (parts.length === 2 && req.method === "GET") {
      const operators = await operatorsStore.listOperators();
      sendJson(res, 200, { operators });
      return;
    }

    if (parts.length === 2 && req.method === "POST") {
      const body = await readJsonBody(req);
      const saved = await operatorsStore.createOperator(body);
      sendJson(res, 201, { operator: saved.operator });
      return;
    }

    if (operatorId && !resource && req.method === "PUT") {
      const body = await readJsonBody(req);
      const saved = await operatorsStore.updateOperator(operatorId, body);
      if (!saved) return notFound(res, "Operator not found");
      sendJson(res, 200, { operator: saved.operator });
      return;
    }

    if (operatorId && !resource && req.method === "DELETE") {
      const saved = await operatorsStore.deleteOperator(operatorId);
      if (!saved) return notFound(res, "Operator not found");
      sendJson(res, 200, { ok: true, operator: saved.operator });
      return;
    }

    if (operatorId && resource === "recipients" && !recipientId && req.method === "GET") {
      const recipients = await operatorsStore.listOperatorRecipients(operatorId);
      sendJson(res, 200, { recipients });
      return;
    }

    if (operatorId && resource === "recipients" && !recipientId && req.method === "POST") {
      const body = await readJsonBody(req);
      const saved = await operatorsStore.createOperatorRecipient(operatorId, body);
      sendJson(res, 201, { recipient: saved.recipient });
      return;
    }

    if (operatorId && resource === "recipients" && recipientId && req.method === "PUT") {
      const body = await readJsonBody(req);
      const saved = await operatorsStore.updateOperatorRecipient(operatorId, recipientId, body);
      if (!saved) return notFound(res, "Recipient not found");
      sendJson(res, 200, { recipient: saved.recipient });
      return;
    }

    if (operatorId && resource === "recipients" && recipientId && req.method === "DELETE") {
      const saved = await operatorsStore.deleteOperatorRecipient(operatorId, recipientId);
      if (!saved) return notFound(res, "Recipient not found");
      sendJson(res, 200, { ok: true, recipient: saved.recipient });
      return;
    }

    notFound(res);
  } catch (error) {
    if (isUniqueViolation(error)) {
      badRequest(res, "Duplicate operator or primary recipient constraint violation");
      return;
    }
    if (String(error?.message || "").includes("required") || String(error?.message || "").includes("must be")) {
      badRequest(res, error.message);
      return;
    }
    console.error("[operators-api]", error);
    sendJson(res, 500, { error: "Internal server error" });
  }
}

module.exports = handle;
