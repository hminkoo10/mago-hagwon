import { api } from "../api";
import { Table } from "../ui";
import { type Row } from "../shared";
type Props = {
  st: Row;
  director: boolean;
  date: string;
  info: (id: string) => Row;
  run: (fn: () => Promise<any>) => Promise<void>;
  refresh: () => Promise<void>;
  Q: (v: Row | undefined) => void;
  Pins: (v: Row[]) => void;
};
export function Students({st, director, date, info, run, refresh, Q, Pins}: Props) {
 return (
          <section>
            <div className="toolbar">
              <h2>학생 {st.students.length}명</h2>
              {director && (
                <button
                  onClick={() =>
                    void run(async () => {
                      Pins((await api("pins", {})).pins);
                      await refresh();
                    })
                  }
                >
                  없는 번호 만들기
                </button>
              )}
            </div>
            <Table
              heads={[
                "이름",
                "학교 · 학년",
                "재원 상태",
                "태블릿 번호",
                "들어 있는 반",
              ]}
            >
              {st.students.map((x: Row) => (
                <tr key={x.id}>
                  <td>
                    <button className="link" onClick={() => Q(x)}>
                      {x.name}
                    </button>
                  </td>
                  <td>
                    {x.school} · {x.grade}
                  </td>
                  <td>
                    {
                      ({ active: "재원", paused: "휴원", left: "퇴원" } as Row)[
                        info(x.id).status
                      ]
                    }
                  </td>
                  <td>{st.pins.includes(x.id) ? "발급함" : "아직 없음"}</td>
                  <td>
                    {st.enrollments
                      .filter(
                        (e: Row) =>
                          e.studentId === x.id &&
                          e.joined <= date &&
                          (!e.left || e.left >= date),
                      )
                      .map(
                        (e: Row) =>
                          st.classes.find((c: Row) => c.id === e.classId)?.name,
                      )
                      .join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </Table>
            {!st.students.length && (
              <p className="empty">
                통합 클라우드 학생 명단에서 학생을 넣어 주세요.
              </p>
            )}
          </section>
 );
}
