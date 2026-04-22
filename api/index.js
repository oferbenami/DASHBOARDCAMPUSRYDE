const { handleRequest } = require("../apps/api/src/app");

module.exports = async (req, res) => {
  await handleRequest(req, res);
};
