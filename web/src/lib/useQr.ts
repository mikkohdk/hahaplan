import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Data-URL QR code for a URL, regenerated when the url or pixel size changes. */
export function useQr(url: string, size = 220): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: size })
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [url, size]);
  return src;
}
