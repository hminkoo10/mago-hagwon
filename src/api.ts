export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api(path: string, data?: unknown, method?: string) {
  const response = await fetch("/api/" + path, {
    method: method ?? (data === undefined ? "GET" : "POST"),
    headers: data === undefined ? {} : { "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const input = await response.json();
  if (!response.ok)
    throw new ApiError(input.error || "다시 해 주세요.", response.status);
  return input;
}
