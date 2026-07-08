/** Few-shot hand vs space/sound/distance ablation — exampleDialog payloads. */

import type { CharacterChunk } from "@/types";
import { parseCharacterSetting } from "@/utils/characterParser";
import type { ProductionValidationScene } from "./production-prompt-fixture";
import { PROSE_VARIATION_SCENES } from "./prose-variation-metrics";

export type FewShotVariant = "hand-baseline" | "space-treatment";

const FEW_SHOT_CHAR = "카일";

/** Baseline — narration anchors on 손/손끝/손목/잡/더듬 (typical hand-heavy few-shot). */
export const FEWSHOT_HAND_BASELINE = `유저: 오늘도 바쁘지?
${FEW_SHOT_CHAR}: ${FEW_SHOT_CHAR}은 카운터 너머로 손을 뻗어 잔을 받아 들었다. 손끝이 미끄러운 유리에 닿았고, 그는 손목을 돌려 잔을 가볍게 두었다.

"조금요. 그쪽은요?"

유저: …괜찮아 보이지 않네.
${FEW_SHOT_CHAR}: 그는 손등으로 이마를 문지른 뒤, 손가락으로 머리카락을 쓸어 넘겼다. 손이 떨리는 것을 숨기려 손을 주머니 속에 넣었다.

"…괜찮습니다."

유저: …들었어?
${FEW_SHOT_CHAR}: ${FEW_SHOT_CHAR}은 손을 입술에 대고 고개를 숙였다. 손끝으로 옆 칸 막대를 더듬으며 손잡이를 꽉 움켜쥐었다.

"…무슨 소리요?"

유저: 문 너머야.
${FEW_SHOT_CHAR}: 그는 손바닥으로 문짝을 짚고, 손목을 돌려 손잡이를 천천히 내렸다. 손에 땀이 배었다.

"…조용히 하세요."`;

/** Treatment — same dialogue; narration starts with 공간·소리·거리·공기. */
export const FEWSHOT_SPACE_TREATMENT = `유저: 오늘도 바쁘지?
${FEW_SHOT_CHAR}: 카페 안 공기가 달큰한 원두 향으로 가득했고, 에스프레소 머신 소음이 카운터 뒤에서 규칙적으로 울렸다. 두 사람 사이 테이블 간격은 손 하나도 채 건너지 못할 만큼 좁았다.

"조금요. 그쪽은요?"

유저: …괜찮아 보이지 않네.
${FEW_SHOT_CHAR}: 형광등 아래 바닥 타일이 차게 반짝였고, 멀리 문 쪽에서 바람 소리가 틈새로 새어 들어왔다. 복도 끝 발소리가 잠시 멎었다.

"…괜찮습니다."

유저: …들었어?
${FEW_SHOT_CHAR}: 복도 깊은 쪽에서 금속이 긁히는 소리가 짧게 울려 퍼졌다. 불 꺼진 층의 공기가 목에 걸릴 만큼 무거웠다.

"…무슨 소리요?"

유저: 문 너머야.
${FEW_SHOT_CHAR}: 문틈 아래 막혀 있던 바람이 한 줄기 새어 나왔고, 바닥과 문 사이 간격이 어둠으로 메워졌다. 복도 끝 거리감이 갑자기 가까워진 느낌이었다.

"…조용히 하세요."`;

const SCENE_GENRES: Record<string, import("@/lib/characterGenres").CharacterGenre[]> = {
  daily: ["현대/일상"],
  romance: ["로맨스"],
  combat: ["코믹/액션"],
  horror: ["공포/추리"],
};

export function fewShotExampleDialog(variant: FewShotVariant): string {
  return variant === "hand-baseline" ? FEWSHOT_HAND_BASELINE : FEWSHOT_SPACE_TREATMENT;
}

export function buildFewShotValidationChunks(exampleDialog: string): CharacterChunk[] {
  return parseCharacterSetting({
    characterId: "fewshot-val-1",
    characterName: FEW_SHOT_CHAR,
    gender: "male",
    systemPrompt: `# 성격
차분하고 관찰력이 뛰어나며, 감정을 겉으로 드러내지 않는다.

# 말투
- 평소: "~요", "~죠" 등 정중한 존댓말
- 긴장 시: 문장이 짧아진다`,
    world: `# 세계관
현대 도시. 초자연적 존재와 일반인이 공존한다.`,
    exampleDialog,
    statusWindowPrompt: "",
  });
}

export function proseSceneToFewShotScene(
  scene: (typeof PROSE_VARIATION_SCENES)[number]
): ProductionValidationScene {
  return {
    id: scene.id,
    label: scene.label,
    genres: SCENE_GENRES[scene.id] ?? ["현대/일상"],
    currentUserMessage: scene.user,
    shortTermHistory: [
      {
        role: "user",
        content: scene.setup,
      },
    ],
  };
}

export function countHandLexInText(text: string): number {
  const words = ["손", "손끝", "손가락", "손목", "손바닥", "손잡", "손을", "손이", "손등"];
  return words.reduce((n, w) => n + (text.match(new RegExp(w, "g"))?.length ?? 0), 0);
}

export function countSpaceSoundLexInText(text: string): number {
  const words = [
    "거리",
    "공간",
    "간격",
    "소리",
    "울림",
    "메아리",
    "공기",
    "바람",
    "복도",
    "바닥",
    "향",
    "냄새",
    "침묵",
  ];
  return words.reduce((n, w) => n + (text.match(new RegExp(w, "g"))?.length ?? 0), 0);
}
