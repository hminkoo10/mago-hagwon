export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api(path: string, data?: unknown) {
  const r = await fetch("/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const b = await r.json();
  if (!r.ok) throw new ApiError(b.error || "다시 해 주세요.", r.status);
  return b;
}
