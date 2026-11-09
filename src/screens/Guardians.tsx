import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Field } from "../ui";
import type { Row } from "../shared";
export function Guardians({
  sid: studentId,
  director,
}: {
  sid: string;
  director: boolean;
}) {
  const [data, setData] = useState<Row>({ guardians: [] }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<Row | null>(null),
    [invite, setInvite] = useState<Row | null>(null);
  const path = `students/${encodeURIComponent(studentId)}/guardians`;
  const load = async () => setData(await api(path));
  useEffect(() => {
    void load().catch((event) => setError(event.message));
  }, [studentId]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (event) {
      setError((event as Error).message);
      if (event instanceof ApiError && event.status === 409) {
        setEdit(null);
        await load().catch((event) => setError(event.message));
      }
    } finally {
      setBusy(false);
    }
  };
  const change = (tail: string, method: string, body?: Row) =>
    run(async () => {
      await api(path + tail, body, method);
      setEdit(null);
      setInvite(null);
      await load();
    });
  return (
    <div className="guardians">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data.possiblyUnder14 && <p className="muted">14세 미만일 수 있음</p>}
      {data.needsConsent && (
        <p className="consent-warning">보호자 동의 확인 필요</p>
      )}
      <button disabled={busy} onClick={() => void run(load)}>
        새로 불러오기
      </button>
      {director && (
        <button
          disabled={busy}
          onClick={() =>
            setEdit({
              name: "",
              relation: "",
              phone: "",
              notify: true,
              isPrimary: false,
            })
          }
        >
          보호자 추가
        </button>
      )}
      {invite && (
        <section aria-label="새 초대 코드">
          <p>이 창을 닫으면 코드를 다시 볼 수 없어요.</p>
          <p className="invite-code">{invite.code}</p>
          <button
            onClick={() =>
              void run(async () => {
                await navigator.clipboard.writeText(invite.code);
              })
            }
          >
            복사
          </button>
          <p>
            끝나는 날짜: {new Date(invite.expiresAt).toLocaleString("ko-KR")}
          </p>
          <p>보호자에게 이 코드와 통합 클라우드 주소를 알려 주세요</p>
          <p>{data.cloudUrl}</p>
          <button onClick={() => setInvite(null)}>코드 닫기</button>
        </section>
      )}
      {edit && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void change(
              edit.id ? `/${edit.id}` : "",
              edit.id ? "PATCH" : "POST",
              edit,
            );
          }}
        >
          <fieldset disabled={busy}>
            <h3>{edit.id ? "보호자 고치기" : "보호자 추가"}</h3>
            {[
              ["name", "이름"],
              ["relation", "관계"],
              ["phone", "전화번호"],
            ].map(([key, setKey]) => (
              <Field key={key} label={setKey}>
                <input
                  required={key !== "relation"}
                  type={key === "phone" ? "tel" : "text"}
                  value={edit[key]}
                  onChange={(event) =>
                    setEdit({ ...edit, [key]: event.target.value })
                  }
                />
              </Field>
            ))}
            <label>
              <input
                type="checkbox"
                checked={edit.isPrimary}
                onChange={(event) =>
                  setEdit({ ...edit, isPrimary: event.target.checked })
                }
              />{" "}
              대표 보호자
            </label>
            <label>
              <input
                type="checkbox"
                checked={edit.notify}
                onChange={(event) =>
                  setEdit({ ...edit, notify: event.target.checked })
                }
              />{" "}
              알림 받기
            </label>
            <div className="toolbar">
              <button className="primary">저장</button>
              <button type="button" onClick={() => setEdit(null)}>
                취소
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {!data.guardians.length && (
        <p className="muted">등록된 보호자가 없어요.</p>
      )}
      {data.guardians.map((guardian: Row) => (
        <section key={guardian.id}>
          <h3>
            {guardian.name} · {guardian.relation || "관계 미입력"}
          </h3>
          <p>{guardian.phone}</p>
          <p>
            {guardian.is_primary ? "대표" : "일반"} · 알림{" "}
            {guardian.notify ? "받기" : "안 받기"} · 계정{" "}
            {guardian.user_id ? "연결됨" : "연결 안 됨"}
          </p>
          {guardian.consents
            .filter((candidate: Row) =>
              ["collect", "messaging"].includes(candidate.item),
            )
            .map((candidate: Row) => (
              <p key={candidate.id} className="muted">
                {candidate.item === "collect"
                  ? "개인정보 수집·이용"
                  : "학원 알림"}{" "}
                · {candidate.version} ·{" "}
                {candidate.withdrawn_at
                  ? "철회함"
                  : candidate.verified
                    ? "확인됨"
                    : "확인 문자 전"}
              </p>
            ))}
          {!guardian.consents.length && <p className="muted">동의 기록 없음</p>}
          {director && (
            <fieldset disabled={busy}>
              <div className="toolbar">
                <button
                  onClick={() =>
                    setEdit({
                      id: guardian.id,
                      rev: guardian.rev,
                      name: guardian.name,
                      relation: guardian.relation,
                      phone: guardian.phone,
                      notify: !!guardian.notify,
                      isPrimary: !!guardian.is_primary,
                    })
                  }
                >
                  고치기
                </button>
                <button
                  onClick={() => {
                    if (confirm("이 보호자 연락처와 동의 기록을 지울까요?"))
                      void change(`/${guardian.id}`, "DELETE");
                  }}
                >
                  지우기
                </button>
                <button
                  onClick={() =>
                    void change(`/${guardian.id}`, "PATCH", {
                      rev: guardian.rev,
                      isPrimary: true,
                    })
                  }
                >
                  대표 정하기
                </button>
                <button
                  onClick={() =>
                    void change(`/${guardian.id}`, "PATCH", {
                      rev: guardian.rev,
                      notify: !guardian.notify,
                    })
                  }
                >
                  알림 {guardian.notify ? "끄기" : "켜기"}
                </button>
                {!guardian.user_id && (
                  <button
                    onClick={() =>
                      void run(async () => {
                        setInvite(
                          await api(`${path}/${guardian.id}/invite`, {}),
                        );
                      })
                    }
                  >
                    초대 코드 만들기
                  </button>
                )}
                {!guardian.user_id && (
                  <button
                    onClick={() =>
                      void change(`/${guardian.id}/invite`, "DELETE")
                    }
                  >
                    초대 취소
                  </button>
                )}
                {!!guardian.user_id && (
                  <button
                    onClick={() => {
                      if (confirm("이 자녀와 계정 연결을 끊을까요?"))
                        void change(`/${guardian.id}/account-link`, "DELETE");
                    }}
                  >
                    계정 연결 끊기
                  </button>
                )}
              </div>
              <p className="muted">
                동의문 날짜: {data.consentVersion}. 서명한 종이를 확인한 뒤
                기록해 주세요.
              </p>
              <div className="toolbar">
                {["collect", "messaging"].map((item) => (
                  <button
                    key={item}
                    onClick={() => {
                      if (confirm("서명한 종이 동의를 확인했나요?"))
                        void change(`/${guardian.id}/consents`, "POST", {
                          item,
                          version: data.consentVersion,
                          method: "paper",
                        });
                    }}
                  >
                    {item === "collect" ? "수집·이용" : "학원 알림"} 종이 동의
                    기록
                  </button>
                ))}
              </div>
            </fieldset>
          )}
        </section>
      ))}
    </div>
  );
}
