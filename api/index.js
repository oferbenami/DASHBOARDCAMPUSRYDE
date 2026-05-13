const identityStore = require("../apps/api/src/storage/identity-store");

const originalListThresholds = identityStore.listThresholds;
identityStore.listThresholds = async (...args) => {
  const rows = await originalListThresholds(...args);
  return rows.filter((row) => row.metricKey !== "rides");
};

const { handleRequest } = require("../apps/api/src/app");

module.exports = async (req, res) => {
  await handleRequest(req, res);
};
