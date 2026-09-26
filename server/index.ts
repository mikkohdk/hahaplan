/**
 * hahaplan server — P0.1
 * Holds show state + the master clock, and broadcasts the FULL show state to
 * every connected client on every change (the state is tiny, and this makes
 * reconnect identical to connect — resilience for free).
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import type { WebSocket } from "ws";
import { z } from "zod";
import {
  ClientMessageSchema,
  type ServerMessage,
  type ShowState,
} from "../shared/protocol";
import { ShowRepo } from "./db";
import {
  ShowError,
  addSignup,
  applyAction,
  autoEndIfAbandoned,
  createShow,
  type StoredShow,
} from "./show";
import { putTranscript, transcriptStorageEnabled } from "./storage";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.DATA_DIR ?? path.join(HERE, "..", "data");
const WEB_DIST = path.join(HERE, "..", "web", "dist");

/* ------------------------------------------------------------- storage -- */

const repo = new ShowRepo(DATA_DIR);
const shows = new Map<string, StoredShow>();
for (const show of repo.loadAll()) shows.set(show.state.id, show);
console.log(`Loaded ${shows.size} show(s) from disk.`);

/* ---------------------------------------------------------------- rooms -- */

const rooms = new Map<string, Set<WebSocket>>();

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

function stateMessage(state: ShowState): ServerMessage {
  return { type: "state", state, serverNowMs: Date.now() };
}

function broadcast(showId: string, state: ShowState): void {
  const room = rooms.get(showId);
  if (!room) return;
  const msg = stateMessage(state);
  for (const socket of room) send(socket, msg);
}

/* ----------------------------------------------- transcript archiving -- */

// Push the full transcript to durable external storage (see storage.ts). Uploads
// are debounced while it grows, then flushed immediately when the show ends, so
// the archive survives Render's ephemeral disk with at most one in-flight window
// of loss. Keyed by show name + creation time; each upload overwrites the same
// object, so this is cheap even on a chatty stage.
const UPLOAD_DEBOUNCE_MS = 20_000;
const uploadTimers = new Map<string, ReturnType<typeof setTimeout>>();

function flushTranscript(show: StoredShow): void {
  putTranscript(show.state.name, show.state.createdAtMs, show.transcript).catch((err) =>
    console.error(`Transcript upload failed for ${show.state.id}:`, err.message),
  );
}

function scheduleTranscriptUpload(show: StoredShow, immediate = false): void {
  if (!transcriptStorageEnabled() || !show.transcript) return;
  const id = show.state.id;
  const pending = uploadTimers.get(id);
  if (pending) clearTimeout(pending);
  if (immediate) {
    uploadTimers.delete(id);
    flushTranscript(show);
    return;
  }
  uploadTimers.set(
    id,
    setTimeout(() => {
      uploadTimers.delete(id);
      flushTranscript(show);
    }, UPLOAD_DEBOUNCE_MS).unref(),
  );
}

/* ------------------------------------------------------------------ app -- */

const app = Fastify({ logger: false });
await app.register(websocket);

app.get("/api/health", async () => ({ ok: true }));

app.post("/api/shows", async (req, reply) => {
  const body = z
    .object({ name: z.string().min(1).max(120).optional() })
    .safeParse(req.body ?? {});
  if (!body.success) return reply.code(400).send({ error: "Invalid body." });

  const show = createShow(body.data.name ?? "Untitled show");
  shows.set(show.state.id, show);
  repo.save(show);
  console.log(`Created show ${show.state.id} ("${show.state.name}")`);
  return { state: show.state, hostToken: show.hostToken };
});

app.get("/api/shows/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const show = shows.get(id);
  if (!show) return reply.code(404).send({ error: "Show not found." });
  return { state: show.state };
});

// Full transcript + captured keywords for offline analysis. Host-token gated so
// it isn't public; the offline LLM gap-check reads this on the operator's command.
app.get("/api/shows/:id/transcript", async (req, reply) => {
  const { id } = req.params as { id: string };
  const { token } = req.query as { token?: string };
  const show = shows.get(id);
  if (!show) return reply.code(404).send({ error: "Show not found." });
  if (token !== show.hostToken) return reply.code(403).send({ error: "Bad host token." });
  return { id, transcript: show.transcript, keywords: show.state.keywords };
});

app.get("/ws/:showId", { websocket: true }, (socket: WebSocket, req) => {
  const { showId } = req.params as { showId: string };
  const show = shows.get(showId);
  if (!show) {
    socket.close(4404, "show not found");
    return;
  }

  let room = rooms.get(showId);
  if (!room) rooms.set(showId, (room = new Set()));
  room.add(socket);
  send(socket, stateMessage(show.state));

  socket.on("message", (raw: Buffer) => {
    let msg;
    try {
      msg = ClientMessageSchema.parse(JSON.parse(raw.toString()));
    } catch {
      send(socket, { type: "error", message: "Malformed message." });
      return;
    }

    if (msg.type === "keywords") {
      // Data ingestion from the stage client — no token; merge deduped by
      // term + category.
      const before = show.state.keywords.length;
      for (const kw of msg.keywords) {
        const exists = show.state.keywords.some(
          (k) => k.term === kw.term && k.category === kw.category,
        );
        if (!exists) show.state.keywords.push(kw);
      }
      if (show.state.keywords.length !== before) {
        repo.save(show);
        broadcast(showId, show.state);
      }
      return;
    }

    if (msg.type === "transcript") {
      // Append to the stored transcript. Never broadcast — it's for optional
      // offline analysis, retrieved with the host token.
      show.transcript += (show.transcript ? " " : "") + msg.text;
      repo.save(show);
      scheduleTranscriptUpload(show);
      return;
    }

    if (msg.type === "signup") {
      // Tokenless open-mic self sign-up; addSignup enforces "sign-up is open".
      try {
        addSignup(show.state, msg.name);
      } catch (err) {
        const message = err instanceof ShowError ? err.message : "Internal error.";
        send(socket, { type: "error", message });
        return;
      }
      repo.save(show);
      broadcast(showId, show.state);
      return;
    }

    if (msg.token !== show.hostToken) {
      send(socket, { type: "error", message: "Not authorized: bad host token." });
      return;
    }
    try {
      applyAction(show.state, msg.action);
    } catch (err) {
      const message = err instanceof ShowError ? err.message : "Internal error.";
      send(socket, { type: "error", message });
      return;
    }
    repo.save(show);
    broadcast(showId, show.state);
    // The show just ended (via Next past the last act / End) — archive now
    // rather than waiting out the debounce window.
    if (show.state.clock.status === "ended") scheduleTranscriptUpload(show, true);
  });

  socket.on("close", () => {
    room.delete(socket);
  });
});

// Keep connections alive through proxies; ws answers pongs automatically.
setInterval(() => {
  for (const room of rooms.values()) {
    for (const socket of room) {
      if (socket.readyState === socket.OPEN) socket.ping();
    }
  }
}, 30_000).unref();

// Reap abandoned shows (host forgot Next/End) so zombie shows don't linger.
setInterval(() => {
  const now = Date.now();
  for (const show of shows.values()) {
    if (autoEndIfAbandoned(show.state, now)) {
      repo.save(show);
      broadcast(show.state.id, show.state);
      scheduleTranscriptUpload(show, true);
      console.log(`Auto-ended abandoned show ${show.state.id}`);
    }
    // Close a sign-up left open on a show that never started, so a forgotten
    // event doesn't keep the instance warm (and burning hours) indefinitely.
    const s = show.state;
    if (s.signup.open && s.clock.status === "idle" && now - s.createdAtMs > 12 * 60 * 60 * 1000) {
      s.signup = { ...s.signup, open: false };
      repo.save(show);
      broadcast(s.id, s);
      console.log(`Auto-closed stale sign-up for show ${s.id}`);
    }
  }
}, 60_000).unref();

// Keep-warm: ping our own public URL so the free-tier instance doesn't spin
// down during an event. The request leaves and returns through the platform
// edge, counting as inbound activity.
//
// This MUST stay tightly scoped or it burns the whole monthly instance-hour
// budget: it only fires while sign-up is open (which the reaper auto-closes
// after 12h) or the clock is actively running/paused (which the reaper
// auto-ends 30 min past an abandoned segment). Crucially it does NOT keep warm
// for a merely idle show that happens to have a lineup — otherwise every
// leftover show would pin the instance online forever.
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  const anyShowActive = () => {
    for (const show of shows.values()) {
      const s = show.state;
      if (s.signup.open) return true; // bounded pre-show sign-up window
      if (s.clock.status === "running" || s.clock.status === "paused") return true;
    }
    return false;
  };
  setInterval(() => {
    if (anyShowActive()) {
      fetch(`${SELF_URL}/api/health`).catch(() => {});
    }
  }, 10 * 60 * 1000).unref();
  console.log("Keep-warm self-ping enabled (only while sign-up is open or a show is live).");
}

/* --------------------------------------------- static frontend (prod) --- */

if (existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST });
  // SPA fallback: any non-API GET serves index.html so /show/... deep links work
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/ws")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found." });
  });
  console.log("Serving web/dist as static frontend.");
}

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`hahaplan server listening on http://localhost:${PORT}`);
