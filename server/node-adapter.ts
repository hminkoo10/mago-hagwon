import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
export function toWebRequest(req: IncomingMessage, origin: string) {
  return new Request(new URL(req.url || "/", origin), {
    method: req.method,
    headers: req.headers as HeadersInit,
    ...(!["GET", "HEAD"].includes(req.method || "GET")
      ? { body: Readable.toWeb(req) as ReadableStream, duplex: "half" }
      : {}),
  } as RequestInit);
}
export async function sendWebResponse(res: ServerResponse, r: Response) {
  const h: Record<string, string> = Object.fromEntries(r.headers);
  res.writeHead(r.status, {
    ...h,
    "set-cookie": r.headers.getSetCookie(),
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  });
  res.end(Buffer.from(await r.arrayBuffer()));
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    const last = (Array.isArray(xff) ? xff.join(",") : xff)?.split(",").map(s => s.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? "unknown";
}
