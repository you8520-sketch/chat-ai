/**
 * Deterministic wire audit — Snapshot B (PR620 real capsule). No provider calls.
 *
 *   npx tsx scripts/investigate-deepseek-snapshot-b-wire.ts
 */
import "./lib/server-only-mock";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT = path.join(
  process.cwd(),
  "docs/audits/deepseek-close-contact-compliance-investigation-2026-09-27",
);
const CAPSULE = path.join(
  process.cwd(),
  "docs/audits/real-production-mid-chat-style-handoff-benchmark",
);
const REVIEW_META = path.join(
  process.cwd(),
  "docs/audits/pr620-real-capsule-quality-verification-2026-09-27/review-packet/meta/SNAPSHOT_B_T2",
);

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function read(rel: string): string {
  return fs.readFileSync(path.join(CAPSULE, rel), "utf8");
}

function write(name: string, data: string | object) {
  const p = path.join(OUT, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    typeof data === "string" ? data : JSON.stringify(data, null, 2),
    "utf8",
  );
}

function flatContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === "object" && b && "text" in b ? String((b as { text: string }).text) : ""))
      .join("");
  }
  return String(content ?? "");
}

function countNeedle(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while (true) {
    const idx = hay.indexOf(needle, i);
    if (idx < 0) break;
    n += 1;
    i = idx + needle.length;
  }
  return n;
}

async function main() {
  const turns = JSON.parse(read("fixtures/user-turns-t1-t2-t3.json")) as {
    characterName: string;
    personaName: string;
  };
  const opening = read("raw/OPENING_ASSISTANT_VISIBLE.txt");
  const t1User = read("raw/T1-USER_RAW.txt");
  const t1Assistant = read("raw/T1-ASSISTANT_PERSISTED_VISIBLE.txt");
  const t2User = read("raw/T2-USER_RAW.txt");
  const dump = read("requests/T2-prompt_dump.txt");

  const extractSection = (sectionId: string): string => {
    const marker = `### [${sectionId}]`;
    const start = dump.indexOf(marker);
    if (start < 0) throw new Error(`missing section ${sectionId}`);
    const afterHeader = dump.indexOf("\n", start);
    const rest = dump.slice(afterHeader + 1);
    const next = rest.search(/\n### \[/);
    return (next >= 0 ? rest.slice(0, next) : rest).trim();
  };

  const characterCanon = extractSection("character-core-identity");
  const identitySection = extractSection("identity-and-rules");
  const personaMatch = identitySection.match(/\[USER_PERSONA\]([\s\S]*?)(?=\n\[|$)/);
  const personaDescription = personaMatch?.[1]?.trim() ?? "";
  const privateSpeech = extractSection("private-speech-control");

  const {
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  } = await import("../src/lib/chatModels");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const { buildSceneDirective, renderSceneDirectiveForPrompt } = await import(
    "../src/lib/sceneDirective"
  );
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION } = await import(
    "../src/lib/currentTurnUserAuthoringDelegation"
  );
  const { COMMON_PROSE_BLOCK } = await import("../src/lib/advancedProseNsfwGuidelines");
  const {
    DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY,
    DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK,
    resolveDeepSeekShortHistoryLengthExtra,
  } = await import("../src/lib/deepseekPromptStructure");
  const { peelCreatorOpeningGreetingFromHistory } = await import(
    "../src/lib/deepseekOpeningSceneContext"
  );

  const shortTermHistory = [
    { role: "user" as const, content: "[채팅 시작]" },
    { role: "assistant" as const, content: opening },
    { role: "user" as const, content: t1User },
    { role: "assistant" as const, content: t1Assistant },
  ];

  const chunks = parseCharacterSetting({
    characterId: "pr620-capsule-10",
    characterName: turns.characterName,
    gender: "male",
    systemPrompt: characterCanon,
    world: "",
    exampleDialog: "",
    statusWindowPrompt: "",
  });

  const userPersona = formatSelectedPersonaForPrompt(
    turns.personaName,
    "male",
    personaDescription,
  );

  const assemble = (modelId: string) => {
    const narrativePov = resolveNarrativePov({
      mode: "third_person",
      contentKind: "character",
      mainCharacterName: turns.characterName,
    });
    const directive = buildSceneDirective({
      mode: "interactive",
      recentMessages: shortTermHistory,
      currentUserMessage: t2User,
      memoryText: "",
      relationshipMemoryText: "",
      lorebookText: "",
      triggeredEventText: "",
      chatId: 620,
      currentTurn: 3,
      progressionHistory: [],
      contentKind: "character",
      primaryCharacterName: turns.characterName,
    });

    const built = buildContext({
      charName: turns.characterName,
      contentKind: "character",
      narrativePov,
      chunks,
      systemPrompt: characterCanon,
      userNickname: turns.personaName,
      userPersona,
      userNote: formatUserNoteForPrompt(""),
      longTermMemory: "",
      shortTermHistory,
      currentUserMessage: t2User,
      nsfw: true,
      gender: "male",
      modelId,
      currentTurnAuthoringDelegation: INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION,
      novelModeEnabled: false,
      personaDisplayName: turns.personaName,
      targetResponseChars: 3200,
      completedTurns: 2,
      userPersonaGender: "male",
      provider: "openrouter",
      genres: ["판타지/SF", "로맨스"],
      privateSpeechControlBlock: privateSpeech,
      sceneDirectiveBlock: renderSceneDirectiveForPrompt(directive),
      scenePacingPromptOwner: "legacy_v1",
      promptDumpSource: "pr620-capsule",
      promptDumpDetail: "SNAPSHOT_B_T2 wire-investigation",
    });

    const wire = assemblePrimaryRpRequest({
      system: built.systemPrompt,
      history: built.history,
      modelId,
      targetResponseChars: 3200,
      messageOpts: {
        transportProvider: "cheaperinference",
        charName: turns.characterName,
        personaName: turns.personaName,
        sceneServerControls: {
          mode: "interactive",
          contentKind: "character",
          party: false,
          primaryCharacterName: turns.characterName,
          currentUserMessage: t2User,
          recentMessages: shortTermHistory,
          memoryText: "",
          adultModeEnabled: true,
          chatId: 620,
          currentTurn: 3,
          progressionHistory: [],
          canonicalSceneDirective: directive,
          skipMotionCue: false,
        },
      },
    });

    const messages = wire.requestBody.messages as Array<{ role: string; content: unknown }>;
    const system = flatContent(messages.find((m) => m.role === "system")?.content);
    const lastUser = flatContent([...messages].reverse().find((m) => m.role === "user")?.content);

    return { built, wire, messages, system, lastUser };
  };

  const dsModel = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
  const gModel = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
  const ds = assemble(dsModel);
  const g37 = assemble(gModel);

  const peeled = peelCreatorOpeningGreetingFromHistory(shortTermHistory);
  const shortHistoryExtra = resolveDeepSeekShortHistoryLengthExtra(shortTermHistory);

  const ownerSections = ds.built.meta.trackedSections?.map((s) => ({
    id: s.id,
    chars: s.text.length,
    generator: "contextBuilder.buildContext",
    sourceFile: "src/services/contextBuilder.ts",
  }));

  const { execSync } = await import("node:child_process");
  const mainSha = execSync("git rev-parse origin/main", { encoding: "utf8" }).trim();

  const ownerMap = {
    recordedAt: new Date().toISOString(),
    exactMain: mainSha,
    models: {
      deepseek: dsModel,
      gemini37: gModel,
    },
    sharedProse: {
      owner: "advancedProseNsfwGuidelines.ts → COMMON_PROSE_BLOCK",
      injectionCountDeepSeek: countNeedle(ds.system, "[COMMON PROSE]"),
      injectionCountGemini37: countNeedle(g37.system, "[COMMON PROSE]"),
      commonProseShaPrefix: sha256(COMMON_PROSE_BLOCK).slice(0, 12),
    },
    deepSeekLegacyReminders: {
      bottomStyleInSystemOrLastUser:
        countNeedle(ds.system + ds.lastUser, DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY.slice(0, 40)) > 0,
      lengthSingleCallBlock:
        countNeedle(ds.system + ds.lastUser, "[DEEPSEEK LENGTH — SINGLE CALL]") > 0,
    },
    snapshotBHistorySignals: {
      messageCount: shortTermHistory.length,
      t1AssistantChars: t1Assistant.length,
      shortHistoryLengthExtraActive: shortHistoryExtra != null,
      openingPeelWouldApply: peeled.peeledSyntheticOpeningTurn && shortHistoryExtra != null,
      openingPeelAppliedOnB: ds.lastUser.includes("[OPENING SCENE CONTEXT"),
    },
    wireHashes: {
      deepseek: {
        systemSha: sha256(ds.system),
        lastUserSha: sha256(ds.lastUser),
        fullMessagesSha: sha256(JSON.stringify(ds.messages.map((m) => ({ role: m.role, content: flatContent(m.content) })))),
      },
      gemini37: {
        systemSha: sha256(g37.system),
        lastUserSha: sha256(g37.lastUser),
        fullMessagesSha: sha256(JSON.stringify(g37.messages.map((m) => ({ role: m.role, content: flatContent(m.content) })))),
      },
    },
    pr1124LiveRunPromptHashes: {
      deepseekB_r1_r2_r3: "9553f557fe831a13e80853bdba8a14895573c6ff87de274e8b9d4fe8e640ddee",
      gemini37B_r1_r2_r3: "50fa7c8abd812e7d4002d4d930283fe39fc7ab6298bad3684f8f9e3cdc67124e",
      matchesCurrentWire: {
        deepseek: sha256(ds.system) === "9553f557fe831a13e80853bdba8a14895573c6ff87de274e8b9d4fe8e640ddee",
        note: "PR1124 promptHash is system-only fingerprint from benchmark harness",
      },
    },
    ownerSections,
    messageRoleSequence: {
      deepseek: ds.messages.map((m) => m.role),
      gemini37: g37.messages.map((m) => m.role),
    },
  };

  write("OWNER_MAP.json", ownerMap);
  write(
    "WIRE_DELTA.md",
    `# Snapshot B wire delta (DeepSeek vs Gemini 3.7)

- DeepSeek system SHA: \`${ownerMap.wireHashes.deepseek.systemSha}\`
- Gemini system SHA: \`${ownerMap.wireHashes.gemini37.systemSha}\`
- DeepSeek last-user SHA: \`${ownerMap.wireHashes.deepseek.lastUserSha.slice(0, 16)}…\`
- Gemini last-user SHA: \`${ownerMap.wireHashes.gemini37.lastUserSha.slice(0, 16)}…\`
- Same capsule history + T2 user; cross-model SHA mismatch expected (adapters).

## DeepSeek-only Snapshot B signals

- \`shortHistoryLengthExtraActive\`: ${ownerMap.snapshotBHistorySignals.shortHistoryLengthExtraActive}
- \`openingPeelAppliedOnB\`: ${ownerMap.snapshotBHistorySignals.openingPeelAppliedOnB}
- T1 assistant persisted length: ${ownerMap.snapshotBHistorySignals.t1AssistantChars} chars

## PR #1124 reproduction

All three DeepSeek B live samples share **identical** \`promptHash\` → same provider-bound system prompt per rep.
`,
  );

  write("wire/deepseek-messages.json", {
    roles: ds.messages.map((m) => m.role),
    previews: ds.messages.map((m) => ({
      role: m.role,
      chars: flatContent(m.content).length,
      head: flatContent(m.content).slice(0, 240),
    })),
  });
  write("wire/gemini37-messages.json", {
    roles: g37.messages.map((m) => m.role),
    previews: g37.messages.map((m) => ({
      role: m.role,
      chars: flatContent(m.content).length,
      head: flatContent(m.content).slice(0, 240),
    })),
  });

  const metaHashes: Record<string, string> = {};
  for (const model of ["deepseek-v4-pro-0813", "gemini-3.7-flash"]) {
    for (const rep of [1, 2, 3]) {
      const p = path.join(REVIEW_META, model, `r${rep}.json`);
      if (fs.existsSync(p)) {
        const j = JSON.parse(fs.readFileSync(p, "utf8")) as { promptHash: string };
        metaHashes[`${model}-r${rep}`] = j.promptHash;
      }
    }
  }
  write("PR1124_PROMPT_HASH_PARITY.json", metaHashes);

  console.log("Wrote investigation artifacts to", OUT);
  console.log("DeepSeek system sha", ownerMap.wireHashes.deepseek.systemSha);
  console.log("PR1124 hash match", ownerMap.pr1124LiveRunPromptHashes.matchesCurrentWire.deepseek);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
