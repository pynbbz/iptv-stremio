const { serveHTTP } = require("stremio-addon-sdk");
const { addon } = require("../index");

module.exports = (req, res) => {
  serveHTTP(addon.getInterface(), { req, res });
};
