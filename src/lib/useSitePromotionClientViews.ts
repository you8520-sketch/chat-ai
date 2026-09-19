"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildActiveSitePromotionClientViewMap,
  nearestActiveSitePromotionExpiryMs,
  type SitePromotionClientView,
} from "@/lib/sitePromotionClientView";

const EXPIRY_SCHEDULE_BUFFER_MS = 50;

/**
 * Client lifecycle owner for site promotion badge/notice surfaces.
 * - Hides UI at endsAt without full page reload (one-shot timer, not polling)
 * - Accepts SSR prop updates (router.refresh) and focus-sync API payloads
 */
export function useSitePromotionClientViews(initialPromos: SitePromotionClientView[]) {
  const [promos, setPromos] = useState(initialPromos);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setPromos(initialPromos);
    setNowMs(Date.now());
  }, [initialPromos]);

  useEffect(() => {
    const nearestEndsMs = nearestActiveSitePromotionExpiryMs(promos, nowMs);
    if (nearestEndsMs == null) return;

    const delay = nearestEndsMs - Date.now();
    if (delay <= 0) {
      setNowMs(Date.now());
      return;
    }

    const timer = window.setTimeout(
      () => setNowMs(Date.now()),
      delay + EXPIRY_SCHEDULE_BUFFER_MS
    );
    return () => window.clearTimeout(timer);
  }, [promos, nowMs]);

  const replacePromotions = useCallback((next: SitePromotionClientView[]) => {
    setPromos(next);
    setNowMs(Date.now());
  }, []);

  const activeByModelId = useMemo(
    () => buildActiveSitePromotionClientViewMap(promos, nowMs),
    [promos, nowMs]
  );

  return { activeByModelId, replacePromotions };
}
