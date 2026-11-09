import { api } from "../api";
import { Table } from "../ui";
import { type Row } from "../shared";
type Props = {
  st: Row;
  settings: Row | null;
  code: string;
  run: (fn: () => Promise<any>) => Promise<void>;
  save: (p: string, v: unknown) => Promise<void>;
  refresh: () => Promise<void>;
  Pins: (v: Row[]) => void;
  Code: (v: string) => void;
};
export function Settings({st, settings, code, run, save, refresh, Pins, Code}: Props) {
 return (
          <>
            <section>
              <h2>강의실</h2>
              <div className="chips">
                {st.rooms.map((r: Row) => (
                  <span className="badge" key={r.id}>
                    {r.name}
                  </span>
                ))}
              </div>
              <form
                className="toolbar"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(() => save("rooms", { name: f.get("name") }));
                  e.currentTarget.reset();
                }}
              >
                <input
                  aria-label="새 강의실 이름"
                  name="name"
                  required
                  placeholder="강의실 이름"
                />
                <button>강의실 넣기</button>
              </form>
            </section>
            <section>
              <div className="toolbar">
                <h2>태블릿 기기</h2>
                <button
                  className="primary"
                  onClick={() =>
                    void run(async () =>
                      Code((await api("devices/code", {})).code),
                    )
                  }
                >
                  태블릿 등록 번호 만들기
                </button>
              </div>
              {code && (
                <p role="status">
                  등록 번호 <strong>{code}</strong> · 10분 안에 한 번만 쓸 수
                  있어요.
                </p>
              )}
              <p className="muted">
                태블릿에서 이 주소의{" "}
                <a href="/kiosk" target="_blank" rel="noreferrer">
                  태블릿 출결
                </a>
                을 열고 번호를 넣어요.
              </p>
              <Table heads={["기기 이름", "마지막 접속", "사용 여부", "관리"]}>
                {settings?.devices.map((d: Row) => (
                  <tr key={d.id}>
                    <td>
                      <input
                        aria-label="기기 이름"
                        defaultValue={d.name}
                        onBlur={(e) => {
                          if (e.target.value !== d.name)
                            void run(() =>
                              save("devices", { ...d, name: e.target.value }),
                            );
                        }}
                      />
                    </td>
                    <td>{new Date(d.lastSeen).toLocaleString("ko-KR")}</td>
                    <td>{d.disabled ? "꺼짐" : "사용 중"}</td>
                    <td>
                      <button
                        disabled={d.disabled}
                        onClick={() =>
                          void run(() =>
                            save("devices", { ...d, disabled: true }),
                          )
                        }
                      >
                        끄기
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            </section>
            <section>
              <h2>학생 번호</h2>
              <p>
                번호는 학원 안에서 겹치지 않는 숫자 4자리예요. 만든 직후 한 번만
                보여요.
              </p>
              <button
                onClick={() =>
                  void run(async () => {
                    Pins((await api("pins", {})).pins);
                    await refresh();
                  })
                }
              >
                없는 번호 모두 만들기
              </button>
            </section>
          </>
 );
}
