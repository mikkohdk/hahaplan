import { useState } from "react";
import { useParams } from "react-router-dom";
import { useShow } from "../lib/useShow";

/**
 * Open-mic self sign-up (public, tokenless). A performer opens the link the
 * host shared, types their name, and gets a slot at the host's default length.
 * Stays live over WebSocket, so the running order updates as others sign up and
 * as the host reorders — all the way through the show.
 */
export function SignupPage() {
  const { showId = "" } = useParams();
  const { state, connected, notFound, lastError, sendSignup } = useShow(showId);
  const [name, setName] = useState("");
  const [added, setAdded] = useState<string | null>(null);

  if (notFound) {
    return (
      <div className="page" style={{ paddingTop: "16vh", textAlign: "center" }}>
        <h2 className="text-h3">This show isn’t available</h2>
        <p className="text-body text-muted" style={{ marginTop: "var(--space-3)" }}>
          The link may be old, or the show has ended.
        </p>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="page" style={{ paddingTop: "18vh", textAlign: "center" }}>
        <span className="mg-spinner" />
        <p className="text-body" style={{ marginTop: "var(--space-4)" }}>
          {connected ? "Loading…" : "Waking the show up…"}
        </p>
      </div>
    );
  }

  const slotMin = Math.round(state.signup.defaultSec / 60);
  const performers = state.acts;

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    sendSignup(n);
    setAdded(n);
    setName("");
  };

  return (
    <div className="page" style={{ paddingTop: "7vh" }}>
      <div>
        <div className="text-overline">hahaplan · open mic</div>
        <h1 className="text-display-3">{state.name}</h1>
      </div>

      {state.signup.open ? (
        <div className="mg-card">
          <div className="text-title-2">Sign up</div>
          <p className="text-body-sm text-muted" style={{ marginTop: "var(--space-2)" }}>
            Add your name — every spot is <strong>{slotMin} min</strong>. The host sets the
            running order.
          </p>
          <div className="row row--wrap" style={{ marginTop: "var(--space-4)" }}>
            <input
              className="mg-input grow"
              placeholder="Your name"
              value={name}
              maxLength={80}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <button
              className="mg-btn mg-btn--primary"
              onClick={submit}
              disabled={!name.trim()}
            >
              Add me
            </button>
          </div>
          {lastError && (
            <div className="mg-callout mg-callout--danger" style={{ marginTop: "var(--space-3)" }}>
              {lastError}
            </div>
          )}
          {added && !lastError && (
            <div className="mg-callout mg-callout--success" style={{ marginTop: "var(--space-3)" }}>
              You’re on the list, {added}! 🎤 Add another name if you like.
            </div>
          )}
        </div>
      ) : (
        <div className="mg-card">
          <div className="mg-callout mg-callout--warning">
            Sign-up isn’t open yet. Keep this page open — it’ll go live the moment the host
            opens it.
          </div>
        </div>
      )}

      <div className="mg-card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="text-title-2">Running order</div>
          <span className="text-caption text-muted">
            {performers.length} {performers.length === 1 ? "spot" : "spots"}
            {!connected && " · reconnecting"}
          </span>
        </div>
        {performers.length === 0 ? (
          <p className="text-body-sm text-muted" style={{ marginTop: "var(--space-2)" }}>
            Nobody yet — be the first!
          </p>
        ) : (
          <ol className="signup-order" style={{ marginTop: "var(--space-3)" }}>
            {performers.map((a) => {
              const done = state.doneActIds.includes(a.id);
              const onStage =
                state.clock.segment?.kind === "act" && state.clock.segment.actId === a.id;
              return (
                <li key={a.id} className={done ? "act-done" : ""}>
                  <span className="text-body">{a.name}</span>
                  {a.kind === "break" && (
                    <span className="mg-tag" style={{ marginLeft: "var(--space-2)" }}>break</span>
                  )}
                  {onStage && (
                    <span className="mg-badge mg-badge--accent" style={{ marginLeft: "var(--space-2)" }}>
                      on stage
                    </span>
                  )}
                  <span className="text-caption text-muted" style={{ marginLeft: "auto" }}>
                    {Math.round(a.durationSec / 60)} min
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
