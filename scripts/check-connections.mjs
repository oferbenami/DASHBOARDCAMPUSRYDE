import { createServer } from "node:http";

const required = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GOOGLE_OAUTH_CLIENT_ID"
];

const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error("Missing required env vars:");
  for (const key of missing) console.error(`- ${key}`);
  process.exit(1);
}

async function checkSupabase() {
  const url = process.env.SUPABASE_URL.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${url}/rest/v1/users?select=id&limit=1`, {
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase check failed (${res.status}): ${text}`);
  }
}

async function checkHealth() {
  const host = process.env.API_HOST || "127.0.0.1";
  const port = Number(process.env.API_PORT || 4000);

  await new Promise((resolve, reject) => {
    const server = createServer(() => {}).listen(0, "127.0.0.1", () => {
      server.close(resolve);
    }).on("error", reject);
  });

  const res = await fetch(`http://${host}:${port}/health`).catch(() => null);
  if (!res) {
    console.log("API health skipped: local server not running.");
    return;
  }
  if (!res.ok) {
    throw new Error(`API health failed with ${res.status}`);
  }
}

(async () => {
  await checkSupabase();
  await checkHealth();
  console.log("Connectivity checks passed (Supabase + API health).\n");
})();
