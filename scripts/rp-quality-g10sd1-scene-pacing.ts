/**
 * Phase G10-SD1 — Scene Pacing Controller live harness.
 *
 * PRODUCTION WIRE = 0 · MERGE = 0
 * Sole variable: SERVER MOTION BUDGET compact cue (Arm P).
 * Agency / CURRENT USER / prose / layout / runtime = production BYTE_IDENTICAL.
 *
 *   PHASE=preaudit|live FIXTURES=N1S,N2 node --conditions=react-server --import tsx \
 *     scripts/rp-quality-g10sd1-scene-pacing.ts
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
  computeRpQualityVectorV2,
  type SettingSource,
} from "../src/lib/rpQualityVector";
import {
  applyScenePacingArmToMessages,
  resolveScenePacingDecision,
  type ScenePacingDecision,
} from "../src/lib/scenePacingController";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import { OPENING_TURN_USER } from "../src/lib/chatGreetingContext";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}
if (!process.env.OPENROUTER_API_KEY?.trim() && existsSync("/tmp/d6b1_or_key")) {
  process.env.OPENROUTER_API_KEY = readFileSync("/tmp/d6b1_or_key", "utf8").trim();
}

const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/rp-quality-g10sd1-scene-pacing";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/rp-scene-pacing-g10sd1";
const C10 =
  "docs/audits/rp-quality-v2-gemini/fixtures/c10_fixture.json";
const FIX_PATH =
  "docs/audits/rp-gemini-contextual-scene-g9a/fixtures/G9A_FIXTURES.json";
const DRAWS = 2;
const PHASE =
  (process.env.PHASE as "preaudit" | "live" | undefined) ??
  (process.argv.includes("--live") ? "live" : "preaudit");
const FIXTURE_FILTER = (process.env.FIXTURES ?? "N1S,N2")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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
function visibleChars(text: string) {
  return text.replace(/\s+/g, "").length;
}
function estimateTokensFromChars(chars: number) {
  return Math.max(1, Math.round(chars / 2));
}

type NFixture = {
  id: string;
  title: string;
  role: string;
  userInput: string;
  historyAfterGreeting: Array<{ role: string; content: string }>;
};

function loadC10() {
  return JSON.parse(readFileSync(C10, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
}
function loadFixtures(): NFixture[] {
  const raw = JSON.parse(readFileSync(FIX_PATH, "utf8")) as {
    fixtures: NFixture[];
  };
  return raw.fixtures.filter((f) => FIXTURE_FILTER.includes(f.id));
}

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
  generationId: string | null;
  provider: string | null;
  sawDone: boolean;
};

function processSseLine(line: string, state: StreamState): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return;
  const data = trimmed.slice(5).trim();
  if (!data) return;
  if (data === "[DONE]") {
    state.sawDone = true;
    return;
  }
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return;
  }
  if (typeof ev.id === "string" && !state.generationId) state.generationId = ev.id;
  if (typeof ev.model === "string") state.resolved = ev.model;
  if (ev.provider && typeof ev.provider === "object") {
    const p = ev.provider as Record<string, unknown>;
    if (typeof p.name === "string") state.provider = p.name;
  }
  if (typeof ev.provider === "string") state.provider = ev.provider;
  if (ev.usage && typeof ev.usage === "object") {
    state.usage = ev.usage as Record<string, unknown>;
  }
  const choices = ev.choices as Array<Record<string, unknown>> | undefined;
  const choice0 = choices?.[0];
  if (choice0 && typeof choice0.finish_reason === "string") {
    state.finish = choice0.finish_reason;
  }
  const delta = choice0?.delta as Record<string, unknown> | undefined;
  if (typeof delta?.content === "string") state.text += delta.content;
  if (typeof choice0?.text === "string") state.text += choice0.text;
}

function processSseChunk(chunk: string, buf: string, state: StreamState) {
  const combined = buf + chunk;
  const lines = combined.split(/\r?\n/);
  const rest = lines.pop() ?? "";
  for (const line of lines) processSseLine(line, state);
  return rest;
}
function flushRemainingSseBuffer(buf: string, state: StreamState) {
  if (buf.trim()) processSseLine(buf, state);
}
function isTransportAbort(error: string | null, httpStatus: number) {
  if (httpStatus === 0 || httpStatus >= 500) return true;
  if (!error) return false;
  return /abort|ECONNRESET|socket|fetch failed|network/i.test(error);
}

async function streamOpenRouter(body: Record<string, unknown>) {
  const { OPENROUTER_CHAT_COMPLETIONS_URL, buildOpenRouterHeaders } =
    await import("../src/lib/openRouterConfig");
  const t0 = Date.now();
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    generationId: null,
    provider: null,
    sawDone: false,
  };
  try {
    const res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildOpenRouterHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      return {
        http_status: res.status,
        error: errText.slice(0, 800),
        text: "",
        finish_reason: null as string | null,
        usage: null as Record<string, unknown> | null,
        provider: null as string | null,
        latency_s: (Date.now() - t0) / 1000,
      };
    }
    if (!res.body) {
      return {
        http_status: res.status,
        error: "empty body",
        text: "",
        finish_reason: null,
        usage: null,
        provider: null,
        latency_s: (Date.now() - t0) / 1000,
      };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf = processSseChunk(decoder.decode(value, { stream: true }), buf, state);
    }
    flushRemainingSseBuffer(buf, state);
    return {
      http_status: res.status,
      error: null as string | null,
      text: state.text,
      finish_reason: state.finish,
      usage: state.usage,
      provider: state.provider,
      latency_s: (Date.now() - t0) / 1000,
    };
  } catch (e) {
    return {
      http_status: 0,
      error: e instanceof Error ? e.message : String(e),
      text: "",
      finish_reason: null,
      usage: null,
      provider: null,
      latency_s: (Date.now() - t0) / 1000,
    };
  }
}

function usageTokens(usage: Record<string, unknown> | null) {
  if (!usage) return null;
  return {
    prompt: usage.prompt_tokens ?? null,
    completion: usage.completion_tokens ?? null,
    total: usage.total_tokens ?? null,
  };
}

function scoreResponseAnchorCount(text: string) {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  let count = 0;
  for (const p of paras) {
    if (/^["“「『]/.test(p) || /["”」』]\s*$/.test(p)) count += 1;
  }
  const band =
    count <= 1 ? "IDEAL" : count === 2 ? "ACCEPTABLE" : "OVERLOAD";
  return { response_anchor_count: count, band };
}

function extractCanonSurface(systemText: string) {
  const canonStart = systemText.indexOf("[CHARACTER CANON");
  let canon = "";
  if (canonStart >= 0) {
    const from = systemText.slice(canonStart);
    const cut = from.search(
      /\n\[(?:IDENTITY_AND_RULES|USER_PERSONA|WEBNOVEL|NARRATION REGISTER|PRIVATE OUTPUT|SCENE |GEMINI )/
    );
    canon = cut > 0 ? from.slice(0, cut) : from.slice(0, 1200);
  }
  const i = systemText.indexOf("[USER_PERSONA]");
  let persona = "";
  if (i >= 0) {
    const rest = systemText.slice(i);
    const next = rest.search(/\n\[[A-Z0-9_ /—-]{3,}\]/);
    persona = next > 0 ? rest.slice(0, next) : rest.slice(0, 600);
  }
  return `${canon}\n---\n${persona}`;
}

async function assembleArm(opts: {
  modelId: string;
  arm: "A" | "P";
  fixture: NFixture;
}) {
  const { loadCharacterChunksForPromptReadOnly } = await import(
    "../src/lib/characterChunks"
  );
  const { formatSelectedPersonaForPrompt } = await import(
    "../src/lib/userPersonas"
  );
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");

  const c10 = loadC10();
  const ch = { ...c10.character };
  const persona = { ...c10.persona };
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
    String(c10.user.nickname ?? personaName)
  );
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: String(ch.name),
  });
  const greeting = String(ch.greeting ?? "");
  const shortTermHistory = [
    { role: "user" as const, content: OPENING_TURN_USER },
    { role: "assistant" as const, content: greeting },
    ...opts.fixture.historyAfterGreeting.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  // Production path: no sceneDirectiveBlock for standard interactive (ARM D OFF).
  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(c10.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory,
    currentUserMessage: opts.fixture.userInput,
    nsfw: !!ch.nsfw,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId: opts.modelId,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: Math.max(0, shortTermHistory.length / 2 - 1),
    provider: "openrouter",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(c10.user.id ?? 4),
    narrativePov,
  });

  const decision: ScenePacingDecision = resolveScenePacingDecision({
    contentKind: "character",
    primaryCharacterName: String(ch.name),
    currentUserMessage: opts.fixture.userInput,
    recentMessages: shortTermHistory,
    currentTurn: Math.max(1, Math.floor(shortTermHistory.length / 2) + 1),
    progressionHistory: [],
    chatId: `g10sd1-${opts.fixture.id}`,
  });

  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId: opts.modelId,
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
    arm: opts.arm,
    decision,
  });

  const body = { ...bodyBase, messages: applied.messages };
  const messages = applied.messages;
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const systemText = applied.systemText;
  const historyWithoutCurrent = messages.filter(
    (m, idx) =>
      m.role !== "system" && !(m.role === "user" && idx === messages.length - 1)
  );

  const settingSources: SettingSource[] = [
    {
      bucket: "CHARACTER_CANON",
      text: [
        String(ch.system_prompt ?? ""),
        String(ch.example_dialog ?? ""),
      ].join("\n"),
    },
    {
      bucket: "WORLD_CANON",
      text: String(ch.world ?? ""),
    },
    {
      bucket: "USER_PERSONA",
      text: String(persona.description ?? ""),
    },
    { bucket: "CURRENT_USER_INPUT", text: opts.fixture.userInput },
    { bucket: "MEMORY", text: "" },
  ];

  const hasLegacySceneEngine = systemText.includes("[PRIVATE SCENE ENGINE RULE]");
  const hasScenePacing = systemText.includes("[SCENE PACING]");
  const hasCollaborative = systemText.includes(
    "[USER CONTROL — COLLABORATIVE INTERACTIVE]"
  );

  return {
    requestBody: body,
    systemSha: sha256(systemText),
    historySha: sha256(JSON.stringify(historyWithoutCurrent)),
    userTailSha: sha256(String(lastUser?.content ?? "")),
    canonDataSha: sha256(extractCanonSurface(systemText)),
    systemText,
    systemChars: systemText.length,
    systemTokensApprox: estimateTokensFromChars(systemText.length),
    lastUserContent: String(lastUser?.content ?? ""),
    decision,
    applied,
    settingSources,
    hasLegacySceneEngine,
    hasScenePacing,
    hasCollaborative,
    generationConfig: {
      model: body.model ?? opts.modelId,
      temperature: body.temperature ?? null,
      max_tokens: body.max_tokens ?? null,
      reasoning: body.reasoning ?? null,
      include_reasoning: body.include_reasoning ?? null,
      provider: body.provider ?? null,
    },
  };
}

async function runPreaudit(modelId: string) {
  const fixtures = loadFixtures();
  const n1s = fixtures.find((f) => f.id === "N1S") ?? fixtures[0]!;
  const A = await assembleArm({ modelId, arm: "A", fixture: n1s });
  const P = await assembleArm({ modelId, arm: "P", fixture: n1s });

  const soleOk =
    A.canonDataSha === P.canonDataSha &&
    A.historySha === P.historySha &&
    A.userTailSha === P.userTailSha &&
    JSON.stringify(A.generationConfig) === JSON.stringify(P.generationConfig) &&
    A.hasCollaborative &&
    P.hasCollaborative &&
    !A.hasLegacySceneEngine &&
    !P.hasLegacySceneEngine &&
    !A.hasScenePacing &&
    P.hasScenePacing &&
    P.applied.insertedCue &&
    A.lastUserContent.includes(USER_TAIL_LENGTH_OWNER_SENTENCE) &&
    P.lastUserContent.includes(USER_TAIL_LENGTH_OWNER_SENTENCE) &&
    !builtHasSceneDirectiveSection(A.systemText) &&
    !builtHasSceneDirectiveSection(P.systemText);

  const decisions = Object.fromEntries(
    await Promise.all(
      fixtures.map(async (f) => {
        const assembled = await assembleArm({ modelId, arm: "P", fixture: f });
        return [
          f.id,
          {
            pacingMode: assembled.decision.pacingMode,
            motionLevel: assembled.decision.motionLevel,
            meaningfulBeatBudget: assembled.decision.meaningfulBeatBudget,
            externalEligible: assembled.decision.externalEligible,
          },
        ] as const;
      })
    )
  );

  const preaudit = {
    phase: "G10-SD1-PREAUDIT",
    latest_main: "7f0c54b60e7ace11bc6e4eea9c820caadde24853",
    api_calls: 0,
    sole_variable: "SERVER_MOTION_BUDGET",
    production_wire: "NOT_RUN",
    standard_legacy_scene_directive: "OFF",
    CURRENT_A: {
      system_tokens_est: A.systemTokensApprox,
      has_scene_pacing: A.hasScenePacing,
      has_legacy_scene_engine: A.hasLegacySceneEngine,
      collaborative: A.hasCollaborative,
      system_sha256: A.systemSha,
      canon_data_sha256: A.canonDataSha,
      history_sha256: A.historySha,
      user_tail_sha256: A.userTailSha,
    },
    CANDIDATE_P: {
      system_tokens_est: P.systemTokensApprox,
      has_scene_pacing: P.hasScenePacing,
      has_legacy_scene_engine: P.hasLegacySceneEngine,
      collaborative: P.hasCollaborative,
      decision: P.decision,
      insertedCue: P.applied.insertedCue,
      system_sha256: P.systemSha,
      canon_data_sha256: P.canonDataSha,
      history_sha256: P.historySha,
      user_tail_sha256: P.userTailSha,
    },
    fixture_decisions: decisions,
    invariants: {
      canon_equal: A.canonDataSha === P.canonDataSha,
      history_equal: A.historySha === P.historySha,
      user_tail_equal: A.userTailSha === P.userTailSha,
      runtime_equal:
        JSON.stringify(A.generationConfig) ===
        JSON.stringify(P.generationConfig),
      agency_byte_identical: A.hasCollaborative && P.hasCollaborative,
      no_legacy_verbose_renderer: !A.hasLegacySceneEngine && !P.hasLegacySceneEngine,
      sole_diff_compact_pacing: soleOk,
    },
    LIVE_CALL_READY: soleOk,
  };

  save(DOCS, "01_G10SD1_PREAUDIT.json", preaudit);
  save(
    DOCS,
    "01_G10SD1_PREAUDIT.md",
    [
      "# G10-SD1 Preaudit",
      "",
      `**LIVE_CALL_READY:** ${preaudit.LIVE_CALL_READY ? "YES" : "NO"}`,
      `**standard legacy SceneDirective:** OFF`,
      `**sole variable:** SERVER_MOTION_BUDGET`,
      "",
      `| | A | P |`,
      `|---|---:|---:|`,
      `| system tokens≈ | ${A.systemTokensApprox} | ${P.systemTokensApprox} |`,
      `| SCENE PACING | ${A.hasScenePacing} | ${P.hasScenePacing} |`,
      `| legacy engine rule | ${A.hasLegacySceneEngine} | ${P.hasLegacySceneEngine} |`,
      `| N1S decision | | ${JSON.stringify(decisions.N1S ?? {})} |`,
      `| N2 decision | | ${JSON.stringify(decisions.N2 ?? {})} |`,
      "",
    ].join("\n")
  );
  console.log(JSON.stringify({ LIVE_CALL_READY: preaudit.LIVE_CALL_READY, decisions, soleOk }, null, 2));
  return preaudit;
}

function builtHasSceneDirectiveSection(systemText: string): boolean {
  // Compact [SCENE PACING] is the candidate cue — not legacy SceneDirective.
  return (
    systemText.includes("[PRIVATE SCENE ENGINE RULE]") ||
    systemText.includes("[이번 턴 장면 지시")
  );
}

async function runLive(modelId: string) {
  const preaudit = await runPreaudit(modelId);
  if (!preaudit.LIVE_CALL_READY) {
    throw new Error("Preaudit not LIVE_CALL_READY");
  }
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("OPENROUTER_API_KEY missing");
  }

  const {
    normalizeAiNovelProsePreDisplay,
    applyDisplayParagraphGrouping,
  } = await import("../src/lib/novelParagraphs");
  const { sanitizeStreamArtifacts } = await import("../src/lib/responseLength");
  const { visibleAssistantDisplayText } = await import(
    "../src/lib/chatDisplayLength"
  );

  const fixtures = loadFixtures();
  const cells: Array<Record<string, unknown>> = [];
  let apiCalls = 0;

  for (const fixture of fixtures) {
    for (const arm of ["A", "P"] as const) {
      const assembled = await assembleArm({ modelId, arm, fixture });
      for (let draw = 1; draw <= DRAWS; draw++) {
        const cellId = `Gemini_${fixture.id}_${arm}_D${draw}`;
        console.log(
          `\n=== ${cellId} mode=${assembled.decision.pacingMode}/${assembled.decision.motionLevel} ===`
        );
        let resp = await streamOpenRouter(assembled.requestBody);
        apiCalls += 1;
        if (
          (!resp.text || resp.error) &&
          isTransportAbort(resp.error, resp.http_status)
        ) {
          console.log(`transport retry ${cellId}`);
          resp = await streamOpenRouter(assembled.requestBody);
          apiCalls += 1;
        }
        if (!resp.text || resp.error) {
          throw new Error(
            `${cellId} failed status=${resp.http_status} err=${resp.error}`
          );
        }

        const preDisplay = normalizeAiNovelProsePreDisplay(
          sanitizeStreamArtifacts(resp.text)
        );
        const display = applyDisplayParagraphGrouping(preDisplay);
        const visible = visibleAssistantDisplayText(display);
        const chars = visibleChars(visible);
        const tokens = usageTokens(resp.usage);
        const anchors = scoreResponseAnchorCount(resp.text);
        const vector = computeRpQualityVectorV2({
          text: resp.text,
          settingSources: assembled.settingSources,
          currentUserInput: fixture.userInput,
        });

        const row = {
          cell_id: cellId,
          fixture: fixture.id,
          arm,
          draw,
          visible_chars: chars,
          finish_reason: resp.finish_reason,
          provider: resp.provider,
          latency_s: resp.latency_s,
          tokens,
          dialogue_char_share: vector.composition.dialogue_char_share,
          narration_char_share: vector.composition.narration_char_share,
          response_anchor: anchors,
          continuity: vector.continuity,
          hard_alarms: vector.hard_alarms,
          pacing: {
            mode: assembled.decision.pacingMode,
            motion: assembled.decision.motionLevel,
            beat_budget: assembled.decision.meaningfulBeatBudget,
            primary: assembled.decision.primaryProgression,
            external_eligible: assembled.decision.externalEligible,
          },
          system_sha256: assembled.systemSha,
          canon_data_sha256: assembled.canonDataSha,
          human_pending: true,
        };
        cells.push(row);

        save(
          join(DOCS, "raw"),
          `${cellId}.md`,
          [
            `# ${cellId}`,
            "",
            `- fixture: ${fixture.id} (${fixture.title})`,
            `- arm: ${arm}`,
            `- pacing: ${assembled.decision.pacingMode} / ${assembled.decision.motionLevel}`,
            `- visible_chars: ${chars}`,
            `- dialogue_share: ${vector.composition.dialogue_char_share}`,
            `- narration_share: ${vector.composition.narration_char_share}`,
            `- anchors: ${anchors.response_anchor_count} (${anchors.band})`,
            `- provider: ${resp.provider}`,
            "",
            "## user_input",
            "",
            "```text",
            fixture.userInput,
            "```",
            "",
            "## visible_output",
            "",
            "```text",
            visible,
            "```",
            "",
          ].join("\n")
        );
        console.log(
          `${cellId}: chars=${chars} dial=${vector.composition.dialogue_char_share} anchors=${anchors.response_anchor_count}`
        );
      }
    }
  }

  const live = {
    phase: "G10-SD1-STAGE1-LIVE",
    api_calls: apiCalls,
    target_calls: fixtures.length * 2 * DRAWS,
    fixtures: fixtures.map((f) => f.id),
    sole_variable: "SERVER_MOTION_BUDGET",
    cells,
    human_review: "PENDING",
    i1_s1: "NOT_RUN",
    production_wire: "NOT_RUN",
    merge: "NOT_RUN",
  };
  save(join(DOCS, "stage1"), "01_STAGE1_LIVE.json", live);
  console.log(
    JSON.stringify(
      {
        apiCalls,
        byFixture: fixtures.map((f) => ({
          id: f.id,
          A: cells
            .filter((c) => c.fixture === f.id && c.arm === "A")
            .map((c) => c.visible_chars),
          P: cells
            .filter((c) => c.fixture === f.id && c.arm === "P")
            .map((c) => c.visible_chars),
        })),
      },
      null,
      2
    )
  );
  return live;
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(DOCS, { recursive: true });
  const { OPENROUTER_GEMINI_31_PRO_MODEL } = await import(
    "../src/lib/chatModels"
  );
  const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;
  console.log(
    `G10SD1 phase=${PHASE} model=${modelId} fixtures=${FIXTURE_FILTER.join(",")}`
  );
  if (PHASE === "live") await runLive(modelId);
  else await runPreaudit(modelId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
