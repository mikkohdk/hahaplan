/**
 * hahaplan — shared protocol.
 * Single source of truth for the show state shape, the WebSocket message
 * protocol, and the clock math. Imported by BOTH the server and the web app,
 * so the two sides can never drift apart.
 */
import { z } from "zod";

export const DEFAULT_WARN_BEFORE_SEC = 60;

/* ---------------------------------------------------------------- acts -- */

export const ActSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["performer", "break"]),
  name: z.string().min(1).max(120),
  durationSec: z.number().int().min(10).max(4 * 3600),
  /** "Red light": seconds before the end when the stage display turns red. */
  warnBeforeSec: z.number().int().min(0).max(3600),
});
export type Act = z.infer<typeof ActSchema>;

/* ------------------------------------------------------------- segment -- */
/**
 * What is on stage right now. When an act starts, its name/duration are
 * SNAPSHOTTED into the segment — live edits to the lineup can therefore
 * never affect the running act's timer (spec §4.1, live editing rule).
 */
export const SegmentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("act"),
    actId: z.string(),
    name: z.string(),
    actKind: z.enum(["performer", "break"]),
    durationSec: z.number().int(),
    warnBeforeSec: z.number().int(),
  }),
  z.object({
    kind: z.literal("host"),
    /** Which act just ended (null when the show opens with a host segment). */
    afterActId: z.string().nullable(),
  }),
]);
export type Segment = z.infer<typeof SegmentSchema>;

/* --------------------------------------------------------------- clock -- */
/**
 * The master clock never "ticks" over the network. The server stores when
 * the current segment (re)started and how much time had accumulated before
 * the last pause; every client renders the countdown locally from that.
 */
export const ClockSchema = z.object({
  status: z.enum(["idle", "running", "paused", "ended"]),
  segment: SegmentSchema.nullable(),
  /** Server epoch ms when the segment started or last resumed. */
  startedAtMs: z.number().nullable(),
  /** Elapsed ms accumulated before the last pause. */
  accumulatedMs: z.number(),
});
export type Clock = z.infer<typeof ClockSchema>;

/* ---------------------------------------------------------------- show -- */

export const ShowStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAtMs: z.number(),
  acts: z.array(ActSchema),
  doneActIds: z.array(z.string()),
  clock: ClockSchema,
});
export type ShowState = z.infer<typeof ShowStateSchema>;

/* ------------------------------------------------------------ protocol -- */

export const HostActionSchema = z.discriminatedUnion("type", [
  /** Begin the next act (from idle, a host segment, or after `ended` if acts were added). */
  z.object({ type: z.literal("start") }),
  /** During an act: end it and enter a timed host segment. During a host segment / idle: same as start. */
  z.object({ type: z.literal("next") }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("resume") }),
  /** Replace the whole lineup (add / delete / reorder are all just this). */
  z.object({ type: z.literal("setActs"), acts: z.array(ActSchema).max(100) }),
  z.object({ type: z.literal("setName"), name: z.string().min(1).max(120) }),
]);
export type HostAction = z.infer<typeof HostActionSchema>;

export const ClientMessageSchema = z.object({
  type: z.literal("action"),
  token: z.string(),
  action: HostActionSchema,
});
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | { type: "state"; state: ShowState; serverNowMs: number }
  | { type: "error"; message: string };

/* ---------------------------------------------------------- clock math -- */

export function elapsedMs(clock: Clock, nowMs: number): number {
  if (clock.status === "running" && clock.startedAtMs !== null) {
    return clock.accumulatedMs + Math.max(0, nowMs - clock.startedAtMs);
  }
  return clock.accumulatedMs;
}

/** Remaining ms for the running act; negative in overtime; null in host segments. */
export function remainingMs(clock: Clock, nowMs: number): number | null {
  if (clock.segment?.kind !== "act") return null;
  return clock.segment.durationSec * 1000 - elapsedMs(clock, nowMs);
}

/** First act in lineup order that is neither done nor currently on stage. */
export function nextAct(state: ShowState): Act | null {
  const runningActId =
    state.clock.segment?.kind === "act" ? state.clock.segment.actId : null;
  const done = new Set(state.doneActIds);
  return state.acts.find((a) => !done.has(a.id) && a.id !== runningActId) ?? null;
}

/** m:ss, with a leading minus in overtime. */
export function formatClock(ms: number): string {
  const neg = ms < 0;
  const totalSec = Math.floor(Math.abs(ms) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${neg ? "-" : ""}${m}:${String(s).padStart(2, "0")}`;
}
