/**
 * Widget-active OpenRouter injection footprint — dedupe before/after comparison.
 */

import { estimateTokens } from "@/lib/tokenEstimate";
import { buildPrimaryModelFlashFirewallBlock } from "@/lib/flashOwnedOutputFirewall";
import { buildStatusWidgetPromptBlock } from "./prompt";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import { resolveStatusWidgetTurn } from "./resolve";

/** Pre-dedupe snapshot (2026-06) — append + fat firewall + DeepSeek user-tail reminder */
export const PRE_DEDUPE_WIDGET_ACTIVE_FOOTPRINT = {
  appendInstructionChars: 127,
  widgetBlockChars: 630,
  firewallChars: 460,
  deepSeekUserTailReminderChars: 219,
  combinedAuditSliceChars: 1726,
  totalSystemInjectionChars:
    127 + 630 + 460, // append + widget + firewall (DeepSeek tail is on user message)
  deepSeekUserTurnExtraChars: 219,
} as const;

export type WidgetActiveInjectionFootprint = {
  widgetBlockChars: number;
  firewallChars: number;
  deepSeekUserTailReminderChars: number;
  totalSystemInjectionChars: number;
  deepSeekUserTurnExtraChars: number;
  estimatedSystemTokens: number;
  estimatedDeepSeekUserTailTokens: number;
};

export function measureWidgetActiveOpenRouterInjection(): WidgetActiveInjectionFootprint {
  const resolved = resolveStatusWidgetTurn({
    characterWidgetJson: JSON.stringify(DEFAULT_STATUS_WIDGET),
    chatMode: "character_only",
  });
  const widgetBlock = buildStatusWidgetPromptBlock(resolved);
  const firewall = buildPrimaryModelFlashFirewallBlock({ statusWidgetActive: true });
  const deepSeekUserTailReminderChars = 0;

  const totalSystemInjectionChars = widgetBlock.length + firewall.length;

  return {
    widgetBlockChars: widgetBlock.length,
    firewallChars: firewall.length,
    deepSeekUserTailReminderChars,
    totalSystemInjectionChars,
    deepSeekUserTurnExtraChars: deepSeekUserTailReminderChars,
    estimatedSystemTokens: estimateTokens(`${widgetBlock}\n\n${firewall}`),
    estimatedDeepSeekUserTailTokens: estimateTokens(""),
  };
}

export function compareWidgetActiveDedupe(): {
  before: typeof PRE_DEDUPE_WIDGET_ACTIVE_FOOTPRINT;
  after: WidgetActiveInjectionFootprint;
  savedSystemChars: number;
  savedSystemPct: number;
  savedDeepSeekUserChars: number;
  savedDeepSeekUserPct: number;
  savedTotalCharsPerTurn: number;
  savedTotalPct: number;
} {
  const after = measureWidgetActiveOpenRouterInjection();
  const beforeSystem = PRE_DEDUPE_WIDGET_ACTIVE_FOOTPRINT.totalSystemInjectionChars;
  const afterSystem = after.totalSystemInjectionChars;
  const savedSystemChars = beforeSystem - afterSystem;
  const savedDeepSeekUserChars =
    PRE_DEDUPE_WIDGET_ACTIVE_FOOTPRINT.deepSeekUserTurnExtraChars -
    after.deepSeekUserTurnExtraChars;
  const beforeTotal =
    beforeSystem + PRE_DEDUPE_WIDGET_ACTIVE_FOOTPRINT.deepSeekUserTurnExtraChars;
  const afterTotal = afterSystem + after.deepSeekUserTurnExtraChars;
  const savedTotalCharsPerTurn = beforeTotal - afterTotal;

  return {
    before: PRE_DEDUPE_WIDGET_ACTIVE_FOOTPRINT,
    after,
    savedSystemChars,
    savedSystemPct: beforeSystem > 0 ? savedSystemChars / beforeSystem : 0,
    savedDeepSeekUserChars,
    savedDeepSeekUserPct:
      PRE_DEDUPE_WIDGET_ACTIVE_FOOTPRINT.deepSeekUserTurnExtraChars > 0
        ? savedDeepSeekUserChars /
          PRE_DEDUPE_WIDGET_ACTIVE_FOOTPRINT.deepSeekUserTurnExtraChars
        : 0,
    savedTotalCharsPerTurn,
    savedTotalPct: beforeTotal > 0 ? savedTotalCharsPerTurn / beforeTotal : 0,
  };
}
