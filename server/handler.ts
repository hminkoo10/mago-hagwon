import { randomInt, randomUUID } from "node:crypto";
import { join } from "node:path";
import { Store, token, hash } from "./store";
import { auth, type Env } from "./mago-auth";
import { HttpError, body, cookie, json, setCookie } from "./http";
import { lessons, members, day, autoAttend } from "./lessons";
import { notify } from "./notify";
export function createApi(
  opts: {
    store?: Store;
    env?: Env;
    fetch?: typeof fetch;
    now?: () => number;
  } = {},
) {
  const env = opts.env ?? process.env,
    store =
      opts.store ??
      new Store(join(env.DATA_DIR || "data", "hagwon.db"), env.SERVER_SECRET),
    now = opts.now ?? Date.now,
    login = auth(store, env, opts.fetch ?? fetch, now);
  const rosterCache = new Map<number, { at: number; data: any }>(),
    attempts = new Map<string, { n: number; until: number }>();
  const fail = (msg: string, status = 400): never => {
    throw new HttpError(status, msg);
  };
  const date = (v: any) =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v))
      ? v
      : fail("날짜를 확인해 주세요.");
  const time = (v: any) =>
    typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
      ? v
      : fail("시간을 확인해 주세요.");
  const text = (v: any, max = 120) =>
    typeof v === "string" ? v.trim().slice(0, max) : "";
  async function roster(a: number, s: any) {
    let hit = rosterCache.get(a);
    if (!hit || now() - hit.at >= 30000) {
      const data = await login.cloud("/api/students", s.cloud);
      if (data.academyId !== undefined && data.academyId !== a)
        fail("학원 정보가 바뀌었어요. 다시 로그인해 주세요.", 409);
      store.purge(a, data.purged ?? []);
      for (const student of data.students ?? [])
        store.put(
          a,
          "roster_state",
          student.id,
          { deleted: !!student.deletedAt },
          student.id,
        );
      hit = { at: now(), data };
      rosterCache.set(a, hit);
    }
    return hit.data;
  }
  return async (req: Request, ip = "unknown"): Promise<Response> => {
    try {
      const u = new URL(req.url),
        p = u.pathname,
        m = req.method,
        secure = u.protocol === "https:" || env.COOKIE_SECURE === "1",
        aCookie = secure ? "__Host-hagwon_device" : "hagwon_device";
      if (m !== "GET" && m !== "HEAD") {
        const origin = req.headers.get("origin");
        if (
          (origin && origin !== u.origin) ||
          req.headers.get("sec-fetch-site") === "cross-site"
        )
          fail("이 화면에서 다시 해 주세요.", 403);
      }
      if (p === "/api/health") return json({ ok: true });
      if (m === "GET" && p.startsWith("/api/auth/mago")) {
        const r = await login.route(req, secure);
        if (r) return r;
      }
      if (p === "/api/auth/logout" && m === "POST")
        return login.logout(req, secure);
      if (p === "/api/kiosk/register" && m === "POST") {
        for (const [key, value] of attempts) if (value.until <= now()) attempts.delete(key);
        const b = await body(req),
          rate = attempts.get(ip);
        if (rate && rate.n >= 5 && rate.until > now())
          fail("잠시 뒤 다시 입력해 주세요.", 429);
        const code = store.find("codes", hash(String(b.code))),
          key = ip;
        attempts.set(key, {
          n: (rate?.n ?? 0) + 1,
          until: now() + 60000,
        });
        if (!code || code.expires <= now() || code.used)
          fail("등록 번호가 틀리거나 시간이 지났어요.");
        store.put(code.academy_id, "codes", code.id, {
          expires: code.expires,
          used: true,
        });
        attempts.delete(ip);
        const t = token();
        store.put(code.academy_id, "devices", hash(t), {
          name: text(b.name) || "입구 태블릿",
          lastSeen: now(),
          disabled: false,
        });
        const r = json({ ok: true });
        r.headers.append("set-cookie", setCookie(aCookie, t, secure, 31536000));
        const staffCookie = secure ? "__Host-hagwon_sid" : "hagwon_sid";
        store.dropSession(cookie(req, staffCookie));
        r.headers.append("set-cookie", setCookie(staffCookie, "", secure, 0));
        return r;
      }
      if (p.startsWith("/api/kiosk/")) {
        const device = store.find("devices", hash(cookie(req, aCookie)));
        if (!device || device.disabled) fail("태블릿 등록이 필요해요.", 401);
        const a = device.academy_id;
        store.db.prepare("UPDATE records SET data=json_set(data, '$.lastSeen', ?) WHERE academy_id=? AND kind='devices' AND id=?").run(now(), a, device.id);
        if (p === "/api/kiosk/recent" && m === "GET")
          return json({
            records: store
              .byDay(a, "checkins", day(new Date(now())))
              .filter((x) => x.deviceId === device.id)
              .slice(-8)
              .reverse()
              .map((x) => ({ at: x.at, kind: x.kind })),
          });
        if (p === "/api/kiosk/checkin" && m === "POST") {
          const rate = store.get(a, "device_limits", device.id);
          if (rate?.until > now())
            fail("번호가 여러 번 틀렸어요. 1분 뒤 다시 해 주세요.", 429);
          const b = await body(req),
            pin = String(b.pin);
          const row: any = /^\d{4}$/.test(pin)
            ? store.db
                .prepare(
                  "SELECT student_id FROM pins WHERE academy_id=? AND digest=?",
                )
                .get(a, store.digest(a, pin))
            : null;
          if (!row) {
            const n =
              (rate?.until && rate.until <= now() ? 0 : (rate?.n ?? 0)) + 1;
            store.put(a, "device_limits", device.id, {
              n,
              until: n >= 5 ? now() + 60000 : 0,
            });
            fail("학생 번호를 다시 확인해 주세요.");
          }
          store.del(a, "device_limits", device.id);
          const sid = row.student_id,
            info = store.get(a, "student_info", sid);
          if (store.get(a, "roster_state", sid)?.deleted)
            fail("사용할 수 없는 학생 번호예요.");
          if (info && info.status !== "active")
            fail("재원 중인 학생 번호만 사용할 수 있어요.");
          const at = new Date(now()).toISOString(),
            prev = store
              .byDay(a, "checkins", day(new Date(now())))
              .filter(
                (x) =>
                  x.studentId === sid &&
                  day(new Date(x.at)) === day(new Date(at)),
              )
              .at(-1);
          if (prev && now() - Date.parse(prev.at) < 3000)
            fail("방금 기록했어요. 잠시 기다려 주세요.", 429);
          const kind = prev?.kind === "in" ? "out" : "in";
          store.put(
            a,
            "checkins",
            randomUUID(),
            { studentId: sid, at, kind, deviceId: device.id },
            sid,
          );
          if (kind === "in") autoAttend(store, a, sid, at);
          notify({ academyId: a, studentId: sid, kind, at });
          return json({ kind, at });
        }
        fail("찾을 수 없는 화면이에요.", 404);
      }
      const s = await login.session(req, secure),
        user = s.user,
        a = user.academy?.id;
      if (p === "/api/me") return json({ user });
      if (user.role === "student")
        fail("학생은 이 프로그램을 쓰지 않아요", 403);
      if (!a || !["director", "teacher"].includes(user.role))
        fail("학원에 속한 원장·선생님만 사용할 수 있어요.", 403);
      const director = () => {
        if (user.role !== "director") fail("원장만 바꿀 수 있어요.", 403);
      };
      const r = await roster(a, s),
        students = (r.students ?? []).filter((x: any) => !x.deletedAt);
      const student = (sid: string) => {
        if (!students.some((x: any) => x.id === sid))
          fail("학생 명단을 확인해 주세요.", 404);
      };
      if (p === "/api/state" && m === "GET") {
        const d = date(u.searchParams.get("date") || day(new Date(now()))),
          all = lessons(store, a, d),
          visible = all.filter(
            (l) => user.role === "director" || l.teacherId === user.id,
          );
        const att = store.byDay(a, "attendance", d);
        return json({
          user,
          students,
          members:
            (await login.cloud("/api/academy/members", s.cloud)).members ?? [],
          classes: store.all(a, "classes"),
          rooms: store.all(a, "rooms"),
          info: store.all(a, "student_info"),
          enrollments: store.all(a, "enrollments"),
          lessons: visible,
          attendance: att.filter((x) =>
            visible.some((l) => l.id === x.lessonId),
          ),
          checkins: store
            .byDay(a, "checkins", d)
            .filter((x) => day(new Date(x.at)) === d),
          pins: store.db
            .prepare("SELECT student_id FROM pins WHERE academy_id=?")
            .all(a)
            .map((x: any) => x.student_id),
        });
      }
      if (p === "/api/week" && m === "GET") {
        const start = date(u.searchParams.get("date") || day(new Date(now())));
        return json({
          lessons: Array.from({ length: 7 }, (_, i) =>
            lessons(
              store,
              a,
              new Date(Date.parse(start + "T12:00:00Z") + i * 86400000)
                .toISOString()
                .slice(0, 10),
            ),
          ).flat(),
        });
      }
      if (p === "/api/student-attendance" && m === "GET") {
        const sid = u.searchParams.get("id") || "";
        student(sid);
        const own = new Set(
          store
            .all(a, "classes")
            .filter((c) => c.teacherId === user.id)
            .map((c) => c.id),
        );
        return json({
          attendance: store
            .byStudent(a, "attendance", sid)
            .filter(
              (x) =>
                x.studentId === sid &&
                (user.role === "director" || own.has(x.classId)),
            ),
        });
      }
      if (p === "/api/attendance" && m === "POST") {
        const b = await body(req),
          ls = lessons(store, a, date(b.date)),
          l = ls.find((x) => x.id === b.lessonId);
        if (!l || l.kind === "cancelled") fail("수업을 확인해 주세요.", 404);
        if (user.role !== "director" && l.teacherId !== user.id)
          fail("내 반의 출결만 고칠 수 있어요.", 403);
        const ms = members(store, a, l).filter((x) =>
          students.some((y: any) => y.id === x.studentId),
        );
        const ids = b.all ? ms.map((x) => x.studentId) : [b.studentId];
        if (!["present", "late", "absent", "early", "none"].includes(b.status))
          fail("출결 상태를 확인해 주세요.");
        for (const sid of ids) store.checkRev(a, "attendance", `${l.id}:${sid}`, b.all ? b.revs?.[sid] : b.rev);
        for (const sid of ids) {
          if (!ms.some((x) => x.studentId === sid))
            fail("이 수업의 학생이 아니에요.");
          const id = `${l.id}:${sid}`;
          store.put(
            a,
            "attendance",
            id,
            {
              studentId: sid,
              classId: l.classId,
              lessonId: l.id,
              date: l.date,
              status: b.status,
              note: text(b.note, 500),
              manual: true,
              updatedBy: user.name,
              updatedAt: new Date(now()).toISOString(),
            },
            sid,
          );
          if (b.status === "absent")
            notify({
              academyId: a,
              studentId: sid,
              kind: "absent",
              at: new Date(now()).toISOString(),
            });
        }
        return json({ ok: true });
      }
      director();
      if (p === "/api/classes" && m === "POST") {
        const b = await body(req);
        if (!text(b.name)) fail("반 이름을 적어 주세요.");
        if (
          ![...(user.academy.subjects ?? ["math"]), "other"].includes(b.subject)
        )
          fail("계약 과목을 골라 주세요.");
        const ms =
          (await login.cloud("/api/academy/members", s.cloud)).members ?? [];
        if (
          !ms.some(
            (x: any) =>
              x.id === b.teacherId && ["director", "teacher"].includes(x.role),
          )
        )
          fail("담당 선생님을 골라 주세요.");
        if (
          !Array.isArray(b.times) ||
          b.times.length < 1 ||
          b.times.length > 30
        )
          fail("반복 시간을 넣어 주세요.");
        const times = b.times.map((t: any) => {
          if (!Number.isInteger(t.weekday) || t.weekday < 0 || t.weekday > 6)
            fail("요일을 확인해 주세요.");
          if (time(t.start) >= time(t.end))
            fail("끝나는 시간은 시작 뒤여야 해요.");
          return {
            id: t.id || randomUUID(),
            weekday: t.weekday,
            start: t.start,
            end: t.end,
            room: text(t.room),
          };
        });
        const startDate = date(b.startDate),
          endDate = b.endDate ? date(b.endDate) : "";
        if (endDate && endDate < startDate) fail("끝 날짜를 확인해 주세요.");
        if (b.id && !store.get(a, "classes", b.id))
          fail("반을 찾지 못했어요.", 404);
        if (b.id) store.checkRev(a, "classes", b.id, b.rev);
        return json(
          store.put(a, "classes", b.id || randomUUID(), {
            name: text(b.name),
            subject: b.subject,
            teacherId: b.teacherId,
            room: text(b.room),
            startDate,
            endDate,
            note: text(b.note, 1000),
            times,
          }),
        );
      }
      if (p === "/api/enrollments" && m === "POST") {
        const b = await body(req);
        student(b.studentId);
        if (!store.get(a, "classes", b.classId))
          fail("반을 찾지 못했어요.", 404);
        const joined = date(b.joined),
          left = b.left ? date(b.left) : "";
        if (left && left < joined) fail("나간 날을 확인해 주세요.");
        if (b.id) {
          const old = store.get(a, "enrollments", b.id);
          if (!old || old.classId !== b.classId || old.studentId !== b.studentId) fail("수강을 찾지 못했어요.", 404);
          store.checkRev(a, "enrollments", b.id, b.rev);
        }
        if (store.byStudent(a, "enrollments", b.studentId).some(x => x.id !== b.id && x.classId === b.classId && x.joined <= (left || "9999-12-31") && (!x.left || x.left >= joined))) fail("기간이 겹쳐요");
        return json(
          store.put(
            a,
            "enrollments",
            b.id || randomUUID(),
            { classId: b.classId, studentId: b.studentId, joined, left },
            b.studentId,
          ),
        );
      }
      if (p === "/api/lessons" && m === "POST") {
        const b = await body(req),
          d = date(b.date),
          c = store.get(a, "classes", b.classId);
        if (!c) fail("반을 찾지 못했어요.", 404);
        if (b.kind === "cancelled") {
          const l = lessons(store, a, d).find((x) => x.id === b.lessonId);
          if (!l || l.classId !== c.id) fail("수업을 확인해 주세요.");
          return json(
            store.put(a, "lessons", l.id, {
              classId: c.id,
              date: d,
              kind: "cancelled",
              isMakeup: l.kind === "makeup",
              start: l.start,
              end: l.end,
              room: l.room,
            }),
          );
        }
        if (b.kind !== "makeup" || time(b.start) >= time(b.end))
          fail("보강 시간을 확인해 주세요.");
        return json(
          store.put(a, "lessons", randomUUID(), {
            classId: c.id,
            date: d,
            kind: "makeup",
            start: b.start,
            end: b.end,
            room: text(b.room),
            teacherId: c.teacherId,
          }),
        );
      }
      if (p === "/api/student-info" && m === "POST") {
        const b = await body(req);
        student(b.studentId);
        if (!["active", "paused", "left"].includes(b.status))
          fail("재원 상태를 골라 주세요.");
        if (
          b.birthYear &&
          (!Number.isInteger(b.birthYear) ||
            b.birthYear < 1900 ||
            b.birthYear > new Date(now()).getFullYear())
        )
          fail("출생 연도를 확인해 주세요.");
        store.checkRev(a, "student_info", b.studentId, b.rev);
        return json(
          store.put(
            a,
            "student_info",
            b.studentId,
            {
              status: b.status,
              enrolledAt: b.enrolledAt ? date(b.enrolledAt) : "",
              leftAt: b.leftAt ? date(b.leftAt) : "",
              birthYear: b.birthYear || null,
            },
            b.studentId,
          ),
        );
      }
      if (p === "/api/pins" && m === "POST") {
        const b = await body(req),
          ids = b.studentId ? [b.studentId] : students.map((x: any) => x.id),
          out: any[] = [];
        for (const sid of ids) {
          student(sid);
          if (
            !b.studentId &&
            store.db
              .prepare("SELECT 1 FROM pins WHERE academy_id=? AND student_id=?")
              .get(a, sid)
          )
            continue;
          let pin = b.pin
            ? String(b.pin)
            : String(randomInt(10000)).padStart(4, "0");
          if (!/^\d{4}$/.test(pin)) fail("번호는 숫자 4자리예요.");
          let tries = 0;
          while (
            store.db
              .prepare(
                "SELECT 1 FROM pins WHERE academy_id=? AND digest=? AND student_id<>?",
              )
              .get(a, store.digest(a, pin), sid)
          ) {
            if (b.pin) fail("이미 쓰는 번호예요.", 409);
            if (++tries > 20000) fail("남은 번호가 없어요.", 409);
            pin = String(randomInt(10000)).padStart(4, "0");
          }
          store.db
            .prepare(
              "INSERT INTO pins VALUES(?,?,?) ON CONFLICT(academy_id,student_id) DO UPDATE SET digest=excluded.digest",
            )
            .run(a, sid, store.digest(a, pin));
          out.push({ studentId: sid, pin });
        }
        return json({ pins: out });
      }
      if (p === "/api/rooms" && m === "POST") {
        const b = await body(req);
        if (!text(b.name)) fail("강의실 이름을 적어 주세요.");
        if (b.id) store.checkRev(a, "rooms", b.id, b.rev);
        return json(
          store.put(a, "rooms", b.id || randomUUID(), { name: text(b.name) }),
        );
      }
      if (p === "/api/settings" && m === "GET")
        return json({
          rooms: store.all(a, "rooms"),
          devices: store
            .all(a, "devices")
            .map(({ id, name, lastSeen, disabled, rev }) => ({
              rev,
              id,
              name,
              lastSeen,
              disabled,
            })),
        });
      if (p === "/api/devices/code" && m === "POST") {
        let code: string;
        do {
          code = String(randomInt(100000, 1000000));
        } while (store.find("codes", hash(code)));
        store.put(a, "codes", hash(code), {
          expires: now() + 600000,
          used: false,
        });
        return json({ code, expires: now() + 600000 });
      }
      if (p === "/api/devices" && m === "POST") {
        const b = await body(req),
          d = store.get(a, "devices", b.id);
        if (!d) fail("기기를 찾지 못했어요.", 404);
        store.checkRev(a, "devices", b.id, b.rev);
        return json(
          store.put(a, "devices", b.id, {
            name: text(b.name) || d.name,
            disabled: !!b.disabled,
            lastSeen: d.lastSeen,
          }),
        );
      }
      return fail("찾을 수 없는 화면이에요.", 404);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error("요청 처리 실패", e instanceof Error ? e.message : "");
      return json(
        { error: "처리하지 못했어요. 입력 내용을 확인해 주세요." },
        500,
      );
    }
  };
}
