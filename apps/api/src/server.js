const http = require("node:http");
const { handleRequest } = require("./app");

const host = process.env.API_HOST || "0.0.0.0";
const port = Number(process.env.API_PORT || 4000);

const server = http.createServer((req, res) => {
  handleRequest(req, res);
});

server.listen(port, host, () => {
  console.log(`API stage 2 listening on http://${host}:${port}`);
});
