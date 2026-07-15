import type { ShowState } from "../../../shared/protocol";

export async function createShow(
  name: string,
): Promise<{ state: ShowState; hostToken: string }> {
  const res = await fetch("/api/shows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Create failed (${res.status})`);
  return res.json();
}

const tokenKey = (showId: string) => `hahaplan:host:${showId}`;

/**
 * The host token travels once in the URL fragment (#t=...) right after show
 * creation, then lives in localStorage so the host link can be re-opened.
 */
export function claimHostToken(showId: string): string | null {
  const match = location.hash.match(/#t=([A-Za-z0-9]+)/);
  if (match) {
    localStorage.setItem(tokenKey(showId), match[1]);
    history.replaceState(null, "", location.pathname);
  }
  return localStorage.getItem(tokenKey(showId));
}
