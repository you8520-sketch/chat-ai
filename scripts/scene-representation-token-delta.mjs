import { renderCompactScenePacingCue } from "../src/lib/scenePacingController.ts";
import { buildSceneDirective, renderSceneDirectiveForPrompt } from "../src/lib/sceneDirective.ts";
import { estimateTokens } from "../src/lib/tokenEstimate.ts";

const PRIMARY = "테스트주인공";

const cases = [
  {
    label: "HOLD",
    d: buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      currentUserMessage: "조용히 있다.",
      chatId: 1,
      currentTurn: 1,
    }),
  },
  {
    label: "MICRO",
    d: buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      currentUserMessage: "손끝만 움직인다.",
      chatId: 2,
      currentTurn: 2,
    }),
  },
  {
    label: "ADVANCE",
    d: buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      currentUserMessage: "이쪽으로 이동하자.",
      chatId: 3,
      currentTurn: 3,
    }),
  },
  {
    label: "TRIGGER_ESCALATE",
    d: buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      triggeredEventText: "복도 끝에서 사이렌이 울린다.",
      currentUserMessage: "밖을 본다.",
      chatId: 4,
      currentTurn: 4,
    }),
  },
];

for (const { label, d } of cases) {
  const full = renderSceneDirectiveForPrompt(d);
  const compact = renderCompactScenePacingCue(d);
  console.log(
    JSON.stringify({
      label,
      motion: d.motionDecision,
      fullChars: full.length,
      compactChars: compact.length,
      deltaChars: full.length - compact.length,
      fullTokens: estimateTokens(full),
      compactTokens: estimateTokens(compact),
      deltaTokens: estimateTokens(full) - estimateTokens(compact),
    })
  );
}
