#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const preferredPort = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ts": "text/plain",
  ".tsx": "text/plain",
};

function createStaticServer() {
  return createServer((request, response) => {
    const requestedPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
    let filePath = join(root, safePath);

    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, "index.html");
    }

    if (!existsSync(filePath)) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  });
}

async function listen(port) {
  const server = createStaticServer();

  return new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolve(listen(port + 1));
        return;
      }

      reject(error);
    });

    server.listen(port, "127.0.0.1", () => {
      resolve({ server, port });
    });
  });
}

const { port } = await listen(preferredPort);
console.log(`Argus demo server: http://127.0.0.1:${port}/apps/marketplace-demo/`);
console.log(`Argus verifier: http://127.0.0.1:${port}/apps/verifier-web/`);
