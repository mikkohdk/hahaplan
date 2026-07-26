import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { elapsedMs, formatClock, remainingMs } from "../../../shared/protocol";
import { Keywords } from "../components/Keywords";
import { extractKeywords } from "../lib/gazetteer";
import { useShow, useTick } from "../lib/useShow";
import { useTranscription } from "../lib/useTranscription";

/**
 * P0 stage display: giant clock the performer never touches.
 * The clock counts UP (elapsed) — a comedian with an 8-minute set wants to see
 * they're at 7:00, not that 1:00 is left. The screen COLOUR still tracks time
 * remaining, so the warnings fire at the same moments (spec §4.2): white-on-black
 * → red screen in the final minute → red/black blink in overtime → escalating
 * multicolor blink once more than a minute over, speeding up the longer it runs.
 */
export function StagePage() {
  const { showId = "" } = useParams();
  const { state, connected, notFound, sendKeywords, sendTranscript, serverNow } =
    useShow(showId);
  useTick(100);

  const {
    status: ccStatus,
    text: ccText,
    error: ccError,
    device: ccDevice,
    start: ccStart,
    stop: ccStop,
  } = useTranscription();
  const [armed, setArmed] = useState(false);
  const transcribeOn = state?.transcribe ?? false;

  // Host turned transcription off → stop the mic and reset the arm gate.
  useEffect(() => {
    if (!transcribeOn && armed) {
      ccStop();
      setArmed(false);
    }
  }, [transcribeOn, armed, ccStop]);

  // Pull location/profession keywords out of the local transcript and send just
  // those (each once). Audio never leaves; keyword capture is always on.
  const sentKeywordsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!transcribeOn || !ccText) return;
    const fresh = extractKeywords(ccText).filter(
      (k) => !sentKeywordsRef.current.has(`${k.category}:${k.term}`),
    );
    if (fresh.length) {
      fresh.forEach((k) => sentKeywordsRef.current.add(`${k.category}:${k.term}`));
      sendKeywords(fresh);
    }
  }, [ccText, transcribeOn, sendKeywords]);

  // Write the transcript back to the server (stored, not broadcast) so it can be
  // pulled later for offline keyword-gap analysis. Send only the new suffix.
  const sentLenRef = useRef(0);
  useEffect(() => {
    if (!transcribeOn) return;
    if (ccText.length < sentLenRef.current) sentLenRef.current = 0; // transcript reset
    if (ccText.length > sentLenRef.current) {
      sendTranscript(ccText.slice(sentLenRef.current));
      sentLenRef.current = ccText.length;
    }
  }, [ccText, transcribeOn, sendTranscript]);

  if (notFound) {
    return (
      <div className="stage">
        <div className="stage__label">show ended</div>
      </div>
    );
  }
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
  let style: CSSProperties | undefined;

  if (seg?.kind === "act" && remaining !== null) {
    display = formatClock(elapsedMs(clock, now));
    label = seg.name;
    if (remaining <= -60_000) {
      // Deep overtime: escalating multicolor blink that speeds up the longer
      // the act runs over. Step per overtime-minute so the period changes at
      // most once a minute, not on every render tick.
      cls += " stage--escalate";
      const overMin = Math.floor(-remaining / 60_000);
      const period = Math.max(0.35, 1.2 - (overMin - 1) * 0.25);
      style = { "--escalate-period": `${period}s` } as CSSProperties;
    } else if (remaining <= 0) {
      cls += " stage--over";
    } else if (remaining <= seg.warnBeforeSec * 1000) {
      cls += " stage--warn";
    }
  } else if (seg?.kind === "host") {
    display = formatClock(elapsedMs(clock, now));
    label = "host";
  } else {
    display = clock.status === "ended" ? "fin" : "—";
    label = clock.status === "ended" ? "that's the show" : state.name;
  }

  const targetMs = seg?.kind === "act" ? seg.durationSec * 1000 : null;

  return (
    <div className={cls} style={style}>
      <div className="stage__clock">{display}</div>
      {targetMs !== null && <div className="stage__target">of {formatClock(targetMs)}</div>}
      <div className="stage__label">
        {clock.status === "paused" ? "paused" : label}
        {!connected && " · reconnecting"}
      </div>

      {transcribeOn && !armed && (
        <button
          className="stage__cc-arm"
          onClick={async () => {
            setArmed(true);
            await ccStart();
          }}
        >
          ▶ Tap once to start · grants mic access
        </button>
      )}
      {transcribeOn && armed && (
        <div className="stage__cc">
          <div className="stage__cc-status">
            {ccStatus === "idle" && "starting…"}
            {ccStatus === "loading" && "loading model…"}
            {ccStatus === "listening" && `● listening${ccDevice ? ` · ${ccDevice}` : ""}`}
            {ccStatus === "error" && "error"}
          </div>
          {/* Show the captured keywords (what the host sees too), not the raw
              transcript — the stage faces the performer. */}
          {ccStatus === "error" ? (
            <div className="stage__cc-text">⚠ {ccError ?? "unknown error"}</div>
          ) : state.keywords.length > 0 ? (
            <Keywords keywords={state.keywords} />
          ) : (
            <div className="stage__cc-text">listening…</div>
          )}
        </div>
      )}
    </div>
  );
}
