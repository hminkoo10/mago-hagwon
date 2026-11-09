import { randomUUID } from "node:crypto";
import type { Store } from "./store";
import { HttpError } from "./http";
export type PaymentMethod = "transfer" | "card" | "cash" | "link";
export type Row = Record<string, any>;
export const tables = [
  "fee_items",
  "invoices",
  "invoice_lines",
  "payments",
  "refunds",
  "billing_settings",
] as const;
export type BillingTable = (typeof tables)[number];
// Billing tables use typed columns; only the refund calculation snapshot is JSON.
const money =
  "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(VALUE)='integer' AND VALUE BETWEEN 0 AND 9007199254740991)";
const nonnegative = money;
const stringColumn = "TEXT NOT NULL DEFAULT ''";
const calendarDate =
  "TEXT NOT NULL CHECK(VALUE GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(VALUE, '+0 days') IS VALUE)";
const optionalDate =
  calendarDate.replace("CHECK(", "DEFAULT '' CHECK(VALUE='' OR (") + ")";
const calendarMonth =
  "TEXT NOT NULL CHECK(VALUE GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(VALUE,6,2) BETWEEN '01' AND '12')";
const enumColumn = (values: string[]) =>
  `TEXT NOT NULL CHECK(VALUE IN (${values.map((value) => `'${value}'`).join(",")}))`;
const definitions: Record<BillingTable, Record<string, string>> = {
  fee_items: {
    seriesId: stringColumn,
    name: stringColumn,
    amount: money,
    unit: enumColumn(["month", "lesson"]),
    kind: enumColumn(["tuition", "extra"]),
    classId: stringColumn,
    startDate: calendarDate,
    endDate: optionalDate,
    note: stringColumn,
  },
  invoices: {
    studentId: stringColumn,
    studentName: stringColumn,
    school: stringColumn,
    grade: stringColumn,
    month: calendarMonth,
    dueDate: calendarDate,
    discount: money,
    discountReason: stringColumn,
    total: money,
    status: enumColumn(["draft", "sent", "canceled"]),
    createdBy: stringColumn,
    createdAt: stringColumn,
    sentAt: stringColumn,
    updatedAt: stringColumn,
    note: stringColumn,
  },
  invoice_lines: {
    invoiceId: "TEXT NOT NULL",
    feeItemId: stringColumn,
    name: stringColumn,
    kind: enumColumn(["tuition", "extra"]),
    unitPrice: money,
    quantity:
      "INTEGER NOT NULL CHECK(typeof(VALUE)='integer' AND VALUE BETWEEN 1 AND 9007199254740991)",
    amount: money,
    classId: stringColumn,
    month:
      calendarMonth.replace("CHECK(", "DEFAULT '' CHECK(VALUE='' OR (") + ")",
    lineIndex: nonnegative,
  },
  payments: {
    invoiceId: "TEXT NOT NULL",
    amount: money,
    method: enumColumn(["transfer", "card", "cash", "link"]),
    date: calendarDate,
    note: stringColumn,
    receiptStatus: enumColumn(["issued", "not_requested", "pending"]),
    approval: stringColumn,
    recordedBy: stringColumn,
  },
  refunds: {
    invoiceId: "TEXT NOT NULL",
    amount: money,
    method: enumColumn(["transfer", "card", "cash", "link"]),
    date: calendarDate,
    note: stringColumn,
    recordedBy: stringColumn,
    reason: enumColumn(["student", "academy"]),
    referenceDate: calendarDate,
    basis: "TEXT NOT NULL CHECK(json_valid(VALUE))",
  },
  billing_settings: {
    dueDay:
      "INTEGER NOT NULL CHECK(typeof(VALUE)='integer' AND VALUE BETWEEN 1 AND 31)",
    teacherRead: "INTEGER NOT NULL CHECK(VALUE IN (0,1))",
    bank: stringColumn,
    account: stringColumn,
    holder: stringColumn,
    registration: stringColumn,
    operator: stringColumn,
    address: stringColumn,
    phone: stringColumn,
  },
};
export const tableName = (table: BillingTable) => `billing_${table}`;
const columnName = (field: string) =>
  field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
export function initBilling(store: Store) {
  store.db.exec("PRAGMA foreign_keys=ON");
  for (const table of tables) {
    const columns = Object.entries(definitions[table]).map(
      ([field, definition]) =>
        `${columnName(field)} ${definition.replaceAll("VALUE", columnName(field))}`,
    );
    const foreignKey = ["invoice_lines", "payments", "refunds"].includes(table)
      ? `,FOREIGN KEY(academy_id,invoice_id) REFERENCES ${tableName("invoices")}(academy_id,id) ON DELETE CASCADE`
      : "";
    const settingsCheck =
      table === "billing_settings" ? ",CHECK(id='settings')" : "";
    store.db.exec(
      `CREATE TABLE IF NOT EXISTS ${tableName(table)}(academy_id INTEGER NOT NULL,id TEXT NOT NULL,rev INTEGER NOT NULL CHECK(rev>0),${columns.join(",")},PRIMARY KEY(academy_id,id)${foreignKey}${settingsCheck})`,
    );
    for (const field of ["month", "studentId", "invoiceId", "classId"]) {
      if (field in definitions[table])
        store.db.exec(
          `CREATE INDEX IF NOT EXISTS ${tableName(table)}_${columnName(field)} ON ${tableName(table)}(academy_id,${columnName(field)})`,
        );
    }
  }
}
function decode(table: BillingTable, record: any): Row {
  const value: Row = { id: record.id, rev: record.rev };
  for (const field of Object.keys(definitions[table])) {
    const raw = record[columnName(field)];
    value[field] =
      field === "basis"
        ? JSON.parse(raw)
        : field === "teacherRead"
          ? Boolean(raw)
          : raw;
  }
  return value;
}
export function rows(
  store: Store,
  academyId: number,
  table: BillingTable,
  filters: Row = {},
): Row[] {
  const predicates = Object.keys(filters).map((field) => {
    if (!(field in definitions[table]) && field !== "id")
      throw new Error("Unknown billing filter");
    return `${columnName(field)}=?`;
  });
  return store.db
    .prepare(
      `SELECT * FROM ${tableName(table)} WHERE academy_id=?${predicates.length ? " AND " + predicates.join(" AND ") : ""}`,
    )
    .all(academyId, ...Object.values(filters))
    .map((record) => decode(table, record));
}
export function invoicesInRange(
  store: Store,
  academyId: number,
  from: string,
  to: string,
): Row[] {
  return store.db
    .prepare(
      `SELECT * FROM ${tableName("invoices")} WHERE academy_id=? AND month BETWEEN ? AND ?`,
    )
    .all(academyId, from, to)
    .map((record) => decode("invoices", record));
}
export function get(
  store: Store,
  academyId: number,
  table: BillingTable,
  id: string,
) {
  const record = store.db
    .prepare(`SELECT * FROM ${tableName(table)} WHERE academy_id=? AND id=?`)
    .get(academyId, id);
  return record ? decode(table, record) : undefined;
}
export function put(
  store: Store,
  academyId: number,
  table: BillingTable,
  input: Row,
  rev: unknown,
) {
  const id = input.id || randomUUID();
  const old = get(store, academyId, table, id);
  if (!Number.isInteger(rev) || rev !== (old?.rev ?? 0))
    throw new HttpError(409, "다른 분이 먼저 고쳤어요. 새로 불러와 주세요.");
  const fields = Object.keys(definitions[table]);
  const values = fields.map((field) => {
    const value = input[field];
    if (field === "basis") return JSON.stringify(value);
    if (field === "teacherRead") return value ? 1 : 0;
    if (value !== undefined) return value;
    if (definitions[table][field].startsWith("INTEGER")) return 0;
    return "";
  });
  const columns = fields.map(columnName);
  store.db
    .prepare(
      `INSERT INTO ${tableName(table)}(academy_id,id,rev,${columns.join(",")}) VALUES(${Array(
        fields.length + 3,
      )
        .fill("?")
        .join(
          ",",
        )}) ON CONFLICT(academy_id,id) DO UPDATE SET rev=excluded.rev,${columns.map((column) => `${column}=excluded.${column}`).join(",")}`,
    )
    .run(academyId, id, Number(rev) + 1, ...values);
  return get(store, academyId, table, id)!;
}
export function relatedRows(
  store: Store,
  academyId: number,
  table: "invoice_lines" | "payments" | "refunds",
  invoices: Row[],
): Row[] {
  // Join through the filtered invoice keys without one query per invoice or a bind-variable limit.
  return store.db
    .prepare(
      `SELECT related.* FROM ${tableName(table)} related JOIN json_each(?) selected ON related.invoice_id=selected.value WHERE related.academy_id=?`,
    )
    .all(JSON.stringify(invoices.map((invoice) => invoice.id)), academyId)
    .map((record) => decode(table, record));
}
export function sumAmounts(values: number[]): number {
  const total = values.reduce((sum, value) => sum + BigInt(integer(value)), 0n);
  return integer(Number(total));
}
export function prorate(amount: number, total: number, gross: number) {
  if (!gross) return 0;
  return integer(
    Number(
      (BigInt(integer(amount)) * BigInt(integer(total)) +
        BigInt(integer(gross)) -
        1n) /
        BigInt(gross),
    ),
  );
}
export function transaction<T>(store: Store, operation: () => T): T {
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const value = operation();
    store.db.exec("COMMIT");
    return value;
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}
export function anonymize(
  store: Store,
  academyId: number,
  studentIds: string[],
) {
  for (const studentId of studentIds)
    for (const invoice of rows(store, academyId, "invoices", { studentId })) {
      put(
        store,
        academyId,
        "invoices",
        {
          ...invoice,
          studentId: randomUUID(),
          studentName: "",
          school: "",
          grade: "",
          note: "",
          discountReason: "",
        },
        invoice.rev,
      );
      for (const table of ["payments", "refunds"] as const)
        for (const record of rows(store, academyId, table, {
          invoiceId: invoice.id,
        }))
          put(
            store,
            academyId,
            table,
            { ...record, note: "", approval: "" },
            record.rev,
          );
    }
}
export function cleanup(store: Store, today: string) {
  const cutoff = `${Number(today.slice(0, 4)) - 5}${today.slice(4)}`;
  store.db
    .prepare(
      `DELETE FROM ${tableName("invoices")} WHERE COALESCE((SELECT MAX(date) FROM ${tableName("payments")} WHERE academy_id=${tableName("invoices")}.academy_id AND invoice_id=${tableName("invoices")}.id),month||'-01') < ?`,
    )
    .run(cutoff);
}
export function integer(value: unknown, min = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < min)
    throw new HttpError(400, "금액·수량은 원 단위 정수로 적어 주세요.");
  return Number(value);
}
export function status(
  invoice: Row,
  payments: Row[],
  refunds: Row[],
  today: string,
) {
  const paid =
    sumAmounts(
      payments
        .filter((payment) => payment.invoiceId === invoice.id)
        .map((payment) => payment.amount),
    ) -
    sumAmounts(
      refunds
        .filter((refund) => refund.invoiceId === invoice.id)
        .map((refund) => refund.amount),
    );
  return {
    paid,
    balance: integer(Math.max(0, invoice.total - paid)),
    paymentStatus:
      invoice.status === "canceled"
        ? "canceled"
        : paid >= invoice.total
          ? "paid"
          : invoice.dueDate < today
            ? "overdue"
            : paid > 0
              ? "partial"
              : "unpaid",
  };
}
export function refund(input: {
  amount: number;
  total: number;
  elapsed: number;
  reason: string;
  beforeStart?: boolean;
  futureAmount?: number;
}) {
  const {
    amount,
    total,
    elapsed,
    reason,
    beforeStart = false,
    futureAmount = 0,
  } = input;
  integer(amount);
  integer(total);
  integer(elapsed);
  integer(futureAmount);
  if (elapsed > total)
    throw new HttpError(400, "지난 수업 수를 확인해 주세요.");
  let numerator = 0,
    denominator = 1,
    stage = "반환 없음";
  if (beforeStart) {
    numerator = 1;
    stage = "시작 전 전액";
  } else if (reason === "academy") {
    numerator = total - elapsed;
    denominator = total || 1;
    stage = "남은 수업 비례";
  } else if (total && BigInt(elapsed) * 3n < BigInt(total)) {
    numerator = 2;
    denominator = 3;
    stage = "1/3 전";
  } else if (total && BigInt(elapsed) * 2n < BigInt(total)) {
    numerator = 1;
    denominator = 2;
    stage = "1/2 전";
  }
  const value = sumAmounts([
    prorate(amount, numerator, denominator),
    futureAmount,
  ]);
  return {
    amount: value,
    basis: {
      total,
      elapsed,
      stage,
      formula: `ceil(${amount} × ${numerator}/${denominator}) + ${futureAmount}`,
      futureAmount,
    },
  };
}
export function generate(
  month: string,
  students: Row[],
  info: Row[],
  enrollments: Row[],
  fees: Row[],
  lessons: Row[],
  existing: Row[],
) {
  const end = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
    )
      .toISOString()
      .slice(0, 10),
    start = month + "-01";
  const invoices: Row[] = [];
  let skipped = 0;
  for (const student of students) {
    if (
      student.deletedAt ||
      (info.find((invoice) => invoice.id === student.id)?.status ??
        "active") !== "active"
    )
      continue;
    const studentEnrollments = enrollments.filter(
      (enrollment) =>
        enrollment.studentId === student.id &&
        enrollment.joined <= end &&
        (!enrollment.left || enrollment.left >= start),
    );
    if (!studentEnrollments.length) continue;
    if (
      existing.some(
        (invoice) =>
          invoice.studentId === student.id &&
          invoice.month === month &&
          invoice.status !== "canceled",
      )
    ) {
      skipped++;
      continue;
    }
    const lines: Row[] = [];
    for (const classId of new Set(
      studentEnrollments.map((enrollment) => enrollment.classId),
    )) {
      const versions = fees.filter(
        (fee) =>
          fee.classId === classId &&
          fee.startDate <= end &&
          (!fee.endDate || fee.endDate >= start),
      );
      for (const series of new Set(
        versions.map((fee) => fee.seriesId || fee.id),
      )) {
        const seriesVersions = versions
          .filter((fee) => (fee.seriesId || fee.id) === series)
          .sort((earlierFee, laterFee) =>
            earlierFee.startDate.localeCompare(laterFee.startDate),
          );
        for (const fee of seriesVersions) {
          const count = lessons.filter(
            (lesson) =>
              lesson.classId === classId &&
              lesson.kind !== "cancelled" &&
              lesson.date >= start &&
              lesson.date <= end &&
              lesson.date >= fee.startDate &&
              (!fee.endDate || lesson.date <= fee.endDate) &&
              studentEnrollments.some(
                (enrollment) =>
                  enrollment.classId === classId &&
                  enrollment.joined <= lesson.date &&
                  (!enrollment.left || enrollment.left >= lesson.date),
              ),
          ).length;
          const quantity =
            fee.unit === "month"
              ? fee === seriesVersions.at(-1)
                ? 1
                : 0
              : count;
          if (quantity)
            lines.push({
              feeItemId: fee.id,
              name: fee.name,
              kind: fee.kind,
              unitPrice: fee.amount,
              quantity,
              amount: integer(fee.amount * quantity),
              classId,
            });
        }
      }
    }
    if (lines.length)
      invoices.push({
        studentId: student.id,
        studentName: student.name,
        school: student.school || "",
        grade: student.grade || "",
        month,
        lines,
      });
  }
  return { invoices, skipped };
}
export function csv(data: unknown[][]) {
  return (
    "\uFEFF" +
    data
      .map((row) =>
        row
          .map((value) => {
            let record = String(value ?? "");
            if (/^[\s]*[=+\-@]/.test(record)) record = "'" + record;
            return '"' + record.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}
