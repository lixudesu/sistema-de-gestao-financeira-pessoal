import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = 4173;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, "dist");
const saveDir = path.join(__dirname, "save");
const stateFile = path.join(saveDir, "data.json");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function ensureSaveDir() {
  await fs.mkdir(saveDir, { recursive: true });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(message);
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) {
      throw new Error("payload_too_large");
    }
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function getStaticPath(urlPathname) {
  const pathname = urlPathname === "/" ? "/index.html" : urlPathname;
  const resolvedPath = path.resolve(distDir, `.${pathname}`);
  if (!resolvedPath.startsWith(distDir)) {
    return null;
  }
  return resolvedPath;
}

async function handleStateRequest(request, response) {
  if (request.method === "GET") {
    try {
      const raw = await fs.readFile(stateFile, "utf8");
      sendJson(response, 200, { state: JSON.parse(raw) });
    } catch (error) {
      if (error?.code === "ENOENT") {
        sendJson(response, 200, { state: null });
        return;
      }
      sendJson(response, 500, { error: "state_read_failed" });
    }
    return;
  }

  if (request.method === "POST") {
    try {
      const payload = await readRequestBody(request);
      const nextState = payload?.state ?? payload;

      if (!nextState || typeof nextState !== "object" || Array.isArray(nextState)) {
        sendJson(response, 400, { error: "invalid_state" });
        return;
      }

      await ensureSaveDir();
      const tempFile = `${stateFile}.tmp`;
      await fs.writeFile(tempFile, JSON.stringify(nextState, null, 2), "utf8");
      await fs.rename(tempFile, stateFile);
      sendJson(response, 200, {
        ok: true,
        savedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error?.message === "payload_too_large") {
        sendJson(response, 413, { error: "payload_too_large" });
        return;
      }
      sendJson(response, 500, { error: "state_write_failed" });
    }
    return;
  }

  sendText(response, 405, "Method Not Allowed");
}

async function handleStaticRequest(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const filePath = getStaticPath(requestUrl.pathname);

  if (!filePath) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": contentTypes[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=3600",
    });
    response.end(file);
  } catch (error) {
    if (error?.code === "ENOENT" && !path.extname(filePath)) {
      const fallback = path.join(distDir, "index.html");
      try {
        const file = await fs.readFile(fallback);
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        response.end(file);
        return;
      } catch {}
    }

    sendText(response, 404, "Not Found");
  }
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (requestUrl.pathname === "/api/state") {
    await handleStateRequest(request, response);
    return;
  }

  await handleStaticRequest(request, response);
});

server.listen(port, host, () => {
  console.log(`SF Sistema Financeiro rodando em http://${host}:${port}`);
  console.log(`Dados salvos em ${stateFile}`);
});
