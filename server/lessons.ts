import type { Store } from "./store";
export const day = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
export const stamp = (date: string, time: string) =>
  Date.parse(`${date}T${time}:00+09:00`);
export function lessons(store: Store, a: number, date: string) {
  const weekday = new Date(date + "T12:00:00+09:00").getUTCDay();
  const result: any[] = [];
  for (const c of store.all(a, "classes")) {
    if (date < c.startDate || (c.endDate && date > c.endDate)) continue;
    for (const t of c.times) {
      if (t.weekday !== weekday) continue;
      const id = `${c.id}:${date}:${t.id}`;
      const ex = store.get(a, "lessons", id);
      result.push({
        ...c,
        ...t,
        room: t.room || c.room,
        id,
        classId: c.id,
        date,
        kind: ex?.kind ?? "regular",
      });
    }
  }
  for (const ex of store
    .byDay(a, "lessons", date)
    .filter((x) => x.date === date && (x.kind === "makeup" || x.isMakeup))) {
    const c = store.get(a, "classes", ex.classId);
    if (c) result.push({ ...c, ...ex, room: ex.room || c.room });
  }
  return result.sort((a, b) => a.start.localeCompare(b.start));
}
export function automaticStatus(
  arrival: number,
  start: number,
  end: number,
  manual: boolean,
) {
  if (manual || arrival < start - 60 * 60000 || arrival > end) return null;
  return arrival <= start + 10 * 60000 ? "present" : "late";
}
export function members(store: Store, a: number, l: any) {
  return store
    .all(a, "enrollments")
    .filter(
      (x) =>
        x.classId === l.classId &&
        x.joined <= l.date &&
        (!x.left || x.left >= l.date),
    );
}
export function autoAttend(store: Store, a: number, sid: string, at: string) {
  for (const l of lessons(store, a, day(new Date(at)))) {
    if (
      l.kind === "cancelled" ||
      !members(store, a, l).some((x) => x.studentId === sid)
    )
      continue;
    const id = `${l.id}:${sid}`,
      old = store.get(a, "attendance", id);
    const status = automaticStatus(
      Date.parse(at),
      stamp(l.date, l.start),
      stamp(l.date, l.end),
      !!old?.manual,
    );
    if (status && !old)
      store.put(
        a,
        "attendance",
        id,
        {
          classId: l.classId,
          date: l.date,
          lessonId: l.id,
          studentId: sid,
          status,
          manual: false,
          note: "",
          updatedBy: "태블릿 출결",
          updatedAt: at,
        },
        sid,
      );
  }
}
