"use strict";

const ALLOWED_ROUTES = new Map([
  ["/auth/v1/signup", new Set(["POST"])],
  ["/auth/v1/token", new Set(["POST"])],
  ["/auth/v1/user", new Set(["GET"])],
  ["/auth/v1/logout", new Set(["POST"])],
  ["/rest/v1/user_progress", new Set(["GET", "POST", "DELETE"])]
]);

// The browser calls this same-origin proxy so users do not need direct DNS
// access to the Supabase domain. Only the small cloud-sync API surface is allowed.
module.exports = async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    return res.status(503).json({ error: "云端同步服务尚未完成配置。" });
  }

  const rawPath = String(req.query?.path || "");
  let target;
  try {
    target = new URL(rawPath, "https://cbst-cloud-proxy.invalid");
  } catch {
    return res.status(400).json({ error: "云端请求地址无效。" });
  }

  const method = String(req.method || "GET").toUpperCase();
  if (!rawPath.startsWith("/") || !ALLOWED_ROUTES.get(target.pathname)?.has(method)) {
    return res.status(403).json({ error: "该云端请求不被允许。" });
  }

  try {
    const headers = {
      apikey: publishableKey,
      Accept: "application/json"
    };
    const authorization = req.headers?.authorization || req.headers?.Authorization;
    const prefer = req.headers?.prefer || req.headers?.Prefer;
    if (authorization) headers.Authorization = authorization;
    if (prefer) headers.Prefer = prefer;
    if (method !== "GET") headers["Content-Type"] = "application/json";

    const response = await fetch(`${supabaseUrl}${target.pathname}${target.search}`, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(req.body || {})
    });
    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(502).json({ error: "云端认证服务暂时无法连接，请稍后重试。" });
  }
};
