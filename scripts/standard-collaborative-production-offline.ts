/**
 * Offline gate for standard collaborative production candidate (PR A).
 * Asserts collaborative owner, SceneDirective OFF, single DeepSeek length owner,
 * Luna picker removal, legacy Luna → DeepSeek.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT = "docs/audits/51-standard-collaborative-production";
const FIXTURE = process.env.FIXTURE_PATH ?? "/tmp/c18_fixture.json";
const TURN1 =
  "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.";

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
  const reasons: string[] = [];
  const {
    USER_SELECTABLE_AI_OPTIONS,
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
    CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
    resolveSelectedAI,
    selectedAILabel,
    isValidSelectedAI,
  } = await import("../src/lib/chatModels");
  const { COLLABORATIVE_INTERACTIVE_OWNER_TITLE } = await import(
    "../src/lib/noGodmodding"
  );
  const { USER_TAIL_LENGTH_OWNER_SENTENCE } = await import("../src/lib/responseLength");
  const { AUTO_PROGRESSION_BLOCK_TITLE } = await import("../src/lib/autoProgressionRules");

  const pickerDeepSeek = USER_SELECTABLE_AI_OPTIONS.some(
    (o) => o.id === CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
  );
  const pickerTerra = USER_SELECTABLE_AI_OPTIONS.some(
    (o) => o.id === CHEAPER_INFERENCE_GPT_56_TERRA_MODEL
  );
  const pickerLuna = USER_SELECTABLE_AI_OPTIONS.some(
    (o) => o.id === CHEAPER_INFERENCE_GPT_56_LUNA_MODEL
  );
  if (!pickerDeepSeek) reasons.push("picker_deepseek_false");
  if (!pickerTerra) reasons.push("picker_terra_false");
  if (pickerLuna) reasons.push("picker_luna_true");
  if (
    resolveSelectedAI(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL) !==
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
  ) {
    reasons.push("legacy_luna_not_deepseek");
  }
  if (!isValidSelectedAI(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL)) {
    reasons.push("luna_registry_missing");
  }
  if (selectedAILabel(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL) !== "GPT-5.6 Luna") {
    reasons.push("luna_receipt_label");
  }

  if (!existsSync(FIXTURE)) throw new Error(`missing ${FIXTURE}`);
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const { loadCharacterChunks } = await import("../src/lib/characterChunks");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const { buildSceneDirective, renderSceneDirectiveForPrompt } = await import(
    "../src/lib/sceneDirective"
  );
  const { buildContext } = await import("../src/services/contextBuilder");
  const { buildOpenRouterMessages } = await import("../src/lib/openRouterAdult");

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
  const shortTermHistory = [
    { role: "user" as const, content: OPENING_TURN_USER },
    { role: "assistant" as const, content: String(ch.greeting ?? "") },
  ];
  const sceneDirectiveBlock = renderSceneDirectiveForPrompt(
    buildSceneDirective({
      characterName: String(ch.name),
      recentMessages: shortTermHistory,
      currentUserMessage: TURN1,
      contentKind: "character",
      mode: "interactive",
    })
  );
  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory,
    currentUserMessage: TURN1,
    nsfw: false,
    gender: "male",
    memoryMeta: "",
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: 0,
    provider: "openrouter",
    contentKind: "character",
    sceneDirectiveBlock,
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: 34,
  });
  const wire = buildOpenRouterMessages(built.systemPrompt, built.history, {
    systemSplit: built.openRouterSystemSplit!,
  });
  const systemJoined = Array.isArray(wire[0]?.content)
    ? (wire[0]!.content as Array<{ text?: string }>)
        .map((p) => p.text ?? "")
        .join("\n\n")
    : String(wire[0]?.content ?? "");
  const finalUser = String(wire[wire.length - 1]?.content ?? "");
  const full = `${systemJoined}\n\n${finalUser}`;

  const collab = countOccurrences(full, COLLABORATIVE_INTERACTIVE_OWNER_TITLE);
  const novel = countOccurrences(full, "[USER CONTROL MODE - NOVEL / EXPLICIT FULL]");
  const scene = (built.meta.trackedSections ?? []).some((s) => s.id === "scene-directive");
  const userTail = countOccurrences(finalUser, USER_TAIL_LENGTH_OWNER_SENTENCE);
  const deepseekLen = countOccurrences(full, "[DEEPSEEK LENGTH — SINGLE CALL]");
  const shortHist = countOccurrences(full, "[SHORT HISTORY]");
  const auto = countOccurrences(full, AUTO_PROGRESSION_BLOCK_TITLE);
  const lengthOwners =
    (userTail > 0 ? 1 : 0) + (deepseekLen > 0 ? 1 : 0) + (shortHist > 0 ? 1 : 0);

  if (collab !== 1) reasons.push(`collaborative_${collab}`);
  if (novel !== 0) reasons.push("legacy_novel_owner");
  if (scene) reasons.push("scene_directive_on");
  if (lengthOwners !== 1 || userTail !== 1) reasons.push(`length_owners_${lengthOwners}`);
  if (auto !== 0) reasons.push(`auto_on_standard_${auto}`);

  const pass = reasons.length === 0;
  const status = {
    STANDARD_COLLABORATIVE_PRODUCTION_CANDIDATE: pass,
    TERRA_PUBLIC_PREMIUM_CANDIDATE: pickerTerra,
    assertions: {
      standard_length_owner: lengthOwners,
      standard_collaborative_owner: collab,
      standard_SceneDirective: scene ? 1 : 0,
      legacy_novel_owner: novel,
      public_picker_DeepSeek: pickerDeepSeek,
      public_picker_Terra: pickerTerra,
      public_picker_Luna: pickerLuna,
      new_Luna_selection_blocked: !pickerLuna,
      legacy_Luna_saved_value_DeepSeek:
        resolveSelectedAI(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL) ===
        CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      historical_Luna_receipts_readable: isValidSelectedAI(
        CHEAPER_INFERENCE_GPT_56_LUNA_MODEL
      ),
    },
    reasons,
  };
  save("OFFLINE_ASSERTIONS.json", status);
  save(
    "STATUS.md",
    [
      "# Standard collaborative + model lineup (PR A)",
      "",
      "```text",
      "STANDARD_COLLABORATIVE_PRODUCTION_CANDIDATE",
      "TERRA_PUBLIC_PREMIUM_CANDIDATE",
      "```",
      "",
      "Excluded from this PR: auto-progression positive-execution experiment,",
      "auto/Terra/Muse audit packets, diagnostic live scripts.",
      "",
      "Do not merge or deploy without explicit user instruction.",
      "",
      "```json",
      JSON.stringify(status.assertions, null, 2),
      "```",
      "",
    ].join("\n")
  );
  console.log(JSON.stringify({ pass, reasons, assertions: status.assertions }, null, 2));
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
