import process from "node:process";

const required = [
  "DB_PROVIDER",
  "EXCEL_DB_PATH",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "WEB_BASE_URL"
];

const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error("Missing required go-live env vars:");
  for (const k of missing) console.error(`- ${k}`);
  process.exit(1);
}

if (String(process.env.DB_PROVIDER).toLowerCase() !== "excel") {
  console.warn("Warning: DB_PROVIDER is not excel. Current stage assumes excel-first go-live.");
}

if (!/^https:\/\//.test(process.env.WEB_BASE_URL)) {
  console.error("WEB_BASE_URL must be https URL for production.");
  process.exit(1);
}

console.log("Go-live preflight passed.");
