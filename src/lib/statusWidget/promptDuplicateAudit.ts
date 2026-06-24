/**
 * Status Widget prompt duplication audit — dev / telemetry companion.
 * Does not affect production prompts.
 */

import { buildStatusWidgetPromptBlock } from "./prompt";
import { STATUS_WIDGET_STATE_POLICY_BLOCK } from "@/lib/stateWindowPolicy";
import { buildPrimaryModelFlashFirewallBlock } from "@/lib/flashOwnedOutputFirewall";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import { resolveStatusWidgetTurn } from "./resolve";

export type PromptDuplicateFinding = {
  category: "status_instruction" | "firewall" | "tail_reminder" | "json_example";
  severity: "high" | "medium" | "low";
  locations: string[];
  overlappingPhrases: string[];
  note: string;
};

const STATUS_VALUES_PHRASES = [
  "<<<STATUS_VALUES>>>",
  "<<<END_STATUS>>>",
  "Do NOT output status window HTML",
  "No status HTML",
  "append at the end",
  "Append format",
  "<scene value>",
  "Flash/server render",
  "JSON values",
  "FORBIDDEN in RP prose",
  "pipe tables",
  "```json",
];

function collectOverlaps(text: string, phrases: string[]): string[] {
  const lower = text.toLowerCase();
  return phrases.filter((p) => lower.includes(p.toLowerCase()));
}

/** Sample widget-active prompt slices for overlap analysis (post-dedupe) */
export function buildStatusWidgetPromptSlicesForAudit(): Record<string, string> {
  const resolved = resolveStatusWidgetTurn({
    characterWidgetJson: JSON.stringify(DEFAULT_STATUS_WIDGET),
    chatMode: "character_only",
  });
  const widgetBlock = buildStatusWidgetPromptBlock(resolved);
  const firewall = buildPrimaryModelFlashFirewallBlock({ statusWidgetActive: true });
  const statePolicy = STATUS_WIDGET_STATE_POLICY_BLOCK;

  return {
    "buildStatusWidgetPromptBlock": widgetBlock,
    "DEEPSEEK_STATUS_WIDGET_BOTTOM_REMINDER": "",
    "STATUS_WIDGET_STATE_POLICY_BLOCK": statePolicy,
    "buildPrimaryModelFlashFirewallBlock(statusWidget)": firewall,
  };
}

export function auditStatusWidgetPromptDuplicates(): {
  slices: Record<string, string>;
  combinedChars: number;
  findings: PromptDuplicateFinding[];
} {
  const slices = buildStatusWidgetPromptSlicesForAudit();
  const combined = Object.values(slices).filter(Boolean).join("\n\n---\n\n");
  const findings: PromptDuplicateFinding[] = [];

  const widgetBlock = slices["buildStatusWidgetPromptBlock"] ?? "";
  const statePolicy = slices["STATUS_WIDGET_STATE_POLICY_BLOCK"] ?? "";
  const firewall = slices["buildPrimaryModelFlashFirewallBlock(statusWidget)"] ?? "";

  const widgetOverlaps = collectOverlaps(widgetBlock, STATUS_VALUES_PHRASES);
  const firewallOverlaps = collectOverlaps(firewall, STATUS_VALUES_PHRASES);
  const sharedWidgetFirewall = widgetOverlaps.filter((p) =>
    firewallOverlaps.some((f) => f.toLowerCase() === p.toLowerCase())
  );

  if (sharedWidgetFirewall.length > 0) {
    findings.push({
      category: "status_instruction",
      severity: "medium",
      locations: ["buildStatusWidgetPromptBlock", "buildPrimaryModelFlashFirewallBlock"],
      overlappingPhrases: sharedWidgetFirewall,
      note: "Widget block and firewall still share phrasing — review if further trim is safe.",
    });
  }

  const stateOverlaps = collectOverlaps(statePolicy, STATUS_VALUES_PHRASES);
  if (stateOverlaps.length > 0) {
    findings.push({
      category: "status_instruction",
      severity: "low",
      locations: ["STATUS_WIDGET_STATE_POLICY_BLOCK", "buildStatusWidgetPromptBlock"],
      overlappingPhrases: stateOverlaps.filter((p) => widgetOverlaps.includes(p)),
      note: "Character system_prompt STATE policy (when present) overlaps widget block — separate injection path.",
    });
  }

  const jsonExampleInObject =
    (widgetBlock.match(/\{"[^"]+":"<scene value>"/g) ?? []).length;
  if (jsonExampleInObject > 4) {
    findings.push({
      category: "json_example",
      severity: "high",
      locations: ["buildStatusWidgetPromptBlock", "buildPrimaryModelFlashFirewallBlock"],
      overlappingPhrases: ["<scene value>", "example JSON object"],
      note: `JSON example objects appear ${jsonExampleInObject} times — expected one object in widget block.`,
    });
  }

  return {
    slices,
    combinedChars: combined.length,
    findings,
  };
}
