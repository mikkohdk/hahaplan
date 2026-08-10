/**
 * Small DSP helpers for the laugh lab. All model-free — they characterise a
 * window of audio by its *texture*, not its loudness: laughter and applause are
 * noise-like and broadband, speech is tonal and structured.
 */

/** In-place iterative radix-2 FFT. re/im must have the same power-of-2 length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wre = Math.cos(ang);
    const wim = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cre = 1;
      let cim = 0;
      for (let k = 0; k < half; k++) {
        const are = re[i + k]!;
        const aim = im[i + k]!;
        const j2 = i + k + half;
        const bre = re[j2]! * cre - im[j2]! * cim;
        const bim = re[j2]! * cim + im[j2]! * cre;
        re[i + k] = are + bre;
        im[i + k] = aim + bim;
        re[j2] = are - bre;
        im[j2] = aim - bim;
        const ncre = cre * wre - cim * wim;
        cim = cre * wim + cim * wre;
        cre = ncre;
      }
    }
  }
}

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/** Fraction of sign changes — noise/fricatives are high, voiced tones low. */
export function zeroCrossingRate(x: Float32Array): number {
  if (x.length < 2) return 0;
  let z = 0;
  for (let i = 1; i < x.length; i++) if (x[i]! >= 0 !== x[i - 1]! >= 0) z++;
  return z / x.length;
}

/**
 * Spectral flatness (Wiener entropy), 0..1: the geometric mean of the power
 * spectrum over its arithmetic mean. Near 1 for noise-like sounds (applause,
 * hissy laughter); near 0 for tonal, formant-structured speech. Averaged over
 * several Hann-windowed frames for stability.
 */
export function spectralFlatness(x: Float32Array): number {
  const N = 1024;
  if (x.length < N) return 0;
  const frames = Math.min(20, Math.floor(x.length / N));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const win = hann(N);
  const power = new Float64Array(N >> 1);
  const step = frames > 1 ? Math.floor((x.length - N) / (frames - 1)) : 0;
  for (let f = 0; f < frames; f++) {
    const off = f * step;
    for (let i = 0; i < N; i++) {
      re[i] = x[off + i]! * win[i]!;
      im[i] = 0;
    }
    fft(re, im);
    for (let i = 0; i < N >> 1; i++) power[i]! += re[i]! * re[i]! + im[i]! * im[i]!;
  }
  let logSum = 0;
  let sum = 0;
  let cnt = 0;
  for (let i = 1; i < N >> 1; i++) {
    const p = power[i]! / frames + 1e-12;
    logSum += Math.log(p);
    sum += p;
    cnt++;
  }
  if (cnt === 0 || sum === 0) return 0;
  const geo = Math.exp(logSum / cnt);
  const arith = sum / cnt;
  return geo / arith;
}
