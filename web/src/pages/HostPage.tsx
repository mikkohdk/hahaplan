import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  DEFAULT_WARN_BEFORE_SEC,
  type Act,
  elapsedMs,
  formatClock,
  nextAct,
} from "../../../shared/protocol";
import { Keywords } from "../components/Keywords";
import { ShareLink } from "../components/ShareLink";
import { claimHostToken } from "../lib/api";
import { ChevronDown, ChevronUp, X } from "../lib/icons";
import {
  deleteTemplate,
  loadTemplates,
  saveTemplate,
  templateActs,
  type Template,
} from "../lib/templates";
import { useShow, useTick } from "../lib/useShow";

const clampMinutes = (n: number) => Math.min(240, Math.max(1, Math.round(n || 1)));

/**
 * Per-act minutes field. Controlled so the spinner arrows commit (not just
 * blur), debounced so typing multi-digit numbers isn't cut off, and synced to
 * the act's real duration when it changes elsewhere.
 */
function MinutesField({
  minutes,
  onCommit,
}: {
  minutes: number;
  onCommit: (m: number) => void;
}) {
  const [val, setVal] = useState(String(minutes));
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setVal(String(minutes));
  }, [minutes]);

  const change = (raw: string) => {
    setVal(raw);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onCommit(clampMinutes(Number(raw))), 400);
  };

  return (
    <input
      className="mg-input"
      type="number"
      min={1}
      max={240}
      value={val}
      onChange={(e) => change(e.target.value)}
      onBlur={() => {
        window.clearTimeout(timer.current);
        onCommit(clampMinutes(Number(val)));
      }}
    />
  );
}

export function HostPage() {
  const { showId = "" } = useParams();
  const token = useMemo(() => claimHostToken(showId), [showId]);
  const { state, connected, notFound, lastError, sendAction, serverNow } = useShow(showId);
  useTick(200);

  const [newName, setNewName] = useState("");
  const [newMinutes, setNewMinutes] = useState(5);
  const [templates, setTemplates] = useState<Template[]>(() => loadTemplates());

  const stageUrl = `${location.origin}/show/${showId}/stage`;
  const followUrl = `${location.origin}/show/${showId}/follow`;
  const signupUrl = `${location.origin}/show/${showId}/signup`;

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
  if (notFound) {
    return (
      <div className="page" style={{ paddingTop: "16vh", textAlign: "center" }}>
        <h2 className="text-h3">This show is no longer available</h2>
        <p className="text-body text-muted" style={{ marginTop: "var(--space-3)" }}>
          The server restarted and this show wasn't saved — on the free tier,
          shows don't persist across restarts. Start a fresh one to keep going.
        </p>
        <a
          className="mg-btn mg-btn--primary mg-btn--lg"
          href="/"
          style={{ marginTop: "var(--space-5)" }}
        >
          Create a new show
        </a>
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

  function nextActName(): string {
    // Auto-name unnamed performers "Act N" using the next unused number, so it
    // doesn't collide if some acts were renamed or deleted.
    const used = state!.acts
      .map((a) => /^Act (\d+)$/.exec(a.name)?.[1])
      .filter((n): n is string => n != null)
      .map(Number);
    return `Act ${(used.length ? Math.max(...used) : 0) + 1}`;
  }

  function addAct(kind: Act["kind"]) {
    const name =
      kind === "break" ? "Break" : newName.trim() || nextActName();
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

  function onSaveTemplate() {
    const name = window.prompt("Save this lineup as a template — name:", state!.name);
    if (name === null) return;
    setTemplates(saveTemplate(name, state!.acts));
  }

  function onLoadTemplate(t: Template) {
    if (
      state!.acts.length > 0 &&
      !window.confirm(`Replace the current lineup with "${t.name}"?`)
    )
      return;
    setActs(templateActs(t));
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
        {/* Next is the primary, always-there action — big and dominant. Start,
            Pause/Resume, Stop and Restart are the smaller supporting controls. */}
        <button
          className="mg-btn mg-btn--accent mg-btn--block"
          onClick={() => act({ type: "next" })}
          style={{
            marginTop: "var(--space-4)",
            fontSize: "1.5rem",
            minHeight: "4rem",
            fontWeight: 700,
          }}
        >
          Next
        </button>
        <div className="controls" style={{ marginTop: "var(--space-3)" }}>
          <button
            className="mg-btn mg-btn--secondary"
            onClick={() => act({ type: "start" })}
            disabled={seg?.kind === "act"}
          >
            Start
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
          <button
            className="mg-btn mg-btn--secondary"
            onClick={() => window.confirm("End the show now?") && act({ type: "stop" })}
            disabled={clock.status === "idle" || clock.status === "ended"}
          >
            Stop
          </button>
          <button
            className="mg-btn mg-btn--ghost"
            onClick={() =>
              window.confirm(
                "Restart the show from the beginning? This clears the running order and captured mentions.",
              ) && act({ type: "restart" })
            }
            disabled={clock.status === "idle"}
          >
            Restart
          </button>
        </div>
      </div>

      {/* --------------------------------------------------- keywords ---- */}
      <div className="mg-card">
        <div className="text-title-2">Mentioned</div>
        {state.keywords.length === 0 ? (
          <p className="text-body-sm text-muted" style={{ marginTop: "var(--space-2)" }}>
            {state.transcribe
              ? "Listening on the stage — nothing captured yet."
              : "Capture is off. Tick the consent box under the lineup to note the locations and professions performers mention."}
          </p>
        ) : (
          <div style={{ marginTop: "var(--space-3)" }}>
            <Keywords keywords={state.keywords} />
          </div>
        )}
      </div>

      {/* -------------------------------------------------- open-mic signup --- */}
      <div className="mg-card">
        <div className="row row--wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="text-title-2">Open-mic sign-up</div>
          <button
            className={`mg-btn mg-btn--sm ${state.signup.open ? "mg-btn--danger" : "mg-btn--primary"}`}
            onClick={() =>
              act({ type: "setSignup", open: !state.signup.open, defaultSec: state.signup.defaultSec })
            }
          >
            {state.signup.open ? "Close sign-up" : "Open sign-up"}
          </button>
        </div>
        <div
          className="row row--wrap"
          style={{ marginTop: "var(--space-3)", alignItems: "center", gap: "var(--space-2)" }}
        >
          <span className="text-body-sm text-muted">Each spot</span>
          <label className="act-field" title="Default slot length in minutes">
            <MinutesField
              minutes={Math.round(state.signup.defaultSec / 60)}
              onCommit={(m) =>
                act({ type: "setSignup", open: state.signup.open, defaultSec: m * 60 })
              }
            />
            min
          </label>
          <span className="text-body-sm text-muted">· performers add their own name</span>
        </div>
        <p className="text-body-sm text-muted" style={{ marginTop: "var(--space-3)" }}>
          {state.signup.open
            ? "Sign-up is open — share the link from the Share section below."
            : "Open sign-up before the show, then share the link — performers add themselves and you keep control of the order."}
        </p>
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
                  <MinutesField
                    minutes={Math.round(a.durationSec / 60)}
                    onCommit={(m) => {
                      const sec = m * 60;
                      if (sec !== a.durationSec) updateAct(a.id, { durationSec: sec });
                    }}
                  />
                  min
                </label>
                <button className="mg-iconbtn mg-iconbtn--sm mg-iconbtn--ghost" title="Move up"
                  onClick={() => moveAct(a.id, -1)}><ChevronUp /></button>
                <button className="mg-iconbtn mg-iconbtn--sm mg-iconbtn--ghost" title="Move down"
                  onClick={() => moveAct(a.id, 1)}><ChevronDown /></button>
                <button className="mg-iconbtn mg-iconbtn--sm mg-iconbtn--ghost" title="Remove"
                  disabled={onStage} onClick={() => removeAct(a.id)}><X /></button>
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

        <label
          className="consent-box"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "var(--space-3)",
            marginTop: "var(--space-4)",
            paddingTop: "var(--space-4)",
            borderTop: "1px solid var(--border-subtle)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={state.transcribe}
            onChange={(e) => act({ type: "setTranscribe", on: e.target.checked })}
            style={{ marginTop: "0.15rem", width: "1.15rem", height: "1.15rem", flexShrink: 0 }}
          />
          <span>
            <span className="text-body">Capture locations &amp; professions from the stage</span>
            <span
              className="text-caption text-muted"
              style={{ display: "block", marginTop: "var(--space-1)" }}
            >
              With your consent, the stage screen transcribes each performer to note the
              places and jobs they mention. Audio is never recorded — only the matched
              words. The stage asks for microphone access once, at setup.
            </span>
          </span>
        </label>
      </div>

      {/* -------------------------------------------------- templates ---- */}
      <div className="mg-card">
        <div className="text-title-2">Templates</div>
        <p className="text-body-sm text-muted" style={{ marginTop: "var(--space-2)" }}>
          Save this lineup to reuse for a recurring night, or load a saved one.
          Stored on this device.
        </p>
        <div className="row row--wrap" style={{ marginTop: "var(--space-3)" }}>
          <button
            className="mg-btn mg-btn--secondary"
            disabled={state.acts.length === 0}
            onClick={onSaveTemplate}
          >
            Save this lineup
          </button>
        </div>
        {templates.length > 0 && (
          <ul className="lineup" style={{ marginTop: "var(--space-3)" }}>
            {templates.map((t) => (
              <li key={t.id}>
                <span className="act-name text-body">{t.name}</span>
                <span className="text-caption">{t.acts.length} acts</span>
                <button className="mg-btn mg-btn--ghost mg-btn--sm" onClick={() => onLoadTemplate(t)}>
                  Load
                </button>
                <button
                  className="mg-iconbtn mg-iconbtn--sm mg-iconbtn--ghost"
                  title="Delete template"
                  onClick={() => setTemplates(deleteTemplate(t.id))}
                >
                  <X />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ------------------------------------------------------ share ---- */}
      <div className="mg-card">
        <div className="text-title-2">Share</div>
        <p className="text-body-sm text-muted" style={{ marginTop: "var(--space-2)" }}>
          Every link in one place. Tap <strong>Share</strong> for WhatsApp / email / Messages,
          <strong> Copy link</strong> to paste, or the QR to enlarge it for scanning in the room.
        </p>
        <div style={{ marginTop: "var(--space-3)" }}>
          {state.signup.open && (
            <ShareLink
              label="Sign-up"
              url={signupUrl}
              description="Performers add their own name — share ahead of the show"
            />
          )}
          <ShareLink
            label="Stage display"
            url={stageUrl}
            description="The screen facing the performer (and the pre-show sign-up board)"
          />
          <ShareLink
            label="Follow view"
            url={followUrl}
            description="For the comedians waiting in the back"
          />
        </div>
      </div>
    </div>
  );
}
