/**
 * Prompt block char counts for Step 1.9 migration verification.
 */
import { buildAdvancedProseNsfwGuidelines } from "@/lib/advancedProseNsfwGuidelines";
import { buildOpenRouterKoreanProseTopBlock } from "@/lib/openRouterProsePolicy";
import { buildCoreMasterPrompt } from "@/lib/corePrompt";
import { buildLengthInstruction } from "@/lib/responseLength";
import { buildWebnovelOutputLayoutRecencyBlock } from "@/lib/webnovelOutputFormat";

const core = buildCoreMasterPrompt({
  charName: "Test",
  userName: "User",
  charGender: "female",
  userGender: "other",
  nsfwEnabled: false,
  impersonationOn: false,
  completedTurns: 5,
  hasMindReading: false,
  allowsBeard: false,
  allowsBodyHair: false,
});

const rows = [
  ["TOP (openRouterProsePolicy)", buildOpenRouterKoreanProseTopBlock()],
  ["PROSE bundle (sfw)", buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false })],
  ["LENGTH CONTROL", buildLengthInstruction()],
  ["CORE RP", core],
  ["OUTPUT LAYOUT", buildWebnovelOutputLayoutRecencyBlock()],
] as const;

let total = 0;
console.log("=== Prompt Block Metrics ===");
for (const [name, text] of rows) {
  console.log(`${name}: ${text.length} chars`);
  total += text.length;
}
console.log(`TOTAL (sample blocks): ${total} chars`);
