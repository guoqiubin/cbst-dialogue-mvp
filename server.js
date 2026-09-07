"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

loadDotEnv(path.join(__dirname, ".env"));

const apiHandler = require("./api/chat.js");
const publicConfigHandler = require("./api/public-config.js");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-terra";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (requestUrl.pathname === "/api/status") {
      return statusHandler(req, createExpressLikeResponse(res));
    }

    if (requestUrl.pathname === "/api/chat") {
      return handleApiRequest(req, res);
    }

    if (requestUrl.pathname === "/api/public-config") {
      return publicConfigHandler(req, createExpressLikeResponse(res));
    }

    return handleStaticRequest(requestUrl.pathname, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`CBST MVP server running at http://${HOST}:${PORT}\n`);
});

async function handleApiRequest(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const body = await readJsonBody(req);
  const wrappedReq = { method: req.method, body };
  const wrappedRes = createExpressLikeResponse(res);
  return apiHandler(wrappedReq, wrappedRes);
}

async function statusHandler(_req, res) {
  return res.status(200).json({
    serverReady: true,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    model: OPENAI_MODEL
  });
}

async function handleStaticRequest(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const resolvedPath = path.normalize(path.join(ROOT, safePath));

  if (!resolvedPath.startsWith(ROOT)) {
    return sendText(res, 403, "Forbidden");
  }

  let stats;
  try {
    stats = await fsp.stat(resolvedPath);
  } catch {
    return sendText(res, 404, "Not found");
  }

  if (stats.isDirectory()) {
    return sendText(res, 403, "Forbidden");
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  fs.createReadStream(resolvedPath).pipe(res);
}

function createExpressLikeResponse(res) {
  return {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      sendJson(res, this.statusCode || 200, payload);
    }
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Request body is not valid JSON");
  }
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) continue;
    const key = trimmed.slice(0, equalIndex).trim();
    const value = trimmed.slice(equalIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] == null) process.env[key] = value;
  }
}
