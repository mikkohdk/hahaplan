/**
 * Stage-client microphone → local Whisper transcription (P1 spike).
 *
 * Captures the mic, batches ~5s windows of 16 kHz mono audio, and hands them to
 * the Whisper worker. Audio stays on the device; only text comes back. `start`
 * must be called from a user gesture (browsers gate mic + AudioContext on one).
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type TranscribeStatus = "idle" | "loading" | "listening" | "error";

const TARGET_RATE = 16000;
const FLUSH_MS = 5000;

/** Linear resample to 16 kHz (no-op when the context already runs at 16 kHz). */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = idx - i0;
    out[i] = input[i0]! * (1 - frac) + input[i1]! * frac;
  }
  return out;
}

export function useTranscription() {
  const [status, setStatus] = useState<TranscribeStatus>("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const bufRef = useRef<Float32Array[]>([]);
  const flushRef = useRef<number | undefined>(undefined);

  const stop = useCallback(() => {
    window.clearInterval(flushRef.current);
    flushRef.current = undefined;
    bufRef.current = [];
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    try {
      setError(null);
      setText("");
      setStatus("loading");

      const worker = new Worker(new URL("./whisperWorker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === "text" && m.text) {
          setText((prev) => (prev ? `${prev} ${m.text}` : m.text));
        } else if (m.type === "error") {
          setError(m.message);
          setStatus("error");
        }
      };
      worker.postMessage({ type: "load" });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: TARGET_RATE });
      ctxRef.current = audioCtx;
      await audioCtx.resume();

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      const mute = audioCtx.createGain();
      mute.gain.value = 0; // route to output at zero gain so the node runs without feedback
      processor.onaudioprocess = (e) => {
        bufRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(audioCtx.destination);

      setStatus((s) => (s === "error" ? s : "listening"));

      flushRef.current = window.setInterval(() => {
        const chunks = bufRef.current;
        if (chunks.length === 0) return;
        bufRef.current = [];
        let total = 0;
        for (const c of chunks) total += c.length;
        const merged = new Float32Array(total);
        let off = 0;
        for (const c of chunks) {
          merged.set(c, off);
          off += c.length;
        }
        const audio = resample(merged, audioCtx.sampleRate, TARGET_RATE);
        workerRef.current?.postMessage({ type: "audio", audio }, [audio.buffer]);
      }, FLUSH_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, []);

  // Tear everything down if the component unmounts mid-capture.
  useEffect(() => stop, [stop]);

  return { status, text, error, start, stop };
}
