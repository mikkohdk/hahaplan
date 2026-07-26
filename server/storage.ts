/**
 * Durable transcript storage in an S3-compatible bucket.
 *
 * Render's free tier has an ephemeral disk, so the SQLite copy of a transcript
 * is lost when the instance restarts. This module pushes a copy to external
 * object storage, keyed by show name + timestamp, so a separate offline tool
 * (keyword patch-crawling / data-quality checks) can read the archive later.
 *
 * Provider-agnostic: works with Supabase Storage, Cloudflare R2, Backblaze B2,
 * or AWS S3 — anything that speaks the S3 PutObject API. Configure with:
 *   S3_ENDPOINT           the bucket's S3 endpoint, e.g.
 *                           Supabase: https://<ref>.supabase.co/storage/v1/s3
 *                           R2:       https://<accountid>.r2.cloudflarestorage.com
 *   S3_BUCKET             bucket name
 *   S3_ACCESS_KEY_ID      access key id
 *   S3_SECRET_ACCESS_KEY  secret access key
 *   S3_REGION             optional, defaults to "auto" (R2). Supabase wants its
 *                           project region, e.g. eu-central-1; AWS us-east-1 etc.
 *
 * With none of these set it's a silent no-op — local dev and CI keep working.
 */
import { AwsClient } from "aws4fetch";

const ENDPOINT = process.env.S3_ENDPOINT?.replace(/\/+$/, "");
const BUCKET = process.env.S3_BUCKET;
const ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
const REGION = process.env.S3_REGION ?? "auto";

const enabled = Boolean(ENDPOINT && BUCKET && ACCESS_KEY_ID && SECRET_ACCESS_KEY);

const client = enabled
  ? new AwsClient({
      accessKeyId: ACCESS_KEY_ID!,
      secretAccessKey: SECRET_ACCESS_KEY!,
      region: REGION,
      service: "s3",
    })
  : null;

export function transcriptStorageEnabled(): boolean {
  return enabled;
}

/** Filesystem/URL-safe slug of the show name, so objects are browsable by name. */
function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "untitled";
}

/**
 * Object key for a show: `transcripts/<slug>-<created-at>.txt`.
 * createdAtMs is fixed for the life of a show, so repeated uploads overwrite the
 * same growing object rather than littering the bucket with partial copies.
 */
export function transcriptKey(showName: string, createdAtMs: number): string {
  const ts = new Date(createdAtMs).toISOString().replace(/[:.]/g, "-");
  return `transcripts/${slug(showName)}-${ts}.txt`;
}

/** Upload (overwrite) the full transcript. Resolves silently when disabled. */
export async function putTranscript(
  showName: string,
  createdAtMs: number,
  transcript: string,
): Promise<void> {
  if (!client) return;
  const key = transcriptKey(showName, createdAtMs);
  const res = await client.fetch(`${ENDPOINT}/${BUCKET}/${key}`, {
    method: "PUT",
    body: transcript,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`S3 PUT ${key} → ${res.status} ${res.statusText} ${detail}`.trim());
  }
}
