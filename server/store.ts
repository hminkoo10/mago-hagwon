import { initBilling, anonymize } from "./billing";
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
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export class Store {
  db: DatabaseSync;
  key: Buffer;
  constructor(path = ":memory:", secret?: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    if (secret) this.key = createHash("sha256").update(secret).digest();
    else if (path === ":memory:") this.key = randomBytes(32);
    else {
      const secretPath = join(dirname(path), "server.secret");
      if (!existsSync(secretPath))
        writeFileSync(secretPath, randomBytes(32), { mode: 0o600, flag: "wx" });
      this.key = readFileSync(secretPath);
    }
    this.db.exec(
      `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(academy_id INTEGER NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,student_id TEXT,day TEXT,data TEXT NOT NULL,PRIMARY KEY(academy_id,kind,id)); CREATE INDEX IF NOT EXISTS records_day ON records(academy_id,kind,day); CREATE INDEX IF NOT EXISTS records_student ON records(academy_id,kind,student_id); CREATE INDEX IF NOT EXISTS records_kind_id ON records(kind,id); CREATE TABLE IF NOT EXISTS pins(academy_id INTEGER NOT NULL,student_id TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(academy_id,student_id),UNIQUE(academy_id,digest)); CREATE TABLE IF NOT EXISTS sessions(academy_id INTEGER, id TEXT PRIMARY KEY, data TEXT NOT NULL);`,
    );
    initBilling(this);
  }
  all(academyId: number, k: string): any[] {
    return this.db
      .prepare("SELECT id,data FROM records WHERE academy_id=? AND kind=?")
      .all(academyId, k)
      .map((response: any) => ({
        id: response.id,
        ...JSON.parse(response.data),
      }));
  }
  get(academyId: number, k: string, id: string): any {
    const response: any = this.db
      .prepare(
        "SELECT id,data FROM records WHERE academy_id=? AND kind=? AND id=?",
      )
      .get(academyId, k, id);
    return response
      ? { id: response.id, ...JSON.parse(response.data) }
      : undefined;
  }
  byDay(academyId: number, k: string, date: string): any[] {
    return this.db
      .prepare(
        "SELECT id,data FROM records WHERE academy_id=? AND kind=? AND day=?",
      )
      .all(academyId, k, date)
      .map((response: any) => ({
        id: response.id,
        ...JSON.parse(response.data),
      }));
  }
  byStudent(academyId: number, k: string, sid: string): any[] {
    return this.db
      .prepare(
        "SELECT id,data FROM records WHERE academy_id=? AND kind=? AND student_id=?",
      )
      .all(academyId, k, sid)
      .map((response: any) => ({
        id: response.id,
        ...JSON.parse(response.data),
      }));
  }
  checkRev(academyId: number, k: string, id: string, rev: unknown) {
    const current = this.get(academyId, k, id)?.rev ?? 0;
    if (!Number.isInteger(rev) || rev !== current)
      throw new HttpError(
        409,
        "다른 분이 먼저 고쳤어요. 새로 불러온 뒤 다시 해 주세요.",
      );
  }
  put(
    academyId: number,
    k: string,
    id: string,
    input: object,
    sid: string | null = null,
  ) {
    const row = input as any;
    const value = { ...input, rev: (this.get(academyId, k, id)?.rev ?? 0) + 1 };
    const date = row.date || (row.at ? day(new Date(row.at)) : null);
    this.db
      .prepare(
        "INSERT INTO records(academy_id,kind,id,student_id,day,data) VALUES(?,?,?,?,?,?) ON CONFLICT(academy_id,kind,id) DO UPDATE SET student_id=excluded.student_id,day=excluded.day,data=excluded.data",
      )
      .run(academyId, k, id, sid, date, JSON.stringify(value));
    return { id, ...value };
  }
  del(academyId: number, k: string, id: string) {
    this.db
      .prepare("DELETE FROM records WHERE academy_id=? AND kind=? AND id=?")
      .run(academyId, k, id);
  }
  find(k: string, id: string): any {
    const response: any = this.db
      .prepare("SELECT academy_id,data FROM records WHERE kind=? AND id=?")
      .get(k, id);
    return response
      ? { id, academy_id: response.academy_id, ...JSON.parse(response.data) }
      : null;
  }
  purge(academyId: number, ids: string[]) {
    anonymize(this, academyId, ids);
    for (const id of ids) {
      this.db
        .prepare("DELETE FROM records WHERE academy_id=? AND student_id=?")
        .run(academyId, id);
      this.db
        .prepare("DELETE FROM pins WHERE academy_id=? AND student_id=?")
        .run(academyId, id);
    }
  }
  digest(academyId: number, pin: string) {
    return createHmac("sha256", this.key)
      .update(`${academyId}:${pin}`)
      .digest("hex");
  }
  seal(value: unknown) {
    const iv = randomBytes(12),
      candidate = createCipheriv("aes-256-gcm", this.key, iv);
    return Buffer.concat([
      iv,
      candidate.update(JSON.stringify(value)),
      candidate.final(),
      candidate.getAuthTag(),
    ]).toString("base64");
  }
  open(value: string): any {
    const input = Buffer.from(value, "base64"),
      d = createDecipheriv("aes-256-gcm", this.key, input.subarray(0, 12));
    d.setAuthTag(input.subarray(-16));
    return JSON.parse(
      Buffer.concat([d.update(input.subarray(12, -16)), d.final()]).toString(),
    );
  }
  session(id: string): any {
    const response: any = this.db
      .prepare("SELECT data FROM sessions WHERE id=?")
      .get(hash(id));
    return response ? this.open(response.data) : null;
  }
  saveSession(id: string, value: any) {
    this.db
      .prepare("INSERT OR REPLACE INTO sessions VALUES(?,?,?)")
      .run(value.user.academy?.id ?? null, hash(id), this.seal(value));
  }
  dropSession(id: string) {
    this.db.prepare("DELETE FROM sessions WHERE id=?").run(hash(id));
  }
  close() {
    this.db.close();
  }
}
