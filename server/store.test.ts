import { expect, it } from "vitest";
import { Store } from "./store";
it("기본 키·날짜·학생 색인 조회 및 학원 분리", () => {
  const store = new Store();
  try {
    for (const a of [1,2]) for (const date of ["2026-11-09","2026-11-10"]) store.put(a,"attendance",date,{date,studentId:"s"}, "s");
    store.all = () => { throw Error("전체 읽기 금지"); };
    expect(store.get(1,"attendance","2026-11-09").date).toBe("2026-11-09");
    expect(store.byDay(1,"attendance","2026-11-09")).toHaveLength(1);
    expect(store.byStudent(1,"attendance","s")).toHaveLength(2);
    for (const [sql,args,index] of [
      ["SELECT * FROM records WHERE academy_id=? AND kind=? AND day=?",[1,"attendance","2026-11-09"],"records_day"],
      ["SELECT * FROM records WHERE academy_id=? AND kind=? AND student_id=?",[1,"attendance","s"],"records_student"]
    ] as const) expect(JSON.stringify(store.db.prepare("EXPLAIN QUERY PLAN "+sql).all(...args))).toContain(index);
  } finally { store.close(); }
});
