import fs from "node:fs";
import path from "node:path";

const roots = [
  path.join(process.cwd(), "apps", "web", "src", "index.html")
];

const badPatterns = [
  /×[\u0080-\u00FF]/g,
  /â[\u0080-\u00FF]/g,
  /ï¸/g
];

const failures = [];

for (const filePath of roots) {
  if (!fs.existsSync(filePath)) continue;
  const text = fs.readFileSync(filePath, "utf8");
  for (const re of badPatterns) {
    const hit = re.exec(text);
    re.lastIndex = 0;
    if (hit) {
      failures.push({ filePath, token: hit[0] });
      break;
    }
  }
}

if (failures.length) {
  console.error("Mojibake guard failed:");
  for (const f of failures) {
    console.error(`- ${f.filePath} contains suspicious token: ${JSON.stringify(f.token)}`);
  }
  process.exit(1);
}

console.log("Mojibake guard passed.");
