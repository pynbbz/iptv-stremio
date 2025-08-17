const { serveHTTP } = require("stremio-addon-sdk");
const { addon, manifest } = require("../index");

module.exports = (req, res) => {
  // Always add CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  if (req.url === "/manifest.json") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(manifest));
  } else {
    serveHTTP(addon.getInterface(), { req, res });
  }
};
