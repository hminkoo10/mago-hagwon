import { randomInt } from "node:crypto";
import { createServer } from "node:http";
import { toWebRequest, sendWebResponse } from "./node-adapter";
import { json } from "./http";
import { token } from "./store";
export async function fakeCloud() {
  const users = new Map<string, any>(),
    codes = new Map<string, string>(),
    sessions = new Map<string, string>(),
    rosters = new Map<number, any>();
  const requests: {
    path: string;
    method: string;
    uid: string | undefined;
    body: any;
  }[] = [];
  const guardians = new Map<string, any[]>();
  const consents = new Map<number, any[]>();
  const server = createServer(async (req, res) => {
    const response = toWebRequest(req, "http://localhost"),
      path = new URL(response.url).pathname,
      input = ["POST", "PATCH"].includes(req.method || "")
        ? await response.json()
        : {},
      uid = sessions.get(
        (response.headers.get("authorization") || "").replace("Bearer ", ""),
      ),
      user = users.get(uid || "");
    requests.push({
      path: path,
      method: req.method || "GET",
      uid,
      body: input,
    });
    let out: Response;
    if (path === "/api/sso/token") {
      const who = codes.get(input.code);
      codes.delete(input.code);
      if (input.secret !== "test-secret" || !who) out = json({}, 400);
      else {
        const t = token();
        sessions.set(t, who);
        out = json({ token: t, user: users.get(who) });
      }
    } else if (!user)
      out = json({ error: { message: "로그인이 끝났어요." } }, 401);
    else if (path === "/api/me") out = json({ user });
    else if (path === "/api/students")
      out = json({
        academyId: user.academy.id,
        students: [],
        purged: [],
        ...rosters.get(user.academy.id),
      });
    else if (path === "/api/academy/members")
      out = json({
        members: [...users.values()].filter(
          (item) => item.academy?.id === user.academy?.id,
        ),
      });
    else if (path === "/api/auth/logout") {
      sessions.delete(
        (response.headers.get("authorization") || "").replace("Bearer ", ""),
      );
      out = json({ ok: true });
    } else if (path === "/api/guardians/consent-summary")
      out = json({
        students: (rosters.get(user.academy.id)?.students ?? [])
          .filter(
            (value: any) =>
              !value.deletedAt &&
              (user.role !== "teacher" || value.teacherId === user.id),
          )
          .map((value: any) => ({
            studentId: value.id,
            collectVerified: (guardians.get(value.id) ?? []).some((guardian) =>
              (consents.get(guardian.id) ?? []).some(
                (candidate) =>
                  candidate.item === "collect" &&
                  candidate.verified &&
                  !candidate.withdrawn_at,
              ),
            ),
          })),
      });
    else if (path.startsWith("/api/students/") && path.includes("/guardians")) {
      const parts = path.split("/"),
        sid = parts[3],
        gid = Number(parts[5]);
      const student = rosters
        .get(user.academy.id)
        ?.students?.find((item: any) => item.id === sid);
      if (
        !student ||
        (user.role === "teacher" && student.teacherId !== user.id) ||
        (req.method !== "GET" && user.role !== "director")
      )
        out = json({ error: { message: "권한이 없어요." } }, 403);
      else if (parts[6] === "consents")
        out = json({ consents: consents.get(gid) ?? [] });
      else if (req.method === "GET")
        out = json({
          guardians: (guardians.get(sid) ?? []).map((guardian) => ({
            ...guardian,
            consents: consents.get(guardian.id) ?? [],
          })),
        });
      else if (req.method === "PATCH")
        out = json(
          { error: { message: "다른 사람이 고쳤어요. 다시 불러와 주세요." } },
          409,
        );
      else out = json({ guardian: { id: 1, ...input } });
    } else out = json({});
    await sendWebResponse(res, out);
  });
  // Windows may assign fetch-forbidden ports (6000, 10080) to listen(0).
  // Reserve only high ports; skip occupied or Windows-reserved candidates.
  for (let attempt = 0; ; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(randomInt(49152, 65536), "127.0.0.1", () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
      break;
    } catch (error) {
      server.removeAllListeners("listening");
      if (
        !["EADDRINUSE", "EACCES"].includes(
          (error as NodeJS.ErrnoException).code || "",
        ) ||
        attempt >= 99
      ) {
        throw error;
      }
    }
  }
  const port = (server.address() as any).port;
  return {
    requests,
    guardians,
    consents,
    users,
    rosters,
    sessions,
    env: {
      MAGO_CLOUD_URL: `http://127.0.0.1:${port}`,
      MAGO_APP_SECRET: "test-secret",
    },
    issue(uid: string) {
      const candidate = token();
      codes.set(candidate, uid);
      return candidate;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
export const cookieOf = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((item) => item.startsWith(name + "="))
    ?.split(";")[0] || "";
export function caller(api: (response: Request) => Promise<Response>) {
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
  if (back.status !== 302)
    throw new Error(
      `Test sign-in failed (${uid}): ${back.status} ${await back.text()}`,
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
