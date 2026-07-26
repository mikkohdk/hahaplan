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

// Tiny English model: smallest download (~40 MB) and fastest — enough to prove
// feasibility on the stage device. Swap for whisper-base if accuracy is short.
const MODEL = "Xenova/whisper-tiny.en";

// Worker global, typed loosely so we don't depend on the webworker lib being
// in the web tsconfig (self is otherwise typed as Window here).
const ctx = self as unknown as {
  postMessage: (msg: unknown) => void;
  onmessage: ((e: MessageEvent) => void) | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Transcriber = (audio: Float32Array, opts?: any) => Promise<any>;

let transcriber: Transcriber | null = null;
let loading: Promise<Transcriber> | null = null;

async function getTranscriber(): Promise<Transcriber> {
  if (transcriber) return transcriber;
  if (!loading) {
    loading = (async () => {
      try {
        return (await pipeline("automatic-speech-recognition", MODEL, {
          device: "webgpu",
          dtype: "fp32",
        })) as unknown as Transcriber;
      } catch {
        // No WebGPU (older device / iOS): fall back to WASM — slower but works.
        return (await pipeline(
          "automatic-speech-recognition",
          MODEL,
        )) as unknown as Transcriber;
      }
    })();
  }
  transcriber = await loading;
  return transcriber;
}

// Serialize inference: onnxruntime handles one call at a time, and audio
// chunks can otherwise overlap while the model is still loading.
let queue: Promise<void> = Promise.resolve();

ctx.onmessage = (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === "load") {
    ctx.postMessage({ type: "status", status: "loading" });
    getTranscriber()
      .then(() => ctx.postMessage({ type: "status", status: "ready" }))
      .catch((err) => ctx.postMessage({ type: "error", message: String(err) }));
    return;
  }

  if (msg.type === "audio") {
    queue = queue.then(async () => {
      try {
        const t = await getTranscriber();
        const out = await t(msg.audio as Float32Array);
        const text = Array.isArray(out)
          ? out.map((o) => o.text).join(" ")
          : (out?.text ?? "");
        const clean = String(text).trim();
        if (clean) ctx.postMessage({ type: "text", text: clean });
      } catch (err) {
        ctx.postMessage({ type: "error", message: String(err) });
      }
    });
  }
};
