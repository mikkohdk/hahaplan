/**
 * Show domain logic: creating shows and applying host actions to the state.
 * Pure functions over ShowState — no I/O here, which keeps the clock rules
 * easy to test and to reason about.
 */
import { randomBytes } from "node:crypto";
import {
  type HostAction,
  type ShowState,
  elapsedMs,
  nextAct,
} from "../shared/protocol";

export interface StoredShow {
  state: ShowState;
  hostToken: string;
}

/** Raised for rule violations; the message is safe to show to the host. */
export class ShowError extends Error {}

function randomId(len: number): string {
  // base64url minus the url chars, lowercased: compact ids that read fine in a URL
  return randomBytes(32)
    .toString("base64url")
    .replace(/[-_]/g, "")
    .toLowerCase()
    .slice(0, len);
}

export function createShow(name: string): StoredShow {
  return {
    state: {
      id: randomId(10),
      name,
      createdAtMs: Date.now(),
      acts: [],
      doneActIds: [],
      clock: { status: "idle", segment: null, startedAtMs: null, accumulatedMs: 0 },
    },
    hostToken: randomId(26),
  };
}

/** Mark whatever is on stage as finished (acts go into doneActIds). */
function finishCurrent(state: ShowState): void {
  const seg = state.clock.segment;
  if (seg?.kind === "act" && !state.doneActIds.includes(seg.actId)) {
    state.doneActIds.push(seg.actId);
  }
}

function beginNextAct(state: ShowState, now: number): void {
  const act = nextAct(state);
  if (!act) {
    if (state.clock.status === "idle") {
      throw new ShowError("Add at least one act before starting.");
    }
    finishCurrent(state);
    state.clock = { status: "ended", segment: null, startedAtMs: null, accumulatedMs: 0 };
    return;
  }
  finishCurrent(state);
  state.clock = {
    status: "running",
    segment: {
      kind: "act",
      actId: act.id,
      name: act.name,
      actKind: act.kind,
      durationSec: act.durationSec,
      warnBeforeSec: act.warnBeforeSec,
    },
    startedAtMs: now,
    accumulatedMs: 0,
  };
}

function beginHostSegment(state: ShowState, now: number): void {
  const afterActId =
    state.clock.segment?.kind === "act" ? state.clock.segment.actId : null;
  finishCurrent(state);
  state.clock = {
    status: "running",
    segment: { kind: "host", afterActId },
    startedAtMs: now,
    accumulatedMs: 0,
  };
}

export function applyAction(
  state: ShowState,
  action: HostAction,
  now = Date.now(),
): void {
  switch (action.type) {
    case "start": {
      if (state.clock.segment?.kind === "act" && state.clock.status !== "ended") {
        throw new ShowError("An act is already on stage — use Next.");
      }
      beginNextAct(state, now);
      return;
    }
    case "next": {
      if (state.clock.status === "ended") {
        throw new ShowError("The show has ended.");
      }
      if (state.clock.segment?.kind === "act") {
        beginHostSegment(state, now);
      } else {
        // idle or host segment: be forgiving, Next means "bring on the next act"
        beginNextAct(state, now);
      }
      return;
    }
    case "pause": {
      if (state.clock.status !== "running") {
        throw new ShowError("Nothing is running.");
      }
      state.clock.accumulatedMs = elapsedMs(state.clock, now);
      state.clock.status = "paused";
      state.clock.startedAtMs = null;
      return;
    }
    case "resume": {
      if (state.clock.status !== "paused") {
        throw new ShowError("The show is not paused.");
      }
      state.clock.status = "running";
      state.clock.startedAtMs = now;
      return;
    }
    case "setActs": {
      const ids = new Set(action.acts.map((a) => a.id));
      if (ids.size !== action.acts.length) {
        throw new ShowError("Duplicate act ids in lineup.");
      }
      // The running act is snapshotted into clock.segment, so replacing the
      // lineup wholesale can never disturb its timer.
      state.acts = action.acts;
      return;
    }
    case "setName": {
      state.name = action.name;
      return;
    }
  }
}
