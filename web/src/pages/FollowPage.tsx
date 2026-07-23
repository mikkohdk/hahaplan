import { useParams } from "react-router-dom";
import { elapsedMs, formatClock, nextAct } from "../../../shared/protocol";
import { useShow, useTick } from "../lib/useShow";

/**
 * Read-only view for comedians waiting in the back room: lineup, who's on,
 * who's next, timing. (P1 adds the locations-mentioned list here.)
 */
export function FollowPage() {
  const { showId = "" } = useParams();
  const { state, connected, serverNow } = useShow(showId);
  useTick(500);

  if (!state) {
    return (
      <div className="page row" style={{ justifyContent: "center", paddingTop: "20vh" }}>
        <span className="mg-spinner" /> <span className="text-muted">Connecting…</span>
      </div>
    );
  }

  const { clock } = state;
  const seg = clock.segment;
  const now = serverNow();
  const upNext = nextAct(state);
  const onStageActId = seg?.kind === "act" ? seg.actId : null;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="text-overline">hahaplan · follow</div>
          <h2 className="text-h3">{state.name}</h2>
        </div>
        <span className={`mg-badge ${connected ? "mg-badge--success" : "mg-badge--danger"}`}>
          {connected ? "live" : "reconnecting"}
        </span>
      </header>

      <div className="mg-card">
        <div className="text-overline">
          {clock.status === "idle" && "not started"}
          {clock.status === "ended" && "show over"}
          {seg?.kind === "act" && "on stage now"}
          {seg?.kind === "host" && "host on stage"}
          {clock.status === "paused" && " · paused"}
        </div>
        <div className="row" style={{ marginTop: "var(--space-2)" }}>
          <div className="grow text-h3">
            {seg?.kind === "act" ? seg.name : seg?.kind === "host" ? "Host" : "—"}
          </div>
          <div className="now-block">
            <div className="now-clock" style={{ fontSize: "var(--fs-3xl)" }}>
              {formatClock(elapsedMs(clock, now))}
            </div>
            {seg?.kind === "act" && (
              <div className="clock-target">of {formatClock(seg.durationSec * 1000)}</div>
            )}
          </div>
        </div>
        <div className="text-caption" style={{ marginTop: "var(--space-2)" }}>
          {upNext ? `Up next: ${upNext.name}` : "Nobody up next"}
        </div>
      </div>

      <div className="mg-card">
        <div className="text-title-2">Lineup</div>
        <ul className="lineup" style={{ marginTop: "var(--space-2)" }}>
          {state.acts.map((a) => {
            const done = state.doneActIds.includes(a.id);
            const onStage = a.id === onStageActId;
            const isNext = upNext?.id === a.id;
            return (
              <li key={a.id}>
                <span className={`act-name text-body ${done ? "act-done" : ""}`}>
                  {a.name}
                  {onStage && (
                    <span className="mg-badge mg-badge--accent" style={{ marginLeft: "var(--space-2)" }}>
                      on stage
                    </span>
                  )}
                  {isNext && (
                    <span className="mg-badge mg-badge--outline" style={{ marginLeft: "var(--space-2)" }}>
                      up next
                    </span>
                  )}
                </span>
                <span className="text-caption">{Math.round(a.durationSec / 60)} min</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
