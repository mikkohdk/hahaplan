/**
 * Audio-event classification in a Web Worker (laugh-lab experiment).
 *
 * Runs an AudioSet classifier (Audio Spectrogram Transformer) locally via
 * transformers.js, so it recognises the *sound* — Laughter, Applause, Cheering,
 * Crowd, Speech, Music — directly, instead of inferring it from gaps in speech
 * recognition. Audio never leaves the device; only labels come back.
 */
import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
}

// AudioSet-finetuned AST (527 classes incl. Laughter/Applause/Cheering/Crowd).
const MODEL = "Xenova/ast-finetuned-audioset-10-10-0.4593";

const ctx = self as unknown as {
  postMessage: (msg: unknown) => void;
  onmessage: ((e: MessageEvent) => void) | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Classifier = (audio: Float32Array, opts?: any) => Promise<any>;

let classifier: Classifier | null = null;
let loading: Promise<Classifier> | null = null;
let modeLabel = "wasm";

// Quantizing (fp16 on GPU, int8 on CPU) is the main lever for speed on this
// heavy (~88M) model, but the quantized weight files may not exist — so try a
// cascade and keep the first that loads, always ending on something that works.
type Attempt = { device: "webgpu" | "wasm"; dtype?: "fp16" | "fp32" | "q8" };
const ATTEMPTS: Attempt[] = [
  { device: "webgpu", dtype: "fp16" },
  { device: "webgpu", dtype: "fp32" },
  { device: "wasm", dtype: "q8" },
  { device: "wasm" },
];

async function build(a: Attempt): Promise<Classifier> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: any = {};
  if (a.device === "webgpu") opts.device = "webgpu";
  if (a.dtype) opts.dtype = a.dtype;
  return (await pipeline("audio-classification", MODEL, opts)) as unknown as Classifier;
}

async function getClassifier(): Promise<Classifier> {
  if (classifier) return classifier;
  if (!loading) {
    loading = (async () => {
      let lastErr: unknown;
      for (const a of ATTEMPTS) {
        try {
          const c = await build(a);
          modeLabel = `${a.device}${a.dtype ? `/${a.dtype}` : ""}`;
          return c;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    })().catch((err) => {
      loading = null;
      throw err;
    });
  }
  classifier = await loading;
  return classifier;
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

let queue: Promise<void> = Promise.resolve();

ctx.onmessage = (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === "load") {
    ctx.postMessage({ type: "status", status: "loading" });
    getClassifier()
      .then(() => ctx.postMessage({ type: "status", status: "ready", device: modeLabel }))
      .catch((err) => ctx.postMessage({ type: "error", message: errText(err) }));
    return;
  }

  if (msg.type === "audio") {
    queue = queue.then(async () => {
      const audio = msg.audio as Float32Array;
      try {
        const c = await getClassifier();
        const out = await c(audio, { top_k: 8 });
        const labels = Array.isArray(out)
          ? out.map((o) => ({ label: String(o.label), score: Number(o.score) }))
          : [];
        ctx.postMessage({ type: "labels", labels });
      } catch (err) {
        ctx.postMessage({ type: "error", message: errText(err) });
      } finally {
        ctx.postMessage({ type: "done" });
      }
    });
  }
};
