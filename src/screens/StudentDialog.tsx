import { useState, useEffect } from "react";
import { api } from "../api";
import { Field, Table } from "../ui";
import { type Row, statuses } from "../shared";
export function StudentDialog({
  student,
  state,
  date,
  director,
  close,
  save,
  issue,
}: {
  student: Row;
  state: Row;
  date: string;
  director: boolean;
  close: () => void;
  save: (p: string, v: unknown) => Promise<Row | undefined>;
  issue: () => void;
}) {
  const [tab, T] = useState("기본 정보"),
    [history, H] = useState<Row[]>([]),
    [err, E] = useState("");
  const current = state.info.find((x: Row) => x.id === student.id) || {},
    [v, V] = useState<Row>({
      rev: 0,
      status: "active",
      enrolledAt: "",
      leftAt: "",
      birthYear: "",
      ...current,
    }),
    set = (k: string, x: any) => V({ ...v, [k]: x });
  useEffect(() => {
    api("student-attendance?id=" + student.id)
      .then((d) => H(d.attendance))
      .catch((e) => E(e.message));
  }, [student.id]);
  return (
    <div className="overlay">
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="학생 정보"
      >
        <div className="toolbar">
          <div>
            <h2>
              {student.name} <span className="badge">{student.grade}</span>
            </h2>
            <p>
              {student.school} · {student.grade}
            </p>
          </div>
          <button onClick={close}>닫기</button>
        </div>
        <div className="tabs">
          {["기본 정보", "반", "출결"].map((t) => (
            <button
              className={t === tab ? "active" : ""}
              key={t}
              onClick={() => T(t)}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === "기본 정보" && (
          <>
            <p className="muted">
              이름·학교는 통합 클라우드 학생 명단에서 고쳐요
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save("student-info", {
                  ...v,
                  studentId: student.id,
                  birthYear: v.birthYear ? Number(v.birthYear) : null,
                }).then(saved => { if (saved) V(saved); });
              }}
            >
              <fieldset disabled={!director}>
                <div className="form-grid">
                  <Field label="이름">
                    <input readOnly value={student.name} />
                  </Field>
                  <Field label="학교 · 학년">
                    <input
                      readOnly
                      value={`${student.school} · ${student.grade}`}
                    />
                  </Field>
                  <Field label="재원 상태">
                    <select
                      value={v.status}
                      onChange={(e) => set("status", e.target.value)}
                    >
                      <option value="active">재원</option>
                      <option value="paused">휴원</option>
                      <option value="left">퇴원</option>
                    </select>
                  </Field>
                  <Field label="출생 연도">
                    <input
                      type="number"
                      min="1900"
                      max={new Date().getFullYear()}
                      value={v.birthYear || ""}
                      onChange={(e) => set("birthYear", e.target.value)}
                    />
                  </Field>
                  <Field label="등록일">
                    <input
                      type="date"
                      value={v.enrolledAt}
                      onChange={(e) => set("enrolledAt", e.target.value)}
                    />
                  </Field>
                  <Field label="퇴원일">
                    <input
                      type="date"
                      value={v.leftAt}
                      onChange={(e) => set("leftAt", e.target.value)}
                    />
                  </Field>
                </div>
                {v.birthYear &&
                  new Date().getFullYear() - Number(v.birthYear) <= 14 && (
                    <p className="badge">14세 미만 확인 필요</p>
                  )}
                <div className="toolbar">
                  <button className="primary">운영 정보 저장하기</button>
                  <button type="button" onClick={issue}>
                    {state.pins.includes(student.id)
                      ? "번호 다시 만들기"
                      : "번호 만들기"}
                  </button>
                </div>
              </fieldset>
            </form>
          </>
        )}
        {tab === "반" && (
          <Table heads={["반", "들어온 날", "나간 날"]}>
            {state.enrollments
              .filter((x: Row) => x.studentId === student.id)
              .map((x: Row) => (
                <tr key={x.id}>
                  <td>
                    {state.classes.find((c: Row) => c.id === x.classId)?.name}
                  </td>
                  <td>{x.joined}</td>
                  <td>{x.left || "계속 다님"}</td>
                </tr>
              ))}
          </Table>
        )}
        {tab === "출결" && (
          <>
            <p className="error">{err}</p>
            <Table heads={["수업 날짜", "출결", "메모", "고친 사람"]}>
              {history.map((x) => (
                <tr key={x.id}>
                  <td>{x.date || x.lessonId.split(":")[1] || date}</td>
                  <td>{statuses[x.status]}</td>
                  <td>{x.note}</td>
                  <td>{x.updatedBy}</td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </div>
    </div>
  );
}
