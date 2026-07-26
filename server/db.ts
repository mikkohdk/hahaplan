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
        transcript TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      )
    `);
    // Migrate older DBs that predate the transcript column.
    try {
      this.db.exec("ALTER TABLE shows ADD COLUMN transcript TEXT NOT NULL DEFAULT ''");
    } catch {
      // Column already exists — fine.
    }
  }

  loadAll(): StoredShow[] {
    const rows = this.db
      .prepare("SELECT host_token, json, transcript FROM shows")
      .all() as Array<{ host_token: string; json: string; transcript: string }>;
    const shows: StoredShow[] = [];
    for (const row of rows) {
      const parsed = ShowStateSchema.safeParse(JSON.parse(row.json));
      if (parsed.success) {
        shows.push({
          state: parsed.data,
          hostToken: row.host_token,
          transcript: row.transcript ?? "",
        });
      } else {
        console.warn("Skipping corrupt show row:", parsed.error.message);
      }
    }
    return shows;
  }

  save(show: StoredShow): void {
    this.db
      .prepare(`
        INSERT INTO shows (id, host_token, json, transcript, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          json = excluded.json,
          transcript = excluded.transcript,
          updated_at = excluded.updated_at
      `)
      .run(
        show.state.id,
        show.hostToken,
        JSON.stringify(show.state),
        show.transcript,
        Date.now(),
      );
  }
}
