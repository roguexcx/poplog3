"use client";
import { useEffect } from "react";

import {
  areAdsEnabled,
  getAdPlacementConfig,
  getAdSenseClientId,
  getAdSenseSlotId,
  shouldReserveDisabledAdSpace,
  type AdSlotPlacement,
} from "@/lib/ads/config";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

type AdSlotProps = {
  placement: AdSlotPlacement;
  slotId?: string;
  className?: string;
  reserveWhenDisabled?: boolean;
  minHeight?: number;
};

export default function AdSlot({
  placement,
  slotId,
  className,
  reserveWhenDisabled,
  minHeight,
}: AdSlotProps) {
  const placementConfig = getAdPlacementConfig(placement);
  const resolvedSlotId = slotId ?? getAdSenseSlotId(placement);
  const resolvedMinHeight = minHeight ?? placementConfig.minHeight;
  const enabled = areAdsEnabled();
  const clientId = getAdSenseClientId();
  const shouldReserve = reserveWhenDisabled ?? (shouldReserveDisabledAdSpace() && placementConfig.reservedByDefault);

  useEffect(() => {
    if (!enabled || !clientId || !resolvedSlotId) return;

    try {
      window.adsbygoogle = window.adsbygoogle ?? [];
      window.adsbygoogle.push({});
    } catch (error) {
      console.warn("[ads] failed to request ad slot", {
        placement,
        error,
      });
    }
  }, [clientId, enabled, placement, resolvedSlotId]);

  if (!enabled || !clientId || !resolvedSlotId) {
    if (!shouldReserve) return null;

    return (
      <div
        aria-hidden="true"
        data-ad-placement={placement}
        className={className}
        style={{ minHeight: resolvedMinHeight }}
      />
    );
  }

  return (
    <ins
      className={["adsbygoogle", className].filter(Boolean).join(" ")}
      style={{ display: "block", minHeight: resolvedMinHeight }}
      data-ad-client={clientId}
      data-ad-slot={resolvedSlotId}
      data-ad-format="auto"
      data-full-width-responsive="true"
      data-ad-placement={placement}
    />
  );
}
