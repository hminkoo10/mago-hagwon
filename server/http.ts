export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
export const cookie = (req: Request, name: string) =>
  req.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="))
    ?.slice(name.length + 1) ?? "";
export const setCookie = (
  name: string,
  value: string,
  secure: boolean,
  age = 86400,
) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`;
export function redirect(url: string, cookies: string[] = []) {
  const h = new Headers({
    location: url,
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
  });
  for (const c of cookies) h.append("set-cookie", c);
  return new Response(null, { status: 302, headers: h });
}
export async function body(req: Request): Promise<Record<string, any>> {
  if (Number(req.headers.get("content-length")) > 64000)
    throw new HttpError(413, "내용이 너무 많아요.");
  const reader = req.body?.getReader();
  let text = "";
  if (reader) {
    const decoder = new TextDecoder();
    let size = 0;
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > 64000) {
        await reader.cancel();
        throw new HttpError(413, "내용이 너무 많아요.");
      }
      text += decoder.decode(r.value, { stream: true });
    }
    text += decoder.decode();
  }
  try {
    const v = JSON.parse(text || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) throw 0;
    return v;
  } catch {
    throw new HttpError(400, "입력 내용을 확인해 주세요.");
  }
}
