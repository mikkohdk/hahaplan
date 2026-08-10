/**
 * Laugh-lab capture hook (experiment, isolated from the production stage hook).
 *
 * Captures the mic once and runs two INDEPENDENT streams, because they want
 * different time scales:
 *   • Transcript — Whisper on ~5s windows (words need context).
 *   • Sound probe — an AudioSet classifier on a short ~1.6s window every ~1.2s,
 *     plus model-free features (spectral flatness, ZCR). Short + overlapping so a
 *     laugh burst gets its own window and isn't diluted by a whole punchline of
 *     speech. This is the key fix over judging one 5s window.
 * Everything stays on the device.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { spectralFlatness, zeroCrossingRate } from "./signal";

export type LabStatus = "idle" | "loading" | "listening" | "error";

export interface AudioEvent {
  label: string;
  score: number;
}
export interface TranscriptItem {
  t: number;
  rms: number;
  text: string;
  spoke: boolean;
}
export interface SoundItem {
  t: number;
  rms: number;
  zcr: number;
  flatness: number;
  events: AudioEvent[];
}

const TARGET_RATE = 16000;
const FLUSH_MS = 5000; // transcript window
const PROBE_MS = 150; // how often we check whether the classifier is free
// Short window so each (heavy) inference is cheap; back-to-back probing then
// tiles the timeline. Kept a touch above real time so consecutive windows meet.
const PROBE_SEC = 2.5;
const RING_SEC = 3.0; // how much recent audio to retain for probes

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

function concat(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function rmsOf(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / x.length);
}

export function useLaughLab(opts?: { transcribe?: boolean }) {
  const optsRef = useRef(opts);
  optsRef.current = opts; // always read the latest option at start()

  const [status, setStatus] = useState<LabStatus>("idle");
  const [device, setDevice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [sounds, setSounds] = useState<SoundItem[]>([]);

  const whisperRef = useRef<Worker | null>(null);
  const classRef = useRef<Worker | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const bufRef = useRef<Float32Array[]>([]); // accumulates for the 5s transcript window
  const ringRef = useRef<Float32Array[]>([]); // last ~RING_SEC for the sound probe
  const ringLenRef = useRef(0);
  const flushRef = useRef<number | undefined>(undefined);
  const probeRef = useRef<number | undefined>(undefined);
  const levelRef = useRef(0);

  const whisperBusyRef = useRef(false);
  const classBusyRef = useRef(false);
  const pendingTextRef = useRef<{ rms: number; text: string; spoke: boolean } | null>(null);
  const pendingSoundRef = useRef<Omit<SoundItem, "events"> | null>(null);

  const stop = useCallback(() => {
    window.clearInterval(flushRef.current);
    window.clearInterval(probeRef.current);
    flushRef.current = undefined;
    probeRef.current = undefined;
    bufRef.current = [];
    ringRef.current = [];
    ringLenRef.current = 0;
    whisperBusyRef.current = false;
    classBusyRef.current = false;
    pendingTextRef.current = null;
    pendingSoundRef.current = null;
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    whisperRef.current?.terminate();
    whisperRef.current = null;
    classRef.current?.terminate();
    classRef.current = null;
    levelRef.current = 0;
    setLevel(0);
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    try {
      setError(null);
      setTranscripts([]);
      setSounds([]);
      setLevel(0);
      levelRef.current = 0;
      setStatus("loading");

      const transcribe = optsRef.current?.transcribe ?? false;
      let whisperReady = !transcribe; // if we're not running Whisper, it's "ready"
      let classReady = false;
      const markReady = () => {
        if (whisperReady && classReady) setStatus((s) => (s === "error" ? s : "listening"));
      };

      if (transcribe) {
        const whisper = new Worker(new URL("./whisperWorker.ts", import.meta.url), {
          type: "module",
        });
        whisperRef.current = whisper;
        whisper.onmessage = (e) => {
          const m = e.data;
          if (m.type === "status" && m.status === "ready") {
            setDevice(m.device ?? null);
            whisperReady = true;
            markReady();
          } else if (m.type === "text" && m.text && pendingTextRef.current) {
            pendingTextRef.current.text = String(m.text);
            const words = pendingTextRef.current.text.trim().split(/\s+/).filter(Boolean).length;
            if (words >= 2) pendingTextRef.current.spoke = true;
          } else if (m.type === "done") {
            const p = pendingTextRef.current;
            pendingTextRef.current = null;
            whisperBusyRef.current = false;
            if (p && p.text) {
              setTranscripts((prev) =>
                [...prev, { t: Date.now(), rms: p.rms, text: p.text, spoke: p.spoke }].slice(-300),
              );
            }
          } else if (m.type === "error") {
            setError(m.message);
            setStatus("error");
          }
        };
        whisper.postMessage({ type: "load" });
      }

      const classifier = new Worker(new URL("./audioEventWorker.ts", import.meta.url), {
        type: "module",
      });
      classRef.current = classifier;
      classifier.onmessage = (e) => {
        const m = e.data;
        if (m.type === "status" && m.status === "ready") {
          setDevice((d) => d ?? m.device ?? null);
          classReady = true;
          markReady();
        } else if (m.type === "labels") {
          const p = pendingSoundRef.current;
          pendingSoundRef.current = null;
          classBusyRef.current = false;
          if (p) {
            setSounds((prev) => [...prev, { ...p, events: m.labels ?? [] }].slice(-500));
          }
        } else if (m.type === "done") {
          classBusyRef.current = false;
        } else if (m.type === "error") {
          setError(m.message);
          setStatus("error");
        }
      };
      classifier.postMessage({ type: "load" });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: TARGET_RATE });
      ctxRef.current = audioCtx;
      await audioCtx.resume();
      const rate = audioCtx.sampleRate;

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      const mute = audioCtx.createGain();
      mute.gain.value = 0;

      const ringMax = Math.floor(RING_SEC * rate);
      processor.onaudioprocess = (e) => {
        const ch = new Float32Array(e.inputBuffer.getChannelData(0));
        if (transcribe) bufRef.current.push(ch); // only accumulate if Whisper runs
        // Rolling ring buffer of recent audio for the sound probe.
        ringRef.current.push(ch);
        ringLenRef.current += ch.length;
        while (ringLenRef.current > ringMax && ringRef.current.length > 1) {
          ringLenRef.current -= ringRef.current.shift()!.length;
        }
        let sq = 0;
        for (let i = 0; i < ch.length; i++) sq += ch[i]! * ch[i]!;
        levelRef.current = levelRef.current * 0.6 + Math.sqrt(sq / ch.length) * 0.4;
        setLevel(levelRef.current);
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(audioCtx.destination);

      setStatus((s) => (s === "error" ? s : "listening"));

      // Transcript stream: whole 5s windows → Whisper (only when enabled).
      if (transcribe) {
        flushRef.current = window.setInterval(() => {
          if (whisperBusyRef.current) return;
          const chunks = bufRef.current;
          if (chunks.length === 0) return;
          bufRef.current = [];
          let merged = concat(chunks);
          const maxLen = 20 * rate;
          if (merged.length > maxLen) merged = merged.slice(merged.length - maxLen);
          const rms = rmsOf(merged);
          if (rms < 0.0025) return;
          const audio = resample(merged, rate, TARGET_RATE);
          pendingTextRef.current = { rms, text: "", spoke: false };
          whisperBusyRef.current = true;
          whisperRef.current?.postMessage({ type: "audio", audio }, [audio.buffer]);
        }, FLUSH_MS);
      }

      // Sound stream: short overlapping windows → classifier + features.
      const probeLen = Math.floor(PROBE_SEC * rate);
      probeRef.current = window.setInterval(() => {
        if (classBusyRef.current) return;
        if (ringRef.current.length === 0) return;
        let recent = concat(ringRef.current);
        if (recent.length > probeLen) recent = recent.slice(recent.length - probeLen);
        const rms = rmsOf(recent);
        if (rms < 0.004) return; // skip near-silence
        const audio = resample(recent, rate, TARGET_RATE);
        pendingSoundRef.current = {
          t: Date.now(),
          rms,
          zcr: zeroCrossingRate(audio),
          flatness: spectralFlatness(audio),
        };
        classBusyRef.current = true;
        classRef.current?.postMessage({ type: "audio", audio }, [audio.buffer]);
      }, PROBE_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, []);

  useEffect(() => stop, [stop]);

  return { status, device, error, level, transcripts, sounds, start, stop };
}
