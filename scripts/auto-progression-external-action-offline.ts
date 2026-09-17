/**
 * Offline: one positive execution paragraph in auto owner; owner count = 1.
 * Verdict: AUTO_PROGRESSION_EXTERNAL_ACTION_DIALOGUE_OFFLINE_PASS
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT = "docs/audits/45-auto-progression-ai-focal";
const FIXTURE = process.env.FIXTURE_PATH ?? "/tmp/c18_fixture.json";
const MODEL = "deepseek-v4-pro";

function save(name: string, content: string | object) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}
function countOccurrences(hay: string, needle: string): number {
  let n = 0;
  let i = 0;
  while (true) {
    const j = hay.indexOf(needle, i);
    if (j < 0) break;
    n += 1;
    i = j + needle.length;
  }
  return n;
}

async function main() {
  const {
    AUTO_PROGRESSION_BLOCK_TITLE,
    AUTO_PROGRESSION_POV_ASSERTIONS,
    buildAutoProgressionUserControlBlock,
  } = await import("../src/lib/autoProgressionRules");
  const { COLLABORATIVE_INTERACTIVE_OWNER_TITLE } = await import(
    "../src/lib/noGodmodding"
  );
  const { loadCharacterChunks } = await import("../src/lib/characterChunks");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { buildContinueNarrativeCommand } = await import("../src/lib/continueNarrative");

  const block = buildAutoProgressionUserControlBlock();
  const reasons: string[] = [];

  if (countOccurrences(block, AUTO_PROGRESSION_BLOCK_TITLE) !== 1) {
    reasons.push("owner_title_count");
  }
  if (!block.includes("각 응답에는 [B]가 직접 수행하는 외부 행동")) {
    reasons.push("missing_positive_execution_paragraph");
  }
  if (!block.includes("USER_PERSONA 및 실제 이전 발화의 말투를 따른 직접 대사")) {
    reasons.push("missing_persona_voice_dialogue_requirement");
  }
  if (!AUTO_PROGRESSION_POV_ASSERTIONS.requiresBExternalActionInOrdinaryScene) {
    reasons.push("assert_b_action");
  }
  if (!AUTO_PROGRESSION_POV_ASSERTIONS.requiresBDirectDialogueInOrdinaryScene) {
    reasons.push("assert_b_dialogue");
  }
  if (!AUTO_PROGRESSION_POV_ASSERTIONS.personaVoiceReference) {
    reasons.push("assert_persona_voice");
  }
  if (AUTO_PROGRESSION_POV_ASSERTIONS.authorizesBInnerPov) {
    reasons.push("assert_inner_pov_true");
  }
  if (AUTO_PROGRESSION_POV_ASSERTIONS.aiFocalViewpointOwnerCount !== 1) {
    reasons.push("assert_ai_focal_count");
  }
  if (block.includes("[USER CONTROL MODE - NOVEL / EXPLICIT FULL]")) {
    reasons.push("novel_leak_in_block");
  }

  if (!existsSync(FIXTURE)) throw new Error(`missing ${FIXTURE}`);
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
  const ch = fixture.character;
  const persona = fixture.persona;
  const user = fixture.user;
  const personaName = String(persona.name ?? "렌");
  const chunks = loadCharacterChunks({
    id: Number(ch.id),
    name: String(ch.name),
    gender: String(ch.gender ?? ""),
    system_prompt: String(ch.system_prompt ?? ""),
    world: String(ch.world ?? ""),
    example_dialog: String(ch.example_dialog ?? ""),
    setting_chunks: String(ch.setting_chunks ?? ""),
    speech_profile: String(ch.speech_profile ?? ""),
  });
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );
  const continueCmd = buildContinueNarrativeCommand({
    personaName,
    charName: String(ch.name),
  });
  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: [
      { role: "user" as const, content: OPENING_TURN_USER },
      { role: "assistant" as const, content: String(ch.greeting ?? "") },
      {
        role: "user" as const,
        content: "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.",
      },
      { role: "assistant" as const, content: "테스트 응답1" },
      {
        role: "user" as const,
        content: "너는 이름이뭐야? 뭐하는 중이었어?",
      },
      { role: "assistant" as const, content: "테스트 응답2" },
    ],
    currentUserMessage: continueCmd,
    nsfw: false,
    gender: (String(ch.gender || "male") as "male" | "female" | "other") || "male",
    memoryMeta: "",
    modelId: MODEL,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: true,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: 2,
    provider: "openrouter",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: 34,
  });

  const full = built.systemPrompt;
  const autoOwners = countOccurrences(full, AUTO_PROGRESSION_BLOCK_TITLE);
  const novel = countOccurrences(full, "[USER CONTROL MODE - NOVEL / EXPLICIT FULL]");
  const collab = countOccurrences(full, COLLABORATIVE_INTERACTIVE_OWNER_TITLE);

  if (autoOwners !== 1) reasons.push(`auto_owner_${autoOwners}`);
  if (novel !== 0) reasons.push("novel_in_context");
  // collaborative should not be the auto owner (auto replaces interactive)
  if (collab !== 0) reasons.push(`collab_leak_${collab}`);
  if (!full.includes("각 응답에는 [B]가 직접 수행하는 외부 행동")) {
    reasons.push("positive_paragraph_not_in_context");
  }
  if (continueCmd.includes(AUTO_PROGRESSION_BLOCK_TITLE)) {
    reasons.push("short_ref_repeats_owner_title");
  }

  const pass = reasons.length === 0;
  const verdict = pass
    ? "AUTO_PROGRESSION_EXTERNAL_ACTION_DIALOGUE_OFFLINE_PASS"
    : "AUTO_PROGRESSION_EXTERNAL_ACTION_DIALOGUE_OFFLINE_FAIL";

  save("AUTO_CORRECTION_OFFLINE.json", {
    verdict,
    reasons,
    autoOwners,
    novel,
    collab,
    assertions: AUTO_PROGRESSION_POV_ASSERTIONS,
  });
  console.log(JSON.stringify({ verdict, reasons, autoOwners, novel, collab }, null, 2));
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
