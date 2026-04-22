import fs from "node:fs";
import path from "node:path";

const provider = (process.env.DB_PROVIDER || "excel").toLowerCase();

if (!process.env.GOOGLE_OAUTH_CLIENT_ID) {
  console.error("Missing required env var: GOOGLE_OAUTH_CLIENT_ID");
  process.exit(1);
}

async function checkSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when DB_PROVIDER=supabase");
  }

  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/users?select=id&limit=1`, {
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

function checkExcel() {
  const excelPath = process.env.EXCEL_DB_PATH || path.join(process.cwd(), "apps", "api", ".data", "operations-store.xlsx");
  const folder = path.dirname(excelPath);
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
  if (!fs.existsSync(excelPath)) {
    console.log(`Excel DB will be created on first write: ${excelPath}`);
  } else {
    console.log(`Excel DB detected: ${excelPath}`);
  }
}

(async () => {
  if (provider === "supabase") {
    await checkSupabase();
    console.log("Connectivity checks passed (Supabase).\n");
    return;
  }

  checkExcel();
  console.log("Connectivity checks passed (Excel provider).\n");
})();
