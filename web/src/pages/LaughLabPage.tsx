import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLaughLab, type SoundItem, type TranscriptItem } from "../lib/useLaughLab";

/**
 * Laugh lab — tuning page for laughter/applause detection. A trained AudioSet
 * classifier runs on short overlapping windows (so a laugh burst isn't buried in
 * a whole punchline of speech), alongside model-free features (spectral
 * flatness, ZCR). Transcript (Whisper) is optional — it's a second heavy model,
 * off by default so the classifier can keep up. Everything stays on the device.
 */

// AudioSet splits laughter across many sibling classes (Laughter, Snicker,
// Chuckle/chortle, Giggle, Belly laugh, Cackle…) plus applause/cheer/crowd, so
// no single label scores high — we SUM the whole family.
const LAUGH_LABELS =
  /laugh|giggl|chuckl|chortle|snicker|cackl|titter|guffaw|applause|clap|cheer|crowd|chatter|audience|whoop/i;

const laughScoreOf = (s: SoundItem) =>
  s.events.reduce((sum, e) => sum + (LAUGH_LABELS.test(e.label) ? e.score : 0), 0);

interface LaughEvent {
  start: number;
  end: number;
  peak: number;
}

/**
 * Group consecutive over-threshold windows into distinct laughs. A single laugh
 * spans several ~1s windows, so counting windows over-counts; and a one-window
 * dip in the middle of a laugh shouldn't split it, hence a 1-window gap
 * tolerance. Returns one entry per laugh, with its peak Σ.
 */
function detectLaughs(sounds: SoundItem[], onset: number): LaughEvent[] {
  const events: LaughEvent[] = [];
  let cur: LaughEvent | null = null;
  let gap = 0;
  for (const s of sounds) {
    const ls = laughScoreOf(s);
    if (ls >= onset) {
      if (!cur) cur = { start: s.t, end: s.t, peak: ls };
      else {
        cur.end = s.t;
        cur.peak = Math.max(cur.peak, ls);
      }
      gap = 0;
    } else if (cur) {
      if (++gap > 1) {
        events.push(cur);
        cur = null;
        gap = 0;
      }
    }
  }
  if (cur) events.push(cur);
  return events;
}

const fmt = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

type Item = ({ kind: "sound" } & SoundItem) | ({ kind: "speech" } & TranscriptItem);

export function LaughLabPage() {
  const [transcribe, setTranscribe] = useState(false);
  const { status, device, error, level, transcripts, sounds, start, stop } = useLaughLab({
    transcribe,
  });
  const [armed, setArmed] = useState(false);
  const [modelThresh, setModelThresh] = useState(0.15);
  const [flatThresh, setFlatThresh] = useState(0.4);

  const items = useMemo<Item[]>(() => {
    const merged: Item[] = [
      ...sounds.map((s) => ({ kind: "sound" as const, ...s })),
      ...transcripts.map((t) => ({ kind: "speech" as const, ...t })),
    ];
    merged.sort((a, b) => a.t - b.t);
    return merged;
  }, [sounds, transcripts]);

  const laughs = useMemo(() => detectLaughs(sounds, modelThresh), [sounds, modelThresh]);
  const laughCount = laughs.length;
  const windowsOver = sounds.filter((s) => laughScoreOf(s) >= modelThresh).length;

  // Build the timeline separately from the live meter: the loudness meter
  // re-renders ~4×/s, and rebuilding a long list that often froze the page.
  // This only recomputes when the data or thresholds change.
  const timelineRows = useMemo(() => {
    return items.map((it, i) => {
      if (it.kind === "speech") {
        return (
          <div key={"s" + it.t + i} className="lab-row">
            <span className="lab-row__t">{fmt(it.t)}</span>
            <span className="lab-row__body">🗣 {it.text}</span>
          </div>
        );
      }
      const ls = laughScoreOf(it);
      const isLaugh = ls >= modelThresh;
      const flat = it.flatness >= flatThresh;
      return (
        <div
          key={"n" + it.t + i}
          className={`lab-row ${isLaugh ? "lab-row--laugh" : flat ? "lab-row--noise" : ""}`}
        >
          <span className="lab-row__t">{fmt(it.t)}</span>
          <span className="lab-row__body">
            <span className="lab-tags">
              <span
                className={`lab-chip ${isLaugh ? "lab-chip--laugh" : ""}`}
                title="summed laughter-family score"
              >
                😂Σ {ls.toFixed(2)}
              </span>
              {it.events.slice(0, 5).map((ev, j) => (
                <span
                  key={j}
                  className={`lab-chip ${LAUGH_LABELS.test(ev.label) ? "lab-chip--laugh" : ""}`}
                >
                  {ev.label} {ev.score.toFixed(2)}
                </span>
              ))}
              <span className="lab-chip lab-chip--dim">
                flat {it.flatness.toFixed(2)} · zcr {it.zcr.toFixed(2)}
              </span>
            </span>
          </span>
        </div>
      );
    });
  }, [items, modelThresh, flatThresh]);

  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [items.length]);

  // Full diagnostic dump so the raw signal can be inspected offline.
  const copyLog = () => {
    const lines = items.map((it) => {
      if (it.kind === "speech") return `[${fmt(it.t)}] 🗣 ${it.text}`;
      const all = it.events.map((e) => `${e.label} ${e.score.toFixed(2)}`).join(", ");
      const ls = laughScoreOf(it);
      const flag = ls >= modelThresh ? `😂[Σ ${ls.toFixed(2)}] ` : "";
      return `[${fmt(it.t)}] ${flag}Σlaugh ${ls.toFixed(2)} rms ${it.rms.toFixed(
        3,
      )} flat ${it.flatness.toFixed(2)} zcr ${it.zcr.toFixed(2)} | ${all}`;
    });
    const header = `laughlab log · device ${device ?? "?"} · ${sounds.length} probes · ${laughCount} distinct laughs / ${windowsOver} hot windows (Σ≥${modelThresh}) · transcript ${transcribe ? "on" : "off"}`;
    navigator.clipboard?.writeText([header, ...lines].join("\n")).catch(() => {});
  };

  return (
    <div className="page" style={{ paddingTop: "6vh" }}>
      <div>
        <div className="text-overline">hahaplan · laugh lab</div>
        <h1 className="text-display-3">Laughter detection</h1>
        <p className="text-body-lg text-muted" style={{ marginTop: "var(--space-3)" }}>
          Play comedy with crowd work and laughter on your speakers, then start
          listening. A sound classifier runs on short overlapping windows so a laugh
          gets its own window, with acoustic texture (flatness) alongside. Compare
          against your ears; drag the thresholds; use Copy log to share the raw signal.
        </p>
      </div>

      <div className="mg-card">
        {!armed ? (
          <>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                marginBottom: "var(--space-3)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={transcribe}
                onChange={(e) => setTranscribe(e.target.checked)}
              />
              <span className="text-body-sm">
                Also transcribe (adds a 2nd heavy model — slower, may miss sound windows)
              </span>
            </label>
            <button
              className="mg-btn mg-btn--primary mg-btn--lg mg-btn--block"
              onClick={async () => {
                setArmed(true);
                await start();
              }}
            >
              {items.length > 0 ? "Start again (clears the log)" : "Start listening"}
            </button>
          </>
        ) : (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="text-caption">
              {status === "idle" && "starting…"}
              {status === "loading" && "loading model… (first run downloads ~90 MB)"}
              {status === "listening" && `● listening${device ? ` · ${device}` : ""}`}
              {status === "error" && `⚠ ${error ?? "error"}`}
            </span>
            <button
              className="mg-btn mg-btn--sm mg-btn--ghost"
              onClick={() => {
                stop();
                setArmed(false);
              }}
            >
              Stop
            </button>
          </div>
        )}

        {armed && (
          <div className="check-meter" style={{ marginTop: "var(--space-4)" }}>
            <span className="check-meter__label text-caption">loudness</span>
            <div className="check-meter__track">
              <div
                className="check-meter__fill"
                style={{ width: `${Math.min(100, (level / 0.12) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {(armed || items.length > 0) && (
          <>
            <div className="lab-controls" style={{ marginTop: "var(--space-4)" }}>
              <label className="lab-slider">
                <span className="text-caption">
                  Laughter score (summed) ≥ <strong>{modelThresh.toFixed(2)}</strong>
                </span>
                <input
                  type="range"
                  min={0.05}
                  max={0.6}
                  step={0.01}
                  value={modelThresh}
                  onChange={(e) => setModelThresh(Number(e.target.value))}
                />
              </label>
              <label className="lab-slider">
                <span className="text-caption">
                  Spectral flatness ≥ <strong>{flatThresh.toFixed(2)}</strong>
                </span>
                <input
                  type="range"
                  min={0.1}
                  max={0.8}
                  step={0.02}
                  value={flatThresh}
                  onChange={(e) => setFlatThresh(Number(e.target.value))}
                />
              </label>
            </div>

            <div
              className="row"
              style={{ justifyContent: "space-between", marginTop: "var(--space-4)" }}
            >
              <span className="text-body">
                😂 <strong>{laughCount}</strong> laughs · {windowsOver} hot windows ·{" "}
                {sounds.length} probes{transcribe ? ` · ${transcripts.length} speech` : ""}
              </span>
              <button
                className="mg-btn mg-btn--sm mg-btn--secondary"
                onClick={copyLog}
                disabled={items.length === 0}
              >
                Copy log
              </button>
            </div>

            <div className="lab-timeline" ref={boxRef} style={{ marginTop: "var(--space-3)" }}>
              {items.length === 0 ? (
                <span className="text-muted">Waiting for audio…</span>
              ) : (
                timelineRows
              )}
            </div>
          </>
        )}
      </div>

      <p className="text-caption">
        <Link to="/">← Back</Link> · <Link to="/check">Device check</Link> · Sound windows
        are ~1.6s every ~0.35s; laughter is located to the window, not the exact instant.
      </p>
    </div>
  );
}
