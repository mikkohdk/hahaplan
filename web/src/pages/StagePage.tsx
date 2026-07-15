import { useParams } from "react-router-dom";
import { elapsedMs, formatClock, remainingMs } from "../../../shared/protocol";
import { useShow, useTick } from "../lib/useShow";

/**
 * P0 stage display: giant clock the performer never touches.
 * Visual states (spec §4.2): white-on-black → red screen in the final
 * minute → blinking in overtime. (The multicolor escalation ladder beyond
 * -1:00 lands with P0.3 polish.)
 */
export function StagePage() {
  const { showId = "" } = useParams();
  const { state, connected, serverNow } = useShow(showId);
  useTick(100);

  if (!state) {
    return (
      <div className="stage">
        <div className="stage__label">{connected ? "waiting for show" : "connecting…"}</div>
      </div>
    );
  }

  const { clock } = state;
  const seg = clock.segment;
  const now = serverNow();
  const remaining = remainingMs(clock, now);

  let cls = "stage";
  let display: string;
  let label: string;

  if (seg?.kind === "act" && remaining !== null) {
    display = formatClock(remaining);
    label = seg.name;
    if (remaining <= 0) cls += " stage--over";
    else if (remaining <= seg.warnBeforeSec * 1000) cls += " stage--warn";
  } else if (seg?.kind === "host") {
    display = formatClock(elapsedMs(clock, now));
    label = "host";
  } else {
    display = clock.status === "ended" ? "fin" : "—";
    label = clock.status === "ended" ? "that's the show" : state.name;
  }

  return (
    <div className={cls}>
      <div className="stage__clock">{display}</div>
      <div className="stage__label">
        {clock.status === "paused" ? "paused" : label}
        {!connected && " · reconnecting"}
      </div>
    </div>
  );
}
