import { todaySummary } from "../today";
import { Table } from "../ui";
import { type Row } from "../shared";
type Props = {
  st: Row;
  date: string;
  studentName: (id: string) => string;
  teacherName: (id: string) => string;
  enrolled: (l: Row) => Row[];
  attendance: (l: Row, id: string) => Row | undefined;
  L: (v: string) => void;
  P: (v: string) => void;
  Q: (v: Row | undefined) => void;
};
export function Today({st, date, studentName, teacherName, enrolled, attendance, L, P, Q}: Props) {
 const summary = todaySummary(st, date, Date.now());
 return (
          <>
            <div className="stats">
              {[
                [
                  "오늘 수업",
                  `${st.lessons.filter((l: Row) => l.kind !== "cancelled").length}개 수업`,
                  `${new Set(st.lessons.map((l: Row) => l.classId)).size}개 반`,
                ],
                [
                  "등원",
                  `${summary.arrived.size}명 · 아직 ${summary.pending.size}명`,
                  "오늘 수업 학생 기준",
                ],
                ["결석", `${summary.absent.size}명`, "출석부에 적힌 학생"],
              ].map(([t, n, s]) => (
                <section key={t}>
                  <span>{t}</span>
                  <strong>{n}</strong>
                  <small>{s}</small>
                </section>
              ))}
            </div>
            <section>
              <h2>오늘 수업</h2>
              <Table heads={["반 이름", "시간", "선생님", "강의실", "출석"]}>
                {st.lessons.map((l: Row) => (
                  <tr key={l.id}>
                    <td>
                      <button
                        className="link"
                        onClick={() => {
                          L(l.id);
                          P("출결");
                        }}
                      >
                        {l.name}
                      </button>
                      {l.kind === "cancelled" && (
                        <span className="badge">휴강</span>
                      )}
                      {l.kind === "makeup" && (
                        <span className="badge">보강</span>
                      )}
                    </td>
                    <td>
                      {l.start}~{l.end}
                    </td>
                    <td>{teacherName(l.teacherId)}</td>
                    <td>{l.room || "—"}</td>
                    <td>
                      <span className="badge good">
                        {
                          enrolled(l).filter((x: Row) =>
                            ["present", "late", "early"].includes(
                              attendance(l, x.studentId)?.status,
                            ),
                          ).length
                        }
                        /{enrolled(l).length}
                      </span>
                    </td>
                  </tr>
                ))}
              </Table>
              {!st.lessons.length && (
                <p className="empty">오늘 수업이 없어요.</p>
              )}
            </section>
            <section>
              <h2>아직 안 온 학생</h2>
              <div className="chips">
                {summary.overdue.map((id: any) => (
                  <button
                    key={id}
                    onClick={() => Q(st.students.find((s: Row) => s.id === id))}
                  >
                    {studentName(id)}
                  </button>
                ))}
              </div>
              <p className="muted">
                시작 시간이 지났고 등원 기록이 없는 학생이에요.
              </p>
            </section>
          </>
 );
}
