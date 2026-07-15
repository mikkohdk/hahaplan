/**
 * End-to-end smoke test. Run against a live server:
 *   npm run dev:server   (terminal 1)
 *   npm run smoke        (terminal 2)
 * Creates a show, connects a host socket and a viewer socket, drives a full
 * show lifecycle and asserts every broadcast both clients receive.
 */
import type { Act, ServerMessage, ShowState } from "../shared/protocol";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const WS_BASE = BASE.replace(/^http/, "ws");

function assert(cond: unknown, label: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${label}`);
  console.log(`  ok — ${label}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Client {
  private queue: ServerMessage[] = [];
  private waiters: Array<(m: ServerMessage) => void> = [];
  private ws: WebSocket;

  constructor(showId: string, readonly name: string) {
    this.ws = new WebSocket(`${WS_BASE}/ws/${showId}`);
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter) waiter(msg);
      else this.queue.push(msg);
    };
  }

  open(): Promise<void> {
    return new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error(`${this.name}: ws error`));
    });
  }

  next(timeoutMs = 3000): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((res, rej) => {
      const t = setTimeout(
        () => rej(new Error(`${this.name}: timed out waiting for a message`)),
        timeoutMs,
      );
      this.waiters.push((m) => {
        clearTimeout(t);
        res(m);
      });
    });
  }

  async nextState(): Promise<ShowState> {
    const msg = await this.next();
    if (msg.type !== "state") {
      throw new Error(`${this.name}: expected state, got ${JSON.stringify(msg)}`);
    }
    return msg.state;
  }

  async nextError(): Promise<string> {
    const msg = await this.next();
    if (msg.type !== "error") {
      throw new Error(`${this.name}: expected error, got ${JSON.stringify(msg)}`);
    }
    return msg.message;
  }

  send(token: string, action: unknown): void {
    this.ws.send(JSON.stringify({ type: "action", token, action }));
  }

  close(): void {
    this.ws.close();
  }
}

async function main() {
  console.log(`Smoke test against ${BASE}`);

  // -- create show -------------------------------------------------------
  const res = await fetch(`${BASE}/api/shows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Smoke Test Open Mic" }),
  });
  assert(res.ok, "POST /api/shows responds 200");
  const { state: created, hostToken } = (await res.json()) as {
    state: ShowState;
    hostToken: string;
  };
  assert(created.clock.status === "idle", "new show starts idle");

  // -- connect host + viewer ---------------------------------------------
  const host = new Client(created.id, "host");
  const viewer = new Client(created.id, "viewer");
  await Promise.all([host.open(), viewer.open()]);
  assert((await host.nextState()).id === created.id, "host gets state on connect");
  assert((await viewer.nextState()).id === created.id, "viewer gets state on connect");

  // -- build lineup --------------------------------------------------------
  const acts: Act[] = [
    { id: "a1", kind: "performer", name: "Alice", durationSec: 300, warnBeforeSec: 60 },
    { id: "a2", kind: "performer", name: "Bob", durationSec: 300, warnBeforeSec: 60 },
  ];
  host.send(hostToken, { type: "setActs", acts });
  assert((await host.nextState()).acts.length === 2, "lineup update reaches host");
  assert((await viewer.nextState()).acts.length === 2, "lineup update reaches viewer");

  // -- auth ----------------------------------------------------------------
  viewer.send("wrong-token", { type: "start" });
  assert((await viewer.nextError()).includes("Not authorized"), "bad token is rejected");

  // -- start ---------------------------------------------------------------
  host.send(hostToken, { type: "start" });
  let s = await host.nextState();
  assert(s.clock.status === "running", "start → running");
  assert(
    s.clock.segment?.kind === "act" && s.clock.segment.actId === "a1",
    "act 1 is on stage",
  );
  s = await viewer.nextState();
  assert(s.clock.segment?.kind === "act", "viewer sees act 1 too");

  // -- pause freezes the clock ----------------------------------------------
  await sleep(250);
  host.send(hostToken, { type: "pause" });
  s = await host.nextState();
  await viewer.nextState();
  assert(s.clock.status === "paused" && s.clock.startedAtMs === null, "pause freezes clock");
  const frozen = s.clock.accumulatedMs;
  assert(frozen >= 200 && frozen < 2000, `accumulated ~250ms (got ${frozen})`);

  host.send(hostToken, { type: "resume" });
  s = await host.nextState();
  await viewer.nextState();
  assert(s.clock.status === "running" && s.clock.accumulatedMs === frozen, "resume keeps elapsed");

  // -- next: act → host segment → act 2 -------------------------------------
  host.send(hostToken, { type: "next" });
  s = await host.nextState();
  await viewer.nextState();
  assert(s.clock.segment?.kind === "host", "next during act → host segment");
  assert(s.doneActIds.includes("a1"), "act 1 marked done");

  host.send(hostToken, { type: "next" });
  s = await host.nextState();
  await viewer.nextState();
  assert(
    s.clock.segment?.kind === "act" && s.clock.segment.actId === "a2",
    "next during host segment → act 2",
  );

  // -- live edit while act 2 runs: delete upcoming, running act untouched ---
  host.send(hostToken, { type: "setActs", acts: [acts[1]!] });
  s = await host.nextState();
  await viewer.nextState();
  assert(
    s.acts.length === 1 && s.clock.segment?.kind === "act" && s.clock.segment.actId === "a2",
    "live lineup edit leaves the running act untouched",
  );

  // -- finish ----------------------------------------------------------------
  host.send(hostToken, { type: "next" });
  s = await host.nextState();
  await viewer.nextState();
  assert(s.clock.segment?.kind === "host", "after last act → host segment");

  host.send(hostToken, { type: "start" });
  s = await host.nextState();
  await viewer.nextState();
  assert(s.clock.status === "ended", "no acts left → show ended");

  // -- REST state matches -----------------------------------------------------
  const getRes = await fetch(`${BASE}/api/shows/${created.id}`);
  const { state: fetched } = (await getRes.json()) as { state: ShowState };
  assert(fetched.clock.status === "ended", "GET /api/shows/:id reflects final state");

  host.close();
  viewer.close();
  console.log("\nPASS — full show lifecycle verified.");
}

main().catch((err) => {
  console.error(`\nFAIL — ${err.message}`);
  process.exit(1);
});
