// 별도 임시 클라우드에서만 실행. 실제 계정·서버에 접근하지 않는다.
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { createServer } from "node:net";
const runId = randomBytes(5).toString("hex");
const root = resolve("."),
  temp = process.argv[2] || (await readFile(".local-test-path", "utf8")).trim(),
  cloudUrl = "http://127.0.0.1:8475",
  appUrl = "http://127.0.0.1:8476",
  password = randomBytes(20).toString("base64url") + "aA9!",
  children = [];
const start = (args, cwd, env) => {
  const c = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  children.push(c);
  c.stdout.on("data", () => {});
  c.stderr.on("data", () => {});
  return c;
};
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if (
        (await fetch(url, { signal: AbortSignal.timeout(2000) })).status < 500
      )
        return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("로컬 서버 시작 실패: " + url);
}
async function cloud(path, body, token) {
  const r = await fetch(cloudUrl + path, {
    method: body ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  assert.ok(r.ok, `${path}: ${JSON.stringify(d)}`);
  return d;
}
async function app(path, body, cookie = "") {
  const r = await fetch(appUrl + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", cookie },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  if (r.status >= 400) throw Error(`${path}: ${await r.text()}`);
  return r;
}
const cookie = (r, name) =>
  r.headers
    .getSetCookie()
    .find((x) => x.startsWith(name + "="))
    ?.split(";")[0] || "";
try {
  for (const port of [8475, 8476]) {
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once("error", () =>
        reject(Error(`${port} 포트를 다른 작업이 사용 중이에요.`)),
      );
      probe.listen(port, "127.0.0.1", () => probe.close(resolve));
    });
  }
  const previousEnv = await readFile(join(root, ".env")).catch(() => null);
  if (previousEnv) await writeFile(join(temp, "previous.env"), previousEnv);
  await mkdir(join(temp, "cloud-data-" + runId), { recursive: true });
  start(
    ["--disable-warning=ExperimentalWarning", "src/index.js"],
    join(temp, "server"),
    {
      PORT: "8475",
      HOST: "127.0.0.1",
      DATA_DIR: join(temp, "cloud-data-" + runId),
      LAUNCHER_REPO: "",
      ADMIN_PASSWORD: password,
    },
  );
  await ready(cloudUrl + "/api/apps");
  const admin = await cloud("/api/auth/login", {
    username: "admin",
    password,
    device: {
      id: "local-integration-admin",
      name: "로컬 시험",
      platform: "web",
    },
  });
  await cloud(
    "/api/admin/apps",
    {
      id: "mago-hagwon",
      name: "마고 학원운영",
      platform: "web",
      url: appUrl,
      enabled: true,
    },
    admin.token,
  );
  const { secret } = await cloud(
    "/api/admin/apps/mago-hagwon/secret",
    {},
    admin.token,
  );
  const { academy } = await cloud(
    "/api/academies",
    { name: "학원운영 로컬 시험", subjects: ["math", "english", "korean"] },
    admin.token,
  );
  const { user: director } = await cloud(
    "/api/users",
    {
      username: "localdirector",
      name: "시험 원장",
      role: "director",
      academyId: academy.id,
      password,
      mustChangePassword: false,
    },
    admin.token,
  );
  const { user: teacher } = await cloud(
    "/api/users",
    {
      username: "localteacher",
      name: "시험 선생님",
      role: "teacher",
      academyId: academy.id,
      password,
      mustChangePassword: false,
      allowedApps: ["mago-hagwon"],
    },
    admin.token,
  );
  const directorLogin = await cloud("/api/auth/login", {
    username: "localdirector",
    password,
    device: { id: "local-director", name: "로컬 시험", platform: "web" },
  });
  const students = [];
  for (const [name, grade] of [
    ["김시험", "중1"],
    ["이시험", "중2"],
    ["박시험", "고1"],
  ])
    students.push(
      (
        await cloud(
          "/api/students",
          { name, school: "시험학교", grade, teacherId: teacher.id },
          directorLogin.token,
        )
      ).student,
    );
  // 기존 .env는 바꾸지 않고 이 자식 프로세스에만 임시 환경 전달.
  start(["dist-server/index.js"], root, {
    MAGO_CLOUD_URL: cloudUrl, MAGO_APP_ID: "mago-hagwon", MAGO_APP_SECRET: secret,
    DATA_DIR: join(temp, "app-data-" + runId), PORT: "8476", HOST: "127.0.0.1",
    TRUST_PROXY: "0", COOKIE_SECURE: "0",
  });
  await ready(appUrl + "/api/health");
  async function signIn(token) {
    const a = await app("/api/auth/mago"),
      state = new URL(a.headers.get("location")).hash.split("state=")[1],
      authorized = await cloud(
        "/api/sso/authorize",
        { appId: "mago-hagwon", state },
        token,
      ),
      back = await app(
        new URL(authorized.redirect).pathname +
          new URL(authorized.redirect).search,
        undefined,
        cookie(a, "hagwon_flow"),
      );
    assert.equal(back.status, 302);
    return cookie(back, "hagwon_sid");
  }
  const sid = await signIn(directorLogin.token),
    me = await (await app("/api/me", undefined, sid)).json();
  assert.equal(me.user.id, director.id);
  const now = new Date(),
    date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now),
    clock = (d) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d),
    startTime = clock(new Date(now - 5 * 60000)),
    endTime = clock(new Date(+now + 50 * 60000));
  const c = await (
    await app(
      "/api/classes",
      {
        name: "로컬 수학 A반",
        subject: "math",
        teacherId: teacher.id,
        startDate: date,
        room: "1강의실",
        times: [
          {
            weekday: new Date(date + "T12:00:00Z").getUTCDay(),
            start: startTime,
            end: endTime,
            room: "1강의실",
          },
        ],
      },
      sid,
    )
  ).json();
  for (const st of students)
    await app(
      "/api/enrollments",
      { classId: c.id, studentId: st.id, joined: date },
      sid,
    );
  await app("/api/rooms", { name: "1강의실" }, sid);
  const pins = await (await app("/api/pins", {}, sid)).json(),
    { code } = await (await app("/api/devices/code", {}, sid)).json(),
    reg = await app("/api/kiosk/register", { code, name: "로컬 시험 태블릿" }),
    device = cookie(reg, "hagwon_device");
  const check = await (
    await app("/api/kiosk/checkin", { pin: pins.pins[0].pin }, device)
  ).json();
  assert.equal(check.kind, "in");
  const state = await (
    await app("/api/state?date=" + date, undefined, sid)
  ).json();
  assert.equal(state.attendance[0].status, "present");
  assert.equal(state.attendance[0].manual, false);
  const tl = await cloud("/api/auth/login", {
      username: "localteacher",
      password,
      device: { id: "local-teacher", name: "로컬 시험", platform: "web" },
    }),
    tsid = await signIn(tl.token);
  await app(
    "/api/attendance",
    {
      date,
      lessonId: state.lessons[0].id,
      studentId: students[1].id,
      rev: state.attendance.find(x => x.lessonId === state.lessons[0].id && x.studentId === students[1].id)?.rev ?? 0,
      status: "absent",
      note: "통합 시험 수동 기록",
    },
    tsid,
  );
  const denied = await fetch(appUrl + "/api/settings", {
    headers: { cookie: tsid },
  });
  assert.equal(denied.status, 403);
  const report = {
    cloudCommit: process.env.CLOUD_COMMIT || "origin/main archive",
    date,
    checks: [
      "원장 실제 SSO",
      "선생님 실제 SSO",
      "클라우드 명단 3명 조회",
      "반 생성·3명 배정",
      "등록 번호 발급·태블릿 등록",
      "학생 번호 일괄 발급",
      "태블릿 등원",
      "자동 출석 반영",
      "담당 선생님 수동 결석",
      "선생님 운영 설정 403",
    ],
    temp,
  };
  await writeFile(
    join(temp, "integration-result.json"),
    JSON.stringify(report, null, 2),
  );
  await writeFile(
    join(temp, "browser-fixture.json"),
    JSON.stringify(
      {
        password,
        director: "localdirector",
        teacher: "localteacher",
        pin: pins.pins[0].pin,
        date,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(report, null, 2));
  if (process.env.KEEP_LOCAL_SERVERS === "1") {
    console.log("브라우저 확인 대기. 종료하면 두 서버도 정리.");
    await new Promise((resolve) => {
      process.on("SIGINT", resolve);
      process.on("SIGTERM", resolve);
    });
  }
} finally {
  for (const c of children) c.kill();
  await Promise.all(
    children.map(
      (c) =>
        new Promise((r) =>
          c.exitCode !== null || c.signalCode !== null
            ? r()
            : c.once("exit", r),
        ),
    ),
  );
}
