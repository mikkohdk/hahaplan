import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createShow } from "../lib/api";

export function Landing() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function onCreate() {
    setBusy(true);
    setError(null);
    try {
      const { state, hostToken } = await createShow(name.trim() || "Untitled show");
      navigate(`/show/${state.id}/host#t=${hostToken}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="page" style={{ paddingTop: "12vh" }}>
      <div>
        <div className="text-overline">hahaplan</div>
        <h1 className="text-display-3">Run the room.</h1>
        <p className="text-body-lg text-muted" style={{ marginTop: "var(--space-3)" }}>
          Timers, lineups and cues for live comedy nights. Build the skeleton,
          hit start — everyone else just opens a link.
        </p>
      </div>

      <div className="mg-card">
        <div className="mg-field">
          <label className="text-label" htmlFor="show-name">Show name</label>
          <input
            id="show-name"
            className="mg-input"
            placeholder="Tuesday Open Mic"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && onCreate()}
          />
        </div>
        <button
          className="mg-btn mg-btn--primary mg-btn--lg mg-btn--block"
          style={{ marginTop: "var(--space-4)" }}
          disabled={busy}
          onClick={onCreate}
        >
          {busy ? "Creating…" : "Create show"}
        </button>
        {error && (
          <div className="mg-callout mg-callout--danger" style={{ marginTop: "var(--space-4)" }}>
            {error}
          </div>
        )}
      </div>

      <p className="text-caption">
        Got a stage or follow link from a host? Just open it — no account, no app.
      </p>
    </div>
  );
}
