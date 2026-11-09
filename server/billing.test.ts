import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  refund,
  status,
  generate,
  put,
  rows,
  cleanup,
  csv,
  get,
  tableName,
  sumAmounts,
  prorate,
} from "./billing";
import { Store } from "./store";
import { createApi } from "./handler";
import { fakeCloud, caller, signIn } from "./testing";
import * as notifications from "./notify";
describe("환불 경계", () => {
  it.each([
    ["시작 전", 12, 0, true, "student", 300, 300],
    ["1/3 전", 12, 3, false, "student", 300, 200],
    ["1/3 경계", 12, 4, false, "student", 300, 150],
    ["1/3 후", 12, 5, false, "student", 300, 150],
    ["1/2 경계", 12, 6, false, "student", 300, 0],
    ["1/2 후", 12, 7, false, "student", 300, 0],
    ["학원 사정", 12, 5, false, "academy", 300, 175],
    ["올림", 12, 3, false, "student", 100, 67],
  ] as const)(
    "%s",
    (_, total, elapsed, beforeStart, reason, amount, expected) =>
      expect(
        refund({ total, elapsed, beforeStart, reason, amount }).amount,
      ).toBe(expected),
  );
  it("1개월 초과: 해당 달 비율 + 남은 달 전액", () =>
    expect(
      refund({
        amount: 300,
        total: 12,
        elapsed: 3,
        reason: "student",
        futureAmount: 600,
      }).amount,
    ).toBe(800));
});
it.each([
  [0, "2026-11-30", "unpaid"],
  [30, "2026-11-30", "partial"],
  [100, "2026-11-30", "paid"],
  [30, "2026-11-01", "overdue"],
])("상태 %s %s", (amount, dueDate, expected) =>
  expect(
    status(
      { id: "i", total: 100, dueDate },
      [{ invoiceId: "i", amount }],
      [],
      "2026-11-09",
    ).paymentStatus,
  ).toBe(expected),
);
it("환불을 받은 금액에서 빼고 취소 별도", () => {
  expect(
    status(
      { id: "i", total: 100, dueDate: "2026-12-01" },
      [{ invoiceId: "i", amount: 100 }],
      [{ invoiceId: "i", amount: 30 }],
      "2026-11-09",
    ).paid,
  ).toBe(70);
  expect(
    status(
      { id: "i", status: "canceled", total: 100, dueDate: "2026-12-01" },
      [],
      [],
      "2026-11-09",
    ).paymentStatus,
  ).toBe("canceled");
});
it("월·회·입퇴반·휴강·판·중복·휴퇴원", () => {
  const students = ["s", "paused", "left", "duplicate"].map((id) => ({
      id,
      name: id,
    })),
    enrollments = students.map((st) => ({
      studentId: st.id,
      classId: "c",
      joined: "2026-11-05",
      left: "2026-11-25",
    }));
  const fees = [
    {
      id: "m1",
      seriesId: "m",
      amount: 200,
      unit: "month",
      classId: "c",
      startDate: "2026-10-01",
      endDate: "2026-11-14",
    },
    {
      id: "m2",
      seriesId: "m",
      amount: 300,
      unit: "month",
      classId: "c",
      startDate: "2026-11-15",
    },
    {
      id: "l",
      amount: 10,
      unit: "lesson",
      classId: "c",
      startDate: "2026-10-01",
    },
  ];
  const lessonRows = ["01", "09", "16", "23", "30"].map((dayOfMonth) => ({
    classId: "c",
    date: `2026-11-${dayOfMonth}`,
    kind: dayOfMonth === "16" ? "cancelled" : "regular",
  }));
  const response = generate(
    "2026-11",
    students,
    [
      { id: "paused", status: "paused" },
      { id: "left", status: "left" },
    ],
    enrollments,
    fees,
    lessonRows,
    [{ studentId: "duplicate", month: "2026-11" }],
  );
  expect(response.skipped).toBe(1);
  expect(response.invoices).toHaveLength(1);
  expect(
    response.invoices[0].lines.map((lesson: any) => [
      lesson.feeItemId,
      lesson.quantity,
      lesson.amount,
    ]),
  ).toEqual([
    ["m2", 1, 300],
    ["l", 2, 20],
  ]);
});
it("CSV BOM·수식·따옴표·개행", () => {
  const text = csv([["=a", "+b", "-c", "@d", " \t=e", 'a"b', "a\nb"]]);
  expect(text.charCodeAt(0)).toBe(0xfeff);
  for (const value of ["=a", "+b", "-c", "@d", " \t=e"])
    expect(text).toContain("'" + value);
  expect(text).toContain('a""b');
});
let cloud: Awaited<ReturnType<typeof fakeCloud>>,
  store: Store,
  call: ReturnType<typeof caller>,
  directorCookie: string,
  teacherCookie: string,
  guardianCookie: string,
  other: string;
beforeEach(async () => {
  cloud = await fakeCloud();
  store = new Store();
  for (const [id, role, academyId] of [
    ["d", "director", 1],
    ["t", "teacher", 1],
    ["g", "guardian", 1],
    ["o", "director", 2],
  ] as const)
    cloud.users.set(id, {
      id,
      role,
      name: id,
      academy: { id: academyId },
      children: [{ studentId: "s" }],
    });
  cloud.rosters.set(1, {
    students: [
      { id: "s", name: "학생", school: "학교", grade: "1" },
      { id: "s2", name: "둘째" },
    ],
  });
  call = caller(
    createApi({
      store,
      env: cloud.env,
      now: () => Date.parse("2026-11-09T00:00Z"),
    }),
  );
  directorCookie = (await signIn(call, cloud, "d")).cookie;
  teacherCookie = (await signIn(call, cloud, "t")).cookie;
  guardianCookie = (await signIn(call, cloud, "g")).cookie;
  other = (await signIn(call, cloud, "o")).cookie;
});
afterEach(async () => {
  vi.restoreAllMocks();
  store.close();
  await cloud.close();
});
async function post(path: string, input: any, candidate = directorCookie) {
  const response = await call("/api/billing/" + path, input, candidate);
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json();
}
async function invoice(studentId = "s", billingMonth = "2026-11") {
  return post("invoices", {
    rev: 0,
    studentId,
    month: billingMonth,
    dueDate: billingMonth + "-10",
    discount: 0,
    lines: [
      { name: "교습비", kind: "tuition", unitPrice: 100000, quantity: 1 },
    ],
  });
}
it("취소한 청구서가 있어도 같은 달 청구서를 다시 만듦", async () => {
  const first = await invoice();
  expect(
    (
      await call(
        "/api/billing/invoices",
        { ...first, rev: 0, id: undefined },
        directorCookie,
      )
    ).status,
  ).toBe(409);
  await post(`invoices/${first.id}/cancel`, { rev: first.rev });
  const again = await invoice();
  expect(again.id).not.toBe(first.id);
});
it("권한·학원 분리·rev·정수·태블릿", async () => {
  expect(
    (await call("/api/billing/invoices", undefined, teacherCookie)).status,
  ).toBe(403);
  expect(
    (await call("/api/billing/invoices", undefined, guardianCookie)).status,
  ).toBe(403);
  expect(
    (await call("/api/billing/invoices", undefined, "hagwon_device=x")).status,
  ).toBe(403);
  await post("settings", { rev: 0, dueDay: 10, teacherRead: true });
  expect(
    (await call("/api/billing/invoices", undefined, teacherCookie)).status,
  ).toBe(200);
  expect(
    (await call("/api/billing/settings", { rev: 1, dueDay: 11 }, teacherCookie))
      .status,
  ).toBe(403);
  const invoiceRow = await invoice();
  expect(
    (
      await call(
        "/api/billing/invoices/" + invoiceRow.id + "/send",
        { rev: 0 },
        directorCookie,
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        "/api/billing/invoices/" + invoiceRow.id + "/send",
        { rev: invoiceRow.rev },
        other,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await call(
        "/api/billing/invoices",
        {
          rev: 0,
          studentId: "s2",
          month: "2026-11",
          dueDate: "2026-11-10",
          lines: [{ name: "a", kind: "tuition", unitPrice: 1.5, quantity: 1 }],
        },
        directorCookie,
      )
    ).status,
  ).toBe(400);
});
it("청구→보내기 이벤트→입금→받음·충돌·중복 방지", async () => {
  const spy = vi.spyOn(notifications, "notify");
  let invoiceRow = await invoice();
  invoiceRow = await post(`invoices/${invoiceRow.id}/send`, {
    rev: invoiceRow.rev,
  });
  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "invoice_sent" }),
  );
  const payment = {
    rev: invoiceRow.rev,
    amount: 100000,
    method: "transfer",
    date: "2026-11-09",
    receiptStatus: "pending",
    note: "=수식",
  };
  await post(`invoices/${invoiceRow.id}/payments`, payment);
  expect(
    (
      await call(
        `/api/billing/invoices/${invoiceRow.id}/payments`,
        payment,
        directorCookie,
      )
    ).status,
  ).toBe(409);
  const data = await (
    await call("/api/billing/invoices", undefined, directorCookie)
  ).json();
  expect(data.invoices[0].paymentStatus).toBe("paid");
  expect(
    (
      await call(
        `/api/billing/invoices/${invoiceRow.id}/cancel`,
        { rev: 3 },
        directorCookie,
      )
    ).status,
  ).toBe(400);
  const csvRes = await call(
    "/api/billing/csv?from=2026-11&to=2026-11",
    undefined,
    directorCookie,
  );
  const bytes = new Uint8Array(await csvRes.arrayBuffer());
  expect(Array.from(bytes.slice(0, 3))).toEqual([239, 187, 191]);
  expect(new TextDecoder().decode(bytes)).toContain("'=수식");
});
it("보호자 자기 자녀 sent만·연결 해제 반영", async () => {
  let invoiceRow = await invoice();
  await invoice("s2");
  expect(
    (
      await (
        await call(
          "/api/guardian/billing?studentId=s",
          undefined,
          guardianCookie,
        )
      ).json()
    ).invoices,
  ).toEqual([]);
  await post(`invoices/${invoiceRow.id}/send`, { rev: invoiceRow.rev });
  expect(
    (
      await (
        await call(
          "/api/guardian/billing?studentId=s",
          undefined,
          guardianCookie,
        )
      ).json()
    ).invoices,
  ).toHaveLength(1);
  expect(
    (
      await call(
        "/api/guardian/billing?studentId=s2",
        undefined,
        guardianCookie,
      )
    ).status,
  ).toBe(403);
  cloud.users.get("g").children = [];
  expect(
    (await call("/api/guardian/billing?studentId=s", undefined, guardianCookie))
      .status,
  ).toBe(403);
});
it("purge 익명화·금액 보존·5년 정리 경계", async () => {
  const invoiceRow = await invoice();
  put(
    store,
    1,
    "payments",
    {
      invoiceId: invoiceRow.id,
      amount: 100,
      method: "cash",
      receiptStatus: "pending",
      date: "2021-11-09",
      note: "학생 메모",
    },
    0,
  );
  store.purge(1, ["s"]);
  const saved = rows(store, 1, "invoices")[0];
  expect(saved.studentId).not.toBe("s");
  expect(saved.studentName).toBe("");
  expect(saved.school).toBe("");
  expect(rows(store, 1, "payments")[0].amount).toBe(100);
  expect(rows(store, 1, "payments")[0].note).toBe("");
  cleanup(store, "2026-11-09");
  expect(rows(store, 1, "invoices")).toHaveLength(1);
  cleanup(store, "2026-11-10");
  expect(rows(store, 1, "invoices")).toHaveLength(0);
  expect(rows(store, 1, "invoice_lines")).toHaveLength(0);
});
it("미입금 5년 정리·다른 학원 영향 없음", async () => {
  await invoice("s", "2020-01");
  put(
    store,
    2,
    "invoices",
    { month: "2026-11", total: 42, dueDate: "2026-11-10", status: "draft" },
    0,
  );
  cleanup(store, "2026-11-09");
  expect(rows(store, 1, "invoices")).toHaveLength(0);
  expect(rows(store, 2, "invoices")).toHaveLength(1);
});
it("수강료 새 판·이전 판 종료·충돌 보존", async () => {
  const fee = {
    rev: 0,
    name: "월비",
    amount: 100,
    unit: "month",
    kind: "tuition",
    startDate: "2026-11-01",
  };
  const f = await post("fees", fee);
  await post("fees", { ...f, amount: 200, startDate: "2026-12-01" });
  expect(
    rows(store, 1, "fee_items").find((item) => item.id === f.id)?.endDate,
  ).toBe("2026-11-30");
  expect(
    (
      await call(
        "/api/billing/fees",
        { ...f, startDate: "2027-01-01" },
        directorCookie,
      )
    ).status,
  ).toBe(409);
});
it("환불 재계산·중복 환불 방지·다개월 줄", async () => {
  store.put(1, "classes", "c", {
    name: "수학",
    startDate: "2026-11-01",
    times: [{ id: "mon", weekday: 1, start: "16:00", end: "17:00" }],
  });
  store.put(1, "enrollments", "e", {
    classId: "c",
    studentId: "s",
    joined: "2026-11-01",
  });
  let invoiceRow = await post("invoices", {
    rev: 0,
    studentId: "s",
    month: "2026-11",
    dueDate: "2026-11-10",
    lines: [
      {
        name: "11월",
        kind: "tuition",
        unitPrice: 300,
        quantity: 1,
        classId: "c",
        month: "2026-11",
      },
      {
        name: "12월",
        kind: "tuition",
        unitPrice: 300,
        quantity: 1,
        classId: "c",
        month: "2026-12",
      },
      { name: "교재", kind: "extra", unitPrice: 100, quantity: 1 },
    ],
  });
  invoiceRow = await post(`invoices/${invoiceRow.id}/send`, {
    rev: invoiceRow.rev,
  });
  invoiceRow = await post(`invoices/${invoiceRow.id}/payments`, {
    rev: invoiceRow.rev,
    amount: 700,
    method: "cash",
    date: "2026-11-01",
    receiptStatus: "not_requested",
  });
  const input = {
    rev: invoiceRow.rev,
    reason: "student",
    referenceDate: "2026-11-03",
    extraAmount: 50,
  };
  const quote = await post(`invoices/${invoiceRow.id}/refund-quote`, input);
  expect(quote.amount).toBe(550);
  expect(
    quote.basis.lines.find((item: any) => item.line === "11월").basis,
  ).toMatchObject({ total: 5, elapsed: 1, stage: "1/3 전" });
  expect(
    quote.basis.lines.find((item: any) => item.line === "12월").amount,
  ).toBe(300);
  invoiceRow = await post(`invoices/${invoiceRow.id}/refunds`, {
    ...input,
    date: "2026-11-04",
    method: "transfer",
    amount: 999999,
  });
  expect(rows(store, 1, "refunds")[0].amount).toBe(550);
  const again = await post(`invoices/${invoiceRow.id}/refund-quote`, {
    ...input,
    rev: invoiceRow.rev,
  });
  expect(again.amount).toBe(0);
  expect(
    (
      await call(
        `/api/billing/invoices/${invoiceRow.id}/refunds`,
        {
          ...input,
          rev: invoiceRow.rev,
          date: "2026-11-04",
          method: "transfer",
        },
        directorCookie,
      )
    ).status,
  ).toBe(400);
});
it("현금영수증 승인번호 후속 기록·rev 충돌", async () => {
  let invoiceRow = await invoice();
  invoiceRow = await post(`invoices/${invoiceRow.id}/send`, {
    rev: invoiceRow.rev,
  });
  invoiceRow = await post(`invoices/${invoiceRow.id}/payments`, {
    rev: invoiceRow.rev,
    amount: 100000,
    method: "cash",
    date: "2026-11-09",
    receiptStatus: "pending",
  });
  const payment = rows(store, 1, "payments")[0],
    value = {
      rev: invoiceRow.rev,
      paymentId: payment.id,
      paymentRev: payment.rev,
      approval: "123456",
    };
  await post(`invoices/${invoiceRow.id}/receipt`, value);
  expect(rows(store, 1, "payments")[0].receiptStatus).toBe("issued");
  expect(
    (
      await call(
        `/api/billing/invoices/${invoiceRow.id}/receipt`,
        value,
        directorCookie,
      )
    ).status,
  ).toBe(409);
});

it("월 목록은 청구·줄·입금·환불을 표마다 한 번 조회", async () => {
  await invoice();
  await invoice("s2");
  const prepare = vi.spyOn(store.db, "prepare");
  const result = await call(
    "/api/billing/invoices?month=2026-11",
    undefined,
    directorCookie,
  );
  expect(result.status).toBe(200);
  expect((await result.json()).invoices).toHaveLength(2);
  const queries = prepare.mock.calls.map(([sql]) => String(sql));
  for (const table of [
    "invoices",
    "invoice_lines",
    "payments",
    "refunds",
  ] as const) {
    expect(
      queries.filter(
        (sql) => sql.startsWith("SELECT") && sql.includes(tableName(table)),
      ),
    ).toHaveLength(1);
  }
});
it("실제 열·외래 키·금액·날짜·종류 제약과 직접 ID 조회", async () => {
  const invoiceRow = await invoice();
  const columns = store.db
    .prepare(`PRAGMA table_info(${tableName("invoices")})`)
    .all()
    .map((column) => column.name);
  expect(columns).toContain("student_id");
  expect(columns).not.toContain("data");
  const payment = {
    invoiceId: invoiceRow.id,
    amount: 1,
    date: "2026-11-09",
    method: "cash",
    receiptStatus: "pending",
  };
  for (const invalid of [
    { amount: -1 },
    { amount: 0.5 },
    { amount: Number.MAX_SAFE_INTEGER + 1 },
    { date: "2026-02-30" },
    { method: "invalid" },
    { invoiceId: "missing" },
  ]) {
    expect(() =>
      put(store, 1, "payments", { ...payment, ...invalid }, 0),
    ).toThrow();
  }
  expect(() => put(store, 2, "payments", payment, 0)).toThrow();
  const prepare = vi.spyOn(store.db, "prepare");
  expect(get(store, 1, "invoices", invoiceRow.id)?.id).toBe(invoiceRow.id);
  expect(prepare.mock.calls[0][0]).toContain("AND id=?");
});
it("합계·비례 계산은 안전 정수 경계를 보존", () => {
  expect(sumAmounts([Number.MAX_SAFE_INTEGER - 1, 1])).toBe(
    Number.MAX_SAFE_INTEGER,
  );
  expect(() => sumAmounts([Number.MAX_SAFE_INTEGER, 1])).toThrow();
  expect(prorate(Number.MAX_SAFE_INTEGER, 2, 3)).toBe(6004799503160661);
  expect(() =>
    refund({
      amount: Number.MAX_SAFE_INTEGER,
      total: 1,
      elapsed: 0,
      beforeStart: true,
      reason: "student",
      futureAmount: 1,
    }),
  ).toThrow();
});
