import { InvoiceCards } from "./Billing";
import { useEffect, useState } from "react";
import { api } from "../api";
import { today, statuses, type Row } from "../shared";
const clock = (at: string | null) =>
  at
    ? new Date(at).toLocaleTimeString("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "—";
export function Guardian({ user }: { user: Row }) {
  const [page, setPage] = useState("출결"),
    [billing, setBilling] = useState<Row>({ invoices: [], account: {} });
  const [children, setChildren] = useState<Row[]>([]),
    [studentId, setStudentId] = useState(""),
    [month, setMonth] = useState(today().slice(0, 7)),
    [data, setData] = useState<Row>({ attendance: [], today: [] }),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    api("guardian/children")
      .then((result) => {
        if (active) {
          setChildren(result.children);
          setStudentId((old) =>
            result.children.some(
              (candidate: Row) => candidate.studentId === old,
            )
              ? old
              : result.children[0]?.studentId || "",
          );
        }
      })
      .catch((event) => setError(event.message));
    return () => {
      active = false;
    };
  }, [tick]);
  useEffect(() => {
    let active = true;
    setData({ attendance: [], today: [] });
    setError("");
    if (studentId)
      api(
        `guardian/attendance?studentId=${encodeURIComponent(studentId)}&month=${month}`,
      )
        .then((result) => {
          if (active) setData(result);
        })
        .catch((event) => {
          if (active) setError(event.message);
        });
    return () => {
      active = false;
    };
  }, [studentId, month, tick]);
  useEffect(() => {
    let active = true;
    setBilling({ invoices: [], account: {} });
    if (studentId)
      api(`guardian/billing?studentId=${encodeURIComponent(studentId)}`)
        .then((result) => {
          if (active) setBilling(result);
        })
        .catch((event) => {
          if (active) setError(event.message);
        });
    return () => {
      active = false;
    };
  }, [studentId, tick]);
  const rows = (items: Row[]) =>
    items.map((response, invoice) => (
      <article className="guardian-lesson" key={invoice}>
        <p>
          <strong>
            {response.date} · {response.className}
          </strong>
        </p>
        <p>
          {response.start}–{response.end} ·{" "}
          {response.date > today() ? (
            <span className="muted">예정</span>
          ) : (
            statuses[response.status] || "아직 없음"
          )}
        </p>
        <p>
          등원 {clock(response.arrival)} · 하원 {clock(response.departure)}
        </p>
      </article>
    ));
  return (
    <div className="guardian-home">
      <header>
        <div className="brand">
          <b className="mark">마</b> 마고 학원운영
        </div>
        <form action="/api/auth/logout" method="post">
          <button>로그아웃</button>
        </form>
      </header>
      <nav aria-label="주 메뉴">
        <button onClick={() => setPage("출결")}>자녀 출결</button>
        <button onClick={() => setPage("수납")}>수납</button>
      </nav>
      <h1>{page === "수납" ? "자녀 수납" : "자녀 출결"}</h1>
      <p className="muted">
        {user.academy.name} · {user.name}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="toolbar">
        <label>
          자녀{" "}
          <select
            value={studentId}
            onChange={(event) => setStudentId(event.target.value)}
          >
            {children.map((candidate) => (
              <option key={candidate.studentId} value={candidate.studentId}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => setTick(tick + 1)}>새로 불러오기</button>
      </div>
      {page === "수납" && (
        <>
          {billing.account.account ? (
            <p>
              입금 계좌 {billing.account.bank} {billing.account.account}{" "}
              {billing.account.holder}
            </p>
          ) : null}
          <InvoiceCards invoices={billing.invoices} />
        </>
      )}
      {page === "출결" &&
        (!children.length ? (
          <p>연결된 자녀가 없어요. 학원에 문의해 주세요.</p>
        ) : (
          <>
            <section>
              <h2>오늘</h2>
              {rows(data.today)}
              {!data.today.length && (
                <p className="muted">오늘 수업이 없어요.</p>
              )}
            </section>
            <section>
              <h2>월별 출결</h2>
              <label>
                달{" "}
                <input
                  aria-label="달"
                  type="month"
                  value={month}
                  onChange={(event) => {
                    if (event.target.value) setMonth(event.target.value);
                  }}
                />
              </label>
              {rows(data.attendance)}
              {!data.attendance.length && (
                <p className="muted">이 달 수업이 없어요.</p>
              )}
            </section>
          </>
        ))}
    </div>
  );
}
