import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { createApi } from "./handler";
import { toWebRequest, sendWebResponse, clientIp } from "./node-adapter";
const api = createApi(),
  root = resolve(process.env.STATIC_DIR || "dist"),
  port = Number(process.env.PORT || 8476),
  host = process.env.HOST || "127.0.0.1";
const server = createServer(async (req, res) => {
  try {
    const origin = `http://${req.headers.host}`,
      url = new URL(req.url || "/", origin);
    if (url.pathname.startsWith("/api/")) {
      await sendWebResponse(res, await api(toWebRequest(req, origin), clientIp(req, process.env.TRUST_PROXY === "1")));
      return;
    }
    let path = resolve(root, "." + decodeURIComponent(url.pathname));
    if (!path.startsWith(root + sep) && path !== root) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!extname(path)) path = resolve(root, "index.html");
    const data = await readFile(path);
    res.writeHead(200, {
      "content-type":
        (
          {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript",
            ".css": "text/css",
          } as Record<string, string>
        )[extname(path)] || "application/octet-stream",
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("찾을 수 없어요.");
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.listen(port, host, () =>
  console.log(`마고 학원운영 http://${host}:${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
