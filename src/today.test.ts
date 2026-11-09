import { expect, it } from "vitest";
import { todaySummary } from "./today";
const date="2026-11-09";
it("등원·아직·결석 중복 없음·휴강 제외·시작 전 목록 제외", () => {
 const state={
 students:["a","b","c","d","e"].map(id=>({id})),
 lessons:[{id:"l",classId:"c",date,start:"16:00"},{id:"future",classId:"f",date,start:"20:00"},{id:"cancel",classId:"x",date,start:"12:00",kind:"cancelled"}],
 enrollments:[...["a","b","c"].map(studentId=>({classId:"c",studentId,joined:date})),{classId:"f",studentId:"d",joined:date},{classId:"x",studentId:"e",joined:date}],
 attendance:[{lessonId:"l",studentId:"b",status:"absent"},{lessonId:"l",studentId:"a",status:"absent"},{lessonId:"cancel",studentId:"e",status:"absent"}],
 checkins:[{studentId:"a",kind:"in"}]
 };
 const result=todaySummary(state,date,Date.parse(date+"T17:00:00+09:00"));
 expect([...result.arrived]).toEqual(["a"]);
 expect([...result.absent]).toEqual(["b"]);
 expect([...result.pending]).toEqual(["c","d"]);
 expect(result.overdue).toEqual(["c"]);
 expect(result.expected.size).toBe(result.arrived.size+result.absent.size+result.pending.size);
});
