const required = ["API_BASE_URL", "SESSION_TOKEN"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error("Missing env for smoke UAT:");
  for (const k of missing) console.error(`- ${k}`);
  process.exit(1);
}

const base = process.env.API_BASE_URL.replace(/\/$/, "");
const token = process.env.SESSION_TOKEN;

async function call(path, method = "GET", body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { res, text: await res.text() };
}

(async () => {
  const checks = [
    ["health", () => call("/health")],
    ["kpi summary", () => call("/kpi/summary")],
    ["kpi trends", () => call("/kpi/trends")],
    ["drilldown", () => call("/kpi/drilldown")],
    ["targets", () => call("/management/targets")],
    ["thresholds", () => call("/management/thresholds")],
    ["export excel", () => call("/export/excel")],
    ["export pdf", () => call("/export/pdf")]
  ];

  for (const [name, fn] of checks) {
    const { res } = await fn();
    if (!res.ok) {
      throw new Error(`${name} failed with status ${res.status}`);
    }
    console.log(`PASS: ${name}`);
  }

  console.log("Smoke UAT passed.");
})();
