const { serveHTTP } = require("stremio-addon-sdk");
const { addon, manifest } = require("../index");

module.exports = (req, res) => {
  if (req.url === "/manifest.json") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(manifest));
  } else {
    serveHTTP(addon.getInterface(), { req, res });
  }
};
