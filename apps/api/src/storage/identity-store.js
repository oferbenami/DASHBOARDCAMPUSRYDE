const excelStore = require("./excel-store");
const supabaseStore = require("./supabase-store");

function selectedProvider() {
  return (process.env.DB_PROVIDER || "excel").toLowerCase();
}

function backend() {
  return selectedProvider() === "supabase" ? supabaseStore : excelStore;
}

module.exports = {
  providerName: () => selectedProvider(),
  upsertUser: (...args) => backend().upsertUser(...args),
  createSession: (...args) => backend().createSession(...args),
  revokeSession: (...args) => backend().revokeSession(...args),
  getActiveSession: (...args) => backend().getActiveSession(...args),
  appendAudit: (...args) => backend().appendAudit(...args),
  listAudit: (...args) => backend().listAudit(...args),
  getDailyMetricsByDate: (...args) => backend().getDailyMetricsByDate(...args),
  upsertDailyMetric: (...args) => backend().upsertDailyMetric(...args),
  listIncidents: (...args) => backend().listIncidents(...args),
  createIncident: (...args) => backend().createIncident(...args),
  updateIncident: (...args) => backend().updateIncident(...args),
  recalculateIncidents: (...args) => backend().recalculateIncidents(...args),
  upsertDayType: (...args) => backend().upsertDayType(...args)
};
