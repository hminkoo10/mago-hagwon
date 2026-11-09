import { day } from "./lessons";
import { HttpError } from "./http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  randomBytes,
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
export const token = () => randomBytes(32).toString("base64url");
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export class Store {
  db: DatabaseSync;
  key: Buffer;
  constructor(path = ":memory:", secret?: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    if (secret) this.key = createHash("sha256").update(secret).digest();
    else if (path === ":memory:") this.key = randomBytes(32);
    else {
      const p = join(dirname(path), "server.secret");
      if (!existsSync(p))
        writeFileSync(p, randomBytes(32), { mode: 0o600, flag: "wx" });
      this.key = readFileSync(p);
    }
    this.db.exec(
      `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(academy_id INTEGER NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,student_id TEXT,day TEXT,data TEXT NOT NULL,PRIMARY KEY(academy_id,kind,id)); CREATE INDEX IF NOT EXISTS records_day ON records(academy_id,kind,day); CREATE INDEX IF NOT EXISTS records_student ON records(academy_id,kind,student_id); CREATE INDEX IF NOT EXISTS records_kind_id ON records(kind,id); CREATE TABLE IF NOT EXISTS pins(academy_id INTEGER NOT NULL,student_id TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(academy_id,student_id),UNIQUE(academy_id,digest)); CREATE TABLE IF NOT EXISTS sessions(academy_id INTEGER, id TEXT PRIMARY KEY, data TEXT NOT NULL);`,
    );
  }
  all(a: number, k: string): any[] {
    return this.db
      .prepare("SELECT id,data FROM records WHERE academy_id=? AND kind=?")
      .all(a, k)
      .map((r: any) => ({ id: r.id, ...JSON.parse(r.data) }));
  }
  get(a: number, k: string, id: string): any {
    const r: any = this.db.prepare("SELECT id,data FROM records WHERE academy_id=? AND kind=? AND id=?").get(a,k,id);
    return r ? { id: r.id, ...JSON.parse(r.data) } : undefined;
  }
  byDay(a: number, k: string, date: string): any[] {
    return this.db.prepare("SELECT id,data FROM records WHERE academy_id=? AND kind=? AND day=?").all(a,k,date).map((r: any) => ({id:r.id,...JSON.parse(r.data)}));
  }
  byStudent(a: number, k: string, sid: string): any[] {
    return this.db.prepare("SELECT id,data FROM records WHERE academy_id=? AND kind=? AND student_id=?").all(a,k,sid).map((r: any) => ({id:r.id,...JSON.parse(r.data)}));
  }
  checkRev(a: number, k: string, id: string, rev: unknown) {
    const current = this.get(a,k,id)?.rev ?? 0;
    if (!Number.isInteger(rev) || rev !== current)
      throw new HttpError(409, "다른 분이 먼저 고쳤어요. 새로 불러온 뒤 다시 해 주세요.");
  }
  put(a: number, k: string, id: string, v: object, sid: string | null = null) {
    const row = v as any;
    const value = { ...v, rev: (this.get(a,k,id)?.rev ?? 0) + 1 };
    const date = row.date || (row.at ? day(new Date(row.at)) : null);
    this.db
      .prepare(
        "INSERT INTO records(academy_id,kind,id,student_id,day,data) VALUES(?,?,?,?,?,?) ON CONFLICT(academy_id,kind,id) DO UPDATE SET student_id=excluded.student_id,day=excluded.day,data=excluded.data",
      )
      .run(a, k, id, sid, date, JSON.stringify(value));
    return { id, ...value };
  }
  del(a: number, k: string, id: string) {
    this.db
      .prepare("DELETE FROM records WHERE academy_id=? AND kind=? AND id=?")
      .run(a, k, id);
  }
  find(k: string, id: string): any {
    const r: any = this.db
      .prepare("SELECT academy_id,data FROM records WHERE kind=? AND id=?")
      .get(k, id);
    return r ? { id, academy_id: r.academy_id, ...JSON.parse(r.data) } : null;
  }
  purge(a: number, ids: string[]) {
    for (const id of ids) {
      this.db
        .prepare("DELETE FROM records WHERE academy_id=? AND student_id=?")
        .run(a, id);
      this.db
        .prepare("DELETE FROM pins WHERE academy_id=? AND student_id=?")
        .run(a, id);
    }
  }
  digest(a: number, pin: string) {
    return createHmac("sha256", this.key).update(`${a}:${pin}`).digest("hex");
  }
  seal(v: unknown) {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", this.key, iv);
    return Buffer.concat([
      iv,
      c.update(JSON.stringify(v)),
      c.final(),
      c.getAuthTag(),
    ]).toString("base64");
  }
  open(v: string): any {
    const b = Buffer.from(v, "base64"),
      d = createDecipheriv("aes-256-gcm", this.key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(-16));
    return JSON.parse(
      Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString(),
    );
  }
  session(id: string): any {
    const r: any = this.db
      .prepare("SELECT data FROM sessions WHERE id=?")
      .get(hash(id));
    return r ? this.open(r.data) : null;
  }
  saveSession(id: string, v: any) {
    this.db
      .prepare("INSERT OR REPLACE INTO sessions VALUES(?,?,?)")
      .run(v.user.academy?.id ?? null, hash(id), this.seal(v));
  }
  dropSession(id: string) {
    this.db.prepare("DELETE FROM sessions WHERE id=?").run(hash(id));
  }
  close() {
    this.db.close();
  }
}
