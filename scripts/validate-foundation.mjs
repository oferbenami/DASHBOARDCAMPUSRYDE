import { existsSync, readFileSync } from "node:fs";

const requiredPaths = [
  "apps/web/package.json",
  "apps/api/package.json",
  "apps/mobile/package.json",
  "apps/api/src/server.js",
  "apps/api/src/app.js",
  "api/index.js",
  "vercel.json",
  ".env.example",
  "infra/docker/docker-compose.dev.yml",
  "docs/adr/0001-baseline-architecture.md",
  "docs/architecture/stage-01-foundation.md",
  "docs/runbooks/environments.md",
  "docs/stages/00-master-program-plan.md",
  "docs/stages/01-foundation-architecture.md"
];

const missing = requiredPaths.filter((path) => !existsSync(path));
if (missing.length > 0) {
  console.error("Missing required stage-1 artifacts:");
  for (const path of missing) {
    console.error(`- ${path}`);
  }
  process.exit(1);
}

const packageRaw = readFileSync("package.json", "utf8").replace(/^\uFEFF/, "");
const pkg = JSON.parse(packageRaw);
if (!Array.isArray(pkg.workspaces) || pkg.workspaces.length < 2) {
  console.error("Invalid workspace configuration in package.json");
  process.exit(1);
}

console.log("Stage 1 foundation validation passed.");
