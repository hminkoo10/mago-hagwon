import { Table } from "../ui";
import { type Row, statuses } from "../shared";
type Props = {
  st: Row;
  date: string;
  busy: boolean;
  chosen: Row | undefined;
  studentName: (id: string) => string;
  enrolled: (l: Row) => Row[];
  attendance: (l: Row, id: string) => Row | undefined;
  run: (fn: () => Promise<any>) => Promise<void>;
  save: (p: string, v: unknown) => Promise<void>;
  L: (v: string) => void;
  Q: (v: Row | undefined) => void;
};
export function Attendance({st, date, busy, chosen, studentName, enrolled, attendance, run, save, L, Q}: Props) {
 return (
          <section className="attendance">
            <div className="toolbar">
              <select
                aria-label="수업 고르기"
                value={chosen?.id || ""}
                onChange={(e) => L(e.target.value)}
              >
                {st.lessons.map((l: Row) => (
                  <option key={l.id} value={l.id}>
                    {l.name} · {l.start}{" "}
                    {l.kind === "cancelled" ? "(휴강)" : ""}
                  </option>
                ))}
              </select>
              {chosen && chosen.kind !== "cancelled" && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      save("attendance", {
                        date,
                        lessonId: chosen.id,
                        status: "present",
                        all: true,
                        revs: Object.fromEntries(enrolled(chosen).map(x => [x.studentId, attendance(chosen, x.studentId)?.rev ?? 0])),
                      }),
                    )
                  }
                >
                  모두 출석으로
                </button>
              )}
            </div>
            {chosen && chosen.kind !== "cancelled" ? (
              <Table heads={["학생", "등원 시각", "출결", "메모", "고친 기록"]}>
                {enrolled(chosen).map((x: Row) => {
                  const at = attendance(chosen, x.studentId);
                  return (
                    <tr key={x.id}>
                      <td>
                        <button
                          className="link"
                          onClick={() =>
                            Q(
                              st.students.find(
                                (s: Row) => s.id === x.studentId,
                              ),
                            )
                          }
                        >
                          {studentName(x.studentId)}
                        </button>
                      </td>
                      <td>
                        {st.checkins
                          .filter(
                            (c: Row) =>
                              c.studentId === x.studentId && c.kind === "in",
                          )
                          .map((c: Row) =>
                            new Date(c.at).toLocaleTimeString("ko-KR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            }),
                          )
                          .join(", ") || "—"}
                      </td>
                      <td>
                        <div
                          className="segments"
                          role="group"
                          aria-label={studentName(x.studentId) + " 출결"}
                        >
                          {Object.entries(statuses).map(([k, v]) => (
                            <button
                              key={k}
                              aria-pressed={(at?.status || "none") === k}
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  save("attendance", {
                                    date,
                                    lessonId: chosen.id,
                                    studentId: x.studentId,
                                    rev: at?.rev ?? 0,
                                    status: k,
                                    note: at?.note || "",
                                  }),
                                )
                              }
                            >
                              {v}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td>
                        <input
                          key={at?.updatedAt || x.id}
                          aria-label={studentName(x.studentId) + " 메모"}
                          defaultValue={at?.note || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (at?.note || ""))
                              void run(() =>
                                save("attendance", {
                                  date,
                                  lessonId: chosen.id,
                                  studentId: x.studentId,
                                  rev: at?.rev ?? 0,
                                  status: at?.status || "none",
                                  note: e.target.value,
                                }),
                              );
                          }}
                        />
                      </td>
                      <td className="muted">
                        {at
                          ? `${at.updatedBy} · ${new Date(at.updatedAt).toLocaleString("ko-KR")}`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            ) : (
              <p className="empty">출결을 적을 수업이 없어요.</p>
            )}
          </section>
 );
}
