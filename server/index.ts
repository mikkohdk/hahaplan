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
  applyAction,
  autoEndIfAbandoned,
  createShow,
  type StoredShow,
} from "./show";

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
      console.log(`Auto-ended abandoned show ${show.state.id}`);
    }
  }
}, 60_000).unref();

// Keep-warm: while any show is running, ping our own public URL so the host
// (e.g. Render free tier) doesn't spin the instance down mid-show. The request
// leaves and returns through the platform edge, counting as inbound activity.
// It stops itself once no show is live, so idle time still spins down and the
// monthly instance-hours aren't burned between shows.
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  const anyShowRunning = () => {
    for (const show of shows.values()) {
      if (show.state.clock.status === "running") return true;
    }
    return false;
  };
  setInterval(() => {
    if (anyShowRunning()) {
      fetch(`${SELF_URL}/api/health`).catch(() => {});
    }
  }, 10 * 60 * 1000).unref();
  console.log("Keep-warm self-ping enabled (active only while a show is running).");
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
