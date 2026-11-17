// Dev server only (picked up automatically by react-scripts): proxy /api to the
// local backend so the app and API share one origin, exactly like production
// behind nginx. Full-page navigations (Google sign-in redirect) are proxied too.
const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function (app) {
  if (process.env.REACT_APP_BACKEND_URL) return; // talking to a remote backend directly
  app.use(
    createProxyMiddleware("/api", {
      target: process.env.DEV_BACKEND_URL || "http://localhost:8001",
      changeOrigin: false,
      xfwd: true,
    })
  );
};
