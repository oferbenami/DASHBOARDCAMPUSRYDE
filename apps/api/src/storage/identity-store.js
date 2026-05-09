const supabaseStore = require("./supabase-store");

function selectedProvider() {
  const provider = (process.env.DB_PROVIDER || "supabase").toLowerCase();
  if (provider !== "supabase") {
    throw new Error(`Invalid DB_PROVIDER=${provider}. Only 'supabase' is supported.`);
  }
  return provider;
}

function backend() {
  selectedProvider();
  return supabaseStore;
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
  upsertDayType: (...args) => backend().upsertDayType(...args),
  listDayTypes: (...args) => backend().listDayTypes(...args),
  getKpiSummary: (...args) => backend().getKpiSummary(...args),
  getKpiTrends: (...args) => backend().getKpiTrends(...args),
  getKpiDrilldown: (...args) => backend().getKpiDrilldown(...args),
  listTargets: (...args) => backend().listTargets(...args),
  createTarget: (...args) => backend().createTarget(...args),
  listThresholds: (...args) => backend().listThresholds(...args),
  upsertThreshold: (...args) => backend().upsertThreshold(...args),
  getExportBundle: (...args) => backend().getExportBundle(...args)
};
