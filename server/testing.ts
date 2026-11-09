import { createServer } from "node:http";
import { toWebRequest, sendWebResponse } from "./node-adapter";
import { json } from "./http";
import { token } from "./store";
export async function fakeCloud() {
  const users = new Map<string, any>(),
    codes = new Map<string, string>(),
    sessions = new Map<string, string>(),
    rosters = new Map<number, any>();
  const server = createServer(async (req, res) => {
    const r = toWebRequest(req, "http://localhost"),
      p = new URL(r.url).pathname,
      b = req.method === "POST" ? await r.json() : {},
      uid = sessions.get(
        (r.headers.get("authorization") || "").replace("Bearer ", ""),
      ),
      user = users.get(uid || "");
    let out: Response;
    if (p === "/api/sso/token") {
      const who = codes.get(b.code);
      codes.delete(b.code);
      if (b.secret !== "test-secret" || !who) out = json({}, 400);
      else {
        const t = token();
        sessions.set(t, who);
        out = json({ token: t, user: users.get(who) });
      }
    } else if (!user)
      out = json({ error: { message: "로그인이 끝났어요." } }, 401);
    else if (p === "/api/me") out = json({ user });
    else if (p === "/api/students")
      out = json({
        academyId: user.academy.id,
        students: [],
        purged: [],
        ...rosters.get(user.academy.id),
      });
    else if (p === "/api/academy/members")
      out = json({
        members: [...users.values()].filter(
          (x) => x.academy?.id === user.academy?.id,
        ),
      });
    else out = json({});
    await sendWebResponse(res, out);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  return {
    users,
    rosters,
    sessions,
    env: {
      MAGO_CLOUD_URL: `http://127.0.0.1:${port}`,
      MAGO_APP_SECRET: "test-secret",
    },
    issue(uid: string) {
      const c = token();
      codes.set(c, uid);
      return c;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
export const cookieOf = (r: Response, name: string) =>
  r.headers
    .getSetCookie()
    .find((x) => x.startsWith(name + "="))
    ?.split(";")[0] || "";
export function caller(api: (r: Request) => Promise<Response>) {
  return (path: string, data?: unknown, cookie = "") =>
    api(
      new Request("http://localhost" + path, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          cookie,
          ...(data === undefined ? {} : { "content-type": "application/json" }),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      }),
    );
}
export async function signIn(
  call: ReturnType<typeof caller>,
  cloud: Awaited<ReturnType<typeof fakeCloud>>,
  uid: string,
) {
  const start = await call("/api/auth/mago"),
    state = new URL(start.headers.get("location")!).hash.split("state=")[1],
    flow = cookieOf(start, "hagwon_flow"),
    code = cloud.issue(uid),
    back = await call(
      `/api/auth/mago/callback?state=${state}&code=${code}`,
      undefined,
      flow,
    );
  return {
    cookie: cookieOf(back, "hagwon_sid"),
    start,
    state,
    flow,
    code,
    back,
  };
}
