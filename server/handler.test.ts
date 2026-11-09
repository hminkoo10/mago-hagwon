import { afterEach, beforeEach, expect, it, describe } from "vitest";
import { Store } from "./store";
import { createApi } from "./handler";
import { lessons, members, automaticStatus, stamp } from "./lessons";
import { fakeCloud, caller, signIn, cookieOf } from "./testing";
let cloud: Awaited<ReturnType<typeof fakeCloud>>,
  store: Store,
  call: ReturnType<typeof caller>,
  now: number,
  d: string,
  t: string,
  o: string;
const date = "2026-11-09",
  studentId = "student-001";
const user = (id: string, role: string, academyId = 1) => ({
  id,
  name: id,
  role,
  academy: {
    id: academyId,
    name: "시험 학원",
    subjects: ["math", "english", "korean"],
  },
});
beforeEach(async () => {
  now = stamp(date, "16:05");
  cloud = await fakeCloud();
  store = new Store();
  for (const u of [
    user("director", "director"),
    user("teacher", "teacher"),
    user("other", "teacher"),
    user("second", "director", 2),
    user("student", "student"),
    { id: "admin", role: "admin", academy: null },
  ])
    cloud.users.set(u.id, u);
  cloud.rosters.set(1, {
    students: [
      { id: studentId, name: "김학생", school: "마고중", grade: "중1" },
      { id: "student-002", name: "이학생" },
    ],
    purged: [],
  });
  call = caller(createApi({ store, env: cloud.env, now: () => now }));
  d = (await signIn(call, cloud, "director")).cookie;
  t = (await signIn(call, cloud, "teacher")).cookie;
  o = (await signIn(call, cloud, "other")).cookie;
});
afterEach(async () => {
  store.close();
  await cloud.close();
});
async function make(teacherId = "teacher") {
  const response = await call(
      "/api/classes",
      {
        name: "수학 A",
        subject: "math",
        teacherId,
        startDate: date,
        times: [{ weekday: 1, start: "16:00", end: "17:00", room: "1강의실" }],
      },
      d,
    ),
    candidate = await response.json();
  expect(response.status).toBe(200);
  await call(
    "/api/enrollments",
    { classId: candidate.id, studentId, joined: date },
    d,
  );
  return { ...candidate, lesson: lessons(store, 1, date)[0] };
}
async function tablet() {
  const response = await call("/api/devices/code", {}, d),
    { code } = await response.json(),
    reg = await call("/api/kiosk/register", { code });
  return { code, cookie: cookieOf(reg, "hagwon_device") };
}
describe("로그인·권한·학원 경계", () => {
  it("SSO state 쿠키와 서버 교환, 토큰은 브라우저 응답에 없음", async () => {
    const value = await signIn(call, cloud, "director");
    expect(value.start.headers.get("location")).toContain(
      "/#/sso?app=mago-hagwon&state=",
    );
    expect(value.back.status).toBe(302);
    expect(value.cookie).toMatch(/hagwon_sid=/);
    expect(value.back.headers.getSetCookie().join()).toContain(
      "HttpOnly; SameSite=Lax",
    );
    expect(
      (await (await call("/api/me", undefined, value.cookie)).json()).cloud,
    ).toBeUndefined();
    expect(
      String(store.db.prepare("SELECT data FROM sessions LIMIT 1").get()?.data),
    ).not.toContain("director");
  });
  it("틀린 state 거부·재사용 거부", async () => {
    const value = await signIn(call, cloud, "teacher");
    expect(
      (
        await call(
          `/api/auth/mago/callback?state=${value.state}&code=${value.code}`,
          undefined,
          value.flow,
        )
      ).status,
    ).toBe(400);
    expect(
      (await call("/api/auth/mago/callback?state=wrong&code=wrong")).status,
    ).toBe(400);
  });
  it("10분 뒤 정지·로그아웃 세션 끊음", async () => {
    cloud.sessions.clear();
    now += 600001;
    expect((await call("/api/me", undefined, d)).status).toBe(401);
    expect(store.session(d.split("=")[1])).toBeNull();
  });
  it("학생은 안내만", async () => {
    const value = await signIn(call, cloud, "student");
    expect((await call("/api/state", undefined, value.cookie)).status).toBe(
      403,
    );
  });
  it("학원 없는 운영자는 안내만", async () => {
    const value = await signIn(call, cloud, "admin");
    expect((await call("/api/state", undefined, value.cookie)).status).toBe(
      403,
    );
  });
  it("선생님 운영 설정·반 쓰기·번호 발급 거부", async () => {
    for (const [p, b] of [
      ["/api/settings", undefined],
      ["/api/rooms", { name: "x" }],
      ["/api/classes", {}],
      ["/api/pins", {}],
      ["/api/devices/code", {}],
    ] as const)
      expect((await call(p, b, t)).status).toBe(403);
  });
  it("남의 반 출결 거부, 내 반 허용", async () => {
    const candidate = await make();
    const input = {
      date,
      lessonId: candidate.lesson.id,
      studentId,
      status: "absent",
      rev: 0,
    };
    expect((await call("/api/attendance", input, o)).status).toBe(403);
    expect((await call("/api/attendance", input, t)).status).toBe(200);
  });
  it("오늘·출결은 내 반만", async () => {
    await make();
    const value = await (
      await call("/api/state?date=" + date, undefined, o)
    ).json();
    expect(value.lessons).toEqual([]);
    expect(value.attendance).toEqual([]);
  });
  it("다른 학원 조회·수정·기기 접근 불가", async () => {
    const candidate = await make(),
      value = await signIn(call, cloud, "second");
    const state = await (
      await call("/api/state?date=" + date, undefined, value.cookie)
    ).json();
    expect(state.classes).toEqual([]);
    expect(
      (
        await call(
          "/api/classes",
          { ...candidate, name: "가로채기" },
          value.cookie,
        )
      ).status,
    ).not.toBe(200);
    expect(
      (
        await call(
          "/api/attendance",
          { date, lessonId: candidate.lesson.id, studentId, status: "present" },
          value.cookie,
        )
      ).status,
    ).toBe(404);
  });
  it("다른 출처 쓰기 거부", async () => {
    const api = createApi({ store, env: cloud.env });
    expect(
      (
        await api(
          new Request("http://localhost/api/rooms", {
            method: "POST",
            headers: { origin: "http://evil", cookie: d },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(403);
  });
});
describe("수업·자동 출석", () => {
  it("반복 요일·시작 끝 날짜 계산", async () => {
    const candidate = await make();
    expect(lessons(store, 1, date)).toHaveLength(1);
    expect(lessons(store, 1, "2026-11-10")).toHaveLength(0);
    store.put(1, "classes", candidate.id, { ...candidate, endDate: date });
    expect(lessons(store, 1, "2026-11-16")).toHaveLength(0);
  });
  it("휴강·보강 날짜 예외", async () => {
    const candidate = await make();
    await call(
      "/api/lessons",
      {
        classId: candidate.id,
        date,
        lessonId: candidate.lesson.id,
        kind: "cancelled",
      },
      d,
    );
    await call(
      "/api/lessons",
      {
        classId: candidate.id,
        date,
        kind: "makeup",
        start: "18:00",
        end: "19:00",
      },
      d,
    );
    expect(lessons(store, 1, date).map((item) => item.kind)).toEqual([
      "cancelled",
      "makeup",
    ]);
  });
  it.each([
    [-61, null],
    [-60, "present"],
    [0, "present"],
    [10, "present"],
    [11, "late"],
    [60, "late"],
    [61, null],
  ])("시작 대비 %i분 자동 출석=%s", (offset, want) => {
    const start = stamp(date, "16:00");
    expect(
      automaticStatus(start + offset * 60000, start, start + 3600000, false),
    ).toBe(want);
  });
  it("수동 기록은 자동 변경 안 함", () =>
    expect(
      automaticStatus(now, stamp(date, "16:00"), stamp(date, "17:00"), true),
    ).toBeNull());
  it("등원 자동 반영·수동 결석 유지·등하원 교대", async () => {
    const candidate = await make(),
      dev = await tablet();
    await call("/api/pins", { studentId, pin: "1234" }, d);
    expect(
      (
        await (
          await call("/api/kiosk/checkin", { pin: "1234" }, dev.cookie)
        ).json()
      ).kind,
    ).toBe("in");
    expect(store.all(1, "attendance")[0].status).toBe("present");
    await call(
      "/api/attendance",
      {
        date,
        lessonId: candidate.lesson.id,
        studentId,
        status: "absent",
        note: "직접 확인",
        rev: store.all(1, "attendance")[0].rev,
      },
      t,
    );
    now += 4000;
    expect(
      (
        await (
          await call("/api/kiosk/checkin", { pin: "1234" }, dev.cookie)
        ).json()
      ).kind,
    ).toBe("out");
    now += 4000;
    await call("/api/kiosk/checkin", { pin: "1234" }, dev.cookie);
    expect(store.all(1, "attendance")[0]).toMatchObject({
      status: "absent",
      manual: true,
      note: "직접 확인",
    });
  });
  it("휴강은 자동 출석 없음", async () => {
    const candidate = await make(),
      dev = await tablet();
    await call(
      "/api/lessons",
      {
        classId: candidate.id,
        date,
        lessonId: candidate.lesson.id,
        kind: "cancelled",
      },
      d,
    );
    await call("/api/pins", { studentId, pin: "1234" }, d);
    await call("/api/kiosk/checkin", { pin: "1234" }, dev.cookie);
    expect(store.all(1, "attendance")).toHaveLength(0);
  });
});
describe("태블릿·번호·명단", () => {
  it("태블릿 등록 브라우저의 직원 세션 제거", async () => {
    const { code } = await (await call("/api/devices/code", {}, d)).json();
    const reg = await call("/api/kiosk/register", { code }, d);
    expect(
      reg.headers
        .getSetCookie()
        .some((item) => item.startsWith("hagwon_sid=;")),
    ).toBe(true);
    expect((await call("/api/state", undefined, d)).status).toBe(401);
  });
  it("클라우드에서 숨긴 학생은 명단 갱신 뒤 태블릿 번호 차단", async () => {
    const dev = await tablet();
    await call("/api/pins", { studentId, pin: "1234" }, d);
    cloud.rosters.set(1, {
      students: [{ id: studentId, name: "김학생", deletedAt: 1 }],
      purged: [],
    });
    now += 30001;
    await call("/api/state", undefined, d);
    expect(
      (await call("/api/kiosk/checkin", { pin: "1234" }, dev.cookie)).status,
    ).toBe(400);
  });
  it("보강 휴강 행 유지·반 기본 강의실 사용", async () => {
    const candidate = await make();
    const made = await (
      await call(
        "/api/lessons",
        {
          classId: candidate.id,
          date,
          kind: "makeup",
          start: "18:00",
          end: "19:00",
        },
        d,
      )
    ).json();
    await call(
      "/api/lessons",
      { classId: candidate.id, date, lessonId: made.id, kind: "cancelled" },
      d,
    );
    expect(
      lessons(store, 1, date).find((lesson) => lesson.id === made.id)?.kind,
    ).toBe("cancelled");
    store.put(1, "classes", candidate.id, {
      ...candidate,
      room: "기본 강의실",
      times: [{ id: "a", weekday: 1, start: "16:00", end: "17:00", room: "" }],
    });
    expect(lessons(store, 1, date)[0].room).toBe("기본 강의실");
  });
  it("재발급하면 옛 번호 무효", async () => {
    const dev = await tablet();
    await call("/api/pins", { studentId, pin: "1234" }, d);
    await call("/api/pins", { studentId, pin: "5678" }, d);
    expect(
      (await call("/api/kiosk/checkin", { pin: "1234" }, dev.cookie)).status,
    ).toBe(400);
    expect(
      (await call("/api/kiosk/checkin", { pin: "5678" }, dev.cookie)).status,
    ).toBe(200);
  });
  it("등록 번호는 한 번만", async () => {
    const dev = await tablet();
    expect((await call("/api/kiosk/register", { code: dev.code })).status).toBe(
      400,
    );
  });
  it("등록 번호 10분 만료", async () => {
    const { code } = await (await call("/api/devices/code", {}, d)).json();
    now += 600001;
    expect((await call("/api/kiosk/register", { code })).status).toBe(400);
  });
  it("등록 태블릿으로 다른 API 접근 못 함", async () => {
    const dev = await tablet();
    expect((await call("/api/state", undefined, dev.cookie)).status).toBe(401);
  });
  it("기기 끄면 즉시 차단", async () => {
    const dev = await tablet(),
      device = store.all(1, "devices")[0];
    await call(
      "/api/devices",
      { id: device.id, disabled: true, rev: device.rev },
      d,
    );
    expect(
      (await call("/api/kiosk/recent", undefined, dev.cookie)).status,
    ).toBe(401);
  });
  it("학원 내 번호 중복 거부·평문 없음", async () => {
    await call("/api/pins", { studentId, pin: "1234" }, d);
    expect(
      (await call("/api/pins", { studentId: "student-002", pin: "1234" }, d))
        .status,
    ).toBe(409);
    const storedPins = store.db.prepare("SELECT * FROM pins").all();
    expect(storedPins).toEqual([
      { academy_id: 1, student_id: studentId, digest: store.digest(1, "1234") },
    ]);
    expect(storedPins[0].digest).toMatch(/^[a-f0-9]{64}$/);
  });
  it("없는 번호 일괄 발급, 기존 번호 유지", async () => {
    expect((await (await call("/api/pins", {}, d)).json()).pins).toHaveLength(
      2,
    );
    expect((await (await call("/api/pins", {}, d)).json()).pins).toHaveLength(
      0,
    );
  });
  it("틀린 번호 5번 뒤 기기별 1분 차단", async () => {
    const dev = await tablet();
    for (let index = 0; index < 5; index++)
      expect(
        (await call("/api/kiosk/checkin", { pin: "xxxx" }, dev.cookie)).status,
      ).toBe(400);
    expect(
      (await call("/api/kiosk/checkin", { pin: "xxxx" }, dev.cookie)).status,
    ).toBe(429);
    now += 60001;
    expect(
      (await call("/api/kiosk/checkin", { pin: "xxxx" }, dev.cookie)).status,
    ).toBe(400);
  });
  it("완전히 지운 학생 연결 정보 삭제·다른 학원 보존", async () => {
    await make();
    await call("/api/pins", { studentId, pin: "1234" }, d);
    store.put(1, "student_info", studentId, { status: "active" }, studentId);
    store.put(2, "student_info", studentId, { status: "active" }, studentId);
    cloud.rosters.set(1, { students: [], purged: [studentId] });
    now += 30001;
    await call("/api/state", undefined, d);
    expect(store.all(1, "enrollments")).toHaveLength(0);
    expect(store.all(1, "student_info")).toHaveLength(0);
    expect(store.db.prepare("SELECT * FROM pins").all()).toHaveLength(0);
    expect(store.all(2, "student_info")).toHaveLength(1);
  });
});

describe("작업 G 회귀", () => {
  it("자기 반 보강 출결만 학생별 출결에서 보임", async () => {
    const candidate = await make();
    const makeup = await (
      await call(
        "/api/lessons",
        {
          classId: candidate.id,
          date,
          kind: "makeup",
          start: "18:00",
          end: "19:00",
        },
        d,
      )
    ).json();
    expect(
      (
        await call(
          "/api/attendance",
          { date, lessonId: makeup.id, studentId, status: "present", rev: 0 },
          t,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await (
          await call("/api/student-attendance?id=" + studentId, undefined, t)
        ).json()
      ).attendance,
    ).toHaveLength(1);
    expect(
      (
        await (
          await call("/api/student-attendance?id=" + studentId, undefined, o)
        ).json()
      ).attendance,
    ).toEqual([]);
  });
  it("재등록 두 기간 보존·각 날짜 명단·경계 겹침 거절", async () => {
    const candidate = await make();
    const first = store.all(1, "enrollments")[0];
    expect(
      (await call("/api/enrollments", { ...first, left: "2026-11-10" }, d))
        .status,
    ).toBe(200);
    expect(
      (
        await call(
          "/api/enrollments",
          { classId: candidate.id, studentId, joined: "2026-11-16" },
          d,
        )
      ).status,
    ).toBe(200);
    const periods = store.all(1, "enrollments");
    expect(periods).toHaveLength(2);
    expect(new Set(periods.map((item) => item.id)).size).toBe(2);
    expect(members(store, 1, { classId: candidate.id, date })).toHaveLength(1);
    expect(
      members(store, 1, { classId: candidate.id, date: "2026-11-12" }),
    ).toEqual([]);
    expect(
      members(store, 1, { classId: candidate.id, date: "2026-11-16" }),
    ).toHaveLength(1);
    const overlap = await call(
      "/api/enrollments",
      {
        classId: candidate.id,
        studentId,
        joined: "2026-11-10",
        left: "2026-11-11",
      },
      d,
    );
    expect(overlap.status).toBe(400);
    expect((await overlap.json()).error).toBe("기간이 겹쳐요");
  });
  it("반·수강·학생 운영 정보·강의실·기기 낡은 rev 거절", async () => {
    const candidate = await make();
    const en = store.all(1, "enrollments")[0];
    const room = await (await call("/api/rooms", { name: "1" }, d)).json();
    await tablet();
    const device = store.all(1, "devices")[0];
    for (const [path, value] of [
      ["classes", candidate],
      ["enrollments", en],
      ["rooms", room],
      ["devices", device],
      ["student-info", { studentId, status: "active", rev: 0 }],
    ] as const) {
      expect((await call("/api/" + path, value, d)).status).toBe(200);
      const stale = await call("/api/" + path, value, d);
      expect(stale.status).toBe(409);
      expect((await stale.json()).error).toBe(
        "다른 분이 먼저 고쳤어요. 새로 불러온 뒤 다시 해 주세요.",
      );
    }
  });
  it("출결 rev 없거나 낡으면 거절·맞으면 저장·일괄 충돌은 전부 보존", async () => {
    const candidate = await make();
    await call(
      "/api/enrollments",
      { classId: candidate.id, studentId: "student-002", joined: date },
      d,
    );
    const value = {
      date,
      lessonId: candidate.lesson.id,
      studentId,
      status: "absent",
    };
    expect((await call("/api/attendance", value, t)).status).toBe(409);
    expect(
      (await call("/api/attendance", { ...value, rev: 0 }, t)).status,
    ).toBe(200);
    expect(
      (await call("/api/attendance", { ...value, rev: 0 }, t)).status,
    ).toBe(409);
    const before = store.all(1, "attendance");
    expect(
      (
        await call(
          "/api/attendance",
          {
            ...value,
            all: true,
            status: "present",
            revs: { [studentId]: 0, "student-002": 0 },
          },
          t,
        )
      ).status,
    ).toBe(409);
    expect(store.all(1, "attendance")).toEqual(before);
    expect(
      (
        await call(
          "/api/attendance",
          {
            ...value,
            all: true,
            status: "present",
            revs: { [studentId]: 1, "student-002": 0 },
          },
          t,
        )
      ).status,
    ).toBe(200);
    expect(store.all(1, "attendance").map((item) => item.status)).toEqual([
      "present",
      "present",
    ]);
  });
  it("등록 제한 IP 분리·성공한 IP만 초기화·1분 뒤 재시도", async () => {
    const api = createApi({ store, env: cloud.env, now: () => now });
    const register = (ip: string, code: string) =>
      api(
        new Request("http://localhost/api/kiosk/register", {
          method: "POST",
          body: JSON.stringify({ code }),
        }),
        ip,
      );
    for (let index = 0; index < 5; index++)
      expect((await register("A", "bad")).status).toBe(400);
    const { code } = await (await call("/api/devices/code", {}, d)).json();
    expect((await register("A", code)).status).toBe(429);
    expect((await register("B", code)).status).toBe(200);
    expect((await register("A", code)).status).toBe(429);
    now += 60001;
    expect((await register("A", "bad")).status).toBe(400);
  });
  it("등록 성공 시 그 IP 실패 횟수 초기화", async () => {
    const api = createApi({ store, env: cloud.env, now: () => now });
    const register = (code: string) =>
      api(
        new Request("http://localhost/api/kiosk/register", {
          method: "POST",
          body: JSON.stringify({ code }),
        }),
        "A",
      );
    for (let index = 0; index < 4; index++) await register("bad");
    const { code } = await (await call("/api/devices/code", {}, d)).json();
    expect((await register(code)).status).toBe(200);
    for (let index = 0; index < 5; index++)
      expect((await register("bad")).status).toBe(400);
    expect((await register("bad")).status).toBe(429);
  });
});

it("가짜 클라우드는 fetch 금지 포트를 피하고 실제 HTTP 응답", async () => {
  const url = new URL(cloud.env.MAGO_CLOUD_URL);
  expect(Number(url.port)).toBeGreaterThanOrEqual(49152);
  expect(Number(url.port)).toBeLessThanOrEqual(65535);
  expect((await fetch(url)).status).toBe(401);
});
