import { randomUUID } from "node:crypto";
import { type Store } from "./store";
import { body, HttpError, json } from "./http";
import { lessons, members } from "./lessons";
import {
  rows,
  get,
  put,
  integer,
  status,
  refund,
  generate,
  csv,
  transaction,
  type Row,
  relatedRows,
  tableName,
  sumAmounts,
  prorate,
  invoicesInRange,
} from "./billing";
import { notify } from "./notify";
function bad(message: string, status = 400): never {
  throw new HttpError(status, message);
}
const text = (view: any) =>
  typeof view === "string" ? view.trim().slice(0, 1000) : "";
const month = (view: any): string =>
  typeof view === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(view)
    ? view
    : bad("달을 확인해 주세요.");
const date = (view: any): string =>
  typeof view === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(view) &&
  !Number.isNaN(Date.parse(view)) &&
  new Date(view).toISOString().slice(0, 10) === view
    ? view
    : bad("날짜를 확인해 주세요.");
export const billingSettings = (store: Store, academyId: number) =>
  get(store, academyId, "billing_settings", "settings") || {
    id: "settings",
    rev: 0,
    dueDay: 10,
    teacherRead: false,
  };
export function invoiceViews(
  store: Store,
  academyId: number,
  invoices: Row[],
  today: string,
): Row[] {
  const groups = (table: "invoice_lines" | "payments" | "refunds") => {
    const grouped = new Map<string, Row[]>();
    for (const record of relatedRows(store, academyId, table, invoices)) {
      const records = grouped.get(record.invoiceId) || [];
      records.push(record);
      grouped.set(record.invoiceId, records);
    }
    return grouped;
  };
  const lines = groups("invoice_lines"),
    payments = groups("payments"),
    refunds = groups("refunds");
  return invoices.map((invoice) => {
    const invoicePayments = payments.get(invoice.id) || [],
      invoiceRefunds = refunds.get(invoice.id) || [];
    return {
      ...invoice,
      lines: (lines.get(invoice.id) || []).sort(
        (left, right) => left.lineIndex - right.lineIndex,
      ),
      payments: invoicePayments,
      refunds: invoiceRefunds,
      ...status(invoice, invoicePayments, invoiceRefunds, today),
    };
  });
}
export function invoiceView(
  store: Store,
  academyId: number,
  invoice: Row,
  today: string,
) {
  return invoiceViews(store, academyId, [invoice], today)[0];
}
export function guardianBilling(
  store: Store,
  academyId: number,
  studentId: string,
  today: string,
) {
  const settings = billingSettings(store, academyId);
  return {
    account: {
      bank: settings.bank,
      account: settings.account,
      holder: settings.holder,
    },
    invoices: invoiceViews(
      store,
      academyId,
      rows(store, academyId, "invoices", {
        studentId: studentId,
        status: "sent",
      }),
      today,
    ).map((view) => {
      const invoice = view;
      return {
        id: invoice.id,
        month: invoice.month,
        total: invoice.total,
        discount: invoice.discount,
        dueDate: invoice.dueDate,
        paid: view.paid,
        paymentStatus: view.paymentStatus,
        lines: view.lines.map((line: Row) => ({
          name: line.name,
          amount: line.amount,
          quantity: line.quantity,
        })),
      };
    }),
  };
}
function monthLessons(store: Store, academyId: number, method: string) {
  const end = new Date(
    Date.UTC(+method.slice(0, 4), +method.slice(5), 0),
  ).getUTCDate();
  return Array.from({ length: end }, (_, dayIndex) =>
    lessons(
      store,
      academyId,
      `${method}-${String(dayIndex + 1).padStart(2, "0")}`,
    ),
  ).flat();
}
function lines(store: Store, academyId: number, input: any): Row[] {
  if (!Array.isArray(input) || !input.length || input.length > 100)
    bad("청구 항목을 넣어 주세요.");
  return input.map((line: Row) => {
    if (!text(line.name) || !["tuition", "extra"].includes(line.kind))
      bad("항목을 확인해 주세요.");
    if (line.classId && !store.get(academyId, "classes", line.classId))
      bad("반을 확인해 주세요.");
    if (line.feeItemId && !get(store, academyId, "fee_items", line.feeItemId))
      bad("수강료표를 확인해 주세요.");
    const unitPrice = integer(line.unitPrice),
      quantity = integer(line.quantity, 1);
    return {
      month: line.month ? month(line.month) : "",
      name: text(line.name),
      kind: line.kind,
      unitPrice,
      quantity,
      amount: integer(unitPrice * quantity),
      classId: line.classId || "",
      feeItemId: line.feeItemId || "",
    };
  });
}
function createInvoice(
  store: Store,
  academyId: number,
  input: Row,
  students: Row[],
  user: Row,
  today: string,
) {
  const student = students.find(
    (candidate) => candidate.id === input.studentId,
  );
  if (!student) bad("학생을 확인해 주세요.", 404);
  const billingMonth = month(input.month);
  if (
    rows(store, academyId, "invoices", {
      studentId: student.id,
      month: billingMonth,
    }).some((invoice) => invoice.status !== "canceled")
  )
    bad("이미 이 달 청구서가 있어요.", 409);
  const invoiceLines = lines(store, academyId, input.lines),
    discount = integer(input.discount ?? 0),
    total = integer(
      sumAmounts(invoiceLines.map((line) => line.amount)) - discount,
    );
  const inv = put(
    store,
    academyId,
    "invoices",
    {
      studentId: student.id,
      studentName: student.name,
      school: student.school || "",
      grade: student.grade || "",
      month: billingMonth,
      dueDate: date(input.dueDate),
      discount,
      discountReason: text(input.discountReason),
      total,
      status: "draft",
      createdBy: user.name,
      createdAt: today,
    },
    input.rev,
  );
  for (const [lineIndex, line] of invoiceLines.entries())
    put(
      store,
      academyId,
      "invoice_lines",
      { ...line, lineIndex, invoiceId: inv.id },
      0,
    );
  return inv;
}
function refundQuote(
  store: Store,
  academyId: number,
  invoice: Row,
  input: Row,
) {
  const refDate = date(input.referenceDate);
  if (!["student", "academy"].includes(input.reason))
    bad("환불 사유를 골라 주세요.");
  const invoiceLines = rows(store, academyId, "invoice_lines", {
      invoiceId: invoice.id,
    }),
    gross = sumAmounts(invoiceLines.map((line) => line.amount)),
    tuition = invoiceLines.filter((line) => line.kind === "tuition");
  const bases = tuition.map((line) => {
    const all = monthLessons(
      store,
      academyId,
      line.month || invoice.month,
    ).filter(
      (candidate) =>
        candidate.kind !== "cancelled" &&
        (!line.classId || candidate.classId === line.classId) &&
        members(store, academyId, candidate).some(
          (enrollment) => enrollment.studentId === invoice.studentId,
        ),
    );
    const amount = gross ? prorate(line.amount, invoice.total, gross) : 0;
    return {
      ...refund({
        amount,
        total: all.length,
        elapsed: all.filter((candidate) => candidate.date <= refDate).length,
        reason: input.reason,
        beforeStart:
          refDate < (all[0]?.date || (line.month || invoice.month) + "-01"),
      }),
      line: line.name,
    };
  });
  const extra = integer(input.extraAmount ?? 0),
    extraMax = gross
      ? prorate(
          sumAmounts(
            invoiceLines
              .filter((line) => line.kind === "extra")
              .map((line) => line.amount),
          ),
          invoice.total,
          gross,
        )
      : 0;
  if (extra > extraMax) bad("기타경비 환불액을 확인해 주세요.");
  const payments = rows(store, academyId, "payments", {
      invoiceId: invoice.id,
    }),
    refunds = rows(store, academyId, "refunds", { invoiceId: invoice.id });
  const amount = sumAmounts([...bases.map((refund) => refund.amount), extra]),
    net = status(invoice, payments, refunds, refDate).paid;
  const prior = sumAmounts(refunds.map((refund) => refund.amount));
  return {
    amount: Math.min(Math.max(0, amount - prior), Math.max(0, net)),
    basis: {
      lines: bases,
      extraAmount: extra,
      calculated: amount,
      available: net,
      priorRefunded: prior,
      capped: amount - prior > net,
    },
    reason: input.reason,
    referenceDate: refDate,
  };
}
export async function billingRoute(
  req: Request,
  store: Store,
  academyId: number,
  user: Row,
  students: Row[],
  today: string,
  at = new Date().toISOString(),
) {
  const url = new URL(req.url),
    path = url.pathname.replace("/api/billing", ""),
    method = req.method,
    settings = billingSettings(store, academyId);
  if (user.role !== "director" && (method !== "GET" || !settings.teacherRead))
    bad("수납을 볼 권한이 없어요.", 403);
  if (method === "GET") {
    if (path === "/settings")
      return json({
        settings: settings,
        fees: rows(store, academyId, "fee_items"),
      });
    if (path === "/invoices") {
      const billingMonth = url.searchParams.get("month"),
        studentId = url.searchParams.get("studentId");
      if (billingMonth) month(billingMonth);
      return json({
        settings: settings,
        invoices: invoiceViews(
          store,
          academyId,
          rows(store, academyId, "invoices", {
            ...(billingMonth ? { month: billingMonth } : {}),
            ...(studentId ? { studentId: studentId } : {}),
          }),
          today,
        ),
      });
    }
    if (path === "/csv") {
      const from = month(url.searchParams.get("from")),
        to = month(url.searchParams.get("to"));
      if (from > to) bad("달 범위를 확인해 주세요.");
      const result: unknown[][] = [
        ["종류", "청구서", "학생", "청구 달", "금액", "날짜", "방법", "메모"],
      ];
      for (const invoice of invoiceViews(
        store,
        academyId,
        invoicesInRange(store, academyId, from, to),
        today,
      )) {
        result.push([
          "청구서",
          invoice.id,
          invoice.studentName,
          invoice.month,
          invoice.total,
          invoice.dueDate,
          invoice.status,
          invoice.discountReason,
        ]);
        for (const table of ["payments", "refunds"] as const)
          for (const record of invoice[table])
            result.push([
              table === "payments" ? "입금" : "환불",
              invoice.id,
              invoice.studentName,
              invoice.month,
              record.amount,
              record.date,
              record.method,
              record.note,
            ]);
      }
      return new Response(csv(result), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": "attachment; filename=billing.csv",
          "cache-control": "no-store",
        },
      });
    }
    bad("찾을 수 없어요.", 404);
  }
  if (method !== "POST") bad("허용하지 않는 방법이에요.", 405);
  const input = await body(req);
  return transaction(store, () => {
    if (path === "/settings") {
      integer(input.dueDay, 1);
      if (input.dueDay > 31) bad("낼 날짜는 1~31일이에요.");
      return json(
        put(
          store,
          academyId,
          "billing_settings",
          {
            id: "settings",
            dueDay: input.dueDay,
            teacherRead: input.teacherRead === true,
            ...Object.fromEntries(
              [
                "bank",
                "account",
                "holder",
                "registration",
                "operator",
                "address",
                "phone",
              ].map((field) => [field, text(input[field])]),
            ),
          },
          input.rev,
        ),
      );
    }
    if (path === "/fees") {
      if (
        !text(input.name) ||
        !["month", "lesson"].includes(input.unit) ||
        !["tuition", "extra"].includes(input.kind)
      )
        bad("수강료표를 확인해 주세요.");
      if (input.classId && !store.get(academyId, "classes", input.classId))
        bad("반을 확인해 주세요.");
      const startDate = date(input.startDate),
        endDate = input.endDate ? date(input.endDate) : "";
      if (endDate && endDate < startDate) bad("끝 날짜를 확인해 주세요.");
      const old = input.id
        ? get(store, academyId, "fee_items", input.id)
        : null;
      if (input.id && !old) bad("수강료표를 찾지 못했어요.", 404);
      if (old) {
        if (input.rev !== old.rev)
          bad("다른 분이 먼저 고쳤어요. 새로 불러와 주세요.", 409);
        if (input.finish)
          return json(
            put(
              store,
              academyId,
              "fee_items",
              { ...old, endDate: date(input.endDate) },
              input.rev,
            ),
          );
        if (startDate <= old.startDate || old.endDate)
          bad("새 판 시작일을 확인해 주세요.");
        put(
          store,
          academyId,
          "fee_items",
          {
            ...old,
            endDate: new Date(Date.parse(startDate) - 86400000)
              .toISOString()
              .slice(0, 10),
          },
          input.rev,
        );
      } else if (input.rev !== 0) bad("새로 불러와 주세요.", 409);
      return json(
        put(
          store,
          academyId,
          "fee_items",
          {
            seriesId: old?.seriesId || old?.id || randomUUID(),
            name: text(input.name),
            amount: integer(input.amount),
            unit: input.unit,
            kind: input.kind,
            classId: input.classId || "",
            startDate,
            endDate,
            note: text(input.note),
          },
          0,
        ),
      );
    }
    if (path === "/generate") {
      if (input.rev !== 0) bad("새로 불러와 주세요.", 409);
      const billingMonth = month(input.month),
        generated = generate(
          billingMonth,
          students,
          store.all(academyId, "student_info"),
          store.all(academyId, "enrollments"),
          rows(store, academyId, "fee_items"),
          monthLessons(store, academyId, billingMonth),
          rows(store, academyId, "invoices", { month: billingMonth }),
        );
      const last = new Date(
          Date.UTC(+billingMonth.slice(0, 4), +billingMonth.slice(5), 0),
        ).getUTCDate(),
        dueDate = `${billingMonth}-${String(Math.min(settings.dueDay, last)).padStart(2, "0")}`;
      return json({
        created: generated.invoices.map((invoice) =>
          createInvoice(
            store,
            academyId,
            { ...invoice, rev: 0, dueDate },
            students,
            user,
            at,
          ),
        ),
        skipped: generated.skipped,
      });
    }
    if (path === "/invoices")
      return json(createInvoice(store, academyId, input, students, user, at));
    if (path === "/send-all") {
      const targets = rows(store, academyId, "invoices", {
        month: month(input.month),
        status: "draft",
      });
      for (const invoice of targets)
        if (input.revs?.[invoice.id] !== invoice.rev)
          bad("새로 불러와 주세요.", 409);
      for (const invoice of targets) {
        put(
          store,
          academyId,
          "invoices",
          { ...invoice, status: "sent", sentAt: at },
          invoice.rev,
        );
        notify({
          academyId: academyId,
          studentId: invoice.studentId,
          kind: "invoice_sent",
          at,
        });
      }
      return json({ sent: targets.length });
    }
    const match =
      /^\/invoices\/([^/]+)\/(edit|send|cancel|payments|receipt|refund-quote|refunds)$/.exec(
        path,
      );
    if (!match) bad("찾을 수 없어요.", 404);
    const [, id, action] = match!,
      invoice = get(store, academyId, "invoices", id);
    if (!invoice) bad("청구서를 찾지 못했어요.", 404);
    if (invoice.rev !== input.rev)
      bad("다른 분이 먼저 고쳤어요. 새로 불러와 주세요.", 409);
    if (invoice.status === "canceled") bad("취소된 청구서예요.");
    if (action === "receipt") {
      const payment = get(store, academyId, "payments", input.paymentId);
      if (!payment || payment.invoiceId !== invoice.id)
        bad("입금을 찾지 못했어요.", 404);
      if (!text(input.approval)) bad("승인번호를 적어 주세요.");
      put(
        store,
        academyId,
        "payments",
        { ...payment, receiptStatus: "issued", approval: text(input.approval) },
        input.paymentRev,
      );
      return json(put(store, academyId, "invoices", invoice, input.rev));
    }
    if (action === "refund-quote")
      return json(refundQuote(store, academyId, invoice, input));
    if (action === "edit") {
      if (invoice.status !== "draft") bad("만든 청구서만 고칠 수 있어요.");
      const invoiceLines = lines(store, academyId, input.lines),
        discount = integer(input.discount);
      const saved = put(
        store,
        academyId,
        "invoices",
        {
          ...invoice,
          discount,
          discountReason: text(input.discountReason),
          dueDate: date(input.dueDate),
          total: integer(
            sumAmounts(invoiceLines.map((line) => line.amount)) - discount,
          ),
        },
        input.rev,
      );
      for (const line of rows(store, academyId, "invoice_lines", {
        invoiceId: id,
      }))
        store.db
          .prepare(
            `DELETE FROM ${tableName("invoice_lines")} WHERE academy_id=? AND id=?`,
          )
          .run(academyId, line.id);
      for (const [lineIndex, line] of invoiceLines.entries())
        put(
          store,
          academyId,
          "invoice_lines",
          { ...line, lineIndex, invoiceId: id },
          0,
        );
      return json(saved);
    }
    if (action === "send" || action === "cancel") {
      if (action === "send" && invoice.status !== "draft")
        bad("이미 보낸 청구서예요.");
      if (
        action === "cancel" &&
        rows(store, academyId, "payments", { invoiceId: invoice.id }).some(
          (path) => path.invoiceId === id,
        )
      )
        bad("입금이 있어요. 취소 대신 환불을 기록해 주세요.");
      const saved = put(
        store,
        academyId,
        "invoices",
        {
          ...invoice,
          status: action === "send" ? "sent" : "canceled",
          updatedAt: at,
        },
        input.rev,
      );
      if (action === "send")
        notify({
          academyId: academyId,
          studentId: invoice.studentId,
          kind: "invoice_sent",
          at,
        });
      return json(saved);
    }
    if (invoice.status !== "sent") bad("청구서를 보낸 뒤 기록해 주세요.");
    if (!["transfer", "card", "cash"].includes(input.method))
      bad("받은 방법을 골라 주세요.");
    if (action === "payments") {
      const amount = integer(input.amount, 1);
      if (!["issued", "not_requested", "pending"].includes(input.receiptStatus))
        bad("현금영수증 상태를 골라 주세요.");
      if (input.receiptStatus === "issued" && !text(input.approval))
        bad("승인번호를 적어 주세요.");
      if (
        ["transfer", "cash"].includes(input.method) &&
        amount >= 100000 &&
        input.receiptStatus === "not_requested"
      )
        bad("발급 대상이에요. 발급 전 또는 발급을 골라 주세요.");
      put(
        store,
        academyId,
        "payments",
        {
          invoiceId: id,
          amount,
          method: input.method,
          date: date(input.date),
          note: text(input.note),
          receiptStatus: input.receiptStatus,
          approval: text(input.approval),
          recordedBy: user.name,
        },
        0,
      );
    } else {
      const quote = refundQuote(store, academyId, invoice, input);
      if (!quote.amount) bad("돌려줄 금액이 없어요.");
      put(
        store,
        academyId,
        "refunds",
        {
          invoiceId: id,
          ...quote,
          date: date(input.date),
          method: input.method,
          note: text(input.note),
          recordedBy: user.name,
        },
        0,
      );
    }
    return json(put(store, academyId, "invoices", invoice, input.rev));
  });
}
