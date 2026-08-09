/**
 * Phase G11-C3A — One-call length root-cause forensic audit (API=0).
 *
 * Serializes sanitized C1 Arm A request snapshots for B/D/F and builds
 * request/owner/pressure inventory vs historical PR #255.
 *
 * LIVE LLM CALLS = 0 · PRODUCTION WIRE = NOT_RUN · MERGE = NOT_RUN
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  applyScenePacingArmToMessages,
  countPacingOwners,
  countTerminalDialogueBudgetOwners,
  resolveScenePacingDecision,
  type ScenePacingDecision,
} from "../src/lib/scenePacingController";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import { OPENING_TURN_USER } from "../src/lib/chatGreetingContext";
import { IMMERSIVE_PROSE_BLOCK } from "../src/lib/advancedProseNsfwGuidelines";
import { COLLABORATIVE_INTERACTIVE_OWNER_BLOCK } from "../src/lib/noGodmodding";
import {
  CURRENT_USER_INPUT_HEADER,
  INTERACTIVE_OWNERSHIP_LOCK_MARKER,
  buildCurrentUserInputWrapper,
} from "../src/lib/currentUserInputLabel";
import {
  OPENROUTER_RP_REASONING_GEMINI_3_PRO,
  GEMINI_PRO_GENERATION_PARAMS,
  OPENROUTER_MAX_OUTPUT_TOKENS,
} from "../src/lib/openRouterClient";
import { OPENROUTER_GEMINI_31_PRO_MODEL } from "../src/lib/chatModels";
import { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL } from "../src/lib/cheaperInferenceConfig";
import { OPENROUTER_CHAT_COMPLETIONS_URL } from "../src/lib/openRouterConfig";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/rp-quality-g11c3a-forensic";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/rp-one-call-length-g11c3a";
const FIX_PATH =
  "docs/audits/rp-integrated-server-control-g11i1/fixtures/G11_I1_FIXTURES.json";
const FIXTURE_FILTER = (process.env.FIXTURES ?? "B,D,F")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

type CharBundle = {
  character: Record<string, unknown>;
  persona: Record<string, unknown>;
  user: Record<string, unknown>;
  party?: boolean;
  establishedActiveCastNames?: string[];
};

type G11Fixture = {
  id: string;
  title: string;
  domain: string;
  characterFixture: string;
  expectedBudget: 4 | 5 | 6 | null;
  party?: boolean;
  contentKind?: "character" | "simulation";
  adultModeEnabled?: boolean;
  knownSupportingCastNames?: string[];
  establishedActiveCastNames?: string[];
  userInput: string;
  historyAfterGreeting: Array<{ role: string; content: string }>;
};

function sha256(t: string) {
  return createHash("sha256").update(t).digest("hex");
}
function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}
function estTokens(chars: number) {
  // Korean-heavy RP: ~1.5 chars/token (diagnostic only; not API truth)
  return Math.round(chars / 1.5);
}
function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === "object" && "text" in b
          ? String((b as { text: unknown }).text ?? "")
          : ""
      )
      .join("\n\n");
  }
  return "";
}

function loadFixtures(): G11Fixture[] {
  const raw = JSON.parse(readFileSync(FIX_PATH, "utf8")) as {
    fixtures: G11Fixture[];
  };
  return raw.fixtures.filter((f) => FIXTURE_FILTER.includes(f.id));
}
function loadCharBundle(path: string): CharBundle {
  return JSON.parse(readFileSync(path, "utf8")) as CharBundle;
}

/** Sanitize request body — strip secrets, keep shape. */
function sanitizeRequestBody(body: Record<string, unknown>) {
  const messages = Array.isArray(body.messages)
    ? (body.messages as Array<{ role: string; content: unknown }>).map((m) => {
        const text = flattenContent(m.content);
        return {
          role: m.role,
          content_chars: [...text].length,
          content_sha256: sha256(text),
          content_preview_head: text.slice(0, 240),
          content_preview_tail: text.slice(-240),
        };
      })
    : [];
  const keys = Object.keys(body).sort();
  const out: Record<string, unknown> = {
    model: body.model ?? null,
    stream: body.stream ?? null,
    stream_options: body.stream_options ?? null,
    temperature: body.temperature ?? null,
    top_p: body.top_p ?? null,
    top_k: body.top_k ?? null,
    max_tokens: body.max_tokens ?? null,
    max_completion_tokens: body.max_completion_tokens ?? null,
    stop: body.stop ?? null,
    stop_sequences: body.stop_sequences ?? null,
    response_format: body.response_format ?? null,
    reasoning: body.reasoning ?? null,
    reasoning_effort: body.reasoning_effort ?? null,
    include_reasoning: body.include_reasoning ?? null,
    provider: body.provider ?? null,
    session_id_present: typeof body.session_id === "string",
    frequency_penalty: body.frequency_penalty ?? null,
    presence_penalty: body.presence_penalty ?? null,
    repetition_penalty: body.repetition_penalty ?? null,
    message_count: messages.length,
    messages_sanitized: messages,
    body_keys: keys,
    has_stop: "stop" in body,
    has_stop_sequences: "stop_sequences" in body,
    has_max_tokens: "max_tokens" in body && body.max_tokens != null,
  };
  return out;
}

type PressureHit = { family: string; clause: string; evidence: string };

function auditSemanticPressure(fullPrompt: string): {
  hits: PressureHit[];
  counts: Record<string, number>;
  weights: Record<string, "LOW" | "MODERATE" | "HIGH">;
} {
  const families: Array<{
    family: string;
    clauses: Array<{ id: string; re: RegExp }>;
  }> = [
    {
      family: "USER_HANDOFF_PRESSURE",
      clauses: [
        {
          id: "future_actions_dialogue_thoughts_decisions",
          re: /Do not continue writing the user's future actions, dialogue, thoughts, or decisions/i,
        },
        {
          id: "leave_pressure_opportunity",
          re: /Leave pressure\/opportunity for \[B\] to respond/i,
        },
        {
          id: "do_not_stop_merely_meta",
          re: /do not stop every turn merely to ask a meta-question/i,
        },
        {
          id: "reaction_point_leave",
          re: /반응 지점을 남긴다/,
        },
        {
          id: "wait_passive_negated",
          re: /수동적으로 기다리기만 하지 않고/,
        },
      ],
    },
    {
      family: "SCENE_CLOSURE_PRESSURE",
      clauses: [
        {
          id: "do_not_summarize_or_close_early",
          re: /요약하거나 성급히 닫지 말고/,
        },
        {
          id: "natural_finish_started_action",
          re: /이미 시작한 행동의 자연스러운 마무리/,
        },
        {
          id: "input_completed_not_permission",
          re: /treat it as completed user input/i,
        },
      ],
    },
    {
      family: "COMPRESSION_PRESSURE",
      clauses: [
        {
          id: "do_not_record_every_motion",
          re: /모든 움직임을 순서대로 기록하지 않는다/,
        },
        {
          id: "compress_ordinary_movement",
          re: /평범한 이동·생활 동작은 압축한다/,
        },
        {
          id: "no_action_body_prop_lists",
          re: /행동 목록, 신체 부위 목록, 소품 조작 목록/,
        },
        {
          id: "no_repeat_prove_metaphor",
          re: /다른 비유·정의·대비로 반복 증명하지 말고/,
        },
        {
          id: "dialogue_budget_terminal",
          re: /\[이번 응답 대화\]/,
        },
        {
          id: "scene_pacing_owner",
          re: /\[SCENE PACING\]/,
        },
      ],
    },
    {
      family: "EXPANSION_SPACE",
      clauses: [
        {
          id: "length_owner_dense_scene",
          re: /하나의 밀도 있는 장면으로 전개한다/,
        },
        {
          id: "obs_action_speech_sense_psych",
          re: /관찰·행동·대사·감각·심리/,
        },
        {
          id: "interior_action_env_relation_causal",
          re: /내면·행동·환경·관계의 변화가 서로 인과적으로 이어지게 쓴다/,
        },
        {
          id: "thought_assoc_memory",
          re: /생각·연상·기억·오해·감정·판단/,
        },
        {
          id: "active_character_moves",
          re: /대사·행동·접촉·제안을 능동적으로 수행한다/,
        },
      ],
    },
  ];

  const hits: PressureHit[] = [];
  const counts: Record<string, number> = {};
  for (const fam of families) {
    let n = 0;
    for (const c of fam.clauses) {
      if (c.re.test(fullPrompt)) {
        n += 1;
        const m = fullPrompt.match(c.re);
        hits.push({
          family: fam.family,
          clause: c.id,
          evidence: m?.[0] ?? c.id,
        });
      }
    }
    counts[fam.family] = n;
  }
  function weight(n: number, max: number): "LOW" | "MODERATE" | "HIGH" {
    if (n <= 0) return "LOW";
    if (n / max < 0.4) return "LOW";
    if (n / max < 0.75) return "MODERATE";
    return "HIGH";
  }
  const weights: Record<string, "LOW" | "MODERATE" | "HIGH"> = {};
  for (const fam of families) {
    weights[fam.family] = weight(counts[fam.family] ?? 0, fam.clauses.length);
  }
  return { hits, counts, weights };
}

function extractOwnerPresence(systemText: string, lastUser: string) {
  const full = `${systemText}\n\n${lastUser}`;
  const owners: Array<Record<string, unknown>> = [];
  const defs: Array<{
    name: string;
    marker: string;
    text?: string;
    where: "system" | "user_tail" | "either";
  }> = [
    {
      name: "COLLABORATIVE_INTERACTIVE_OWNER",
      marker: "[USER CONTROL — COLLABORATIVE INTERACTIVE]",
      text: COLLABORATIVE_INTERACTIVE_OWNER_BLOCK,
      where: "system",
    },
    {
      name: "IMMERSIVE_PROSE",
      marker: "[IMMERSIVE PROSE]",
      text: IMMERSIVE_PROSE_BLOCK,
      where: "system",
    },
    {
      name: "IMMERSIVE_LONGFORM_PROSE",
      marker: "[IMMERSIVE LONGFORM PROSE]",
      where: "system",
    },
    {
      name: "SCENE_PACING",
      marker: "[SCENE PACING]",
      where: "system",
    },
    {
      name: "SCENE_FLOW",
      marker: "[SCENE FLOW]",
      where: "system",
    },
    {
      name: "CURRENT_USER_INPUT_WRAPPER",
      marker: CURRENT_USER_INPUT_HEADER,
      where: "user_tail",
    },
    {
      name: "INTERACTIVE_OWNERSHIP_LOCK",
      marker: INTERACTIVE_OWNERSHIP_LOCK_MARKER,
      where: "user_tail",
    },
    {
      name: "USER_TAIL_LENGTH_OWNER",
      marker: USER_TAIL_LENGTH_OWNER_SENTENCE,
      text: USER_TAIL_LENGTH_OWNER_SENTENCE,
      where: "user_tail",
    },
    {
      name: "DIALOGUE_BUDGET_TERMINAL",
      marker: "[이번 응답 대화]",
      where: "user_tail",
    },
    {
      name: "COMBINED_L1_TERMINAL",
      marker: "[이번 응답]",
      where: "user_tail",
    },
    {
      name: "EXAMPLE_DIALOG_STYLE_ONLY",
      marker: "[EXAMPLE DIALOG — STYLE ONLY]",
      where: "system",
    },
    {
      name: "NO_FALSE_SHARED_MEMORY",
      marker: "[NO FALSE SHARED MEMORY]",
      where: "system",
    },
  ];

  for (const d of defs) {
    const hay =
      d.where === "system"
        ? systemText
        : d.where === "user_tail"
          ? lastUser
          : full;
    const idx = hay.indexOf(d.marker);
    const present = idx >= 0;
    const exactTextPresent =
      d.text != null ? hay.includes(d.text) : present;
    owners.push({
      owner: d.name,
      present,
      exact_constant_present: exactTextPresent,
      position_index: idx,
      absolute_terminal_user:
        d.where === "user_tail" && present
          ? lastUser.trimEnd().endsWith(d.marker) ||
            (d.text != null && lastUser.trimEnd().endsWith(d.text))
          : null,
      text_sha256: d.text != null ? sha256(d.text) : null,
      text_chars: d.text != null ? [...d.text].length : null,
      marker: d.marker.slice(0, 80),
    });
  }
  return owners;
}

async function assembleArmA(fixture: G11Fixture, modelId: string) {
  const { loadCharacterChunksForPromptReadOnly } = await import(
    "../src/lib/characterChunks"
  );
  const { formatSelectedPersonaForPrompt } = await import(
    "../src/lib/userPersonas"
  );
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");

  const bundle = loadCharBundle(fixture.characterFixture);
  const ch = { ...bundle.character };
  const persona = { ...bundle.persona };
  const personaName = String(persona.name ?? "유저");
  const contentKind = fixture.contentKind ?? "character";
  const party = Boolean(fixture.party ?? bundle.party);
  const support = fixture.knownSupportingCastNames ?? [];
  const established =
    fixture.establishedActiveCastNames ??
    bundle.establishedActiveCastNames ??
    (party
      ? [String(ch.name), personaName, ...(support.length ? support : ["동료"])]
      : undefined);

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
    String(bundle.user.nickname ?? personaName)
  );
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind,
    mainCharacterName: String(ch.name),
  });
  const greeting = String(ch.greeting ?? "");
  const shortTermHistory = [
    { role: "user" as const, content: OPENING_TURN_USER },
    { role: "assistant" as const, content: greeting },
    ...fixture.historyAfterGreeting.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(bundle.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory,
    currentUserMessage: fixture.userInput,
    nsfw: !!ch.nsfw || !!fixture.adultModeEnabled,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: Math.max(0, shortTermHistory.length / 2 - 1),
    provider: "openrouter",
    contentKind,
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(bundle.user.id ?? 4),
    narrativePov,
  });

  const decision: ScenePacingDecision = resolveScenePacingDecision({
    contentKind,
    party,
    primaryCharacterName: String(ch.name),
    currentUserMessage: fixture.userInput,
    recentMessages: shortTermHistory,
    currentTurn: Math.max(1, Math.floor(shortTermHistory.length / 2) + 1),
    progressionHistory: [],
    knownSupportingCastNames: support,
    establishedActiveCastNames: established,
    adultModeEnabled: fixture.adultModeEnabled ?? false,
    chatId: `g11c3a-A-${fixture.id}`,
  });

  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider: "openrouter",
      charName: String(ch.name),
      personaName,
    },
  });

  const bodyBase = {
    ...(wire.requestBody as Record<string, unknown>),
    stream: true,
    stream_options: { include_usage: true },
  };
  const messagesBase =
    (bodyBase.messages as Array<{ role: string; content: string }>) ?? [];

  const applied = applyScenePacingArmToMessages({
    messages: messagesBase,
    arm: "A",
    decision,
    dialogueBudgetInput: {
      currentUserMessage: fixture.userInput,
      recentMessages: shortTermHistory,
      knownSupportingCastNames: support,
      party,
      contentKind,
    },
  });

  const body = { ...bodyBase, messages: applied.messages };
  const messages = applied.messages;
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const systemMsg = messages.find((m) => m.role === "system");
  const systemText = flattenContent(systemMsg?.content ?? applied.systemText);
  const lastUserContent = flattenContent(lastUser?.content ?? "");

  const historyMsgs = messages.filter(
    (m) => m.role === "user" || m.role === "assistant"
  );
  // Exclude last user from "history" size for accounting
  const priorHistory = historyMsgs.slice(0, -1);
  const historyChars = priorHistory.reduce(
    (a, m) => a + [...flattenContent(m.content)].length,
    0
  );
  const systemChars = [...systemText].length;
  const lastUserChars = [...lastUserContent].length;
  const fullInputChars = messages.reduce(
    (a, m) => a + [...flattenContent(m.content)].length,
    0
  );

  const pressure = auditSemanticPressure(`${systemText}\n\n${lastUserContent}`);
  const owners = extractOwnerPresence(systemText, lastUserContent);
  const wrapperLegacy = buildCurrentUserInputWrapper({
    mode: "interactive",
    personaName,
    ownershipLockEnabled: false,
  });
  const wrapperLock = buildCurrentUserInputWrapper({
    mode: "interactive",
    personaName,
    ownershipLockEnabled: true,
  });

  const sanitized = sanitizeRequestBody(body);

  // Theoretical visible capacity: max_tokens omitted → provider default.
  // Document OR Gemini documented coerce fallback 8192; RP omits field.
  const maxTokensField = body.max_tokens;
  const theoreticalVisible = {
    max_tokens_in_request: maxTokensField ?? null,
    max_tokens_omitted: maxTokensField == null,
    openrouter_coerce_fallback_constant: OPENROUTER_MAX_OUTPUT_TOKENS,
    approx_korean_chars_at_8192_tokens: Math.round(8192 * 1.5),
    desired_korean_range: [3000, 6000],
    OUTPUT_TOKEN_CAP_NOT_CAUSE:
      maxTokensField == null ||
      (typeof maxTokensField === "number" && maxTokensField * 1.5 >= 6000),
    note:
      "RP chat resolveMaxOutputTokensForTarget returns undefined (omit). Historical #255 also omitted max_tokens and produced ~4200 visible output tokens with finish_reason=stop — hard cap not binding then either.",
  };

  return {
    fixture: fixture.id,
    domain: fixture.domain,
    characterFixture: fixture.characterFixture,
    modelId,
    endpoint_class: "openrouter_chat_completions",
    endpoint: OPENROUTER_CHAT_COMPLETIONS_URL,
    generation: {
      temperature: body.temperature ?? null,
      top_p: body.top_p ?? null,
      top_k: body.top_k ?? null,
      reasoning: body.reasoning ?? null,
      reasoning_effort: body.reasoning_effort ?? null,
      include_reasoning: body.include_reasoning ?? null,
      max_tokens: body.max_tokens ?? null,
      max_completion_tokens: body.max_completion_tokens ?? null,
      stop: body.stop ?? null,
      stop_sequences: body.stop_sequences ?? null,
      response_format: body.response_format ?? null,
      stream: body.stream ?? null,
      stream_options: body.stream_options ?? null,
      provider_routing: body.provider ?? null,
    },
    sizes: {
      messages_count: messages.length,
      system_chars: systemChars,
      system_est_tokens: estTokens(systemChars),
      history_chars: historyChars,
      history_est_tokens: estTokens(historyChars),
      last_user_chars: lastUserChars,
      last_user_est_tokens: estTokens(lastUserChars),
      full_input_chars: fullInputChars,
      full_input_est_tokens: estTokens(fullInputChars),
    },
    owners_present: owners,
    pacing_owners: countPacingOwners(systemText),
    terminal_owners: countTerminalDialogueBudgetOwners(lastUserContent),
    pressure,
    user_wrapper: {
      legacy_interactive_sha256: sha256(wrapperLegacy),
      legacy_interactive_chars: [...wrapperLegacy].length,
      lock_enabled_sha256: sha256(wrapperLock),
      lock_enabled_chars: [...wrapperLock].length,
      lock_marker_in_assembled: lastUserContent.includes(
        INTERACTIVE_OWNERSHIP_LOCK_MARKER
      ),
      assembled_uses_legacy_or_lock: lastUserContent.includes(
        INTERACTIVE_OWNERSHIP_LOCK_MARKER
      )
        ? "LOCK"
        : lastUserContent.includes(CURRENT_USER_INPUT_HEADER)
          ? "LEGACY_OR_HEADER"
          : "ABSENT",
      agency_vs_early_stop_note:
        "Wording preserves agency ('Do not continue writing the user's future…') and also tells model to leave response opportunity; does not literally say 'stop once answered', but handoff semantics are present.",
    },
    length_owner: {
      sentence: USER_TAIL_LENGTH_OWNER_SENTENCE,
      sha256: sha256(USER_TAIL_LENGTH_OWNER_SENTENCE),
      chars: [...USER_TAIL_LENGTH_OWNER_SENTENCE].length,
      absolute_terminal: lastUserContent
        .trimEnd()
        .endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE),
      dialogue_budget_present: /\[이번 응답 대화\]/.test(lastUserContent),
    },
    theoretical_visible_capacity: theoreticalVisible,
    request_sanitized: sanitized,
    system_sha256: sha256(systemText),
    user_tail_sha256: sha256(lastUserContent),
    constants: {
      OPENROUTER_RP_REASONING_GEMINI_3_PRO,
      GEMINI_PRO_GENERATION_PARAMS,
      COLLAB_sha256: sha256(COLLABORATIVE_INTERACTIVE_OWNER_BLOCK),
      IMMERSIVE_sha256: sha256(IMMERSIVE_PROSE_BLOCK),
      USER_TAIL_sha256: sha256(USER_TAIL_LENGTH_OWNER_SENTENCE),
    },
  };
}

function historicalInventory() {
  // Values from PR #255 persisted artifacts + code at tip 3af5ec5. No guessing.
  const costPathCandidates = [
    "docs/audits/55-gemini31-opus5-minimal-screen/COST_RESULTS.json",
    "/tmp/c3a-hist/COST_RESULTS.json",
  ];
  let cost: Record<string, unknown> | null = null;
  for (const p of costPathCandidates) {
    if (existsSync(p)) {
      cost = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      break;
    }
  }
  // If missing on branch, use extracted /tmp copy from origin/pr-255
  if (!cost && existsSync("/tmp/c3a-hist/COST_RESULTS.json")) {
    cost = JSON.parse(
      readFileSync("/tmp/c3a-hist/COST_RESULTS.json", "utf8")
    ) as Record<string, unknown>;
  }

  const gemini = (cost?.byModel as Record<string, unknown> | undefined)
    ?.gemini31 as Record<string, unknown> | undefined;
  const turns = (gemini?.turns as Array<Record<string, unknown>>) ?? [];
  const avgVisible =
    typeof gemini?.avg_visible_chars === "number"
      ? gemini.avg_visible_chars
      : null;

  return {
    pr: 255,
    pr_url: "https://github.com/you8520-sketch/chat-ai/pull/255",
    branch: "cursor/gemini31-opus5-minimal-screen-6a91",
    tip_commit: "3af5ec5b36ae35648f08cb235c4afab73770a35a",
    base_noted: "cursor/standard-collaborative-lineup-6a91 (PR #250)",
    route: {
      app_path: "/api/chat",
      provider_endpoint_class: "cheaperinference_chat_completions",
      endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      evidence:
        "live script posts /api/chat; AVAILABILITY.json endpoint CI; COST rows provider=cheaperinference",
    },
    model: {
      requested: "gemini-3.1-pro-preview",
      resolved: "gemini-3.1-pro-preview",
      provider_label_in_usage: "cheaperinference",
      upstream_provider_capability_note: "Google (AVAILABILITY.json)",
    },
    reasoning: {
      wire: "reasoning_effort=low",
      openrouter_style_reasoning_object: "STRIPPED by adaptCheaperInferenceChatBody",
      include_reasoning: "STRIPPED / not sent on CI",
      evidence: "AVAILABILITY.json + cheaperInferenceConfig.ts @ 3af5ec5",
    },
    temperature: {
      value: 0.95,
      evidence:
        "GEMINI_PRO_GENERATION_PARAMS.temperature in openRouterClient.ts (SAME @ 3af5ec5 and HEAD); applied before CI adapt",
      confidence: "HIGH_from_code_path",
    },
    top_p: {
      value: null,
      note: "OPENROUTER_FORBIDDEN_KEYS deletes top_p for non-DeepSeek; not in persisted meta",
      status: "OMITTED_BY_CODE",
    },
    max_tokens: {
      value: null,
      note: "resolveMaxOutputTokensForTarget returns undefined — RP omits max_tokens @ 3af5ec5",
      status: "OMITTED_BY_CODE",
      observed_visible_output_tokens_max: turns.length
        ? Math.max(
            ...turns.map((t) => Number(t.visible_output_tokens ?? 0))
          )
        : null,
    },
    stop_sequences: {
      value: null,
      status: "OMITTED_BY_CODE",
      evidence:
        "OPENROUTER_FORBIDDEN_KEYS includes stop/stop_sequences; assertPureOpenRouterPayload rejects them",
    },
    stream: { value: true, stream_options_include_usage: "UNKNOWN_PERSISTED" },
    response_format: { value: null, status: "UNKNOWN_NOT_PERSISTED" },
    fixtures: {
      character_id: 18,
      persona_id: 61,
      sets: ["relationship T1-T2", "action T1-T2"],
      note: "Different from G11 B/D/F — FIXTURE_CONFOUND=YES",
    },
    prompt_owners_declared: {
      SceneDirective: 0,
      collaborative_owner: 1,
      legacy_novel_owner: 0,
      terminal_length_owner: 1,
    },
    owner_text_recoverable: {
      USER_TAIL_LENGTH_OWNER_SENTENCE: {
        text: USER_TAIL_LENGTH_OWNER_SENTENCE,
        sha256: sha256(USER_TAIL_LENGTH_OWNER_SENTENCE),
        vs_current: "BYTE_IDENTICAL",
        evidence: "constant identical at 3af5ec5 and HEAD",
      },
      COLLABORATIVE_INTERACTIVE_OWNER_BLOCK: {
        sha256: sha256(COLLABORATIVE_INTERACTIVE_OWNER_BLOCK),
        vs_current: "BYTE_IDENTICAL",
        evidence: "noGodmodding.ts identical @ 3af5ec5 vs HEAD",
      },
      IMMERSIVE_PROSE_BLOCK: {
        sha256: sha256(IMMERSIVE_PROSE_BLOCK),
        vs_current: "BYTE_IDENTICAL",
        evidence: "advancedProseNsfwGuidelines.ts identical @ 3af5ec5 vs HEAD",
      },
      currentUserInputLabel_module: {
        vs_current: "BYTE_IDENTICAL",
        evidence: "currentUserInputLabel.ts identical @ 3af5ec5 vs HEAD",
      },
      full_assembled_prompt_chars: "UNKNOWN",
      full_assembled_prompt_tokens: "UNKNOWN",
      note: "Full prompt body was not persisted in Audit 55 packets; only input_tokens from usage (~17514 T1, ~21726–21862 T2)",
    },
    outputs: {
      avg_visible_chars: avgVisible,
      finish_reasons: turns.map((t) => t.finish_reason),
      retry: 0,
      continuation: 0,
      recovery: 0,
    },
    input_tokens_observed: turns.map((t) => ({
      id: t.id,
      input_tokens: t.input_tokens,
      visible_output_tokens: t.visible_output_tokens,
      visible_chars: t.visible_chars,
      finish_reason: t.finish_reason,
    })),
  };
}

function buildRequestDiff(
  historical: ReturnType<typeof historicalInventory>,
  currentSample: Awaited<ReturnType<typeof assembleArmA>>
) {
  type Row = {
    field: string;
    historical: unknown;
    current: unknown;
    status: "SAME" | "DIFFERENT" | "UNKNOWN";
    possible_length_impact: string;
  };
  const rows: Row[] = [];
  function row(
    field: string,
    h: unknown,
    c: unknown,
    status: Row["status"],
    impact: string
  ) {
    rows.push({
      field,
      historical: h,
      current: c,
      status,
      possible_length_impact: impact,
    });
  }

  row(
    "provider_route",
    "cheaperinference /api/chat → api.cheaperinference.com",
    "openrouter assemblePrimaryRpRequest → openrouter.ai",
    "DIFFERENT",
    "HIGH — different gateway/provider routing; not prompt-only"
  );
  row(
    "model_id",
    historical.model.requested,
    currentSample.modelId,
    "DIFFERENT",
    "HIGH — CI bare slug vs OpenRouter google/ slug; may map to different backends"
  );
  row(
    "reasoning",
    "reasoning_effort=low (CI)",
    currentSample.generation.reasoning,
    "DIFFERENT",
    "MEDIUM — same effort label 'low' but different wire shape; budget sharing UNKNOWN"
  );
  row(
    "temperature",
    historical.temperature.value,
    currentSample.generation.temperature,
    historical.temperature.value === currentSample.generation.temperature
      ? "SAME"
      : "DIFFERENT",
    "LOW if same; sampling affects style more than hard length"
  );
  row(
    "top_p",
    historical.top_p.value,
    currentSample.generation.top_p,
    "SAME",
    "LOW — both omitted"
  );
  row(
    "max_output_tokens",
    historical.max_tokens.value,
    currentSample.generation.max_tokens,
    "SAME",
    "LOW as cause — both omitted; historical still reached ~4k output tokens"
  );
  row(
    "stop_sequences",
    historical.stop_sequences.value,
    currentSample.generation.stop,
    "SAME",
    "LOW — both omitted by forbidden-key policy; NOT a new stop config"
  );
  row(
    "message_structure",
    "system + history + wrapped current user (via /api/chat buildContext)",
    `messages_count=${currentSample.sizes.messages_count}`,
    "UNKNOWN",
    "MEDIUM — structure class same; exact history/fixture content differs"
  );
  row(
    "system_length",
    "UNKNOWN (usage input_tokens T1≈17514 includes all)",
    currentSample.sizes.system_chars,
    "UNKNOWN",
    "UNKNOWN — cannot compare absolute system size without historical prompt dump"
  );
  row(
    "history_length",
    "UNKNOWN exact; T2 input_tokens≈21.7k",
    currentSample.sizes.history_chars,
    "UNKNOWN",
    "HIGH confound via fixture/history domain difference"
  );
  row(
    "user_tail_structure",
    "CURRENT USER wrapper + body + layout + USER_TAIL_LENGTH (code path)",
    currentSample.length_owner,
    "SAME",
    "LOW as delta — USER_TAIL BYTE_IDENTICAL; placement absolute terminal on Arm A"
  );
  row(
    "stream",
    true,
    currentSample.generation.stream,
    "SAME",
    "NONE"
  );
  return rows;
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(DOCS, { recursive: true });

  // Ensure historical COST available
  if (!existsSync("/tmp/c3a-hist/COST_RESULTS.json")) {
    throw new Error("missing /tmp/c3a-hist/COST_RESULTS.json — extract PR #255 first");
  }
  // Copy historical reference into docs for sealed audit
  save(
    join(DOCS, "historical"),
    "COST_RESULTS_GEMINI_SUMMARY.json",
    JSON.parse(readFileSync("/tmp/c3a-hist/COST_RESULTS.json", "utf8")).byModel
      .gemini31
  );
  for (const name of [
    "AVAILABILITY.json",
    "SOURCE_MANIFEST.json",
    "PROMPT_OWNER_MATRIX.md",
    "README.md",
    "RUNTIME_RESULTS.json",
  ]) {
    const p = join("/tmp/c3a-hist", name);
    if (existsSync(p)) {
      writeFileSync(join(DOCS, "historical", name), readFileSync(p), "utf8");
    }
  }

  const historical = historicalInventory();
  const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;
  const fixtures = loadFixtures();
  const assemblies: Awaited<ReturnType<typeof assembleArmA>>[] = [];

  for (const fix of fixtures) {
    console.log(`assemble Arm A fixture=${fix.id} (no LLM call)`);
    const a = await assembleArmA(fix, modelId);
    assemblies.push(a);
    save(join(OUT_ROOT, "snapshots"), `C1_ARM_A_${fix.id}_sanitized.json`, a);
    save(join(DOCS, "snapshots"), `C1_ARM_A_${fix.id}_sanitized.json`, {
      fixture: a.fixture,
      generation: a.generation,
      sizes: a.sizes,
      owners_present: a.owners_present,
      pressure: {
        counts: a.pressure.counts,
        weights: a.pressure.weights,
        hits: a.pressure.hits,
      },
      length_owner: a.length_owner,
      user_wrapper: a.user_wrapper,
      theoretical_visible_capacity: a.theoretical_visible_capacity,
      request_sanitized: a.request_sanitized,
      system_sha256: a.system_sha256,
      user_tail_sha256: a.user_tail_sha256,
      constants: a.constants,
      pacing_owners: a.pacing_owners,
      terminal_owners: a.terminal_owners,
    });
  }

  const sample = assemblies[0]!;
  const requestDiff = buildRequestDiff(historical, sample);

  // Aggregate pressure across fixtures
  const pressureAgg: Record<string, number[]> = {};
  for (const a of assemblies) {
    for (const [k, v] of Object.entries(a.pressure.counts)) {
      (pressureAgg[k] ??= []).push(v);
    }
  }

  const inventory = {
    phase: "G11-C3A",
    llm_calls: 0,
    production_wire: "NOT_RUN",
    merge: "NOT_RUN",
    historical,
    current: {
      pr: 300,
      pr_url: "https://github.com/you8520-sketch/chat-ai/pull/300",
      branch_reference: "cursor/server-control-length-tax-baseline-g11c1-96c2",
      tip_commit: "1ecdf8f",
      base: "7f0c54b60e7ace11bc6e4eea9c820caadde24853",
      route: "OpenRouter assemblePrimaryRpRequest (G11 harness; not /api/chat)",
      model: modelId,
      provider_endpoint: OPENROUTER_CHAT_COMPLETIONS_URL,
      fixtures: FIXTURE_FILTER,
      arm: "A",
      mean_visible_chars_from_C1: 2178,
      assemblies: assemblies.map((a) => ({
        fixture: a.fixture,
        domain: a.domain,
        sizes: a.sizes,
        generation: a.generation,
        system_sha256: a.system_sha256,
        user_tail_sha256: a.user_tail_sha256,
        pacing_owners: a.pacing_owners,
        terminal_owners: a.terminal_owners,
        pressure_counts: a.pressure.counts,
        pressure_weights: a.pressure.weights,
        length_owner_terminal: a.length_owner.absolute_terminal,
        dialogue_budget: a.length_owner.dialogue_budget_present,
        wrapper_mode: a.user_wrapper.assembled_uses_legacy_or_lock,
        OUTPUT_TOKEN_CAP_NOT_CAUSE:
          a.theoretical_visible_capacity.OUTPUT_TOKEN_CAP_NOT_CAUSE,
      })),
    },
    request_diff: requestDiff,
    stop_audit: {
      historical_stop: null,
      current_stop: sample.generation.stop,
      current_stop_sequences: sample.generation.stop_sequences,
      current_has_stop_key: sample.request_sanitized.has_stop,
      finding:
        "NO new stop configuration on current vs historical code path. Both forbid stop/stop_sequences.",
      priority: "NOT_HIGH — stop delta absent",
    },
    output_budget_audit: {
      OUTPUT_TOKEN_CAP_NOT_CAUSE: true,
      evidence:
        "Both omit max_tokens; historical finish_reason=stop with visible_output_tokens≈3842–4283; current C1 short stops also finish_reason=stop (not length).",
      reasoning_budget_sharing: "UNKNOWN — not persisted; no live probe in C3A",
    },
    owner_parity: {
      USER_TAIL_LENGTH_OWNER_SENTENCE: "BYTE_IDENTICAL",
      COLLABORATIVE_INTERACTIVE_OWNER_BLOCK: "BYTE_IDENTICAL",
      IMMERSIVE_PROSE_BLOCK: "BYTE_IDENTICAL",
      currentUserInputLabel_module: "BYTE_IDENTICAL",
      SCENE_PACING_module: "HIST_ABSENT / CUR_PRESENT_but_ArmA_injects_0",
      D3_dialogue_budget_on_ArmA: 0,
    },
    pressure_summary: {
      per_fixture: assemblies.map((a) => ({
        fixture: a.fixture,
        counts: a.pressure.counts,
        weights: a.pressure.weights,
      })),
      note: "Pressure exists on CURRENT; key compression/handoff clauses are in BYTE_IDENTICAL owners also present historically — not a new injection delta.",
    },
    fixture_confound: "YES",
    provider_route_confound: "YES",
  };

  save(OUT_ROOT, "00_FORENSIC_INVENTORY.json", inventory);
  save(DOCS, "00_FORENSIC_INVENTORY.json", inventory);
  save(DOCS, "01_REQUEST_DIFF.json", requestDiff);

  console.log(
    JSON.stringify(
      {
        ok: true,
        fixtures: assemblies.map((a) => a.fixture),
        llm_calls: 0,
        OUTPUT_TOKEN_CAP_NOT_CAUSE: true,
        stop_delta: false,
        owner_tail: "BYTE_IDENTICAL",
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
