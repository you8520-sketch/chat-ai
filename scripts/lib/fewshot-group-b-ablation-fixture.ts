/**
 * Step 7.7 Group B — explain vs show few-shot ablation fixtures (Leon, tagged).
 * Same quoted dialogue; only narration style in example pairs differs.
 */

import type { RegisterValidationScene } from "./leon-ren-register-fixtures";
import { LEON_EXAMPLE_TAGGED, LEON_SCENES } from "./exampleDialogContextAuditLib";

export type GroupBFewShotVariant = "explain-baseline" | "show-treatment";

/** 설명형 — 평소/절제/목소리 변화를 서술로 정당화 (Group B problem patterns). */
export const LEON_FEWSHOT_EXPLAIN_BASELINE = `[사적] 유저: …우리 둘뿐이야.
레온: 레온은 평소의 딱딱한 태도와 달리, 지금은 목소리가 부드러워진 것 같았다. 평소의 절제도 여기엔 없었다.

"…알겠어요."

[사적] 유저: 괜찮아?
레온: 평소처럼 냉정하던 그가, 지금은 말투가 달라진 듯했다. 목소리 끝이 평소보다 가라앉았다.

"…괜찮아요."

[침대] 유저: …불 끌까?
레온: 평소엔 절제하던 레온이지만, 침대 가까이서는 목소리가 더 낮아졌다. 처음으로 이렇게 가까운 거리였다.

"…그래요."

[침대] 유저: …가까이 와도 돼?
레온: 그는 평소의 거리감과 달리, 지금은 목소리가 거의 속삭임에 가까웠다. 군인으로서의 절제도 여기엔 없었다.

"…괜찮아요."`;

/** 보여주기형 — same dialogue; body/space/sound show state change (Step 6 space axis). */
export const LEON_FEWSHOT_SHOW_TREATMENT = `[사적] 유저: …우리 둘뿐이야.
레온: 레온은 어깨 라인을 조금 내리고, 입술을 몇 번 망설이다 열었다. 방 안 공기가 한 박 늦게 움직였다.

"…알겠어요."

[사적] 유저: 괜찮아?
레온: 레온은 시선을 잠시 바닥에 두었다가, 다시 렌 쪽으로 올렸다. 숨소리가 짧아졌다.

"…괜찮아요."

[침대] 유저: …불 끌까?
레온: 불빛이 레온의 턱선을 가로질렀다. 그는 이불 끝을 손끝으로 만지며, 고개를 아주 작게 끄덕였다.

"…그래요."

[침대] 유저: …가까이 와도 돼?
레온: 두 사람 사이 거리가 한 뼘 줄었다. 레온은 손등으로 시트를 누르다 멈추고, 입술을 다시 열었다.

"…괜찮아요."`;

export function leonGroupBFewShotExample(variant: GroupBFewShotVariant): string {
  return variant === "explain-baseline" ? LEON_FEWSHOT_EXPLAIN_BASELINE : LEON_FEWSHOT_SHOW_TREATMENT;
}

/** Ablation generation scenes — private/emotion transition only. */
export const GROUP_B_ABLATION_SCENES: RegisterValidationScene[] = LEON_SCENES.filter((s) =>
  ["leon-private-0", "leon-private-1"].includes(s.id)
);

/** Keep [공적]×2; replace [사적]/[침대] with show pairs (production candidate, +86 tok). */
export function leonGroupBShowMergedForProduction(): string {
  const publicPairs = LEON_EXAMPLE_TAGGED.split(/\n(?=\[)/)
    .filter((block) => block.startsWith("[공적]"))
    .join("\n");
  return `${publicPairs.trim()}\n${LEON_FEWSHOT_SHOW_TREATMENT.trim()}`;
}

export const LEON_EXAMPLE_TAGGED_GROUP_B_CANDIDATE = leonGroupBShowMergedForProduction();
