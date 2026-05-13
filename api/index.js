const identityStore = require("../apps/api/src/storage/identity-store");

const originalListThresholds = identityStore.listThresholds;
identityStore.listThresholds = async (...args) => {
  const rows = await originalListThresholds(...args);
  const normalizedRows = [];
  for (const row of rows) {
    if (row.metricKey !== "rides") {
      normalizedRows.push(row);
    }
  }
  return normalizedRows;
};

const originalListTargets = identityStore.listTargets;
identityStore.listTargets = async (...args) => {
  const rows = await originalListTargets(...args);
  return rows.map((row) => {
    if (row.metricKey !== "rides") return row;
    return { ...row, direction: "at_most" };
  });
};

const { handleRequest } = require("../apps/api/src/app");

module.exports = async (req, res) => {
  await handleRequest(req, res);
};
