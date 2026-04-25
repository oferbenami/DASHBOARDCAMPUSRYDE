const XLSX = require("xlsx");
const path = require("path");

const SHEETS = {
  users:           ["id", "googleSub", "email", "fullName", "isActive", "createdAt", "updatedAt"],
  sessions:        ["id", "userId", "sessionToken", "createdAt", "expiresAt", "revokedAt"],
  audit_log:       ["id", "createdAt", "actorUserId", "action", "entityType", "entityId", "beforeData", "afterData", "metadata"],
  daily_metrics:   ["id", "key", "serviceDate", "serviceType", "ridesCount", "registeredPassengers", "issuesCount", "affectedPassengers", "createdAt", "updatedAt"],
  incidents:       ["id", "serviceDate", "serviceType", "origin", "destination", "shiftTime", "passengersCount", "issueType", "description", "delayMinutes", "createdAt", "updatedAt"],
  day_types:       ["id", "serviceDate", "dayType", "reason", "isPartial", "noActivity", "createdAt", "updatedAt"],
  targets_history: ["id", "metricKey", "scopeKey", "direction", "targetValue", "effectiveFrom", "effectiveTo", "createdAt", "updatedAt"],
  kpi_thresholds:  ["metricKey", "greenMin", "greenMax", "yellowMin", "yellowMax", "redMin", "redMax", "createdAt", "updatedAt"]
};

const wb = XLSX.utils.book_new();

for (const [name, headers] of Object.entries(SHEETS)) {
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  ws["!cols"] = headers.map(() => ({ wch: 20 }));
  XLSX.utils.book_append_sheet(wb, ws, name);
}

const outPath = path.join(__dirname, "DashboardRyde_DB.xlsx");
XLSX.writeFile(wb, outPath);
console.log("Created:", outPath);
