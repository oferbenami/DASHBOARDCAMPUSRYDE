/**
 * DashboardRyde DB Setup Script
 * ─────────────────────────────
 * 1. פתח https://script.google.com → New Project
 * 2. מחק כל קוד קיים, הדבק את הקובץ הזה
 * 3. לחץ ▶ Run (הפונקציה createDashboardRydeDB תרוץ)
 * 4. אשר הרשאות בפופאפ
 * 5. לאחר הרצה — ה-Spreadsheet ID יופיע בחלון "Execution log"
 */

function createDashboardRydeDB() {
  var SHEETS = {
    "users":           ["id", "googleSub", "email", "fullName", "isActive", "createdAt", "updatedAt"],
    "sessions":        ["id", "userId", "sessionToken", "createdAt", "expiresAt", "revokedAt"],
    "audit_log":       ["id", "createdAt", "actorUserId", "action", "entityType", "entityId", "beforeData", "afterData", "metadata"],
    "daily_metrics":   ["id", "key", "serviceDate", "serviceType", "ridesCount", "registeredPassengers", "issuesCount", "affectedPassengers", "createdAt", "updatedAt"],
    "incidents":       ["id", "serviceDate", "serviceType", "origin", "destination", "shiftTime", "passengersCount", "issueType", "description", "delayMinutes", "createdAt", "updatedAt"],
    "day_types":       ["id", "serviceDate", "dayType", "reason", "isPartial", "noActivity", "createdAt", "updatedAt"],
    "targets_history": ["id", "metricKey", "scopeKey", "direction", "targetValue", "effectiveFrom", "effectiveTo", "createdAt", "updatedAt"],
    "kpi_thresholds":  ["metricKey", "greenMin", "greenMax", "yellowMin", "yellowMax", "redMin", "redMax", "createdAt", "updatedAt"]
  };

  var ss = SpreadsheetApp.create("DashboardRyde DB");
  var sheetNames = Object.keys(SHEETS);

  // rename the default Sheet1 to the first name, then add the rest
  var sheets = ss.getSheets();
  sheets[0].setName(sheetNames[0]);
  sheets[0].getRange(1, 1, 1, SHEETS[sheetNames[0]].length).setValues([SHEETS[sheetNames[0]]]);
  sheets[0].setFrozenRows(1);
  sheets[0].getRange(1, 1, 1, SHEETS[sheetNames[0]].length).setFontWeight("bold");

  for (var i = 1; i < sheetNames.length; i++) {
    var name = sheetNames[i];
    var headers = SHEETS[name];
    var sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  }

  var id = ss.getId();
  Logger.log("✅ Spreadsheet created successfully!");
  Logger.log("📋 Spreadsheet ID: " + id);
  Logger.log("🔗 URL: " + ss.getUrl());
  Logger.log("");
  Logger.log("Next steps:");
  Logger.log("1. Copy the Spreadsheet ID above");
  Logger.log("2. Share this spreadsheet with your Service Account email (Editor)");
  Logger.log("3. Set GOOGLE_SHEETS_SPREADSHEET_ID=" + id + " in Vercel");
}
