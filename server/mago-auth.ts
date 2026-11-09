import { HttpError, cookie, setCookie, redirect } from "./http";
import { Store, token, hash } from "./store";
export type Env = Record<string, string | undefined>;
export function auth(
  store: Store,
  env: Env,
  fetcher: typeof fetch,
  now: () => number,
) {
  const url = (env.MAGO_CLOUD_URL ?? "").replace(/\/$/, ""),
    appId = env.MAGO_APP_ID || "mago-hagwon";
  const flows = new Map<string, number>();
  async function cloud(path: string, t?: string, b?: unknown) {
    if (!url || !env.MAGO_APP_SECRET)
      throw new HttpError(503, "통합 클라우드 연결 설정이 필요해요.");
    let r: Response;
    try {
      r = await fetcher(url + path, {
        method: b ? "POST" : "GET",
        headers: {
          "content-type": "application/json",
          ...(t ? { authorization: `Bearer ${t}` } : {}),
        },
        body: b ? JSON.stringify(b) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new HttpError(502, "통합 클라우드에 연결하지 못했어요.");
    }
    const d = await r.json();
    if (!r.ok)
      throw new HttpError(
        r.status,
        d.error?.message || "통합 클라우드에서 확인하지 못했어요.",
      );
    return d;
  }
  const name = (secure: boolean) =>
    secure ? "__Host-hagwon_sid" : "hagwon_sid";
  return {
    cloud,
    async route(req: Request, secure: boolean) {
      const p = new URL(req.url);
      if (p.pathname === "/api/auth/mago") {
        const state = token();
        for (const [k, v] of flows) if (v < now()) flows.delete(k);
        if (flows.size > 1000)
          throw new HttpError(429, "잠시 후 다시 해 주세요.");
        flows.set(hash(state), now() + 600000);
        if (!url)
          throw new HttpError(503, "통합 클라우드 연결 설정이 필요해요.");
        return redirect(`${url}/#/sso?app=${appId}&state=${state}`, [
          setCookie(
            secure ? "__Host-hagwon_flow" : "hagwon_flow",
            state,
            secure,
            600,
          ),
        ]);
      }
      if (p.pathname === "/api/auth/mago/callback") {
        const state = p.searchParams.get("state") || "",
          key = hash(state),
          until = flows.get(key);
        flows.delete(key);
        if (
          !state ||
          cookie(req, secure ? "__Host-hagwon_flow" : "hagwon_flow") !==
            state ||
          !until ||
          until <= now()
        )
          throw new HttpError(
            400,
            "로그인 시간이 지났어요. 다시 로그인해 주세요.",
          );
        const d = await cloud("/api/sso/token", undefined, {
          appId,
          secret: env.MAGO_APP_SECRET,
          code: p.searchParams.get("code"),
        });
        const me = await cloud("/api/me", d.token);
        if (!me.user?.id) throw new HttpError(502, "계정을 확인하지 못했어요.");
        const sid = token();
        store.saveSession(sid, {
          user: me.user,
          cloud: d.token,
          checked: now(),
          expires: now() + 86400000,
        });
        return redirect("/", [
          setCookie(name(secure), sid, secure),
          setCookie(
            secure ? "__Host-hagwon_flow" : "hagwon_flow",
            "",
            secure,
            0,
          ),
        ]);
      }
      return null;
    },
    async session(req: Request, secure: boolean) {
      const sid = cookie(req, name(secure));
      let s = store.session(sid);
      if (!s || s.expires <= now()) {
        store.dropSession(sid);
        throw new HttpError(401, "통합 클라우드로 로그인해 주세요.");
      }
      if (now() - s.checked >= 600000) {
        try {
          const d = await cloud("/api/me", s.cloud);
          if (d.user?.id !== s.user.id)
            throw new HttpError(401, "다시 로그인해 주세요.");
          s = { ...s, user: d.user, checked: now() };
          store.saveSession(sid, s);
        } catch (e) {
          if (
            e instanceof HttpError &&
            (e.status === 401 || e.status === 403)
          ) {
            store.dropSession(sid);
          }
          throw e;
        }
      }
      return { ...s, sid };
    },
    async logout(req: Request, secure: boolean) {
      const sid = cookie(req, name(secure)),
        s = store.session(sid);
      store.dropSession(sid);
      if (s) await cloud("/api/auth/logout", s.cloud, {}).catch(() => {});
      return redirect("/", [setCookie(name(secure), "", secure, 0)]);
    },
  };
}
