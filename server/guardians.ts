import type { Store } from "./store";
import { lessons, members, day } from "./lessons";

export function consentStatus(
  birthYear: number | null | undefined,
  consents: {
    item: string;
    verified?: boolean;
    withdrawn_at?: number | null;
  }[],
  year: number,
) {
  const possiblyUnder14 =
    Number.isInteger(birthYear) &&
    Number(birthYear) >= 1900 &&
    Number(birthYear) <= year &&
    year - Number(birthYear) <= 14;
  return {
    possiblyUnder14,
    needsConsent:
      possiblyUnder14 &&
      !consents.some(
        (candidate) =>
          candidate.item === "collect" &&
          candidate.verified === true &&
          !candidate.withdrawn_at,
      ),
  };
}

export function guardianAttendance(
  store: Store,
  academy: number,
  sid: string,
  month: string,
) {
  const result = [];
  const checkins = store.byStudent(academy, "checkins", sid);
  const dates =
    month.length === 10
      ? [month]
      : Array.from(
          { length: 31 },
          (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
        );
  for (const date of dates) {
    if (new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date)
      continue;
    const checks = checkins
      .filter((item) => day(new Date(item.at)) === date)
      .sort((academyId, input) => academyId.at.localeCompare(input.at));
    for (const lesson of lessons(store, academy, date)) {
      if (
        lesson.kind === "cancelled" ||
        !members(store, academy, lesson).some((item) => item.studentId === sid)
      )
        continue;
      const att = store.get(academy, "attendance", `${lesson.id}:${sid}`);
      result.push({
        date,
        className: lesson.name,
        start: lesson.start,
        end: lesson.end,
        status: att?.status ?? "none",
        arrival: checks.find((item) => item.kind === "in")?.at ?? null,
        departure:
          checks.filter((item) => item.kind === "out").at(-1)?.at ?? null,
      });
    }
  }
  return result;
}
