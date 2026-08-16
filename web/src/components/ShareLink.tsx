import { useState } from "react";
import { useQr } from "../lib/useQr";

/**
 * One shareable link: a tap-to-enlarge QR, the native OS share sheet (WhatsApp,
 * email, Messages…) where available, and a copy-link fallback. The direct URL
 * is what a group chat wants to click; the QR is for scanning in the room.
 */
export function ShareLink({
  label,
  url,
  description,
}: {
  label: string;
  url: string;
  description?: string;
}) {
  const qr = useQr(url, 200);
  const bigQr = useQr(url, 640);
  const [zoom, setZoom] = useState(false);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const share = async () => {
    if (canShare) {
      try {
        await navigator.share({ title: label, text: `${label} — hahaplan`, url });
      } catch {
        /* user cancelled — ignore */
      }
    } else {
      copy();
    }
  };

  const buttons = (
    <>
      {canShare && (
        <button className="mg-btn mg-btn--sm mg-btn--primary" onClick={share}>
          Share
        </button>
      )}
      <button className="mg-btn mg-btn--sm mg-btn--secondary" onClick={copy}>
        {copied ? "Copied ✓" : "Copy link"}
      </button>
    </>
  );

  return (
    <div className="share-link">
      <button
        className="share-link__qr"
        onClick={() => setZoom(true)}
        title="Tap to enlarge for scanning"
      >
        {qr && <img src={qr} alt={`${label} QR code`} width={92} height={92} />}
      </button>
      <div className="share-link__body">
        <div className="text-body" style={{ fontWeight: 600 }}>
          {label}
        </div>
        {description && <div className="text-caption text-muted">{description}</div>}
        <div className="link-mono share-link__url">{url}</div>
        <div className="row" style={{ gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
          {buttons}
        </div>
      </div>

      {zoom && (
        <div className="qr-lightbox" onClick={() => setZoom(false)}>
          <div className="qr-lightbox__inner" onClick={(e) => e.stopPropagation()}>
            <div className="text-title-2" style={{ textAlign: "center" }}>
              {label}
            </div>
            {bigQr && <img src={bigQr} alt={`${label} QR code`} className="qr-lightbox__img" />}
            <div className="link-mono" style={{ textAlign: "center", overflowWrap: "anywhere" }}>
              {url}
            </div>
            <div className="row" style={{ justifyContent: "center", gap: "var(--space-2)" }}>
              {buttons}
              <button className="mg-btn mg-btn--sm mg-btn--ghost" onClick={() => setZoom(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
