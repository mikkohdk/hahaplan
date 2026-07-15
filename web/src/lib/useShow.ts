/**
 * Live connection to a show. Reconnects with backoff; the server resends the
 * full state on every (re)connect, so there is no client-side sync logic.
 * Clock offset: every state message carries serverNowMs, so we continuously
 * know how far this device's clock is from the server's.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  HostAction,
  ServerMessage,
  ShowState,
} from "../../../shared/protocol";

export function useShow(showId: string) {
  const [state, setState] = useState<ShowState | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let disposed = false;
    let retries = 0;
    let timer: number | undefined;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws/${showId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retries = 0;
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        if (msg.type === "state") {
          offsetRef.current = msg.serverNowMs - Date.now();
          setState(msg.state);
        } else if (msg.type === "error") {
          setLastError(msg.message);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!disposed) {
          timer = window.setTimeout(connect, Math.min(5000, 500 * 2 ** retries++));
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [showId]);

  const sendAction = useCallback((action: HostAction, token: string) => {
    setLastError(null);
    const msg: ClientMessage = { type: "action", token, action };
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  /** Best estimate of the server's clock right now. */
  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  return { state, connected, lastError, sendAction, serverNow };
}

/** Re-render on an interval so countdowns tick. */
export function useTick(intervalMs = 200): void {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setN((n) => n + 1), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
}
