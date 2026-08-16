/**
 * Offline unification gate for Audit 43/44:
 * DEFAULT_AND_AUTO_MODE_UNIFICATION_OFFLINE_PASS
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT = process.env.OUT_DIR ?? "docs/audits/43-rp-mode-unification";
const FIXTURE = process.env.FIXTURE_PATH ?? "/tmp/c18_fixture.json";
const MODEL = "deepseek-v4-pro-0813";
const TURN1 =
  "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
function save(name: string, content: string | object) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}
function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
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

function lengthOwnerFlags(userTurn: string) {
  return {
    deepseek_length: userTurn.includes("[DEEPSEEK LENGTH — SINGLE CALL]"),
    short_history: userTurn.includes("[SHORT HISTORY]"),
    short_user: userTurn.includes("[SHORT USER TURN]"),
    regen_length: userTurn.includes("[REGEN LENGTH]"),
    user_tail: userTurn.includes("이번 응답은 한국어 3,200~4,200자"),
  };
}

function countLengthOwners(flags: ReturnType<typeof lengthOwnerFlags>): number {
  return Object.values(flags).filter(Boolean).length;
}

async function buildPayload(opts: {
  fixture: {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
  isContinue?: boolean;
  novelModeEnabled?: boolean;
  userImpersonation?: boolean;
  message?: string;
}) {
  const { loadCharacterChunks } = await import("../src/lib/characterChunks");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const { buildSceneDirective, renderSceneDirectiveForPrompt } = await import(
    "../src/lib/sceneDirective"
  );
  const { buildContext } = await import("../src/services/contextBuilder");
  const { buildOpenRouterMessages } = await import("../src/lib/openRouterAdult");
  const { buildContinueNarrativeCommand } = await import("../src/lib/continueNarrative");
  const { COLLABORATIVE_INTERACTIVE_OWNER_TITLE } = await import("../src/lib/noGodmodding");
  const { AUTO_PROGRESSION_BLOCK_TITLE, AUTO_PROGRESSION_POV_ASSERTIONS } = await import(
    "../src/lib/autoProgressionRules"
  );
  const { resolveNoGodmoddingMode } = await import("../src/lib/noGodmodding");
  const { resolveChatRuntimeMode } = await import("../src/lib/chatRuntimeMode");

  const ch = opts.fixture.character;
  const persona = opts.fixture.persona;
  const user = opts.fixture.user;
  const greeting = String(ch.greeting ?? "").trim();
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

  const isContinue = opts.isContinue === true;
  const novelModeEnabled = opts.novelModeEnabled === true;
  const currentUserMessage = isContinue
    ? buildContinueNarrativeCommand({
        personaName,
        charName: String(ch.name),
      })
    : opts.message ?? TURN1;

  const shortTermHistory = [
    { role: "user" as const, content: OPENING_TURN_USER },
    { role: "assistant" as const, content: greeting },
  ];

  const sceneDirectiveBlock = renderSceneDirectiveForPrompt(
    buildSceneDirective({
      characterName: String(ch.name),
      recentMessages: shortTermHistory.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      currentUserMessage,
      contentKind: "character",
      mode: isContinue || novelModeEnabled ? "auto_progression" : "interactive",
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
    currentUserMessage,
    nsfw: false,
    gender: (String(ch.gender || "male") as "male" | "female" | "other") || "male",
    memoryMeta: "",
    modelId: MODEL,
    userImpersonation: opts.userImpersonation === true,
    novelModeEnabled,
    isContinue,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: isContinue ? 2 : 0,
    provider: "openrouter",
    contentKind: "character",
    sceneDirectiveBlock,
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: 34,
  } as Parameters<typeof buildContext>[0]);

  const split = built.openRouterSystemSplit!;
  const wire = buildOpenRouterMessages(built.systemPrompt, built.history, {
    systemSplit: split,
  });
  const systemJoined = Array.isArray(wire[0]?.content)
    ? (wire[0]!.content as Array<{ text?: string }>)
        .map((p) => p.text ?? "")
        .join("\n\n")
    : String(wire[0]?.content ?? "");
  const finalUser = String(wire[wire.length - 1]?.content ?? "");
  const full = `${systemJoined}\n\n${finalUser}`;
  const flags = lengthOwnerFlags(finalUser);
  const tracked = (built.meta.trackedSections ?? []).map((s) => s.id);

  const mode = resolveNoGodmoddingMode({
    isContinue,
    novelModeEnabled,
    impersonationOn: opts.userImpersonation === true && !isContinue && !novelModeEnabled,
  });
  const runtime = resolveChatRuntimeMode({
    isContinue,
    novelModeEnabled,
    oocUserImpersonationAllowed:
      opts.userImpersonation === true && !isContinue && !novelModeEnabled,
  });

  return {
    systemJoined,
    finalUser,
    full,
    flags,
    lengthOwnerCount: countLengthOwners(flags),
    tracked,
    mode,
    runtime,
    hashes: { system: sha256(systemJoined), user: sha256(finalUser) },
    counts: {
      collaborative: countOccurrences(full, COLLABORATIVE_INTERACTIVE_OWNER_TITLE),
      autoFocal: countOccurrences(full, AUTO_PROGRESSION_BLOCK_TITLE),
      legacyNovel: countOccurrences(full, "[USER CONTROL MODE - NOVEL / EXPLICIT FULL]"),
      interactiveNested: countOccurrences(full, "[INTERACTIVE USER CONTROL]"),
      sceneEngine: countOccurrences(full, "[PRIVATE SCENE ENGINE RULE]"),
      sceneTurn: countOccurrences(full, "[이번 턴 장면 지시"),
      deepseekLength: countOccurrences(full, "[DEEPSEEK LENGTH — SINGLE CALL]"),
      shortHistory: countOccurrences(full, "[SHORT HISTORY]"),
      shortUser: countOccurrences(full, "[SHORT USER TURN]"),
      regenLength: countOccurrences(full, "[REGEN LENGTH]"),
      userTail: countOccurrences(full, "이번 응답은 한국어 3,200~4,200자"),
      bInnerPovAuth: /\[B\]의 1인칭·내면 시점으로 전환/.test(full)
        ? 0
        : countOccurrences(full, "[B]의 내면 시점"),
    },
    pov: AUTO_PROGRESSION_POV_ASSERTIONS,
    sceneSectionPresent: tracked.includes("scene-directive"),
  };
}

async function main() {
  if (!existsSync(FIXTURE)) throw new Error(`missing fixture ${FIXTURE}`);
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };

  const standard = await buildPayload({ fixture });
  const auto = await buildPayload({ fixture, isContinue: true });
  const legacyNovel = await buildPayload({ fixture, novelModeEnabled: true });
  const both = await buildPayload({
    fixture,
    isContinue: true,
    novelModeEnabled: true,
  });
  const ooc = await buildPayload({ fixture, userImpersonation: true });

  const reasons: string[] = [];

  // Routing
  if (standard.mode !== "standard" || standard.runtime !== "interactive") {
    reasons.push("standard_routing");
  }
  if (auto.mode !== "autoContinue" || auto.runtime !== "auto_progression") {
    reasons.push("auto_routing");
  }
  if (legacyNovel.mode !== "autoContinue" || legacyNovel.runtime !== "auto_progression") {
    reasons.push("legacy_novel_routing");
  }
  if (both.mode !== "autoContinue" || both.counts.autoFocal !== 1) {
    reasons.push("continue_plus_novel_single_auto_owner");
  }
  if (ooc.mode !== "coNarration" || ooc.runtime !== "ooc_user_impersonation_allowed") {
    reasons.push("ooc_routing");
  }
  if (
    standard.counts.legacyNovel +
      auto.counts.legacyNovel +
      legacyNovel.counts.legacyNovel +
      both.counts.legacyNovel +
      ooc.counts.legacyNovel >
    0
  ) {
    reasons.push("legacy_novel_block_leaked");
  }

  // Standard owner counts
  if (standard.lengthOwnerCount !== 1 || !standard.flags.user_tail) {
    reasons.push(`standard_length_owners_${standard.lengthOwnerCount}`);
  }
  if (standard.counts.deepseekLength || standard.counts.shortHistory) {
    reasons.push("standard_competing_length");
  }
  if (standard.sceneSectionPresent || standard.counts.sceneEngine) {
    reasons.push("standard_scene_directive_present");
  }
  if (standard.counts.collaborative !== 1) {
    reasons.push(`standard_collaborative_${standard.counts.collaborative}`);
  }
  if (standard.counts.interactiveNested !== 0) {
    reasons.push("standard_nested_interactive_leak");
  }
  if (standard.counts.autoFocal !== 0) {
    reasons.push("standard_auto_leak");
  }

  // Auto owner counts + POV
  if (auto.counts.autoFocal !== 1) {
    reasons.push(`auto_owner_${auto.counts.autoFocal}`);
  }
  if (auto.counts.collaborative !== 0) {
    reasons.push("auto_collaborative_leak");
  }
  if (auto.counts.legacyNovel !== 0) {
    reasons.push("auto_legacy_novel");
  }
  if (!/외부에서 관찰 가능한 행동/.test(auto.full) && !/외부 행동/.test(auto.full)) {
    reasons.push("auto_missing_b_external_action");
  }
  if (!/대사를 공동 서술/.test(auto.full) && !/중간 길이의 대사/.test(auto.full)) {
    reasons.push("auto_missing_b_dialogue");
  }
  if (!/1인칭·내면 시점으로 전환하지 않는다/.test(auto.full)) {
    reasons.push("auto_missing_inner_pov_ban");
  }
  if (!auto.pov.authorizesBExternalAction || auto.pov.authorizesBInnerPov) {
    reasons.push("auto_pov_assertions");
  }

  // Legacy novel normalized identically to auto for owner title
  if (legacyNovel.counts.autoFocal !== 1 || legacyNovel.counts.legacyNovel !== 0) {
    reasons.push("legacy_novel_normalization");
  }

  const pass = reasons.length === 0;
  const verdict = pass
    ? "DEFAULT_AND_AUTO_MODE_UNIFICATION_OFFLINE_PASS"
    : "DEFAULT_AND_AUTO_MODE_UNIFICATION_OFFLINE_FAIL";

  const report = {
    verdict,
    reasons,
    standard: {
      mode: standard.mode,
      runtime: standard.runtime,
      lengthOwnerCount: standard.lengthOwnerCount,
      flags: standard.flags,
      counts: standard.counts,
      sceneSectionPresent: standard.sceneSectionPresent,
    },
    auto: {
      mode: auto.mode,
      runtime: auto.runtime,
      counts: auto.counts,
      pov: auto.pov,
      sceneSectionPresent: auto.sceneSectionPresent,
    },
    legacyNovel: {
      mode: legacyNovel.mode,
      runtime: legacyNovel.runtime,
      counts: legacyNovel.counts,
    },
    both: { mode: both.mode, counts: both.counts },
    ooc: { mode: ooc.mode, runtime: ooc.runtime },
  };

  save("OFFLINE_VERDICT.json", report);
  console.log(JSON.stringify(report, null, 2));
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
