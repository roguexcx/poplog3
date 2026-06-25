import Script from "next/script";

import { areAdsEnabled, getAdSenseClientId } from "@/lib/ads/config";

export default function AdSenseBootstrap() {
  const clientId = getAdSenseClientId();

  if (!areAdsEnabled() || !clientId) return null;

  return (
    <Script
      id="poplog-adsense-bootstrap"
      async
      strategy="afterInteractive"
      crossOrigin="anonymous"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(
        clientId,
      )}`}
    />
  );
}
