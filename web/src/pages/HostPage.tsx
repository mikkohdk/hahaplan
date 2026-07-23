import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import QRCode from "qrcode";
import {
  DEFAULT_WARN_BEFORE_SEC,
  type Act,
  elapsedMs,
  formatClock,
  nextAct,
} from "../../../shared/protocol";
import { claimHostToken } from "../lib/api";
import { useShow, useTick } from "../lib/useShow";

function useQr(url: string): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 220 }).then(setSrc);
  }, [url]);
  return src;
}

const clampMinutes = (n: number) => Math.min(240, Math.max(1, Math.round(n || 1)));

export function HostPage() {
  const { showId = "" } = useParams();
  const token = useMemo(() => claimHostToken(showId), [showId]);
  const { state, connected, lastError, sendAction, serverNow } = useShow(showId);
  useTick(200);

  const [newName, setNewName] = useState("");
  const [newMinutes, setNewMinutes] = useState(5);

  const stageUrl = `${location.origin}/show/${showId}/stage`;
  const followUrl = `${location.origin}/show/${showId}/follow`;
  const stageQr = useQr(stageUrl);
  const followQr = useQr(followUrl);

  if (!token) {
    return (
      <div className="page">
        <div className="mg-callout mg-callout--warning">
          This device has no host key for this show. Open the original host
          link (it carries the key) on this device.
        </div>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="page" style={{ paddingTop: "18vh", textAlign: "center" }}>
        <span className="mg-spinner" />
        <p className="text-body" style={{ marginTop: "var(--space-4)" }}>
          {connected ? "Loading your show…" : "Waking the show up…"}
        </p>
        <p className="text-caption text-muted" style={{ marginTop: "var(--space-2)" }}>
          The first open after a quiet spell can take up to a minute — it's working, hang tight.
        </p>
      </div>
    );
  }

  const act = (action: Parameters<typeof sendAction>[0]) => sendAction(action, token);
  const setActs = (acts: Act[]) => act({ type: "setActs", acts });

  const { clock } = state;
  const now = serverNow();
  const seg = clock.segment;
  const upNext = nextAct(state);

  function addAct(kind: Act["kind"]) {
    const name = kind === "break" ? "Break" : newName.trim();
    if (!name) return;
    setActs([
      ...state!.acts,
      {
        id: crypto.randomUUID(),
        kind,
        name,
        durationSec: clampMinutes(newMinutes) * 60,
        warnBeforeSec: DEFAULT_WARN_BEFORE_SEC,
      },
    ]);
    setNewName("");
  }

  function updateAct(id: string, patch: Partial<Act>) {
    setActs(state!.acts.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function removeAct(id: string) {
    setActs(state!.acts.filter((a) => a.id !== id));
  }

  function moveAct(id: string, dir: -1 | 1) {
    const acts = [...state!.acts];
    const i = acts.findIndex((a) => a.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= acts.length) return;
    [acts[i], acts[j]] = [acts[j]!, acts[i]!];
    setActs(acts);
  }

  const onStageActId = seg?.kind === "act" ? seg.actId : null;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="text-overline">hahaplan · host</div>
          <h2 className="text-h2">{state.name}</h2>
        </div>
        <span className={`mg-badge ${connected ? "mg-badge--success" : "mg-badge--danger"}`}>
          {connected ? "live" : "reconnecting"}
        </span>
      </header>

      {lastError && <div className="mg-callout mg-callout--danger">{lastError}</div>}

      {/* ------------------------------------------------ now on stage --- */}
      <div className="mg-card">
        <div className="text-overline">
          {clock.status === "idle" && "ready"}
          {clock.status === "ended" && "that's the show"}
          {seg?.kind === "act" && `on stage · ${seg.actKind}`}
          {seg?.kind === "host" && "host segment"}
          {clock.status === "paused" && " · paused"}
        </div>
        <div className="row row--wrap" style={{ marginTop: "var(--space-2)" }}>
          <div className="grow">
            <div className="text-h3">
              {seg?.kind === "act" ? seg.name : seg?.kind === "host" ? "You're on." : "—"}
            </div>
            <div className="text-caption" style={{ marginTop: "var(--space-1)" }}>
              {upNext ? `Up next: ${upNext.name}` : "Nobody up next"}
            </div>
          </div>
          <div className="now-block">
            <div className="now-clock">
              {formatClock(elapsedMs(clock, now))}
            </div>
            {seg?.kind === "act" && (
              <div className="clock-target">of {formatClock(seg.durationSec * 1000)}</div>
            )}
          </div>
        </div>
        <div className="controls" style={{ marginTop: "var(--space-4)" }}>
          <button
            className="mg-btn mg-btn--primary mg-btn--lg"
            onClick={() => act({ type: "start" })}
            disabled={seg?.kind === "act"}
          >
            Start
          </button>
          <button className="mg-btn mg-btn--accent mg-btn--lg" onClick={() => act({ type: "next" })}>
            Next
          </button>
          {clock.status === "paused" ? (
            <button className="mg-btn mg-btn--secondary" onClick={() => act({ type: "resume" })}>
              Resume
            </button>
          ) : (
            <button
              className="mg-btn mg-btn--secondary"
              onClick={() => act({ type: "pause" })}
              disabled={clock.status !== "running"}
            >
              Pause
            </button>
          )}
        </div>
      </div>

      {/* ----------------------------------------------------- lineup ---- */}
      <div className="mg-card">
        <div className="text-title-2">Lineup</div>
        {state.acts.length === 0 && (
          <p className="text-body-sm text-muted" style={{ marginTop: "var(--space-2)" }}>
            No acts yet. Add your first performer below.
          </p>
        )}
        <ul className="lineup" style={{ marginTop: "var(--space-2)" }}>
          {state.acts.map((a) => {
            const done = state.doneActIds.includes(a.id);
            const onStage = a.id === onStageActId;
            return (
              <li key={a.id}>
                <span className={`act-name text-body ${done ? "act-done" : ""}`}>
                  {a.name}
                  {onStage && (
                    <span className="mg-badge mg-badge--accent" style={{ marginLeft: "var(--space-2)" }}>
                      on stage
                    </span>
                  )}
                  {a.kind === "break" && (
                    <span className="mg-tag" style={{ marginLeft: "var(--space-2)" }}>break</span>
                  )}
                </span>
                <label className="act-field" title="Set length in minutes">
                  <input
                    key={`min-${a.id}-${a.durationSec}`}
                    className="mg-input"
                    type="number"
                    min={1}
                    max={240}
                    defaultValue={Math.round(a.durationSec / 60)}
                    onBlur={(e) => {
                      const sec = clampMinutes(Number(e.target.value)) * 60;
                      if (sec !== a.durationSec) updateAct(a.id, { durationSec: sec });
                    }}
                  />
                  min
                </label>
                <button className="mg-iconbtn mg-iconbtn--sm mg-iconbtn--ghost" title="Move up"
                  onClick={() => moveAct(a.id, -1)}>↑</button>
                <button className="mg-iconbtn mg-iconbtn--sm mg-iconbtn--ghost" title="Move down"
                  onClick={() => moveAct(a.id, 1)}>↓</button>
                <button className="mg-iconbtn mg-iconbtn--sm mg-iconbtn--ghost" title="Remove"
                  disabled={onStage} onClick={() => removeAct(a.id)}>✕</button>
              </li>
            );
          })}
        </ul>
        <div className="row row--wrap" style={{ marginTop: "var(--space-3)" }}>
          <input
            className="mg-input grow"
            placeholder="Performer name"
            value={newName}
            maxLength={120}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addAct("performer")}
          />
          <input
            className="mg-input"
            style={{ width: "5.5rem" }}
            type="number"
            min={1}
            max={240}
            value={newMinutes}
            onChange={(e) => setNewMinutes(Number(e.target.value))}
            title="Set length in minutes"
          />
          <span className="text-caption">min</span>
          <button className="mg-btn mg-btn--secondary" onClick={() => addAct("performer")}>
            Add
          </button>
          <button className="mg-btn mg-btn--ghost" onClick={() => addAct("break")}>
            Add break
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------ share ---- */}
      <div className="mg-card">
        <div className="text-title-2">Share</div>
        <p className="text-body-sm text-muted" style={{ marginTop: "var(--space-2)" }}>
          Stage display goes on the device facing the performer. Follow is for
          the comedians in the back.
        </p>
        <div className="row row--wrap" style={{ marginTop: "var(--space-4)", justifyContent: "space-around" }}>
          <div className="share-qr">
            <span className="text-overline">stage</span>
            {stageQr && <img src={stageQr} alt="Stage display QR" width={160} height={160} />}
            <span className="link-mono">{stageUrl}</span>
          </div>
          <div className="share-qr">
            <span className="text-overline">follow</span>
            {followQr && <img src={followQr} alt="Follow view QR" width={160} height={160} />}
            <span className="link-mono">{followUrl}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
