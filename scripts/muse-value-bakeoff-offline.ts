/**
 * Muse value bake-off offline gate.
 * Shared standard collaborative architecture; Muse has no style adapter.
 * Verdict: MUSE_VALUE_BAKEOFF_OFFLINE_PASS
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT = "docs/audits/52-muse-value-bakeoff";
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
  if (!existsSync(FIXTURE)) throw new Error(`missing ${FIXTURE}`);
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const {
    OPENROUTER_MUSE_SPARK_12_MODEL,
    USER_SELECTABLE_AI_OPTIONS,
    isValidSelectedAI,
    resolveSelectedAI,
    isUserApiSelectableAI,
  } = await import("../src/lib/chatModels");
  const { resolveOpenRouterModelId } = await import("../src/lib/openRouterConfig");
  const { loadCharacterChunks } = await import("../src/lib/characterChunks");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const { buildSceneDirective, renderSceneDirectiveForPrompt } = await import(
    "../src/lib/sceneDirective"
  );
  const { buildContext } = await import("../src/services/contextBuilder");
  const { buildOpenRouterMessages } = await import("../src/lib/openRouterAdult");
  const { COLLABORATIVE_INTERACTIVE_OWNER_TITLE } = await import("../src/lib/noGodmodding");
  const { USER_TAIL_LENGTH_OWNER_SENTENCE } = await import("../src/lib/responseLength");
  const { LUNA_TERMINAL_OUTPUT_CONTRACT } = await import(
    "../src/lib/lunaSinglePrimaryAdapter"
  );
  const { TERRA_TERMINAL_LENGTH_OWNER_CONTRACT } = await import(
    "../src/lib/terraTerminalLengthOwner"
  );

  const modelId = OPENROUTER_MUSE_SPARK_12_MODEL;
  const reasons: string[] = [];

  if (!isValidSelectedAI(modelId)) reasons.push("muse_not_registered");
  if (USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === modelId)) {
    reasons.push("muse_public_picker_exposed");
  }
  if (resolveSelectedAI(modelId) !== modelId) reasons.push("muse_resolve_mismatch");
  if (resolveOpenRouterModelId(modelId) !== modelId) {
    reasons.push("muse_openrouter_route_mismatch");
  }
  if (isUserApiSelectableAI(modelId) && process.env.MUSE_DIAGNOSTIC_SELECTABLE?.trim() !== "1") {
    reasons.push("muse_api_selectable_without_diagnostic_env");
  }

  const ch = fixture.character;
  const persona = fixture.persona;
  const user = fixture.user;
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
  const personaName = String(persona.name ?? "렌");
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
    modelId,
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
  const luna = countOccurrences(finalUser, LUNA_TERMINAL_OUTPUT_CONTRACT);
  const terra = countOccurrences(finalUser, TERRA_TERMINAL_LENGTH_OWNER_CONTRACT);
  const deepseekLen = countOccurrences(full, "[DEEPSEEK LENGTH — SINGLE CALL]");
  const shortHist = countOccurrences(full, "[SHORT HISTORY]");
  const lengthOwners =
    (userTail > 0 ? 1 : 0) +
    (luna > 0 ? 1 : 0) +
    (terra > 0 ? 1 : 0) +
    (deepseekLen > 0 ? 1 : 0) +
    (shortHist > 0 ? 1 : 0);

  const museAdapterHints = [
    "[MUSE",
    "MUSE STYLE",
    "Muse prose",
    "MUSE LENGTH",
    "dialogue-ratio",
  ];
  for (const hint of museAdapterHints) {
    if (full.toLowerCase().includes(hint.toLowerCase())) {
      reasons.push(`unexpected_muse_adapter:${hint}`);
    }
  }

  if (collab !== 1) reasons.push(`collab_${collab}`);
  if (novel !== 0) reasons.push("novel");
  if (scene) reasons.push("scene_on");
  if (lengthOwners !== 1 || userTail !== 1) {
    reasons.push(`length_owners_${lengthOwners}_tail_${userTail}`);
  }

  const pass = reasons.length === 0;
  const verdict = pass
    ? "MUSE_VALUE_BAKEOFF_OFFLINE_PASS"
    : "MUSE_VALUE_BAKEOFF_OFFLINE_FAIL";
  const assertions = {
    standard_SceneDirective: scene ? 1 : 0,
    standard_collaborative_owner: collab,
    legacy_novel_owner: novel,
    standard_user_control_owner: collab,
    model_terminal_length_owner: lengthOwners,
    muse_public_picker: USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === modelId),
    muse_style_adapter: false,
  };
  save("OFFLINE_VERDICT.json", {
    verdict,
    reasons,
    modelId,
    assertions,
    collab,
    novel,
    scene,
    lengthOwners,
    userTail,
  });
  console.log(JSON.stringify({ verdict, reasons, assertions }, null, 2));
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
