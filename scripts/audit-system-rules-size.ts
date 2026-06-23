/** Token breakdown only — no full prompt dump. npx.cmd tsx scripts/audit-system-rules-size.ts */
import { estimateTokens } from "../src/lib/tokenEstimate";
import { buildCoreMasterPromptForCache } from "../src/lib/corePrompt";
import { SHARED_PROSE_RULES_BLOCK } from "../src/lib/sharedProseRules";
import { buildNarrativeStyleLayer } from "../src/lib/narrativeStyle";
import { STATE_WINDOW_POLICY_BLOCK } from "../src/lib/stateWindowPolicy";
import { buildSmartUserPersonaNarrationRules } from "../src/lib/userPersonaNarrationRules";
import { buildLengthInstruction } from "../src/lib/responseLength";
import { buildOpenRouterOpusCompactTail } from "../src/lib/corePrompt";
import {
  KOREAN_OUTPUT_DIRECTIVE,
  DIALOGUE_FORMAT_DIRECTIVE,
  KOREAN_NARRATION_ENDING_RULE,
} from "../src/lib/promptTranslation";
import {
  OPENROUTER_KOREAN_STYLE_BLOCK,
  OPENROUTER_NSFW_CORE,
  buildCoNarrationKoreanRule,
} from "../src/lib/openRouterAdult";

const blocks: [string, string][] = [
  ["or-korean-style", OPENROUTER_KOREAN_STYLE_BLOCK],
  ["or-co-narration", buildCoNarrationKoreanRule(false)],
  ["or-nsfw-core", OPENROUTER_NSFW_CORE],
  [
    "core-master",
    buildCoreMasterPromptForCache({
      charName: "백하율",
      userName: "렌",
      charGender: "male",
      userGender: "other",
      nsfwEnabled: true,
      impersonationOn: false,
      completedTurns: 99,
      hasMindReading: false,
      allowsBeard: true,
      allowsBodyHair: true,
      tailFormatActive: true,
      statusWindowTailActive: false,
    }),
  ],
  ["shared-prose", SHARED_PROSE_RULES_BLOCK],
  [
    "narrative-style",
    buildNarrativeStyleLayer({ charName: "백하율", completedTurns: 10 }),
  ],
  ["state-window-policy", STATE_WINDOW_POLICY_BLOCK],
  ["user-persona-narration", buildSmartUserPersonaNarrationRules("백하율", "렌")],
  ["prose-guard", buildOpenRouterOpusCompactTail()],
  ["length-2000", buildLengthInstruction(2000)],
  ["korean-output", KOREAN_OUTPUT_DIRECTIVE],
  ["dialogue-format", DIALOGUE_FORMAT_DIRECTIVE],
  ["korean-narration", KOREAN_NARRATION_ENDING_RULE],
];

let total = 0;
for (const [id, text] of blocks.sort((a, b) => estimateTokens(b[1]) - estimateTokens(a[1]))) {
  const t = estimateTokens(text);
  total += t;
  console.log(`${String(t).padStart(5)} tok  ${id} (${text.length} chars)`);
}
console.log(`\nStatic rules subtotal (no persona/speech/character): ~${total} tok`);
