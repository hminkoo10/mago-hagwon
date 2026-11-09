import { billingRoute, guardianBilling, billingSettings } from "./billing-api";
import { cleanup } from "./billing";
import { randomInt, randomUUID } from "node:crypto";
import { join } from "node:path";
import { Store, token, hash } from "./store";
import { auth, type Env } from "./mago-auth";
import { HttpError, body, cookie, json, setCookie } from "./http";
import { lessons, members, day, autoAttend } from "./lessons";
import { consentStatus, guardianAttendance } from "./guardians";
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
  cleanup(store, day(new Date(now())));
  const consentCache = new Map<string, { at: number; data: any[] }>();
  const rosterCache = new Map<number, { at: number; data: any }>(),
    attempts = new Map<string, { n: number; until: number }>();
  const fail = (msg: string, status = 400): never => {
    throw new HttpError(status, msg);
  };
  const date = (value: any) =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value))
      ? value
      : fail("날짜를 확인해 주세요.");
  const time = (value: any) =>
    typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
      ? value
      : fail("시간을 확인해 주세요.");
  const text = (value: any, max = 120) =>
    typeof value === "string" ? value.trim().slice(0, max) : "";
  async function roster(academyId: number, value: any) {
    let hit = rosterCache.get(academyId);
    if (!hit || now() - hit.at >= 30000) {
      const data = await login.cloud("/api/students", value.cloud);
      if (data.academyId !== undefined && data.academyId !== academyId)
        fail("학원 정보가 바뀌었어요. 다시 로그인해 주세요.", 409);
      store.purge(academyId, data.purged ?? []);
      for (const student of data.students ?? [])
        store.put(
          academyId,
          "roster_state",
          student.id,
          { deleted: !!student.deletedAt },
          student.id,
        );
      hit = { at: now(), data };
      rosterCache.set(academyId, hit);
    }
    return hit.data;
  }
  return async (req: Request, ip = "unknown"): Promise<Response> => {
    try {
      const u = new URL(req.url),
        path = u.pathname,
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
      if (path === "/api/health") return json({ ok: true });
      if (m === "GET" && path.startsWith("/api/auth/mago")) {
        const response = await login.route(req, secure);
        if (response) return response;
      }
      if (path === "/api/auth/logout" && m === "POST")
        return login.logout(req, secure);
      if (path === "/api/kiosk/register" && m === "POST") {
        for (const [key, value] of attempts)
          if (value.until <= now()) attempts.delete(key);
        const input = await body(req),
          rate = attempts.get(ip);
        if (rate && rate.n >= 5 && rate.until > now())
          fail("잠시 뒤 다시 입력해 주세요.", 429);
        const code = store.find("codes", hash(String(input.code))),
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
          name: text(input.name) || "입구 태블릿",
          lastSeen: now(),
          disabled: false,
        });
        const response = json({ ok: true });
        response.headers.append(
          "set-cookie",
          setCookie(aCookie, t, secure, 31536000),
        );
        const staffCookie = secure ? "__Host-hagwon_sid" : "hagwon_sid";
        store.dropSession(cookie(req, staffCookie));
        response.headers.append(
          "set-cookie",
          setCookie(staffCookie, "", secure, 0),
        );
        return response;
      }
      if (path.startsWith("/api/kiosk/")) {
        const device = store.find("devices", hash(cookie(req, aCookie)));
        if (!device || device.disabled) fail("태블릿 등록이 필요해요.", 401);
        const academyId = device.academy_id;
        store.db
          .prepare(
            "UPDATE records SET data=json_set(data, '$.lastSeen', ?) WHERE academy_id=? AND kind='devices' AND id=?",
          )
          .run(now(), academyId, device.id);
        if (path === "/api/kiosk/recent" && m === "GET")
          return json({
            records: store
              .byDay(academyId, "checkins", day(new Date(now())))
              .filter((item) => item.deviceId === device.id)
              .slice(-8)
              .reverse()
              .map((item) => ({ at: item.at, kind: item.kind })),
          });
        if (path === "/api/kiosk/checkin" && m === "POST") {
          const rate = store.get(academyId, "device_limits", device.id);
          if (rate?.until > now())
            fail("번호가 여러 번 틀렸어요. 1분 뒤 다시 해 주세요.", 429);
          const input = await body(req),
            pin = String(input.pin);
          const row: any = /^\d{4}$/.test(pin)
            ? store.db
                .prepare(
                  "SELECT student_id FROM pins WHERE academy_id=? AND digest=?",
                )
                .get(academyId, store.digest(academyId, pin))
            : null;
          if (!row) {
            const n =
              (rate?.until && rate.until <= now() ? 0 : (rate?.n ?? 0)) + 1;
            store.put(academyId, "device_limits", device.id, {
              n,
              until: n >= 5 ? now() + 60000 : 0,
            });
            fail("학생 번호를 다시 확인해 주세요.");
          }
          store.del(academyId, "device_limits", device.id);
          const sid = row.student_id,
            info = store.get(academyId, "student_info", sid);
          if (store.get(academyId, "roster_state", sid)?.deleted)
            fail("사용할 수 없는 학생 번호예요.");
          if (info && info.status !== "active")
            fail("재원 중인 학생 번호만 사용할 수 있어요.");
          const at = new Date(now()).toISOString(),
            prev = store
              .byDay(academyId, "checkins", day(new Date(now())))
              .filter(
                (item) =>
                  item.studentId === sid &&
                  day(new Date(item.at)) === day(new Date(at)),
              )
              .at(-1);
          if (prev && now() - Date.parse(prev.at) < 3000)
            fail("방금 기록했어요. 잠시 기다려 주세요.", 429);
          const kind = prev?.kind === "in" ? "out" : "in";
          store.put(
            academyId,
            "checkins",
            randomUUID(),
            { studentId: sid, at, kind, deviceId: device.id },
            sid,
          );
          if (kind === "in") autoAttend(store, academyId, sid, at);
          notify({ academyId: academyId, studentId: sid, kind, at });
          return json({ kind, at });
        }
        fail("찾을 수 없는 화면이에요.", 404);
      }
      if (
        path.startsWith("/api/billing") &&
        cookie(req, aCookie) &&
        !cookie(req, secure ? "__Host-hagwon_sid" : "hagwon_sid")
      )
        fail("태블릿은 수납을 볼 수 없어요.", 403);
      const value = await login.session(req, secure),
        user = value.user,
        academyId = user.academy?.id;
      if (user.role === "guardian") {
        if (!academyId)
          fail("학원 정보를 확인하지 못했어요. 다시 로그인해 주세요.", 403);
        const fresh = (await login.cloud("/api/me", value.cloud)).user;
        if (
          fresh.id !== user.id ||
          fresh.role !== "guardian" ||
          fresh.academy?.id !== academyId
        )
          fail("다시 로그인해 주세요.", 403);
        if (path === "/api/me" && m === "GET") return json({ user: fresh });
        const children = fresh.children ?? [];
        if (path === "/api/guardian/children" && m === "GET")
          return json({ children });
        if (path === "/api/guardian/billing" && m === "GET") {
          const sid = u.searchParams.get("studentId") || "";
          if (!children.some((candidate: any) => candidate.studentId === sid))
            fail("내 자녀만 볼 수 있어요.", 403);
          return json(
            guardianBilling(store, academyId, sid, day(new Date(now()))),
          );
        }
        if (path === "/api/guardian/attendance" && m === "GET") {
          const sid = u.searchParams.get("studentId") || "",
            month =
              u.searchParams.get("month") || day(new Date(now())).slice(0, 7);
          if (!children.some((candidate: any) => candidate.studentId === sid))
            fail("내 자녀만 볼 수 있어요.", 403);
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
            fail("달을 확인해 주세요.");
          return json({
            attendance: guardianAttendance(store, academyId, sid, month),
            today: guardianAttendance(
              store,
              academyId,
              sid,
              day(new Date(now())),
            ),
          });
        }
        fail("보호자 계정으로는 쓸 수 없는 기능이에요.", 403);
      }
      if (path === "/api/me") return json({ user });
      if (user.role === "student")
        fail("학생은 이 프로그램을 쓰지 않아요", 403);
      if (!academyId || !["director", "teacher"].includes(user.role))
        fail("학원에 속한 원장·선생님만 사용할 수 있어요.", 403);
      const director = () => {
        if (user.role !== "director") fail("원장만 바꿀 수 있어요.", 403);
      };
      const response = await roster(academyId, value),
        students = (response.students ?? []).filter(
          (item: any) => !item.deletedAt,
        );
      const student = (sid: string) => {
        if (!students.some((item: any) => item.id === sid))
          fail("학생 명단을 확인해 주세요.", 404);
      };
      if (path.startsWith("/api/billing/"))
        return await billingRoute(
          req,
          store,
          academyId,
          user,
          students,
          day(new Date(now())),
          new Date(now()).toISOString(),
        );
      if (path.startsWith("/api/students/")) {
        const match = /^\/api\/students\/([^/]+)\/guardians(.*)$/.exec(path);
        if (!match || u.search) fail("허용하지 않는 경로예요.", 403);
        const [, sid, tail] = match!;
        student(sid);
        const allowed =
          tail === ""
            ? ["GET", "POST"]
            : /^\/\d+$/.test(tail)
              ? ["PATCH", "DELETE"]
              : /^\/\d+\/invite$/.test(tail)
                ? ["POST", "DELETE"]
                : /^\/\d+\/account-link$/.test(tail)
                  ? ["DELETE"]
                  : /^\/\d+\/consents$/.test(tail)
                    ? ["GET", "POST"]
                    : /^\/\d+\/consents\/\d+\/withdraw$/.test(tail)
                      ? ["POST"]
                      : [];
        if (!allowed.includes(m)) fail("허용하지 않는 경로예요.", 403);
        if (m !== "GET") director();
        const result = await login.cloud(
          path,
          value.cloud,
          ["POST", "PATCH"].includes(m) ? await body(req) : undefined,
          m,
        );
        if (m === "GET" && tail === "") {
          const guardians = result.guardians ?? [];
          consentCache.delete(`${academyId}:${user.role}:${user.id}`);
          return json({
            guardians,
            cloudUrl: env.MAGO_CLOUD_URL,
            consentVersion: "2026-11-09",
            ...consentStatus(
              store.get(academyId, "student_info", sid)?.birthYear,
              guardians.flatMap((guardian: any) => guardian.consents),
              Number(day(new Date(now())).slice(0, 4)),
            ),
          });
        }
        return json(result);
      }
      if (path === "/api/state" && m === "GET") {
        const d = date(u.searchParams.get("date") || day(new Date(now()))),
          all = lessons(store, academyId, d),
          visible = all.filter(
            (lesson) =>
              user.role === "director" || lesson.teacherId === user.id,
          );
        const att = store.byDay(academyId, "attendance", d);
        const consentWarnings: string[] = [];
        try {
          const key = `${academyId}:${user.role}:${user.id}`;
          let hit = consentCache.get(key);
          if (!hit || now() - hit.at >= 30000) {
            const data = await login.cloud(
              "/api/guardians/consent-summary",
              value.cloud,
            );
            if (!Array.isArray(data.students))
              throw new Error("동의 요약 없음");
            hit = { at: now(), data: data.students };
            consentCache.set(key, hit);
          }
          const verified = new Map(
            hit.data.map((item: any) => [item.studentId, item.collectVerified]),
          );
          for (const st of students) {
            const birthYear = store.get(
              academyId,
              "student_info",
              st.id,
            )?.birthYear;
            if (
              verified.has(st.id) &&
              verified.get(st.id) !== true &&
              consentStatus(
                birthYear,
                [],
                Number(day(new Date(now())).slice(0, 4)),
              ).possiblyUnder14
            )
              consentWarnings.push(st.id);
          }
        } catch {
          /* 클라우드 오류는 동의 경고만 생략한다. */
        }
        return json({
          user,
          students,
          consentWarnings,
          billingRead:
            user.role === "director" ||
            billingSettings(store, academyId).teacherRead === true,
          members:
            (await login.cloud("/api/academy/members", value.cloud)).members ??
            [],
          classes: store.all(academyId, "classes"),
          rooms: store.all(academyId, "rooms"),
          info: store.all(academyId, "student_info"),
          enrollments: store.all(academyId, "enrollments"),
          lessons: visible,
          attendance: att.filter((item) =>
            visible.some((lesson) => lesson.id === item.lessonId),
          ),
          checkins: store
            .byDay(academyId, "checkins", d)
            .filter((item) => day(new Date(item.at)) === d),
          pins: store.db
            .prepare("SELECT student_id FROM pins WHERE academy_id=?")
            .all(academyId)
            .map((item: any) => item.student_id),
        });
      }
      if (path === "/api/week" && m === "GET") {
        const start = date(u.searchParams.get("date") || day(new Date(now())));
        return json({
          lessons: Array.from({ length: 7 }, (_, index) =>
            lessons(
              store,
              academyId,
              new Date(Date.parse(start + "T12:00:00Z") + index * 86400000)
                .toISOString()
                .slice(0, 10),
            ),
          ).flat(),
        });
      }
      if (path === "/api/student-attendance" && m === "GET") {
        const sid = u.searchParams.get("id") || "";
        student(sid);
        const own = new Set(
          store
            .all(academyId, "classes")
            .filter((candidate) => candidate.teacherId === user.id)
            .map((candidate) => candidate.id),
        );
        return json({
          attendance: store
            .byStudent(academyId, "attendance", sid)
            .filter(
              (item) =>
                item.studentId === sid &&
                (user.role === "director" || own.has(item.classId)),
            ),
        });
      }
      if (path === "/api/attendance" && m === "POST") {
        const input = await body(req),
          ls = lessons(store, academyId, date(input.date)),
          lesson = ls.find((item) => item.id === input.lessonId);
        if (!lesson || lesson.kind === "cancelled")
          fail("수업을 확인해 주세요.", 404);
        if (user.role !== "director" && lesson.teacherId !== user.id)
          fail("내 반의 출결만 고칠 수 있어요.", 403);
        const ms = members(store, academyId, lesson).filter((item) =>
          students.some((y: any) => y.id === item.studentId),
        );
        const ids = input.all
          ? ms.map((item) => item.studentId)
          : [input.studentId];
        if (
          !["present", "late", "absent", "early", "none"].includes(input.status)
        )
          fail("출결 상태를 확인해 주세요.");
        for (const sid of ids)
          store.checkRev(
            academyId,
            "attendance",
            `${lesson.id}:${sid}`,
            input.all ? input.revs?.[sid] : input.rev,
          );
        for (const sid of ids) {
          if (!ms.some((item) => item.studentId === sid))
            fail("이 수업의 학생이 아니에요.");
          const id = `${lesson.id}:${sid}`;
          store.put(
            academyId,
            "attendance",
            id,
            {
              studentId: sid,
              classId: lesson.classId,
              lessonId: lesson.id,
              date: lesson.date,
              status: input.status,
              note: text(input.note, 500),
              manual: true,
              updatedBy: user.name,
              updatedAt: new Date(now()).toISOString(),
            },
            sid,
          );
          if (input.status === "absent")
            notify({
              academyId: academyId,
              studentId: sid,
              kind: "absent",
              at: new Date(now()).toISOString(),
            });
        }
        return json({ ok: true });
      }
      director();
      if (path === "/api/classes" && m === "POST") {
        const input = await body(req);
        if (!text(input.name)) fail("반 이름을 적어 주세요.");
        if (
          ![...(user.academy.subjects ?? ["math"]), "other"].includes(
            input.subject,
          )
        )
          fail("계약 과목을 골라 주세요.");
        const ms =
          (await login.cloud("/api/academy/members", value.cloud)).members ??
          [];
        if (
          !ms.some(
            (item: any) =>
              item.id === input.teacherId &&
              ["director", "teacher"].includes(item.role),
          )
        )
          fail("담당 선생님을 골라 주세요.");
        if (
          !Array.isArray(input.times) ||
          input.times.length < 1 ||
          input.times.length > 30
        )
          fail("반복 시간을 넣어 주세요.");
        const times = input.times.map((t: any) => {
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
        const startDate = date(input.startDate),
          endDate = input.endDate ? date(input.endDate) : "";
        if (endDate && endDate < startDate) fail("끝 날짜를 확인해 주세요.");
        if (input.id && !store.get(academyId, "classes", input.id))
          fail("반을 찾지 못했어요.", 404);
        if (input.id) store.checkRev(academyId, "classes", input.id, input.rev);
        return json(
          store.put(academyId, "classes", input.id || randomUUID(), {
            name: text(input.name),
            subject: input.subject,
            teacherId: input.teacherId,
            room: text(input.room),
            startDate,
            endDate,
            note: text(input.note, 1000),
            times,
          }),
        );
      }
      if (path === "/api/enrollments" && m === "POST") {
        const input = await body(req);
        student(input.studentId);
        if (!store.get(academyId, "classes", input.classId))
          fail("반을 찾지 못했어요.", 404);
        const joined = date(input.joined),
          left = input.left ? date(input.left) : "";
        if (left && left < joined) fail("나간 날을 확인해 주세요.");
        if (input.id) {
          const old = store.get(academyId, "enrollments", input.id);
          if (
            !old ||
            old.classId !== input.classId ||
            old.studentId !== input.studentId
          )
            fail("수강을 찾지 못했어요.", 404);
          store.checkRev(academyId, "enrollments", input.id, input.rev);
        }
        if (
          store
            .byStudent(academyId, "enrollments", input.studentId)
            .some(
              (item) =>
                item.id !== input.id &&
                item.classId === input.classId &&
                item.joined <= (left || "9999-12-31") &&
                (!item.left || item.left >= joined),
            )
        )
          fail("기간이 겹쳐요");
        return json(
          store.put(
            academyId,
            "enrollments",
            input.id || randomUUID(),
            {
              classId: input.classId,
              studentId: input.studentId,
              joined,
              left,
            },
            input.studentId,
          ),
        );
      }
      if (path === "/api/lessons" && m === "POST") {
        const input = await body(req),
          d = date(input.date),
          candidate = store.get(academyId, "classes", input.classId);
        if (!candidate) fail("반을 찾지 못했어요.", 404);
        if (input.kind === "cancelled") {
          const lesson = lessons(store, academyId, d).find(
            (item) => item.id === input.lessonId,
          );
          if (!lesson || lesson.classId !== candidate.id)
            fail("수업을 확인해 주세요.");
          return json(
            store.put(academyId, "lessons", lesson.id, {
              classId: candidate.id,
              date: d,
              kind: "cancelled",
              isMakeup: lesson.kind === "makeup",
              start: lesson.start,
              end: lesson.end,
              room: lesson.room,
            }),
          );
        }
        if (input.kind !== "makeup" || time(input.start) >= time(input.end))
          fail("보강 시간을 확인해 주세요.");
        return json(
          store.put(academyId, "lessons", randomUUID(), {
            classId: candidate.id,
            date: d,
            kind: "makeup",
            start: input.start,
            end: input.end,
            room: text(input.room),
            teacherId: candidate.teacherId,
          }),
        );
      }
      if (path === "/api/student-info" && m === "POST") {
        const input = await body(req);
        student(input.studentId);
        if (!["active", "paused", "left"].includes(input.status))
          fail("재원 상태를 골라 주세요.");
        if (
          input.birthYear &&
          (!Number.isInteger(input.birthYear) ||
            input.birthYear < 1900 ||
            input.birthYear > new Date(now()).getFullYear())
        )
          fail("출생 연도를 확인해 주세요.");
        store.checkRev(academyId, "student_info", input.studentId, input.rev);
        return json(
          store.put(
            academyId,
            "student_info",
            input.studentId,
            {
              status: input.status,
              enrolledAt: input.enrolledAt ? date(input.enrolledAt) : "",
              leftAt: input.leftAt ? date(input.leftAt) : "",
              birthYear: input.birthYear || null,
            },
            input.studentId,
          ),
        );
      }
      if (path === "/api/pins" && m === "POST") {
        const input = await body(req),
          ids = input.studentId
            ? [input.studentId]
            : students.map((item: any) => item.id),
          out: any[] = [];
        for (const sid of ids) {
          student(sid);
          if (
            !input.studentId &&
            store.db
              .prepare("SELECT 1 FROM pins WHERE academy_id=? AND student_id=?")
              .get(academyId, sid)
          )
            continue;
          let pin = input.pin
            ? String(input.pin)
            : String(randomInt(10000)).padStart(4, "0");
          if (!/^\d{4}$/.test(pin)) fail("번호는 숫자 4자리예요.");
          let tries = 0;
          while (
            store.db
              .prepare(
                "SELECT 1 FROM pins WHERE academy_id=? AND digest=? AND student_id<>?",
              )
              .get(academyId, store.digest(academyId, pin), sid)
          ) {
            if (input.pin) fail("이미 쓰는 번호예요.", 409);
            if (++tries > 20000) fail("남은 번호가 없어요.", 409);
            pin = String(randomInt(10000)).padStart(4, "0");
          }
          store.db
            .prepare(
              "INSERT INTO pins VALUES(?,?,?) ON CONFLICT(academy_id,student_id) DO UPDATE SET digest=excluded.digest",
            )
            .run(academyId, sid, store.digest(academyId, pin));
          out.push({ studentId: sid, pin });
        }
        return json({ pins: out });
      }
      if (path === "/api/rooms" && m === "POST") {
        const input = await body(req);
        if (!text(input.name)) fail("강의실 이름을 적어 주세요.");
        if (input.id) store.checkRev(academyId, "rooms", input.id, input.rev);
        return json(
          store.put(academyId, "rooms", input.id || randomUUID(), {
            name: text(input.name),
          }),
        );
      }
      if (path === "/api/settings" && m === "GET")
        return json({
          rooms: store.all(academyId, "rooms"),
          devices: store
            .all(academyId, "devices")
            .map(({ id, name, lastSeen, disabled, rev }) => ({
              rev,
              id,
              name,
              lastSeen,
              disabled,
            })),
        });
      if (path === "/api/devices/code" && m === "POST") {
        let code: string;
        do {
          code = String(randomInt(100000, 1000000));
        } while (store.find("codes", hash(code)));
        store.put(academyId, "codes", hash(code), {
          expires: now() + 600000,
          used: false,
        });
        return json({ code, expires: now() + 600000 });
      }
      if (path === "/api/devices" && m === "POST") {
        const input = await body(req),
          d = store.get(academyId, "devices", input.id);
        if (!d) fail("기기를 찾지 못했어요.", 404);
        store.checkRev(academyId, "devices", input.id, input.rev);
        return json(
          store.put(academyId, "devices", input.id, {
            name: text(input.name) || d.name,
            disabled: !!input.disabled,
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
