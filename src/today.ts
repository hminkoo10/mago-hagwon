import type { Row } from "./shared";
export function todaySummary(state: Row, date: string, now: number) {
  const lessons = state.lessons.filter((l: Row) => l.kind !== "cancelled" && l.date === date);
  const members = (l: Row): Row[] => state.enrollments.filter((x: Row) => x.classId === l.classId && x.joined <= date && (!x.left || x.left >= date) && state.students.some((s: Row) => s.id === x.studentId));
  const expected = new Set<string>(lessons.flatMap((l: Row) => members(l).map(x => x.studentId)));
  const arrived = new Set<string>([...expected].filter(id => state.checkins.some((x: Row) => x.studentId === id && x.kind === "in")));
  const absent = new Set<string>([...expected].filter(id => !arrived.has(id) && state.attendance.some((x: Row) => x.studentId === id && x.status === "absent" && lessons.some((l: Row) => l.id === x.lessonId))));
  const pending = new Set([...expected].filter(id => !arrived.has(id) && !absent.has(id)));
  const overdue = [...pending].filter(id => lessons.some((l: Row) => Date.parse(date + "T" + l.start + ":00+09:00") < now && members(l).some(x => x.studentId === id)));
  return { expected, arrived, absent, pending, overdue };
}
