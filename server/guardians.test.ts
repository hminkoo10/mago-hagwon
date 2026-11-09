import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { createApi } from "./handler";
import { Store } from "./store";
import { fakeCloud, caller, signIn } from "./testing";
import * as lessonModule from "./lessons";
import { consentStatus, guardianAttendance } from "./guardians";
let cloud: Awaited<ReturnType<typeof fakeCloud>>,
  store: Store,
  call: ReturnType<typeof caller>,
  d: string,
  t: string,
  guardian: string;
beforeEach(async () => {
  cloud = await fakeCloud();
  store = new Store();
  for (const [id, role] of [
    ["d", "director"],
    ["t", "teacher"],
    ["g", "guardian"],
  ])
    cloud.users.set(id, {
      id,
      name: id,
      role,
      academy: { id: 1 },
      children: [
        { studentId: "s1", name: "자녀" },
        { studentId: "new", name: "새 자녀" },
      ],
    });
  cloud.rosters.set(1, {
    students: [
      { id: "s1", teacherId: "t" },
      { id: "s2", teacherId: "other" },
      { id: "deleted", deletedAt: 1 },
    ],
  });
  call = caller(
    createApi({
      store,
      env: cloud.env,
      now: () => Date.parse("2026-11-09T07:00:00Z"),
    }),
  );
  d = (await signIn(call, cloud, "d")).cookie;
  t = (await signIn(call, cloud, "t")).cookie;
  guardian = (await signIn(call, cloud, "g")).cookie;
  await call("/api/state", undefined, d);
  store.put(2, "roster_state", "foreign", { deleted: false }, "foreign");
});
afterEach(async () => {
  store.close();
  await cloud.close();
});
const base = "/api/students/s1/guardians";
it("원장 쓰기·담당 선생님 읽기·다른 학생 차단", async () => {
  expect((await call(base, { name: "보호자" }, d)).status).toBe(200);
  expect((await call(base, undefined, t)).status).toBe(200);
  expect((await call(base, {}, t)).status).toBe(403);
  expect((await call("/api/students/s2/guardians", undefined, t)).status).toBe(
    403,
  );
  expect(
    cloud.requests.find(
      (response) => response.path === base && response.method === "POST",
    )?.uid,
  ).toBe("d");
});
it("명단 밖 학생·경로·식별자·메서드 차단", async () => {
  expect(
    (await call("/api/students/missing/guardians", undefined, d)).status,
  ).toBe(404);
  for (const tail of [
    "/abc",
    "/1/secret",
    "/1/consents/abc/withdraw",
    "?academy=2",
    "/1/account-link/extra",
  ])
    expect((await call(base + tail, {}, d)).status).toBe(403);
  expect((await call(base + "/1", {}, d)).status).toBe(403);
});
it("충돌 오류 문구 보존", async () => {
  const res = await createRequest(base + "/1", "PATCH", { rev: 0 });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe(
    "다른 사람이 고쳤어요. 다시 불러와 주세요.",
  );
});
function createRequest(path: string, method: string, value: any) {
  return createApi({ store, env: cloud.env })(
    new Request("http://localhost" + path, {
      method,
      headers: { cookie: d },
      body: JSON.stringify(value),
    }),
  );
}
it("14세 경계·동의 확인·철회·연도 없음", () => {
  expect(consentStatus(2012, [], 2026)).toEqual({
    possiblyUnder14: true,
    needsConsent: true,
  });
  expect(consentStatus(2011, [], 2026).needsConsent).toBe(false);
  expect(consentStatus(null, [], 2026).needsConsent).toBe(false);
  expect(consentStatus(2027, [], 2026).possiblyUnder14).toBe(false);
  for (const candidate of [
    { item: "collect", verified: false },
    { item: "messaging", verified: true },
    { item: "collect", verified: true, withdrawn_at: 1 },
  ])
    expect(consentStatus(2015, [candidate], 2026).needsConsent).toBe(true);
  expect(
    consentStatus(2015, [{ item: "collect", verified: true }], 2026)
      .needsConsent,
  ).toBe(false);
});
it("학생 목록과 보호자 탭의 동의 경고", async () => {
  store.put(1, "student_info", "s1", { birthYear: 2012 }, "s1");
  expect(
    (await (await call("/api/state", undefined, d)).json()).consentWarnings,
  ).toContain("s1");
  cloud.guardians.set("s1", [{ id: 1 }]);
  cloud.consents.set(1, [{ item: "collect", verified: true }]);
  expect((await (await call(base, undefined, d)).json()).needsConsent).toBe(
    false,
  );
  expect(
    (await (await call("/api/state", undefined, d)).json()).consentWarnings,
  ).not.toContain("s1");
});
it("보호자 직원 API 차단", async () => {
  for (const path of [
    "state",
    "week",
    "student-attendance?id=s1",
    "settings",
    "students/s1/guardians",
    "pins",
    "unknown",
  ])
    expect((await call("/api/" + path, undefined, guardian)).status).toBe(403);
  for (const path of ["attendance", "classes", "student-info", "devices/code"])
    expect((await call("/api/" + path, {}, guardian)).status).toBe(403);
});
it("자기 자녀 출결·학원 경계·연결 해제", async () => {
  store.put(1, "classes", "c", {
    name: "수학",
    startDate: "2026-11-01",
    times: [{ id: "t", weekday: 1, start: "16:00", end: "17:00" }],
  });
  store.put(
    1,
    "enrollments",
    "e",
    { classId: "c", studentId: "s1", joined: "2026-11-01" },
    "s1",
  );
  store.put(
    1,
    "checkins",
    "in",
    { at: "2026-11-09T07:00:00Z", kind: "in" },
    "s1",
  );
  store.put(
    1,
    "attendance",
    "c:2026-11-09:t:s1",
    { status: "present", note: "비공개" },
    "s1",
  );
  const kids = await (
    await call("/api/guardian/children", undefined, guardian)
  ).json();
  expect(kids.children.map((candidate: any) => candidate.studentId)).toEqual([
    "s1",
    "new",
  ]);
  const data = await (
    await call(
      "/api/guardian/attendance?studentId=s1&month=2026-11",
      undefined,
      guardian,
    )
  ).json();
  expect(data.today[0]).toMatchObject({
    status: "present",
    className: "수학",
    arrival: "2026-11-09T07:00:00Z",
  });
  expect(JSON.stringify(data)).not.toContain("비공개");
  for (const sid of ["s2", "deleted", "foreign"])
    expect(
      (
        await call(
          `/api/guardian/attendance?studentId=${sid}`,
          undefined,
          guardian,
        )
      ).status,
    ).toBe(403);
  expect(
    (
      await call(
        "/api/guardian/attendance?studentId=s1&month=2026-13",
        undefined,
        guardian,
      )
    ).status,
  ).toBe(400);
  cloud.users.get("g").children = [];
  expect(
    (await call("/api/guardian/attendance?studentId=s1", undefined, guardian))
      .status,
  ).toBe(403);
});
it("보호자 로그아웃 토큰 폐기", async () => {
  expect((await call("/api/auth/logout", {}, guardian)).status).toBe(302);
  expect(
    cloud.requests.some(
      (response) =>
        response.path === "/api/auth/logout" && response.uid === "g",
    ),
  ).toBe(true);
  expect(
    (await call("/api/guardian/children", undefined, guardian)).status,
  ).toBe(401);
});

it("100명도 요약 한 번·30초 캐시·만료·클라우드 장애 격리", async () => {
  let clock = Date.parse("2026-11-09T07:00:00Z"),
    broken = false;
  const fetcher: typeof fetch = async (input, init) => {
    if (broken && String(input).includes("consent-summary"))
      return new Response("{}", { status: 503 });
    return fetch(input, init);
  };
  const request = caller(
    createApi({ store, env: cloud.env, now: () => clock, fetch: fetcher }),
  );
  cloud.rosters.set(1, {
    students: Array.from({ length: 100 }, (_, index) => ({
      id: `s${index}`,
      teacherId: index < 50 ? "t" : "other",
    })),
  });
  for (let index = 0; index < 100; index++)
    store.put(1, "student_info", `s${index}`, { birthYear: 2015 }, `s${index}`);
  cloud.requests.length = 0;
  for (let index = 0; index < 2; index++)
    expect(
      (await (await request("/api/state", undefined, d)).json())
        .consentWarnings,
    ).toHaveLength(100);
  expect(
    cloud.requests.filter((response) =>
      response.path.includes("consent-summary"),
    ),
  ).toHaveLength(1);
  expect(
    cloud.requests.some(
      (response) =>
        response.path.startsWith("/api/students/") &&
        response.path.includes("/guardians"),
    ),
  ).toBe(false);
  expect(
    (await (await request("/api/state", undefined, t)).json()).consentWarnings,
  ).toHaveLength(50);
  expect(
    cloud.requests.filter((response) =>
      response.path.includes("consent-summary"),
    ),
  ).toHaveLength(2);
  clock += 30000;
  broken = true;
  const response = await request("/api/state", undefined, d);
  expect(response.status).toBe(200);
  expect((await response.json()).consentWarnings).toEqual([]);
  broken = false;
  await request("/api/state", undefined, d);
  expect(
    cloud.requests.filter((response) =>
      response.path.includes("consent-summary"),
    ),
  ).toHaveLength(3);
});
it("보호자 목록은 포함된 동의만 사용", async () => {
  cloud.guardians.set("s1", [{ id: 1 }]);
  cloud.consents.set(1, [{ item: "collect", verified: true }]);
  cloud.requests.length = 0;
  expect(
    (await (await call(base, undefined, d)).json()).guardians[0].consents[0]
      .verified,
  ).toBe(true);
  expect(
    cloud.requests.filter((response) => response.path.includes("/consents")),
  ).toHaveLength(0);
});
it("직원 명단을 읽지 않은 새 자녀도 표시", async () => {
  store.del(1, "roster_state", "s1");
  expect(
    (
      await (await call("/api/guardian/children", undefined, guardian)).json()
    ).children.map((candidate: any) => candidate.studentId),
  ).toEqual(["s1", "new"]);
});

it("오늘 수업은 하루만 계산", () => {
  const spy = vi.spyOn(lessonModule, "lessons");
  try {
    guardianAttendance(store, 1, "s1", "2026-11-09");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(store, 1, "2026-11-09");
  } finally {
    spy.mockRestore();
  }
});
