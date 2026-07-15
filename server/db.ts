/**
 * Persistence: one SQLite file via Node's built-in node:sqlite — no native
 * npm dependency to compile. Shows are stored as JSON blobs; the clock uses
 * absolute epoch timestamps, so a running show survives a server restart
 * with the correct elapsed time.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ShowStateSchema } from "../shared/protocol";
import type { StoredShow } from "./show";

export class ShowRepo {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "hahaplan.db"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shows (
        id         TEXT PRIMARY KEY,
        host_token TEXT NOT NULL,
        json       TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  loadAll(): StoredShow[] {
    const rows = this.db
      .prepare("SELECT host_token, json FROM shows")
      .all() as Array<{ host_token: string; json: string }>;
    const shows: StoredShow[] = [];
    for (const row of rows) {
      const parsed = ShowStateSchema.safeParse(JSON.parse(row.json));
      if (parsed.success) {
        shows.push({ state: parsed.data, hostToken: row.host_token });
      } else {
        console.warn("Skipping corrupt show row:", parsed.error.message);
      }
    }
    return shows;
  }

  save(show: StoredShow): void {
    this.db
      .prepare(`
        INSERT INTO shows (id, host_token, json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at
      `)
      .run(show.state.id, show.hostToken, JSON.stringify(show.state), Date.now());
  }
}
