import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const artifactRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(artifactRoot, "web-public");
const port = Number(process.env.PORT);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PORT must be provided by the managed web service.");
  process.exit(1);
}

async function sendFile(response, filePath, method) {
  const file = await stat(filePath);
  if (!file.isFile()) return false;

  response.writeHead(200, {
    "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
    "Content-Length": file.size,
    "Cache-Control": "no-cache",
  });
  if (method === "HEAD") {
    response.end();
  } else {
    createReadStream(filePath).pipe(response);
  }
  return true;
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  // API traffic belongs to the more-specific /api service route, never the SPA fallback.
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    response.writeHead(404).end("API route is not served by the web UI.");
    return;
  }

  const requestedPath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(publicRoot, requestedPath);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
    response.writeHead(400).end("Bad request");
    return;
  }

  try {
    if (await sendFile(response, filePath, request.method || "GET")) return;
  } catch {
    // Extensionless paths are client-side routes; missing assets remain real 404s.
  }

  if (!path.extname(pathname)) {
    try {
      const entry = pathname === "/instructor" || pathname.startsWith("/instructor/")
        ? path.join(publicRoot, "instructor", "index.html")
        : path.join(publicRoot, "index.html");
      if (await sendFile(response, entry, request.method || "GET")) return;
    } catch {
      // Report the missing entry page below.
    }
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`ClassScribe web UI listening on port ${port}\n`);
});