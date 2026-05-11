import process from "node:process";

const required = ["WEB_BASE_URL"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error("Missing env for auth/login smoke:");
  for (const k of missing) console.error(`- ${k}`);
  process.exit(1);
}

const base = process.env.WEB_BASE_URL.replace(/\/$/, "");

function normalizeOrigin(urlLike) {
  try {
    return new URL(urlLike).origin;
  } catch {
    return null;
  }
}

async function mustFetchJson(path) {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} failed with status ${res.status}: ${text}`);
  }
  return res.json();
}

async function mustFetchText(path) {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} failed with status ${res.status}: ${text}`);
  }
  return res.text();
}

(async () => {
  const healthRes = await fetch(`${base}/health`);
  if (!healthRes.ok) {
    throw new Error(`/health failed: ${healthRes.status}`);
  }
  console.log("PASS: /health");

  const config = await mustFetchJson("/auth/config");
  if (!config.googleClientIdPresent || !String(config.googleClientId || "").trim()) {
    throw new Error("auth/config returned missing google client id");
  }
  const expectedOrigin = normalizeOrigin(base);
  const effectiveOrigin = normalizeOrigin(config.effectiveOrigin);
  if (!expectedOrigin || !effectiveOrigin || expectedOrigin !== effectiveOrigin) {
    throw new Error(`effectiveOrigin mismatch: expected ${expectedOrigin}, got ${config.effectiveOrigin}`);
  }
  console.log("PASS: /auth/config");

  const html = await mustFetchText("/");
  const positiveSignals = [
    "id=\"googleBtnWrap\"",
    "initAuthUI(",
    "initGoogleLogin("
  ];
  for (const signal of positiveSignals) {
    if (!html.includes(signal)) {
      throw new Error(`missing login readiness signal in html: ${signal}`);
    }
  }

  console.log("PASS: login HTML readiness");
  console.log("Auth/login smoke passed.");
})();
