import { useState, useEffect } from "react";
import { api } from "../api";
import { Field } from "../ui";
import { type Row } from "../shared";
export function Tablet() {
  const [ready, R] = useState(false),
    [pin, P] = useState(""),
    [code, C] = useState(""),
    [name, N] = useState("입구 태블릿"),
    [msg, M] = useState(""),
    [records, S] = useState<Row[]>([]),
    [busy, B] = useState(false);
  const recent = () =>
    api("kiosk/recent").then((d) => {
      R(true);
      S(d.records);
    });
  useEffect(() => {
    recent().catch(() => R(false));
    const id = setInterval(() => recent().catch(() => R(false)), 30000);
    return () => clearInterval(id);
  }, []);
  async function send() {
    if (busy) return;
    B(true);
    try {
      if (!ready) {
        await api("kiosk/register", { code, name });
        await recent();
        M("등록했어요. 학생 번호를 눌러 주세요.");
      } else {
        const d = await api("kiosk/checkin", { pin });
        M(
          d.kind === "in"
            ? "등원했어요. 반가워요."
            : "하원했어요. 조심히 가세요.",
        );
        P("");
        await recent();
      }
    } catch (e) {
      M((e as Error).message);
      P("");
    } finally {
      B(false);
    }
  }
  return (
    <div className="tablet">
      <div className="brand">
        <b className="mark">마</b>마고 학원운영
      </div>
      <h1>태블릿 출결</h1>
      <p>
        {ready
          ? "학생 번호 4자리를 눌러 주세요."
          : "원장님이 만든 등록 번호를 넣어 주세요."}
      </p>
      <div role="status" className="notice">
        {msg}
      </div>
      {!ready ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Field label="기기 이름">
            <input value={name} onChange={(e) => N(e.target.value)} />
          </Field>
          <Field label="등록 번호 6자리">
            <input
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => C(e.target.value)}
              required
            />
          </Field>
          <button className="primary" disabled={busy}>
            이 태블릿 등록하기
          </button>
        </form>
      ) : (
        <div className="tablet-grid">
          <div className="tablet-entry">
            <input
              className="pin-display"
              type="password"
              aria-label="학생 번호 4자리"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => P(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && pin.length === 4) void send();
              }}
            />
            <div className="keypad">
              {[
                "1",
                "2",
                "3",
                "4",
                "5",
                "6",
                "7",
                "8",
                "9",
                "지우기",
                "0",
                "확인",
              ].map((k) => (
                <button
                  className={k === "확인" ? "primary" : ""}
                  key={k}
                  disabled={busy || (k === "확인" && pin.length !== 4)}
                  onClick={() =>
                    k === "지우기"
                      ? P(pin.slice(0, -1))
                      : k === "확인"
                        ? void send()
                        : P((pin + k).slice(0, 4))
                  }
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
          <aside className="recent">
            <h2>방금 기록</h2>
            {records.map((x, i) => (
              <p key={i}>
                {new Date(x.at).toLocaleTimeString("ko-KR")} ·{" "}
                {x.kind === "in" ? "등원" : "하원"}
              </p>
            ))}
          </aside>
        </div>
      )}
    </div>
  );
}
