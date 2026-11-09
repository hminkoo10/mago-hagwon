import { useState } from "react";
import { Field } from "../ui";
import { type Row, subjects, weekday } from "../shared";
export function ClassEditor({
  value,
  state,
  busy,
  close,
  submit,
  save,
  date,
}: {
  value: Row;
  state: Row;
  busy: boolean;
  close: () => void;
  submit: (v: Row) => void;
  save: (p: string, v: unknown) => Promise<Row | undefined>;
  date: string;
}) {
  const [v, V] = useState<Row>(structuredClone(value)),
    [period, Period] = useState<Row | null>(null),
    [sid, Id] = useState(""),
    [joined, J] = useState(date),
    [left, Left] = useState(""),
    [exdate, Ex] = useState(date),
    [start, T] = useState("16:00"),
    [end, End] = useState("17:00"),
    [room, R] = useState("");
  const set = (k: string, x: any) => V({ ...v, [k]: x });
  return (
    <div className="overlay">
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="반 고치기"
      >
        <div className="toolbar">
          <h2>{v.readOnly ? "반 보기" : v.id ? "반 고치기" : "반 만들기"}</h2>
          <button onClick={close}>닫기</button>
        </div>
        <fieldset disabled={!!v.readOnly}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(v);
            }}
          >
            <div className="form-grid">
              <Field label="반 이름">
                <input
                  required
                  value={v.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </Field>
              <Field label="과목">
                <select
                  value={v.subject}
                  onChange={(e) => set("subject", e.target.value)}
                >
                  {[...(state.user.academy.subjects ?? ["math"]), "other"].map(
                    (k) => (
                      <option key={k} value={k}>
                        {subjects[k]}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="담당 선생님">
                <select
                  value={v.teacherId}
                  onChange={(e) => set("teacherId", e.target.value)}
                >
                  {state.members
                    .filter((x: Row) =>
                      ["teacher", "director"].includes(x.role),
                    )
                    .map((x: Row) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="강의실">
                <input
                  list="rooms"
                  value={v.room}
                  onChange={(e) => set("room", e.target.value)}
                />
              </Field>
              <Field label="시작 날짜">
                <input
                  type="date"
                  required
                  value={v.startDate}
                  onChange={(e) => set("startDate", e.target.value)}
                />
              </Field>
              <Field label="끝 날짜">
                <input
                  type="date"
                  value={v.endDate}
                  onChange={(e) => set("endDate", e.target.value)}
                />
              </Field>
            </div>
            <Field label="메모">
              <textarea
                value={v.note}
                onChange={(e) => set("note", e.target.value)}
              />
            </Field>
            <h3>반복 시간</h3>
            {v.times.map((t: Row, i: number) => (
              <div className="toolbar" key={i}>
                <select
                  aria-label="요일"
                  value={t.weekday}
                  onChange={(e) =>
                    set(
                      "times",
                      v.times.map((x: Row, n: number) =>
                        n === i ? { ...x, weekday: Number(e.target.value) } : x,
                      ),
                    )
                  }
                >
                  {weekday.map((d, n) => (
                    <option key={d} value={n}>
                      {d}
                    </option>
                  ))}
                </select>
                {["start", "end", "room"].map((k) => (
                  <input
                    key={k}
                    aria-label={
                      { start: "시작 시각", end: "끝 시각", room: "강의실" }[k]
                    }
                    type={k === "room" ? "text" : "time"}
                    value={t[k]}
                    required={k !== "room"}
                    onChange={(e) =>
                      set(
                        "times",
                        v.times.map((x: Row, n: number) =>
                          n === i ? { ...x, [k]: e.target.value } : x,
                        ),
                      )
                    }
                  />
                ))}
                <button
                  type="button"
                  onClick={() =>
                    set(
                      "times",
                      v.times.filter((_: Row, n: number) => n !== i),
                    )
                  }
                >
                  빼기
                </button>
              </div>
            ))}
            <div className="toolbar">
              <button
                type="button"
                onClick={() =>
                  set("times", [
                    ...v.times,
                    { weekday: 1, start: "16:00", end: "17:00", room: v.room },
                  ])
                }
              >
                시간 더 넣기
              </button>
              <button className="primary" disabled={busy}>
                반 저장하기
              </button>
            </div>
          </form>
          <datalist id="rooms">
            {state.rooms.map((r: Row) => (
              <option key={r.id}>{r.name}</option>
            ))}
          </datalist>
          {v.id && (
            <>
              <h3>학생 넣고 빼기</h3>
              <div className="form-grid">
                <Field label="학생">
                  <select
                    value={sid}
                    onChange={(e) => {
                      Id(e.target.value);
                      const en = [...state.enrollments].sort((a: Row, b: Row) => b.joined.localeCompare(a.joined)).find(
                        (x: Row) =>
                          x.classId === v.id && x.studentId === e.target.value,
                      );
                      Period(en || null);
                      J(en?.joined || date);
                      Left(en?.left || "");
                    }}
                  >
                    <option value="">학생 고르기</option>
                    {state.students.map((s: Row) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="들어온 날">
                  <input
                    type="date"
                    value={joined}
                    onChange={(e) => J(e.target.value)}
                  />
                </Field>
                <Field label="나간 날 (비우면 계속)">
                  <input
                    type="date"
                    value={left}
                    onChange={(e) => Left(e.target.value)}
                  />
                </Field>
              </div>
              <button
                disabled={!sid || busy}
                onClick={() =>
                  save("enrollments", {
                    id: period?.id,
                    rev: period?.rev,
                    classId: v.id,
                    studentId: sid,
                    joined,
                    left,
                  }).then(saved => { if (saved) Period(saved); })
                }
              >
                학생 배정 저장하기
              </button>
              <div>
                {state.enrollments.filter((e: Row) => e.classId === v.id).map((e: Row) => (
                  <div className="toolbar" key={e.id}>
                    <span>{state.students.find((s: Row) => s.id === e.studentId)?.name} · {e.joined} ~ {e.left || "계속 다님"}</span>
                    <button onClick={() => { Id(e.studentId); Period(e); J(e.joined); Left(e.left); }}>기간 고치기</button>
                    {e.left && <button onClick={() => { Id(e.studentId); Period(null); J(date); Left(""); }}>다시 넣기</button>}
                  </div>
                ))}
              </div>
              <h3>휴강·보강</h3>
              <div className="toolbar">
                <input
                  aria-label="예외 날짜"
                  type="date"
                  value={exdate}
                  onChange={(e) => Ex(e.target.value)}
                />
                <input
                  aria-label="보강 시작"
                  type="time"
                  value={start}
                  onChange={(e) => T(e.target.value)}
                />
                <input
                  aria-label="보강 끝"
                  type="time"
                  value={end}
                  onChange={(e) => End(e.target.value)}
                />
                <input
                  aria-label="보강 강의실"
                  placeholder="강의실"
                  value={room}
                  onChange={(e) => R(e.target.value)}
                />
                <button
                  disabled={busy}
                  onClick={() =>
                    save("lessons", {
                      classId: v.id,
                      date: exdate,
                      kind: "makeup",
                      start,
                      end,
                      room,
                    })
                  }
                >
                  보강 하나 넣기
                </button>
              </div>
              <p className="muted">
                휴강은 아래 해당 수업에서 눌러요. 선택 날짜의 수업만 보여요.
              </p>
              {state.lessons
                .filter((l: Row) => l.classId === v.id)
                .map((l: Row) => (
                  <div className="toolbar" key={l.id}>
                    {l.date} {l.start}~{l.end}
                    <button
                      disabled={l.kind === "cancelled" || busy}
                      onClick={() =>
                        save("lessons", {
                          classId: v.id,
                          date: l.date,
                          lessonId: l.id,
                          kind: "cancelled",
                        })
                      }
                    >
                      휴강으로 표시
                    </button>
                  </div>
                ))}
            </>
          )}
        </fieldset>
      </div>
    </div>
  );
}
