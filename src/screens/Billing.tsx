import { useEffect, useState } from "react";
import { api } from "../api";
import { today, type Row } from "../shared";
export const money = (value: number | bigint) =>
  `${(value || 0).toLocaleString("ko-KR")}원`;
const labels: Row = {
  draft: "만듦",
  sent: "보냄",
  canceled: "취소",
  paid: "받음",
  partial: "일부",
  unpaid: "아직",
  overdue: "미납",
  transfer: "계좌이체",
  card: "카드(단말기)",
  cash: "현금",
};
const Method = () => (
  <>
    <option value="transfer">계좌이체</option>
    <option value="card">카드(단말기)</option>
    <option value="cash">현금</option>
  </>
);
export function InvoiceCards({
  invoices,
  open,
}: {
  invoices: Row[];
  open?: (invoice: Row) => void;
}) {
  return (
    <div className="billing-list">
      <table>
        <thead>
          <tr>
            {[
              "학생·청구 달",
              "합계",
              "할인",
              "낼 날짜",
              "받은 금액",
              "상태",
              "항목",
            ].map((heading) => (
              <th key={heading}>{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td data-label="학생·청구 달">
                <strong>
                  {invoice.studentName} {invoice.month}
                </strong>
                {open && (
                  <button onClick={() => open(invoice)}>청구서 열기</button>
                )}
              </td>
              <td data-label="합계">{money(invoice.total)}</td>
              <td data-label="할인">{money(invoice.discount)}</td>
              <td data-label="낼 날짜">{invoice.dueDate}</td>
              <td data-label="받은 금액">{money(invoice.paid)}</td>
              <td data-label="상태">
                {invoice.status === "draft" ? "만듦 · " : ""}
                {labels[invoice.paymentStatus] || labels[invoice.status]}
              </td>
              <td data-label="항목">
                {invoice.lines.map((invoiceLine: Row, lineIndex: number) => (
                  <p key={lineIndex}>
                    {invoiceLine.name} × {invoiceLine.quantity} ·{" "}
                    {money(invoiceLine.amount)}
                  </p>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!invoices.length && <p className="muted">청구서가 없어요.</p>}
    </div>
  );
}
export function StudentBilling({ sid: studentId }: { sid: string }) {
  const [data, setData] = useState<Row>({ invoices: [] }),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api(`billing/invoices?studentId=${encodeURIComponent(studentId)}`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((event) => {
        if (active) setError(event.message);
      });
    return () => {
      active = false;
    };
  }, [studentId]);
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <InvoiceCards invoices={data.invoices} />
    </>
  );
}
export function Billing({
  st: state,
  director,
}: {
  st: Row;
  director: boolean;
}) {
  const [month, setMonth] = useState(today().slice(0, 7)),
    [data, setData] = useState<Row>({ invoices: [], settings: {} }),
    [selected, setSelected] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [filter, setFilter] = useState(""),
    [classId, setClassId] = useState(""),
    [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false),
    [from, setFrom] = useState(month),
    [to, setTo] = useState(month);
  const load = async () => {
    const result = await api(`billing/invoices?month=${month}`);
    setData(result);
    return result;
  };
  const run = async (operation: () => Promise<any>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      const result = await load();
      if (selected)
        setSelected(
          result.invoices.find((invoice: Row) => invoice.id === selected.id) ||
            null,
        );
    } catch (event) {
      setError((event as Error).message);
      await load().catch(() => {});
      setSelected(null);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let active = true;
    api(`billing/invoices?month=${month}`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((event) => {
        if (active) setError(event.message);
      });
    setSelected(null);
    return () => {
      active = false;
    };
  }, [month]);
  const valid = data.invoices.filter(
      (invoice: Row) => invoice.status !== "canceled",
    ),
    overdue = valid.filter(
      (invoice: Row) => invoice.paymentStatus === "overdue",
    ),
    sum = (invoices: Row[], field: string) =>
      invoices.reduce((total, invoice) => total + BigInt(invoice[field]), 0n);
  return (
    <div className="billing">
      <label>
        달{" "}
        <input
          type="month"
          value={month}
          onChange={(event) => {
            if (event.target.value) setMonth(event.target.value);
          }}
        />
      </label>
      <div className="stats">
        <section>
          청구 {valid.length}건 · {money(sum(valid, "total"))}
        </section>
        <section>받은 금액 {money(sum(valid, "paid"))}</section>
        <section>
          미납 {overdue.length}건 · {money(sum(overdue, "balance"))}
        </section>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="toolbar">
        {director && (
          <>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const response = await api("billing/generate", {
                    month,
                    rev: 0,
                  });
                  setMessage(
                    `${response.created.length}명 만듦 · 이미 있는 ${response.skipped}명 건너뜀`,
                  );
                })
              }
            >
              이달 청구서 만들기
            </button>
            <button onClick={() => setCreating(true)}>
              청구서 하나 만들기
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  api("billing/send-all", {
                    month,
                    revs: Object.fromEntries(
                      data.invoices
                        .filter((invoice: Row) => invoice.status === "draft")
                        .map((invoice: Row) => [invoice.id, invoice.rev]),
                    ),
                  }),
                )
              }
            >
              모두 보내기
            </button>
          </>
        )}
        <label>
          상태{" "}
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="">모두</option>
            {Object.entries(labels)
              .slice(0, 7)
              .map(([field, setField]) => (
                <option key={field} value={field}>
                  {setField}
                </option>
              ))}
          </select>
        </label>
        <label>
          반{" "}
          <select
            value={classId}
            onChange={(event) => setClassId(event.target.value)}
          >
            <option value="">모두</option>
            {state.classes.map((candidate: Row) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="toolbar">
        <label>
          시작 달{" "}
          <input
            type="month"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          끝 달{" "}
          <input
            type="month"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <a className="button" href={`/api/billing/csv?from=${from}&to=${to}`}>
          CSV 내려받기
        </a>
      </div>
      <InvoiceCards
        invoices={data.invoices.filter(
          (invoice: Row) =>
            (!filter ||
              invoice.status === filter ||
              invoice.paymentStatus === filter) &&
            (!classId ||
              invoice.lines.some(
                (invoiceLine: Row) => invoiceLine.classId === classId,
              )),
        )}
        open={setSelected}
      />
      {creating && (
        <div className="overlay">
          <div className="modal wide">
            <h2>청구서 하나 만들기</h2>
            <button onClick={() => setCreating(false)}>닫기</button>
            <InvoiceEditor
              st={state}
              value={{
                studentId: state.students[0]?.id,
                month,
                dueDate: `${month}-${String(Math.min(data.settings.dueDay || 10, 28)).padStart(2, "0")}`,
                discount: 0,
                discountReason: "",
                lines: [
                  {
                    name: "교습비",
                    kind: "tuition",
                    unitPrice: 0,
                    quantity: 1,
                    classId: "",
                  },
                ],
              }}
              create
              submit={(value) =>
                void run(async () => {
                  await api("billing/invoices", { ...value, rev: 0 });
                  setCreating(false);
                })
              }
            />
          </div>
        </div>
      )}
      {selected && (
        <InvoiceDialog
          key={`${selected.id}:${selected.rev}`}
          i={selected}
          st={state}
          cfg={data.settings}
          director={director}
          close={() => setSelected(null)}
          run={run}
        />
      )}
    </div>
  );
}
function InvoiceEditor({
  value,
  st: state,
  submit,
  create = false,
}: {
  value: Row;
  st: Row;
  submit: (value: Row) => void;
  create?: boolean;
}) {
  const [editorValues, setEditorValues] = useState(value),
    set = (field: string, item: any) =>
      setEditorValues({ ...editorValues, [field]: item });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(editorValues);
      }}
    >
      {create && (
        <label>
          학생{" "}
          <select
            value={editorValues.studentId}
            onChange={(event) => set("studentId", event.target.value)}
          >
            {state.students.map((value: Row) => (
              <option key={value.id} value={value.id}>
                {value.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        낼 날짜{" "}
        <input
          required
          type="date"
          value={editorValues.dueDate}
          onChange={(event) => set("dueDate", event.target.value)}
        />
      </label>
      {editorValues.lines.map((invoiceLine: Row, lineIndex: number) => (
        <fieldset key={lineIndex}>
          <legend>항목 {lineIndex + 1}</legend>
          <label>
            교습 달{" "}
            <input
              type="month"
              value={invoiceLine.month || editorValues.month}
              onChange={(event) =>
                set(
                  "lines",
                  editorValues.lines.map((item: Row, candidateIndex: number) =>
                    candidateIndex === lineIndex
                      ? { ...item, month: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </label>
          {["name", "unitPrice", "quantity"].map((field) => (
            <label key={field}>
              {{ name: "이름", unitPrice: "단가", quantity: "수량" }[field]}{" "}
              <input
                aria-label={
                  { name: "이름", unitPrice: "단가", quantity: "수량" }[field]
                }
                required
                type={field === "name" ? "text" : "number"}
                min={field === "quantity" ? 1 : 0}
                step="1"
                value={invoiceLine[field]}
                onChange={(event) =>
                  set(
                    "lines",
                    editorValues.lines.map(
                      (item: Row, candidateIndex: number) =>
                        candidateIndex === lineIndex
                          ? {
                              ...item,
                              [field]:
                                field === "name"
                                  ? event.target.value
                                  : Number(event.target.value),
                            }
                          : item,
                    ),
                  )
                }
              />
            </label>
          ))}
          <label>
            종류{" "}
            <select
              value={invoiceLine.kind}
              onChange={(event) =>
                set(
                  "lines",
                  editorValues.lines.map((item: Row, candidateIndex: number) =>
                    candidateIndex === lineIndex
                      ? { ...item, kind: event.target.value }
                      : item,
                  ),
                )
              }
            >
              <option value="tuition">교습비</option>
              <option value="extra">기타경비</option>
            </select>
          </label>
          <label>
            반{" "}
            <select
              value={invoiceLine.classId || ""}
              onChange={(event) =>
                set(
                  "lines",
                  editorValues.lines.map((item: Row, candidateIndex: number) =>
                    candidateIndex === lineIndex
                      ? { ...item, classId: event.target.value }
                      : item,
                  ),
                )
              }
            >
              <option value="">없음</option>
              {state.classes.map((candidate: Row) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={editorValues.lines.length === 1}
            onClick={() =>
              set(
                "lines",
                editorValues.lines.filter(
                  (_: Row, candidateIndex: number) =>
                    candidateIndex !== lineIndex,
                ),
              )
            }
          >
            줄 빼기
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          set("lines", [
            ...editorValues.lines,
            {
              name: "",
              kind: "tuition",
              unitPrice: 0,
              quantity: 1,
              classId: "",
            },
          ])
        }
      >
        줄 더하기
      </button>
      <label>
        할인{" "}
        <input
          type="number"
          min="0"
          step="1"
          value={editorValues.discount}
          onChange={(event) => set("discount", Number(event.target.value))}
        />
      </label>
      <label>
        할인 사유{" "}
        <input
          value={editorValues.discountReason}
          onChange={(event) => set("discountReason", event.target.value)}
        />
      </label>
      <button className="primary">청구서 저장</button>
    </form>
  );
}
function InvoiceDialog({
  i: invoice,
  st: state,
  cfg,
  director,
  close,
  run,
}: {
  i: Row;
  st: Row;
  cfg: Row;
  director: boolean;
  close: () => void;
  run: (operation: () => Promise<any>) => Promise<void>;
}) {
  const [mode, setMode] = useState(""),
    [method, setMethod] = useState("transfer"),
    [amount, setAmount] = useState(invoice.balance),
    [quote, setQuote] = useState<Row | null>(null),
    [reason, setReason] = useState("student"),
    [referenceDate, setReferenceDate] = useState(today()),
    [extra, setExtra] = useState(0);
  const path = `billing/invoices/${invoice.id}/`,
    send = (action: string, input: Row = {}) =>
      run(() => api(path + action, { ...input, rev: invoice.rev }));
  return (
    <div className="overlay">
      <div className="modal wide billing">
        <div className="toolbar">
          <h2>
            {invoice.studentName} · {invoice.month} 청구서
          </h2>
          <button onClick={close}>닫기</button>
        </div>
        <p>
          {money(invoice.total)} · {labels[invoice.status]} ·{" "}
          {labels[invoice.paymentStatus]}
        </p>
        {director && invoice.status === "draft" && (
          <>
            <InvoiceEditor
              st={state}
              value={invoice}
              submit={(value) => void send("edit", value)}
            />
            <button onClick={() => void send("send")}>보내기</button>
          </>
        )}
        {director && invoice.status !== "canceled" && (
          <button onClick={() => void send("cancel")}>청구 취소</button>
        )}
        <h3>입금 목록</h3>
        {invoice.payments.map((path: Row) => (
          <div key={path.id}>
            {path.date} · {money(path.amount)} · {labels[path.method]} ·{" "}
            {path.receiptStatus === "issued"
              ? `현금영수증 ${path.approval}`
              : path.receiptStatus === "pending"
                ? "발급 전"
                : "요청 안 함"}{" "}
            · {path.note}
            {director && path.receiptStatus !== "issued" && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const f = new FormData(event.currentTarget);
                  void send("receipt", {
                    paymentId: path.id,
                    paymentRev: path.rev,
                    approval: f.get("approval"),
                  });
                }}
              >
                <label>
                  발급 승인번호 <input name="approval" required />
                </label>
                <button>현금영수증 발급 기록</button>
              </form>
            )}
          </div>
        ))}
        {invoice.refunds.map((response: Row) => (
          <p key={response.id}>
            환불 {response.date} · {money(response.amount)} ·{" "}
            {labels[response.method]}
          </p>
        ))}
        <div className="toolbar">
          {director && invoice.status === "sent" && (
            <>
              <button onClick={() => setMode("payment")}>입금 기록</button>
              <button onClick={() => setMode("refund")}>환불 계산</button>
            </>
          )}
          <button
            disabled={!invoice.payments.length}
            onClick={() => setMode("print")}
          >
            영수증 인쇄
          </button>
        </div>
        {mode === "payment" && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const f = new FormData(event.currentTarget);
              void send("payments", {
                amount,
                method,
                date: f.get("date"),
                note: f.get("note"),
                receiptStatus: f.get("receiptStatus"),
                approval: f.get("approval"),
              });
            }}
          >
            <h3>입금 기록</h3>
            <label>
              금액{" "}
              <input
                required
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(event) => setAmount(+event.target.value)}
              />
            </label>
            <label>
              방법{" "}
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value)}
              >
                <Method />
              </select>
            </label>
            <label>
              받은 날{" "}
              <input required name="date" type="date" defaultValue={today()} />
            </label>
            {["transfer", "cash"].includes(method) && amount >= 100000 && (
              <p>
                현금영수증 발급 대상이에요. 발급하고 승인번호를 적어 주세요.
              </p>
            )}
            <label>
              현금영수증{" "}
              <select name="receiptStatus" defaultValue="pending">
                <option value="pending">발급 전</option>
                <option value="issued">발급</option>
                <option value="not_requested">요청 안 함</option>
              </select>
            </label>
            <label>
              승인번호 <input name="approval" />
            </label>
            <label>
              메모 <input name="note" />
            </label>
            <button>입금 저장</button>
          </form>
        )}
        {mode === "refund" && (
          <>
            <h3>환불 계산</h3>
            <p>반환 사유가 생긴 날부터 5일 안에 돌려줘야 해요</p>
            <p className="muted">
              기준일 수업까지 지난 수업으로 세요. 기타경비는 직접 정해요.
            </p>
            <label>
              사유{" "}
              <select
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setQuote(null);
                }}
              >
                <option value="student">학생 사정</option>
                <option value="academy">학원 사정</option>
              </select>
            </label>
            <label>
              기준 날짜{" "}
              <input
                type="date"
                value={referenceDate}
                onChange={(event) => {
                  setReferenceDate(event.target.value);
                  setQuote(null);
                }}
              />
            </label>
            <label>
              기타경비 환불액{" "}
              <input
                type="number"
                min="0"
                step="1"
                value={extra}
                onChange={(event) => {
                  setExtra(+event.target.value);
                  setQuote(null);
                }}
              />
            </label>
            <button
              onClick={() =>
                void run(async () =>
                  setQuote(
                    await api(path + "refund-quote", {
                      rev: invoice.rev,
                      reason,
                      referenceDate,
                      extraAmount: extra,
                    }),
                  ),
                )
              }
            >
              계산 결과 보기
            </button>
            {quote && (
              <>
                <p>돌려줄 금액 {money(quote.amount)}</p>
                {quote.basis.lines.map((item: Row, lineIndex: number) => (
                  <p key={lineIndex}>
                    {item.line} · 총 {item.basis.total}회 / 지난{" "}
                    {item.basis.elapsed}회 · {item.basis.stage} ·{" "}
                    {item.basis.formula}
                  </p>
                ))}
                {quote.basis.capped && <p>받은 잔액까지만 돌려줘요.</p>}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const f = new FormData(event.currentTarget);
                    void send("refunds", {
                      reason,
                      referenceDate,
                      extraAmount: extra,
                      date: f.get("date"),
                      method: f.get("method"),
                      note: f.get("note"),
                    });
                  }}
                >
                  <label>
                    돌려준 날{" "}
                    <input
                      required
                      name="date"
                      type="date"
                      defaultValue={today()}
                    />
                  </label>
                  <label>
                    방법{" "}
                    <select name="method">
                      <Method />
                    </select>
                  </label>
                  <label>
                    메모 <input name="note" />
                  </label>
                  <button>환불 기록</button>
                </form>
              </>
            )}
          </>
        )}
        {mode === "print" && (
          <div className="receipt">
            <h2>교습비등 영수증</h2>
            <p>
              학원 {state.user.academy.name} · 등록번호 {cfg.registration}
            </p>
            <p>
              설립·운영자 {cfg.operator} · 주소 {cfg.address} · 전화 {cfg.phone}
            </p>
            <p>
              학습자 {invoice.studentName} · {invoice.school} {invoice.grade}
            </p>
            <p>
              교습과목{" "}
              {Array.from(
                new Set(
                  invoice.lines.map(
                    (invoiceLine: Row) =>
                      state.classes.find(
                        (candidate: Row) =>
                          candidate.id === invoiceLine.classId,
                      )?.name || invoiceLine.name,
                  ),
                ),
              ).join(", ")}
            </p>
            <p>
              교습기간{" "}
              {Array.from(
                new Set(
                  invoice.lines.map(
                    (invoiceLine: Row) => invoiceLine.month || invoice.month,
                  ),
                ),
              )
                .sort()
                .join(", ")}
            </p>
            {invoice.lines.map((invoiceLine: Row, lineIndex: number) => (
              <p key={lineIndex}>
                {invoiceLine.kind === "tuition" ? "교습비" : "기타경비"} ·{" "}
                {invoiceLine.name} · {money(invoiceLine.amount)}
              </p>
            ))}
            <p>
              할인 {money(invoice.discount)} · 합계 {money(invoice.total)}
            </p>
            {invoice.payments.map((path: Row) => (
              <p key={path.id}>
                받은 날 {path.date} · 받은 금액 {money(path.amount)} · 받은 사람{" "}
                {path.recordedBy}
              </p>
            ))}
            <p>
              환불{" "}
              {money(
                invoice.refunds.reduce(
                  (lineIndex: number, response: Row) =>
                    lineIndex + response.amount,
                  0,
                ),
              )}{" "}
              · 받은 금액 합계 {money(invoice.paid)}
            </p>
            <button onClick={() => window.print()}>인쇄하기</button>
          </div>
        )}
      </div>
    </div>
  );
}
export function BillingSettings({ st: state }: { st: Row }) {
  const [data, setData] = useState<Row>({
      settings: { rev: 0, dueDay: 10 },
      fees: [],
    }),
    [error, setError] = useState(""),
    [version, setVersion] = useState<Row | null>(null);
  const load = () => api("billing/settings").then(setData);
  useEffect(() => {
    void load().catch((event) => setError(event.message));
  }, []);
  const save = async (path: string, value: Row) => {
    setError("");
    try {
      await api(path, value);
      setVersion(null);
      await load();
    } catch (event) {
      setError((event as Error).message);
      await load();
    }
  };
  return (
    <section className="billing">
      <h2>수납 설정</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <form
        key={data.settings.rev}
        onSubmit={(event) => {
          event.preventDefault();
          const f = new FormData(event.currentTarget);
          void save("billing/settings", {
            ...Object.fromEntries(f),
            rev: data.settings.rev,
            dueDay: Number(f.get("dueDay")),
            teacherRead: f.get("teacherRead") === "on",
          });
        }}
      >
        <div className="form-grid">
          {Object.entries({
            bank: "은행",
            account: "입금 계좌번호",
            holder: "예금주",
            registration: "학원 등록번호",
            operator: "설립·운영자",
            address: "주소",
            phone: "전화",
          }).map(([field, setField]) => (
            <label key={field}>
              {setField}
              <input name={field} defaultValue={data.settings[field] || ""} />
            </label>
          ))}
          <label>
            기본 낼 날짜(매달 n일)
            <input
              name="dueDay"
              type="number"
              min="1"
              max="31"
              required
              defaultValue={data.settings.dueDay}
            />
          </label>
          <label>
            <input
              name="teacherRead"
              type="checkbox"
              defaultChecked={data.settings.teacherRead}
            />{" "}
            선생님도 수납 보기
          </label>
        </div>
        <button>수납 설정 저장</button>
      </form>
      <h3>수강료표</h3>
      {data.fees.map((f: Row) => (
        <article key={f.id}>
          <p>
            {f.name} · {money(f.amount)} / {f.unit === "month" ? "월" : "회"} ·{" "}
            {f.startDate}~{f.endDate || "계속"} ·{" "}
            {state.classes.find((candidate: Row) => candidate.id === f.classId)
              ?.name || "반 없음"}
          </p>
          {!f.endDate && (
            <>
              <button onClick={() => setVersion({ ...f, startDate: today() })}>
                새 판 만들기
              </button>
              <label>
                끝 날짜{" "}
                <input
                  type="date"
                  aria-label={`${f.name} 끝 날짜`}
                  onChange={(event) =>
                    setVersion({
                      ...f,
                      endDate: event.target.value,
                      finish: true,
                    })
                  }
                />
              </label>
              {version && version.id === f.id && version.finish && (
                <button onClick={() => void save("billing/fees", version!)}>
                  끝내기
                </button>
              )}
            </>
          )}
        </article>
      ))}
      <form
        key={version?.id || "new"}
        onSubmit={(event) => {
          event.preventDefault();
          const f = new FormData(event.currentTarget);
          void save("billing/fees", {
            ...Object.fromEntries(f),
            id: version?.finish ? undefined : version?.id,
            rev: version?.finish ? 0 : version?.rev || 0,
            amount: Number(f.get("amount")),
          });
        }}
      >
        <h3>{version && !version.finish ? "수강료 새 판" : "수강료 만들기"}</h3>
        <div className="form-grid">
          <label>
            이름
            <input required name="name" defaultValue={version?.name || ""} />
          </label>
          <label>
            금액
            <input
              required
              type="number"
              min="0"
              step="1"
              name="amount"
              defaultValue={version?.amount || 0}
            />
          </label>
          <label>
            단위
            <select name="unit" defaultValue={version?.unit || "month"}>
              <option value="month">월</option>
              <option value="lesson">회</option>
            </select>
          </label>
          <label>
            종류
            <select name="kind" defaultValue={version?.kind || "tuition"}>
              <option value="tuition">교습비</option>
              <option value="extra">기타경비</option>
            </select>
          </label>
          <label>
            반
            <select name="classId" defaultValue={version?.classId || ""}>
              <option value="">없음</option>
              {state.classes.map((candidate: Row) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            적용 시작일
            <input
              required
              type="date"
              name="startDate"
              defaultValue={version?.startDate || today()}
            />
          </label>
          <label>
            메모
            <input name="note" defaultValue={version?.note || ""} />
          </label>
        </div>
        <button>수강료 저장</button>
        <button type="button" onClick={() => setVersion(null)}>
          새로 입력
        </button>
      </form>
    </section>
  );
}
