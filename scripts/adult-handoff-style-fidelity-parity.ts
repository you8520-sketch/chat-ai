/**
 * Adult Handoff Style Fidelity Audit — prompt parity check.
 *
 * Reuses the PRODUCTION adult handoff builder (buildContext +
 * appendAdultHandoffPrompt + assemblePrimaryRpRequest) for two candidate
 * adult models and compares the outbound prompt bodies after canonicalizing
 * model ID / provider transport fields.
 *
 * Per audit §7: if production architecture injects candidate-specific
 * semantic/style prose (e.g. DeepSeek-only XML wrapping, style reminder,
 * compact future-instruction boundary, appearance variation rule), report
 * PRODUCTION_HANDOFF_PROMPT_PARITY_FAIL and STOP before any live API call.
 * Adapters are NOT deleted to fake parity.
 *
 * No generation calls are made by this script.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const FIXTURE_DIR =
  process.env.FIXTURE_DIR ?? "/opt/cursor/artifacts/opus-quality-anchor/fixtures";

const DEEPSEEK_CANDIDATE = "deepseek-v4-pro";
const MUSE_CANDIDATE = "meta/muse-spark-1.2";

// Common adult-route entry user turn — byte-identical across A/B and across
// sources. Consensual, explicitly-adult, fictional characters.
const ADULT_ENTRY_USER_TURN =
  "*그의 손이 내 허리를 감싸 안는다. 눈이 마주치고 거리가 사라진다.* \n\n“이대로 있어도 돼?”\n\n*곁에서 숨소리가 가까워진다. 더 가까이 닿아도 좋다는 허락이 눈빛에 묻어 있다.*";

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

function sha256(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

/**
 * Canonicalize a candidate request body: replace the model field and any
 * provider-transport-only fields with a neutral placeholder so that only
 * semantic prompt content remains for hashing.
 */
function canonicalizeBody(body: Record<string, unknown>): {
  canonical: Record<string, unknown>;
  diffFields: string[];
} {
  const canonical: Record<string, unknown> = { ...body };
  const diffFields: string[] = [];
  // model id — allowed difference
  if (typeof canonical.model === "string") {
    diffFields.push(`model=${canonical.model}`);
    canonical.model = "<CANDIDATE>";
  }
  // provider transport-only fields that may differ technically
  for (const k of [
    "session_id",
    "provider",
    "providerRouting",
    "reasoning",
    "include_reasoning",
    "reasoning_effort",
  ]) {
    if (k in canonical) {
      diffFields.push(`${k}=${JSON.stringify(canonical[k])}`);
      canonical[k] = "<CANDIDATE>";
    }
  }
  return { canonical, diffFields };
}

async function loadFixture(characterId: number) {
  const path = join(FIXTURE_DIR, `c${characterId}_fixture.json`);
  return JSON.parse(readFileSync(path, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
}

async function buildCandidatePrompt(opts: {
  candidateModelId: string;
  fixture: Awaited<ReturnType<typeof loadFixture>>;
  sourceHistory: ChatMsg[];
  sourceAssistantOutput: string;
  currentUserMessage: string;
}) {
  const { loadCharacterChunksForPromptReadOnly } = await import(
    "../src/lib/characterChunks"
  );
  const { formatSelectedPersonaForPrompt } = await import(
    "../src/lib/userPersonas"
  );
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const {
    appendAdultHandoffPrompt,
    buildSceneContinuityPacket,
    selectAdultHandoffRawVariants,
  } = await import("../src/lib/adultSceneRouting");
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");

  const ch = opts.fixture.character;
  const persona = opts.fixture.persona;
  const personaName = String(persona.name ?? "렌");
  const { chunks } = loadCharacterChunksForPromptReadOnly(
    {
      id: Number(ch.id),
      name: String(ch.name),
      gender: String(ch.gender ?? ""),
      system_prompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      example_dialog: String(ch.example_dialog ?? ""),
      setting_chunks: String(ch.setting_chunks ?? ""),
      speech_profile: String(ch.speech_profile ?? ""),
    },
    personaName,
    String(opts.fixture.user.nickname ?? personaName)
  );
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );

  // Reconstruct handoff RAW history: prior source exchanges + source's last
  // assistant output, then the adult entry user turn as current input.
  const handoffRaw: ChatMsg[] = [
    { role: "user", content: OPENING_TURN_USER },
    { role: "assistant", content: String(ch.greeting ?? "") },
    ...opts.sourceHistory.filter(
      (m) => m.role !== "system" && m.content !== OPENING_TURN_USER
    ),
    { role: "assistant", content: opts.sourceAssistantOutput },
  ];

  // Use the production handoff RAW selector with production defaults.
  const handoffVariants = selectAdultHandoffRawVariants(handoffRaw, {});
  const handoffHistory = handoffVariants.handoff.history;

  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: String(ch.name),
  });

  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(opts.fixture.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: handoffHistory,
    currentUserMessage: opts.currentUserMessage,
    nsfw: true,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId: opts.candidateModelId,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: Math.max(0, Math.floor((handoffHistory.length - 2) / 2)),
    provider: "openrouter",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(opts.fixture.user.id ?? 4),
    narrativePov,
    preserveAdultHandoffRawHistory: true,
  });

  const continuityPacket = buildSceneContinuityPacket({
    previousSceneMode: "romantic",
    sexualContextActive: true,
    activeConsentMode: "standard",
    charactersPresent: [String(ch.name), personaName],
    currentPov: narrativePov.mode,
  });

  const systemPrompt = appendAdultHandoffPrompt(built.systemPrompt, continuityPacket);

  const wire = assemblePrimaryRpRequest({
    system: systemPrompt,
    history: built.history ?? [],
    modelId: opts.candidateModelId,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider: "openrouter",
      charName: String(ch.name),
      personaName,
    },
  });

  const body = wire.requestBody as Record<string, unknown>;
  const messages = body.messages as ChatMsg[];
  return { body, messages, systemPrompt, history: built.history ?? [] };
}

async function main() {
  const results: Record<string, unknown> = {};

  // Use c18 (nsfw=1 adult fixture) for the character context. Reconstruct
  // a source-style prior history from the fixture greeting + one exchange.
  const fixture = await loadFixture(18);
  const ch = fixture.character;
  const sourceAssistantOutput = String(ch.greeting ?? "");
  const sourceHistory: ChatMsg[] = [
    {
      role: "user",
      content:
        "[유저 지문/행동 — 캐릭터가 관찰 가능]\n그와 마주 앉아 저녁을 함께 한다.\n\n[유저 대사]\n오늘 밤은 좀 더 느긋하게 있어도 좋을 것 같아.",
    },
  ];

  const candidates = [
    { label: "A_deepseek", modelId: DEEPSEEK_CANDIDATE },
    { label: "B_muse", modelId: MUSE_CANDIDATE },
  ];

  const built: Record<
    string,
    { body: Record<string, unknown>; messages: ChatMsg[]; systemPrompt: string; diffFields: string[] }
  > = {};

  for (const c of candidates) {
    const r = await buildCandidatePrompt({
      candidateModelId: c.modelId,
      fixture,
      sourceHistory,
      sourceAssistantOutput,
      currentUserMessage: ADULT_ENTRY_USER_TURN,
    });
    const { canonical, diffFields } = canonicalizeBody(r.body);
    built[c.label] = {
      body: canonical,
      messages: r.messages,
      systemPrompt: r.systemPrompt,
      diffFields,
    };
  }

  // Hash the canonical message array (the actual outbound prompt).
  const hashMessages = (msgs: ChatMsg[]) =>
    sha256(msgs.map((m) => `${m.role}\u0000${m.content}`).join("\u0001"));

  const promptBodyHashA = hashMessages(built.A_deepseek.messages);
  const promptBodyHashB = hashMessages(built.B_muse.messages);
  const systemHashA = sha256(built.A_deepseek.systemPrompt);
  const systemHashB = sha256(built.B_muse.systemPrompt);

  // Detect specific DeepSeek-only adapters in the DeepSeek system/user prompt
  // that are absent from Muse — the real production parity difference.
  const dsSystem = built.A_deepseek.systemPrompt;
  const museSystem = built.B_muse.systemPrompt;
  const dsUserTail = built.A_deepseek.messages[built.A_deepseek.messages.length - 1]?.content ?? "";
  const museUserTail = built.B_muse.messages[built.B_muse.messages.length - 1]?.content ?? "";

  const checks = {
    deepseek_xml_wrapping:
      dsSystem.includes("<PERSONA>") || dsSystem.includes("<WORLD_LORE>"),
    muse_xml_wrapping:
      museSystem.includes("<PERSONA>") || museSystem.includes("<WORLD_LORE>"),
    deepseek_style_reminder: dsUserTail.includes("System Reminder:"),
    muse_style_reminder: museUserTail.includes("System Reminder:"),
    deepseek_compact_boundary: dsUserTail.includes(
      "포괄적으로 순응 의사를 밝혀도"
    ),
    muse_compact_boundary: museUserTail.includes(
      "포괄적으로 순응 의사를 밝혀도"
    ),
    deepseek_appearance_variation: dsSystem.includes("DEEPSEEK_APPEARANCE") ||
      dsSystem.includes("외모 묘사"),
    muse_appearance_variation: museSystem.includes("DEEPSEEK_APPEARANCE") ||
      museSystem.includes("외모 묘사"),
    muse_m1_style_section: museSystem.includes("MUSE_PROSE_M1") ||
      museSystem.includes("Muse 문체"),
    deepseek_m1_style_section: dsSystem.includes("MUSE_PROSE_M1") ||
      dsSystem.includes("Muse 문체"),
  };

  const parity =
    promptBodyHashA === promptBodyHashB && systemHashA === systemHashB
      ? "PASS"
      : "FAIL";

  const report = {
    timestamp: new Date().toISOString(),
    fixture_character_id: 18,
    fixture_character_name: String(ch.name),
    fixture_nsfw: !!ch.nsfw,
    adult_entry_user_turn_chars: ADULT_ENTRY_USER_TURN.length,
    candidates: {
      A: { label: "A_deepseek", modelId: DEEPSEEK_CANDIDATE, diffFields: built.A_deepseek.diffFields },
      B: { label: "B_muse", modelId: MUSE_CANDIDATE, diffFields: built.B_muse.diffFields },
    },
    hashes: {
      prompt_body_hash_A: promptBodyHashA,
      prompt_body_hash_B: promptBodyHashB,
      system_hash_A: systemHashA,
      system_hash_B: systemHashB,
    },
    adapter_checks: checks,
    PROMPT_PARITY: parity,
    verdict:
      parity === "PASS"
        ? "PROMPT_PARITY_PASS"
        : "PRODUCTION_HANDOFF_PROMPT_PARITY_FAIL",
    live_calls_run: false,
    note:
      parity === "FAIL"
        ? "Production adult handoff injects candidate-specific semantic/style adapters (DeepSeek XML wrapping / style reminder / compact future-instruction boundary / appearance variation; Muse M1 style section). These are real production differences, NOT faked. Per audit §7, stop before live API calls."
        : "Prompts byte-equivalent after canonicalizing model/provider fields.",
  };

  console.log(JSON.stringify({ parity_check: report }, null, 2));

  // Save the report for the audit packet.
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const outDir = "docs/audits/adult-handoff-style-fidelity-muse12";
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "PROMPT_PARITY.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );
  writeFileSync(
    join(outDir, "PROMPT_PARITY.md"),
    `# Prompt Parity Check — Adult Handoff Fidelity Audit\n\n` +
      "Reuses production \`buildContext\` + \`appendAdultHandoffPrompt\` + \`assemblePrimaryRpRequest\` for both candidates, canonicalizes model/provider fields, then compares hashes.\n\n" +
      "```text\n" +
      `PROMPT_PARITY: ${parity}\nverdict: ${report.verdict}\n\n` +
      `prompt_body_hash_A (deepseek): ${promptBodyHashA}\n` +
      `prompt_body_hash_B (muse):     ${promptBodyHashB}\n` +
      `system_hash_A (deepseek):      ${systemHashA}\n` +
      `system_hash_B (muse):          ${systemHashB}\n\n` +
      `DeepSeek XML wrapping: ${checks.deepseek_xml_wrapping} (Muse: ${checks.muse_xml_wrapping})\n` +
      `DeepSeek style reminder: ${checks.deepseek_style_reminder} (Muse: ${checks.muse_style_reminder})\n` +
      `DeepSeek compact boundary: ${checks.deepseek_compact_boundary} (Muse: ${checks.muse_compact_boundary})\n` +
      `DeepSeek appearance variation: ${checks.deepseek_appearance_variation} (Muse: ${checks.muse_appearance_variation})\n` +
      `Muse M1 style section: ${checks.muse_m1_style_section} (DeepSeek: ${checks.deepseek_m1_style_section})\n` +
      "```\n\n" +
      (parity === "FAIL"
        ? "> **PRODUCTION_HANDOFF_PROMPT_PARITY_FAIL**\n>\n> Production adult handoff injects candidate-specific semantic/style adapters. These are real production differences and were NOT removed to fake parity. Per audit §7, live API calls are NOT run.\n"
        : "> Prompts byte-equivalent after canonicalizing model/provider fields.\n"),
    "utf8"
  );

  if (parity === "FAIL") {
    console.log("\n[parity] STOP: PRODUCTION_HANDOFF_PROMPT_PARITY_FAIL — LIVE_CALLS_NOT_RUN");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
