/**
 * Device/browser capability checks for the on-device transcription. Used by the
 * standalone /check demo (and available for a stage-side gate later).
 */
export type BrowserVerdict = "ideal" | "good" | "weak" | "unknown";

export function detectBrowser(): { name: string; verdict: BrowserVerdict } {
  const ua = navigator.userAgent;
  // Order matters: Edge/Opera identify as Chrome too, so check them first.
  if (/Edg\//.test(ua)) return { name: "Edge", verdict: "ideal" };
  if (/OPR\//.test(ua)) return { name: "Opera", verdict: "ideal" };
  if (/Firefox\//.test(ua)) return { name: "Firefox", verdict: "weak" };
  if (/Chrome\//.test(ua)) return { name: "Chrome", verdict: "ideal" };
  if (/Safari\//.test(ua)) return { name: "Safari", verdict: "good" };
  return { name: "your browser", verdict: "unknown" };
}

/** True only if WebGPU is present AND actually yields an adapter. */
export async function checkWebGPU(): Promise<boolean> {
  const gpu = (navigator as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}
