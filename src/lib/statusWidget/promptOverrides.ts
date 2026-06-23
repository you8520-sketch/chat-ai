import {
  STATE_WINDOW_POLICY_BLOCK,
  STATUS_WIDGET_STATE_POLICY_BLOCK,
} from "@/lib/stateWindowPolicy";
import type { OpenRouterSystemSplit } from "@/lib/openRouterCache";

const FORBIDDEN_UI_META =
  "UI/Meta: FORBIDDEN. NO html, json, markdown tables, or status UI. (Handled by server/Flash).";

const WIDGET_UI_META =
  "UI/Meta: Korean RP prose in body — NO html, markdown tables, inline status lines, or ```json in prose.";

function patchStatusWidgetForbiddenUiMeta(text: string): string {
  return text.split(FORBIDDEN_UI_META).join(WIDGET_UI_META);
}

/** OpenRouter — STATUS_VALUES 지시는 contextBuilder [rule-length-control] 직후 단일 블록 */
export function patchOpenRouterSplitForStatusWidget(
  split: OpenRouterSystemSplit
): OpenRouterSystemSplit {
  return {
    systemRulesBlock: patchStatusWidgetForbiddenUiMeta(split.systemRulesBlock),
    characterSettingsBlock: split.characterSettingsBlock,
    dynamicBlock: patchStatusWidgetForbiddenUiMeta(split.dynamicBlock),
  };
}

/** 위젯 ON 시 Flash 금지 정책 패치 — widget 본문은 contextBuilder에서 length 직후 주입 */
export function applyStatusWidgetSystemPromptOverrides(
  systemPrompt: string,
  _widgetBlock?: string
): string {
  let s = systemPrompt;
  if (s.includes(STATE_WINDOW_POLICY_BLOCK)) {
    s = s.replace(STATE_WINDOW_POLICY_BLOCK, STATUS_WIDGET_STATE_POLICY_BLOCK);
  }
  return patchStatusWidgetForbiddenUiMeta(s).trimEnd();
}

/** @deprecated patchOpenRouterSplitForStatusWidget */
export function appendStatusWidgetBlockToOpenRouterSplit(
  split: OpenRouterSystemSplit,
  _widgetBlock?: string
): OpenRouterSystemSplit {
  return patchOpenRouterSplitForStatusWidget(split);
}
