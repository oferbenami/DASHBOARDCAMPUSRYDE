import process from "node:process";

const required = ["API_BASE_URL", "SESSION_TOKEN"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error("Missing env for production smoke:");
  for (const k of missing) console.error(`- ${k}`);
  process.exit(1);
}

const base = process.env.API_BASE_URL.replace(/\/$/, "");
const token = process.env.SESSION_TOKEN;

async function request(path, expectedStatus = 200) {
  const res = await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });

  if (res.status !== expectedStatus) {
    const text = await res.text();
    throw new Error(`${path} expected ${expectedStatus} got ${res.status}: ${text}`);
  }
  return res;
}

(async () => {
  const health = await fetch(`${base}/health`);
  if (!health.ok) {
    throw new Error(`/health failed: ${health.status}`);
  }
  console.log("PASS: /health");

  await request("/auth/me");
  console.log("PASS: /auth/me");

  await request("/kpi/summary");
  console.log("PASS: /kpi/summary");

  await request("/kpi/trends");
  console.log("PASS: /kpi/trends");

  await request("/kpi/drilldown");
  console.log("PASS: /kpi/drilldown");

  const excel = await request("/export/excel");
  if (!String(excel.headers.get("content-type") || "").includes("sheet")) {
    throw new Error("/export/excel content-type mismatch");
  }
  console.log("PASS: /export/excel");

  const pdf = await request("/export/pdf");
  if (String(pdf.headers.get("content-type") || "") !== "application/pdf") {
    throw new Error("/export/pdf content-type mismatch");
  }
  console.log("PASS: /export/pdf");

  console.log("Production smoke passed.");
})();
