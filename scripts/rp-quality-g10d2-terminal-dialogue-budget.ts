/**
 * Phase G10-D2 — Terminal dialogue budget owner (CURRENT USER TURN end).
 *
 * PRODUCTION WIRE = 0 · MERGE = 0
 * Baseline: G10-SD2 Arm Q. No D1 system [대화 운용].
 * Sole variable: Arm U appends private [이번 응답 대화] at user-turn end.
 *
 *   PHASE=preaudit|live FIXTURES=N1S DRAWS=3 node --conditions=react-server --import tsx \
 *     scripts/rp-quality-g10d2-terminal-dialogue-budget.ts
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
  countDialogueBlockOwners,
  countPacingOwners,
  countTerminalDialogueBudgetOwners,
  resolveScenePacingDecision,
  type ScenePacingArm,
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
  "/opt/cursor/artifacts/rp-quality-g10d2-terminal-dialogue-budget";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/rp-scene-pacing-g10d2";
const C10 =
  "docs/audits/rp-quality-v2-gemini/fixtures/c10_fixture.json";
const FIX_PATH =
  "docs/audits/rp-gemini-contextual-scene-g9a/fixtures/G9A_FIXTURES.json";
const DRAWS = Number(process.env.DRAWS ?? "3");
const PHASE =
  (process.env.PHASE as "preaudit" | "live" | undefined) ??
  (process.argv.includes("--live") ? "live" : "preaudit");
const FIXTURE_FILTER = (process.env.FIXTURES ?? "N1S")
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

/** Direct-speech paragraph/block count. */
function countDirectSpeechBlocks(text: string) {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  let count = 0;
  for (const p of paras) {
    if (/^["“「『]/.test(p) || /["”」』]\s*$/.test(p)) count += 1;
  }
  const band =
    count === 0
      ? "SILENCE_OK"
      : count <= 3
        ? "PREFERRED"
        : count === 4
          ? "MAX"
          : "OVER_CAP";
  return { speech_blocks: count, band };
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
      return {
        http_status: res.status,
        error: (await res.text()).slice(0, 800),
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
  arm: ScenePacingArm;
  fixture: NFixture;
  contentKind?: "character" | "simulation";
  party?: boolean;
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
  const contentKind = opts.contentKind ?? "character";
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
    contentKind,
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
    contentKind,
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(c10.user.id ?? 4),
    narrativePov,
  });

  const decision: ScenePacingDecision = resolveScenePacingDecision({
    contentKind,
    party: opts.party ?? false,
    primaryCharacterName: String(ch.name),
    currentUserMessage: opts.fixture.userInput,
    recentMessages: shortTermHistory,
    currentTurn: Math.max(1, Math.floor(shortTermHistory.length / 2) + 1),
    progressionHistory: [],
    establishedActiveCastNames: opts.party
      ? [String(ch.name), personaName, "동료"]
      : contentKind === "simulation"
        ? ["병사A", "병사B", "정찰대"]
        : undefined,
    chatId: `g10d2-${opts.fixture.id}-${opts.arm}`,
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
  const owners = countPacingOwners(systemText);
  const systemDialogueOwners = countDialogueBlockOwners(systemText);
  const terminalOwners = countTerminalDialogueBudgetOwners(
    String(lastUser?.content ?? "")
  );

  const settingSources: SettingSource[] = [
    {
      bucket: "CHARACTER_CANON",
      text: [String(ch.system_prompt ?? ""), String(ch.example_dialog ?? "")].join(
        "\n"
      ),
    },
    { bucket: "WORLD_CANON", text: String(ch.world ?? "") },
    { bucket: "USER_PERSONA", text: String(persona.description ?? "") },
    { bucket: "CURRENT_USER_INPUT", text: opts.fixture.userInput },
    { bucket: "MEMORY", text: "" },
  ];

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
    owners,
    systemDialogueOwners,
    terminalOwners,
    settingSources,
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
  const Q = await assembleArm({ modelId, arm: "Q", fixture: n1s });
  const U = await assembleArm({ modelId, arm: "U", fixture: n1s });
  const Usim = await assembleArm({
    modelId,
    arm: "U",
    fixture: n1s,
    contentKind: "simulation",
  });
  const Uparty = await assembleArm({
    modelId,
    arm: "U",
    fixture: n1s,
    party: true,
  });

  const soleOk =
    Q.canonDataSha === U.canonDataSha &&
    Q.historySha === U.historySha &&
    Q.userTailSha !== U.userTailSha &&
    JSON.stringify(Q.generationConfig) === JSON.stringify(U.generationConfig) &&
    JSON.stringify(Q.decision) === JSON.stringify(U.decision) &&
    Q.owners.scene_pacing === 1 &&
    U.owners.scene_pacing === 1 &&
    U.owners.scene_flow === 0 &&
    U.owners.scene_state === 0 &&
    U.owners.genre_scene_mode === 0 &&
    U.systemDialogueOwners.dialogue_block_owner === 0 &&
    U.terminalOwners.terminal_dialogue_budget_owner === 1 &&
    U.terminalOwners.numeric_dialogue_percentage === 0 &&
    Q.terminalOwners.terminal_dialogue_budget_owner === 0 &&
    Usim.terminalOwners.terminal_dialogue_budget_owner === 0 &&
    Uparty.terminalOwners.terminal_dialogue_budget_owner === 0 &&
    U.applied.terminalDialogueBudgetAppended &&
    !U.applied.dialogueBlockCapIntegrated &&
    !Usim.applied.terminalDialogueBudgetAppended &&
    !Uparty.applied.terminalDialogueBudgetAppended &&
    U.decision.pacingMode === "DYAD" &&
    U.decision.motionLevel === "HOLD" &&
    U.lastUserContent.includes(USER_TAIL_LENGTH_OWNER_SENTENCE) &&
    U.lastUserContent.trimEnd().endsWith(
      "직접 발화는 최대 4개 블록으로 구성한다. 보통 1~3개면 충분하다."
    );

  const preaudit = {
    phase: "G10-D2-PREAUDIT",
    latest_main: "7f0c54b60e7ace11bc6e4eea9c820caadde24853",
    api_calls: 0,
    sole_variable: "TERMINAL_DIALOGUE_BUDGET_OWNER",
    production_wire: "NOT_RUN",
    reference: "G10-SD2 Q + G10-D1 T stored (no redraw)",
    REFERENCE_Q: {
      system_chars: Q.systemChars,
      owners: Q.owners,
      systemDialogueOwners: Q.systemDialogueOwners,
      terminalOwners: Q.terminalOwners,
      decision: Q.decision,
    },
    CANDIDATE_U: {
      system_chars: U.systemChars,
      owners: U.owners,
      systemDialogueOwners: U.systemDialogueOwners,
      terminalOwners: U.terminalOwners,
      decision: U.decision,
      terminalDialogueBudgetAppended: U.applied.terminalDialogueBudgetAppended,
      user_tail_delta_vs_Q: U.lastUserContent.length - Q.lastUserContent.length,
    },
    SCOPE: {
      single_primary_terminal_cap: U.terminalOwners.terminal_dialogue_budget_owner,
      simulation_terminal_cap: Usim.terminalOwners.terminal_dialogue_budget_owner,
      party_terminal_cap: Uparty.terminalOwners.terminal_dialogue_budget_owner,
      system_dialogue_cap_U: U.systemDialogueOwners.dialogue_block_owner,
    },
    invariants: {
      canon_equal: Q.canonDataSha === U.canonDataSha,
      history_equal: Q.historySha === U.historySha,
      user_tail_changed: Q.userTailSha !== U.userTailSha,
      runtime_equal:
        JSON.stringify(Q.generationConfig) ===
        JSON.stringify(U.generationConfig),
      decision_q_u_identical:
        JSON.stringify(Q.decision) === JSON.stringify(U.decision),
      no_numeric_pct: U.terminalOwners.numeric_dialogue_percentage === 0,
      no_system_dialogue_cap: U.systemDialogueOwners.dialogue_block_owner === 0,
      no_scene_state: U.owners.scene_state === 0,
    },
    LIVE_CALL_READY: soleOk,
  };

  save(DOCS, "00_API0.md", [
    "# G10-D2 API=0 — Terminal Dialogue Budget Owner",
    "",
    `- sole variable: TERMINAL_DIALOGUE_BUDGET_OWNER`,
    `- system [대화 운용]=${U.systemDialogueOwners.dialogue_block_owner}`,
    `- terminal [이번 응답 대화]=${U.terminalOwners.terminal_dialogue_budget_owner}`,
    `- SCENE PACING=${U.owners.scene_pacing} FLOW=${U.owners.scene_flow} MODE=${U.owners.genre_scene_mode}`,
    `- sim/party terminal=${Usim.terminalOwners.terminal_dialogue_budget_owner}/${Uparty.terminalOwners.terminal_dialogue_budget_owner}`,
    `- numeric %=${U.terminalOwners.numeric_dialogue_percentage}`,
    `- user-tail Δ chars vs Q: ${U.lastUserContent.length - Q.lastUserContent.length}`,
    `- LIVE_CALL_READY: ${soleOk ? "YES" : "NO"}`,
    "",
  ].join("\n"));
  save(DOCS, "01_G10D2_PREAUDIT.json", preaudit);
  save(
    DOCS,
    "01_G10D2_PREAUDIT.md",
    [
      "# G10-D2 Preaudit — Terminal Dialogue Budget",
      "",
      `**LIVE_CALL_READY:** ${preaudit.LIVE_CALL_READY ? "YES" : "NO"}`,
      `**sole variable:** TERMINAL_DIALOGUE_BUDGET_OWNER`,
      "",
      `| | Q | U |`,
      `|---|---:|---:|`,
      `| SCENE PACING | ${Q.owners.scene_pacing} | ${U.owners.scene_pacing} |`,
      `| system [대화 운용] | ${Q.systemDialogueOwners.dialogue_block_owner} | ${U.systemDialogueOwners.dialogue_block_owner} |`,
      `| terminal [이번 응답 대화] | ${Q.terminalOwners.terminal_dialogue_budget_owner} | ${U.terminalOwners.terminal_dialogue_budget_owner} |`,
      `| sim/party terminal | — | ${Usim.terminalOwners.terminal_dialogue_budget_owner}/${Uparty.terminalOwners.terminal_dialogue_budget_owner} |`,
      `| user-tail chars | ${Q.lastUserContent.length} | ${U.lastUserContent.length} |`,
      "",
    ].join("\n")
  );
  console.log(
    JSON.stringify(
      {
        LIVE_CALL_READY: preaudit.LIVE_CALL_READY,
        systemCapU: U.systemDialogueOwners.dialogue_block_owner,
        terminalU: U.terminalOwners,
        scope: preaudit.SCOPE,
        userTailDelta: U.lastUserContent.length - Q.lastUserContent.length,
      },
      null,
      2
    )
  );
  return preaudit;
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
    const assembled = await assembleArm({ modelId, arm: "U", fixture });
    for (let draw = 1; draw <= DRAWS; draw++) {
      const cellId = `Gemini_${fixture.id}_U_D${draw}`;
      console.log(
        `\n=== ${cellId} mode=${assembled.decision.pacingMode}/${assembled.decision.motionLevel} termBudget=${assembled.terminalOwners.terminal_dialogue_budget_owner} ===`
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
      const speech = countDirectSpeechBlocks(resp.text);
      const vector = computeRpQualityVectorV2({
        text: resp.text,
        settingSources: assembled.settingSources,
        currentUserInput: fixture.userInput,
      });

      const row = {
        cell_id: cellId,
        fixture: fixture.id,
        arm: "U",
        draw,
        visible_chars: chars,
        finish_reason: resp.finish_reason,
        provider: resp.provider,
        latency_s: resp.latency_s,
        dialogue_char_share: vector.composition.dialogue_char_share,
        narration_char_share: vector.composition.narration_char_share,
        speech_blocks: speech,
        continuity: vector.continuity,
        hard_alarms: vector.hard_alarms,
        pacing: {
          mode: assembled.decision.pacingMode,
          motion: assembled.decision.motionLevel,
          sot: assembled.owners.pacing_sot_count,
        },
        systemDialogueOwners: assembled.systemDialogueOwners,
        terminalOwners: assembled.terminalOwners,
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
          `- arm: U (Q + terminal dialogue budget)`,
          `- pacing: ${assembled.decision.pacingMode} / ${assembled.decision.motionLevel}`,
          `- system_dialogue_cap: ${assembled.systemDialogueOwners.dialogue_block_owner}`,
          `- terminal_dialogue_budget: ${assembled.terminalOwners.terminal_dialogue_budget_owner}`,
          `- visible_chars: ${chars}`,
          `- speech_blocks: ${speech.speech_blocks} (${speech.band})`,
          `- dialogue_share: ${vector.composition.dialogue_char_share}`,
          `- narration_share: ${vector.composition.narration_char_share}`,
          `- provider: ${resp.provider}`,
          "",
          "## user_tail_end",
          "",
          "```text",
          assembled.lastUserContent.slice(-400),
          "```",
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
        `${cellId}: chars=${chars} blocks=${speech.speech_blocks} dial=${vector.composition.dialogue_char_share}`
      );
    }
  }

  const live = {
    phase: "G10-D2-STAGE1-LIVE",
    api_calls: apiCalls,
    target_calls: fixtures.length * DRAWS,
    fixtures: fixtures.map((f) => f.id),
    sole_variable: "TERMINAL_DIALOGUE_BUDGET_OWNER",
    reference: "G10-D1 T + G10-SD2 Q stored",
    cells,
    human_review: "PENDING",
    n2: "NOT_RUN",
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
          U: cells
            .filter((c) => c.fixture === f.id)
            .map((c) => ({
              chars: c.visible_chars,
              blocks: (c.speech_blocks as { speech_blocks: number })
                .speech_blocks,
            })),
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
    `G10D2 phase=${PHASE} model=${modelId} fixtures=${FIXTURE_FILTER.join(",")} draws=${DRAWS}`
  );
  if (PHASE === "live") await runLive(modelId);
  else await runPreaudit(modelId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
