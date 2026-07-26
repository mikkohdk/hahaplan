/**
 * Whisper speech-to-text in a Web Worker (P1 stage-client spike).
 *
 * All inference is local: transformers.js fetches the model from the Hugging
 * Face CDN once (cached), then runs it in-browser via WebGPU (fast) or WASM
 * (fallback). Audio never leaves the device — only text is posted back.
 *
 * Runs in a worker so Whisper inference can't freeze the stage clock.
 */
import { pipeline, env } from "@huggingface/transformers";

// Fetch models from the hub; we bundle none locally.
env.allowLocalModels = false;
// Single-threaded WASM: the multi-threaded build needs SharedArrayBuffer, which
// requires cross-origin-isolation headers (COOP/COEP) we don't set. Forcing one
// thread avoids that entirely — slower, but it actually runs.
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
}

// Base English model (~74 MB). small.en is more accurate but too slow to keep
// up in real time on a typical stage GPU (it lags ~a minute behind); base.en
// stays a few seconds behind while still being far better than tiny at proper
// nouns (place names). This is the practical real-time ceiling in-browser.
const MODEL = "Xenova/whisper-base.en";

const ctx = self as unknown as {
  postMessage: (msg: unknown) => void;
  onmessage: ((e: MessageEvent) => void) | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Transcriber = (audio: Float32Array, opts?: any) => Promise<any>;

let transcriber: Transcriber | null = null;
let loading: Promise<Transcriber> | null = null;
let mode: "webgpu" | "wasm" = "wasm";

async function build(device: "webgpu" | "wasm"): Promise<Transcriber> {
  const opts = device === "webgpu" ? { device, dtype: "fp32" as const } : {};
  return (await pipeline(
    "automatic-speech-recognition",
    MODEL,
    opts,
  )) as unknown as Transcriber;
}

async function getTranscriber(): Promise<Transcriber> {
  if (transcriber) return transcriber;
  if (!loading) {
    loading = (async () => {
      try {
        const t = await build("webgpu");
        mode = "webgpu";
        return t;
      } catch {
        const t = await build("wasm");
        mode = "wasm";
        return t;
      }
    })().catch((err) => {
      loading = null; // let a later chunk retry the load
      throw err;
    });
  }
  transcriber = await loading;
  return transcriber;
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// Serialize inference: onnxruntime handles one call at a time.
let queue: Promise<void> = Promise.resolve();

ctx.onmessage = (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === "load") {
    ctx.postMessage({ type: "status", status: "loading" });
    getTranscriber()
      .then(() => ctx.postMessage({ type: "status", status: "ready", device: mode }))
      .catch((err) => ctx.postMessage({ type: "error", message: errText(err) }));
    return;
  }

  if (msg.type === "audio") {
    queue = queue.then(async () => {
      const audio = msg.audio as Float32Array;
      try {
        try {
          const t = await getTranscriber();
          const t0 = performance.now();
          const out = await t(audio);
          // If inference ms exceeds the audio's seconds, we're slower than
          // real time and will fall behind. Visible in the stage tab console.
          console.log(
            `[whisper] ${mode}: ${(performance.now() - t0).toFixed(0)}ms for ` +
              `${(audio.length / 16000).toFixed(1)}s of audio`,
          );
          emit(out);
        } catch (err) {
          // WebGPU can load but fail at inference on some devices/models — drop
          // to WASM for the rest of the session and retry this chunk once.
          if (mode === "webgpu") {
            transcriber = null;
            loading = null;
            transcriber = await build("wasm");
            mode = "wasm";
            ctx.postMessage({ type: "status", status: "ready", device: mode });
            emit(await transcriber(audio));
          } else {
            ctx.postMessage({ type: "error", message: errText(err) });
          }
        }
      } catch (err2) {
        ctx.postMessage({ type: "error", message: `wasm: ${errText(err2)}` });
      } finally {
        // Ack so the client knows the worker is free (backpressure).
        ctx.postMessage({ type: "done" });
      }
    });
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function emit(out: any) {
  const text = Array.isArray(out) ? out.map((o) => o.text).join(" ") : (out?.text ?? "");
  const clean = String(text).trim();
  if (clean) ctx.postMessage({ type: "text", text: clean });
}
