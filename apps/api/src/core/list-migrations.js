const fs = require("node:fs");
const path = require("node:path");

const migrationsDir = path.join(__dirname, "..", "..", "db", "migrations");

if (!fs.existsSync(migrationsDir)) {
  console.error("Migrations directory not found:", migrationsDir);
  process.exit(1);
}

const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
if (files.length === 0) {
  console.error("No migration files found.");
  process.exit(1);
}

console.log("Migration files:");
for (const file of files) {
  console.log(`- ${file}`);
}
