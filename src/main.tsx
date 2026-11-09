import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { api, ApiError } from "./api";
import { Table } from "./ui";
import { type Row, today } from "./shared";
import { Today } from "./screens/Today";
import { Attendance } from "./screens/Attendance";
import { Timetable } from "./screens/Timetable";
import { Students } from "./screens/Students";
import { Settings } from "./screens/Settings";
import { ClassEditor } from "./screens/ClassEditor";
import { StudentDialog } from "./screens/StudentDialog";
import { Tablet } from "./screens/Kiosk";
function App() {
  const [user, U] = useState<Row | null>(null),
    [state, S] = useState<Row | null>(null),
    [page, P] = useState("오늘"),
    [date, D] = useState(today()),
    [error, E] = useState(""),
    [busy, B] = useState(false),
    [selected, Q] = useState<Row | null>(null),
    [editClass, C] = useState<Row | null>(null),
    [lesson, L] = useState(""),
    [filter, F] = useState(""),
    [room, R] = useState(""),
    [week, W] = useState<Row[]>([]),
    [settings, G] = useState<Row | null>(null),
    [code, Code] = useState(""),
    [pins, Pins] = useState<Row[]>([]);
  const director = user?.role === "director";
  const refresh = async () => {
    const me = await api("me");
    U(me.user);
    if (me.user.academy && ["director", "teacher"].includes(me.user.role)) {
      const data = await api("state?date=" + date);
      S(data);
      if (page === "운영 설정") G(await api("settings"));
      if (page === "반·시간표") {
        const dt = new Date(date + "T12:00:00Z");
        dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
        W((await api("week?date=" + dt.toISOString().slice(0, 10))).lessons);
      }
    }
  };
  const run = async (fn: () => Promise<any>) => {
    B(true);
    E("");
    try {
      return await fn();
    } catch (e) {
      E((e as Error).message);
      if (e instanceof ApiError && e.status === 409) { C(null); Q(null); await refresh(); }
    } finally {
      B(false);
    }
  };
  const save = async (path: string, data: unknown) => {
    const saved = await api(path, data);
    await refresh();
    return saved;
  };
  useEffect(() => {
    void run(refresh);
  }, [date, page]);
  useEffect(() => {
    const id = setInterval(() => {
      api("me")
        .then((x) => U(x.user))
        .catch((e) => {
          U(null);
          S(null);
          E(e.message);
        });
    }, 600000);
    return () => clearInterval(id);
  }, []);
  if (!user)
    return (
      <div className="login">
        <div className="brand">
          <b className="mark">마</b> 마고 학원운영
        </div>
        <h1>학원 하루를 한곳에서</h1>
        <p>통합 클라우드 계정으로 시작해요.</p>
        <a className="primary button" href="/api/auth/mago">
          통합 클라우드로 로그인
        </a>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  if (
    user.role === "student" ||
    !user.academy ||
    !["director", "teacher"].includes(user.role)
  )
    return (
      <div className="login">
        <h1>마고 학원운영</h1>
        <p>
          {user.role === "student"
            ? "학생은 이 프로그램을 쓰지 않아요"
            : "학원에 속한 원장·선생님만 사용할 수 있어요."}
        </p>
        <form action="/api/auth/logout" method="post">
          <button>로그아웃</button>
        </form>
      </div>
    );
  if (!state)
    return (
      <div className="login" role="status">
        {error || "명단을 불러오고 있어요."}
        <button onClick={() => void run(refresh)}>다시 불러오기</button>
      </div>
    );
  const st = state,
    studentName = (id: string) =>
      st.students.find((x: Row) => x.id === id)?.name || "명단에서 지운 학생",
    teacherName = (id: string) =>
      st.members.find((x: Row) => x.id === id)?.name || "선생님",
    info = (id: string) =>
      st.info.find((x: Row) => x.id === id) || { status: "active" },
    enrolled = (l: Row) =>
      st.enrollments.filter(
        (x: Row) =>
          x.classId === l.classId &&
          x.joined <= date &&
          (!x.left || x.left >= date) &&
          st.students.some((s: Row) => s.id === x.studentId),
      ),
    attendance = (l: Row, id: string) =>
      st.attendance.find((x: Row) => x.lessonId === l.id && x.studentId === id),
    chosen = st.lessons.find((l: Row) => l.id === lesson) || st.lessons[0];
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <b className="mark">마</b>
          <strong>마고 학원운영</strong>
        </div>
        <nav aria-label="주 메뉴">
          {[
            "오늘",
            "출결",
            "반·시간표",
            "학생",
            ...(director ? ["운영 설정"] : []),
          ].map((p, i) => (
            <button
              className={p === page ? "active" : ""}
              key={p}
              onClick={() => P(p)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d={
                    [
                      "M3 10 12 3l9 7v11H3ZM9 21v-8h6v8",
                      "M4 5h16v16H4ZM3 10h18M8 3v4m8-4v4M8 15l3 3 5-5",
                      "M3 4h18v17H3ZM8 4v17m7-17v17M3 10h18m-18 5h18",
                      "M8 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 22v-4a6 6 0 0 1 12 0v4M17 3v8m-4-4h8",
                      "M4 7h16M4 12h16M4 17h16",
                    ][i]
                  }
                />
              </svg>
              {p}
            </button>
          ))}
        </nav>
        <footer>
          {user.academy.name}
          <br />
          {user.name} · {director ? "원장" : "선생님"}
          <form action="/api/auth/logout" method="post">
            <button>로그아웃</button>
          </form>
        </footer>
      </aside>
      <main>
        <header>
          <div>
            <h1>{page}</h1>
            <p className="muted">
              {
                (
                  {
                    오늘: "오늘 수업과 아직 안 온 학생을 확인해요.",
                    출결: "모두 출석으로 바꾼 뒤, 다른 학생만 고쳐요.",
                    "반·시간표": "반과 한 주 수업 시간을 함께 봐요.",
                    학생: "통합 클라우드 명단에 운영 정보를 붙여요.",
                    "운영 설정": "강의실과 태블릿을 준비해요.",
                  } as Row
                )[page]
              }
            </p>
          </div>
          <div className="actions">
            <input
              aria-label="기준 날짜"
              type="date"
              value={date}
              onChange={(e) => D(e.target.value)}
            />
            <button disabled={busy} onClick={() => void run(refresh)}>
              새로 불러오기
            </button>
          </div>
        </header>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {page === "오늘" && <Today st={st} date={date} studentName={studentName} teacherName={teacherName} enrolled={enrolled} attendance={attendance} L={L} P={P} Q={(v) => Q(v || null)} />}
        {page === "출결" && <Attendance st={st} date={date} busy={busy} chosen={chosen} studentName={studentName} enrolled={enrolled} attendance={attendance} run={run} save={save} L={L} Q={(v) => Q(v || null)} />}
        {page === "반·시간표" && <Timetable st={st} director={director} user={user} date={date} week={week} filter={filter} room={room} teacherName={teacherName} L={L} P={P} D={D} F={F} R={R} C={C} />}
        {page === "학생" && <Students st={st} director={director} date={date} info={info} run={run} refresh={refresh} Q={(v) => Q(v || null)} Pins={Pins} />}
        {page === "운영 설정" && director && <Settings st={st} settings={settings} code={code} run={run} save={save} refresh={refresh} Pins={Pins} Code={Code} />}
        {pins.length > 0 && (
          <div className="overlay">
            <div className="modal">
              <h2>새 학생 번호</h2>
              <p>이 창을 닫으면 다시 볼 수 없어요. 학생에게 알려 주세요.</p>
              <Table heads={["학생", "번호"]}>
                {pins.map((x) => (
                  <tr key={x.studentId}>
                    <td>{studentName(x.studentId)}</td>
                    <td>
                      <strong>{x.pin}</strong>
                    </td>
                  </tr>
                ))}
              </Table>
              <button onClick={() => Pins([])}>닫기</button>
            </div>
          </div>
        )}
        {editClass && (
          <ClassEditor
            value={editClass}
            state={st}
            busy={busy}
            close={() => C(null)}
            submit={(v) =>
              void run(async () => {
                await save("classes", v);
                C(null);
              })
            }
            save={(p, v) => run(() => save(p, v))}
            date={date}
          />
        )}
        {selected && (
          <StudentDialog
            student={selected}
            state={st}
            date={date}
            director={director}
            close={() => Q(null)}
            save={(p, v) => run(() => save(p, v))}
            issue={() =>
              void run(async () => {
                Pins((await api("pins", { studentId: selected.id })).pins);
                Q(null);
                await refresh();
              })
            }
          />
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  location.pathname === "/kiosk" ? <Tablet /> : <App />,
);

