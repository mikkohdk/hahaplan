import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { checkWebGPU, detectBrowser } from "../lib/capability";
import { useTranscription } from "../lib/useTranscription";

/**
 * Standalone device check + live demo. No show, no lineup — a prospective user
 * opens this, sees whether their device can run on-device transcription, and
 * proves it by talking and watching the text appear. Everything stays local.
 */
export function CheckPage() {
  const browser = useMemo(detectBrowser, []);
  const [webgpu, setWebgpu] = useState<boolean | null>(null);
  useEffect(() => {
    checkWebGPU().then(setWebgpu);
  }, []);

  const { status, text, error, device, start, stop } = useTranscription();
  const [armed, setArmed] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [text]);

  const ready = webgpu === true && browser.verdict !== "weak";

  return (
    <div className="page" style={{ paddingTop: "8vh" }}>
      <div>
        <div className="text-overline">hahaplan · device check</div>
        <h1 className="text-display-3">Will it run here?</h1>
        <p className="text-body-lg text-muted" style={{ marginTop: "var(--space-3)" }}>
          hahaplan transcribes live comedy right on the stage device — no audio
          ever leaves the machine, no accounts, no running cost. Check this
          device and try it for yourself.
        </p>
      </div>

      <div className="mg-card">
        <div className="text-title-2">This device</div>
        <ul className="check-list" style={{ marginTop: "var(--space-3)" }}>
          <li>
            <span
              className={`mg-badge ${
                webgpu ? "mg-badge--success" : webgpu === false ? "mg-badge--danger" : ""
              }`}
            >
              {webgpu === null ? "…" : webgpu ? "yes" : "no"}
            </span>
            <span className="text-body">GPU acceleration (WebGPU)</span>
          </li>
          <li>
            <span
              className={`mg-badge ${
                browser.verdict === "ideal"
                  ? "mg-badge--success"
                  : browser.verdict === "weak"
                    ? "mg-badge--danger"
                    : ""
              }`}
            >
              {browser.name}
            </span>
            <span className="text-body">
              {browser.verdict === "ideal" && "great for this"}
              {browser.verdict === "good" && "works well"}
              {browser.verdict === "weak" && "runs, but slow — prefer Chrome, Edge or Safari"}
              {browser.verdict === "unknown" && "should work"}
            </span>
          </li>
        </ul>
        <div
          className={`mg-callout ${ready ? "mg-callout--success" : "mg-callout--warning"}`}
          style={{ marginTop: "var(--space-4)" }}
        >
          {webgpu === null
            ? "Checking…"
            : ready
              ? "Looks good — this device can run live transcription."
              : webgpu === false
                ? "No GPU acceleration here. It can still run on the CPU, just slowly. For the stage display, use a device with WebGPU — most modern PCs, Macs and iPads have it."
                : `This runs best in Chrome, Edge or Safari — ${browser.name} will be noticeably slower.`}
        </div>
      </div>

      <div className="mg-card">
        <div className="text-title-2">Try it live</div>
        <p className="text-body-sm text-muted" style={{ marginTop: "var(--space-2)" }}>
          Tap start, allow the microphone, and talk. It all runs inside this page
          — your audio never leaves the device.
        </p>
        {!armed ? (
          <button
            className="mg-btn mg-btn--primary mg-btn--lg mg-btn--block"
            style={{ marginTop: "var(--space-4)" }}
            onClick={async () => {
              setArmed(true);
              await start();
            }}
          >
            Start the live test
          </button>
        ) : (
          <>
            <div
              className="row"
              style={{ justifyContent: "space-between", marginTop: "var(--space-4)" }}
            >
              <span className="text-caption">
                {status === "idle" && "starting…"}
                {status === "loading" && "loading model…"}
                {status === "listening" && `● listening${device ? ` · ${device}` : ""}`}
                {status === "error" && "error"}
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
            <div className="check-transcript" ref={boxRef} style={{ marginTop: "var(--space-3)" }}>
              {status === "error" ? `⚠ ${error ?? "error"}` : text || "…"}
            </div>
            {status === "loading" && (
              <p className="text-caption text-muted" style={{ marginTop: "var(--space-2)" }}>
                First run downloads the model (~74 MB) — a few seconds, then it's cached.
              </p>
            )}
          </>
        )}
      </div>

      <p className="text-caption">
        <Link to="/">← Back</Link> · Powered by free, open-source AI (Whisper via
        transformers.js), running on your device.
      </p>
    </div>
  );
}
