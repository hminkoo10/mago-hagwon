import React from "react";
import { Table } from "../ui";
import { type Row, subjects, weekday } from "../shared";
type Props = {
  st: Row;
  director: boolean;
  user: Row;
  date: string;
  week: Row[];
  filter: string;
  room: string;
  teacherName: (id: string) => string;
  L: (v: string) => void;
  P: (v: string) => void;
  D: (v: string) => void;
  F: (v: string) => void;
  R: (v: string) => void;
  C: (v: Row) => void;
};
export function Timetable({st, director, user, date, week, filter, room, teacherName, L, P, D, F, R, C}: Props) {
 const visibleWeek = week.filter(l => (!filter || l.teacherId === filter) && (!room || l.room === room));
 const first = visibleWeek.length ? Math.max(0, Math.min(...visibleWeek.map(l => Number(l.start.slice(0,2)))) - 1) : 14;
 const last = visibleWeek.length ? Math.min(24, Math.max(...visibleWeek.map(l => Math.ceil(Number(l.end.slice(0,2)) + Number(l.end.slice(3))/60))) + 1) : 22;
 return (
          <>
            <div className="toolbar">
              <select
                aria-label="선생님별 보기"
                value={filter}
                onChange={(e) => F(e.target.value)}
              >
                <option value="">모든 선생님</option>
                {st.members.map((x: Row) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="강의실별 보기"
                value={room}
                onChange={(e) => R(e.target.value)}
              >
                <option value="">모든 강의실</option>
                {st.rooms.map((x: Row) => (
                  <option key={x.id}>{x.name}</option>
                ))}
              </select>
              {director && (
                <button
                  className="primary"
                  onClick={() =>
                    C({
                      name: "",
                      subject:
                        (user.academy.subjects ?? ["math"])[0] || "other",
                      teacherId: user.id,
                      room: "",
                      startDate: date,
                      endDate: "",
                      note: "",
                      times: [
                        { weekday: 1, start: "16:00", end: "17:00", room: "" },
                      ],
                    })
                  }
                >
                  반 만들기
                </button>
              )}
            </div>
            <section>
              <h2>한 주 시간표</h2>
              <div className="week-scroll">
                <div className="week">
                  <div className="week-head">시간</div>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                    <div key={d} className="week-head">
                      {weekday[d]}
                    </div>
                  ))}
                  {Array.from({ length: last - first }, (_, i) => first + i).map((h) => (
                    <React.Fragment key={h}>
                      <div className="hour">
                        {String(h).padStart(2, "0")}:00
                      </div>
                      {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                        <div className="week-cell" key={d}>
                          {week
                            .filter(
                              (l) =>
                                new Date(l.date + "T12:00:00Z").getUTCDay() ===
                                  d &&
                                Number(l.start.slice(0, 2)) === h &&
                                (!filter || l.teacherId === filter) &&
                                (!room || l.room === room),
                            )
                            .map((l) => (
                              <button
                                key={l.id}
                                className={"lesson " + l.subject}
                                onClick={() => {
                                  D(l.date);
                                  L(l.id);
                                  P("출결");
                                }}
                              >
                                <b>{l.name}</b>
                                <br />
                                {l.start}~{l.end}
                                <br />
                                {teacherName(l.teacherId)} · {l.room}
                                {l.kind !== "regular" && (
                                  <span>
                                    {" "}
                                    · {l.kind === "cancelled" ? "휴강" : "보강"}
                                  </span>
                                )}
                              </button>
                            ))}
                        </div>
                      ))}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </section>
            <section>
              <h2>반 목록</h2>
              <Table heads={["반 이름", "과목", "선생님", "학생", "관리"]}>
                {st.classes.map((c: Row) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>
                      <span className={"badge " + c.subject}>
                        {subjects[c.subject]}
                      </span>
                    </td>
                    <td>{teacherName(c.teacherId)}</td>
                    <td>
                      {
                        st.enrollments.filter(
                          (x: Row) =>
                            x.classId === c.id &&
                            x.joined <= date &&
                            (!x.left || x.left >= date),
                        ).length
                      }
                      명
                    </td>
                    <td>
                      <button onClick={() => C({ ...c, readOnly: !director })}>
                        {director ? "반 고치기" : "반 보기"}
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            </section>
          </>
 );
}
