export type Row = Record<string, any>;
export const subjects: Row = {
    math: "수학",
    english: "영어",
    korean: "국어",
    other: "기타",
  },
  statuses: Row = {
    none: "아직 없음",
    present: "출석",
    late: "지각",
    absent: "결석",
    early: "조퇴",
  };
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const weekday = ["일", "월", "화", "수", "목", "금", "토"];
