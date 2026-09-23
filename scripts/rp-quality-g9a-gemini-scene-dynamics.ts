/**
 * Phase G9-A — Gemini contextual scene dynamics.
 *
 * PRODUCTION WIRE = 0 · MERGE = 0
 * Sole variable: REPLACE [SCENE FLOW] → [SCENE DYNAMICS] (Arm C, Gemini only).
 * Agency / CURRENT USER / prose / layout = production BYTE_IDENTICAL.
 *
 *   PHASE=preaudit|live FIXTURES=N1S,N2 node --conditions=react-server --import tsx \
 *     scripts/rp-quality-g9a-gemini-scene-dynamics.ts
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
  applyG9aSceneDynamicsArmToMessages,
  GEMINI_CONTEXTUAL_SCENE_DYNAMICS,
  g9aParityShas,
  type GeminiSceneDynamicsArm,
} from "../src/lib/geminiContextualSceneDynamicsG9a";
import { SCENE_FLOW_BLOCK } from "../src/lib/generationProcessBeatFlow";
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
  "/opt/cursor/artifacts/rp-quality-g9a-scene-dynamics";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/rp-gemini-contextual-scene-g9a";
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
  const responseHeaders: Record<string, string> = {};
  try {
    const res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildOpenRouterHeaders(),
      body: JSON.stringify(body),
    });
    for (const [k, v] of res.headers.entries()) {
      if (
        /provider|generation|request|ratelimit|model|openrouter/i.test(k) ||
        k.startsWith("x-")
      ) {
        responseHeaders[k] = v;
      }
    }
    if (!res.ok) {
      const errText = await res.text();
      return {
        http_status: res.status,
        error: errText.slice(0, 800),
        text: "",
        finish_reason: null as string | null,
        usage: null as Record<string, unknown> | null,
        resolved_model: null as string | null,
        generation_id: null as string | null,
        provider: null as string | null,
        latency_s: (Date.now() - t0) / 1000,
        response_headers: responseHeaders,
      };
    }
    if (!res.body) {
      return {
        http_status: res.status,
        error: "empty body",
        text: "",
        finish_reason: null,
        usage: null,
        resolved_model: null,
        generation_id: null,
        provider: null,
        latency_s: (Date.now() - t0) / 1000,
        response_headers: responseHeaders,
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
      resolved_model: state.resolved,
      generation_id: state.generationId,
      provider: state.provider,
      latency_s: (Date.now() - t0) / 1000,
      response_headers: responseHeaders,
    };
  } catch (e) {
    return {
      http_status: 0,
      error: e instanceof Error ? e.message : String(e),
      text: "",
      finish_reason: null,
      usage: null,
      resolved_model: null,
      generation_id: null,
      provider: null,
      latency_s: (Date.now() - t0) / 1000,
      response_headers: responseHeaders,
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

/** Data-only surfaces that must stay BYTE-equal across A/C (no prose windows). */
function extractCanonSurface(systemText: string) {
  const sliceUntilNextHeader = (startMarker: string) => {
    const i = systemText.indexOf(startMarker);
    if (i < 0) return "";
    const rest = systemText.slice(i);
    const next = rest.search(/\n\[[A-Z0-9_ /—-]{3,}\]/);
    // Keep header block only up to the next top-level [HEADER]
    if (next > 0) return rest.slice(0, next);
    return rest.slice(0, 600);
  };
  // CHARACTER CANON block often contains EXAMPLE DIALOG as nested — take until IDENTITY/USER_PERSONA/WEBNOVEL/NARRATION
  const canonStart = systemText.indexOf("[CHARACTER CANON");
  let canon = "";
  if (canonStart >= 0) {
    const from = systemText.slice(canonStart);
    const cut = from.search(
      /\n\[(?:IDENTITY_AND_RULES|USER_PERSONA|WEBNOVEL|NARRATION REGISTER|PRIVATE OUTPUT|SCENE |GEMINI )/
    );
    canon = cut > 0 ? from.slice(0, cut) : from.slice(0, 1200);
  }
  const persona = sliceUntilNextHeader("[USER_PERSONA]");
  return `${canon}\n---\n${persona}`;
}

async function assembleArm(opts: {
  modelId: string;
  arm: GeminiSceneDynamicsArm;
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

  const applied = applyG9aSceneDynamicsArmToMessages({
    messages: messagesBase,
    modelId: opts.modelId,
    arm: opts.arm,
  });

  const body = { ...bodyBase, messages: applied.messages };
  const messages = applied.messages;
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const systemText = applied.systemText;
  // History parity excludes system (Arm C edits system only) and current user turn.
  const historyWithoutCurrent = messages.filter(
    (m, idx) =>
      m.role !== "system" && !(m.role === "user" && idx === messages.length - 1)
  );
  const parity = g9aParityShas(systemText);

  const settingSources: SettingSource[] = [
    {
      bucket: "CHARACTER_CANON",
      text: [
        String(ch.system_prompt ?? ""),
        String(ch.speech_profile ?? ""),
        String(ch.example_dialog ?? ""),
      ].join("\n"),
    },
    {
      bucket: "WORLD_CANON",
      text: [String(ch.world ?? ""), String(ch.setting_chunks ?? "")].join("\n"),
    },
    {
      bucket: "USER_PERSONA",
      text: String(persona.description ?? ""),
    },
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
    applied,
    parity,
    settingSources,
    userInput: opts.fixture.userInput,
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
  const C = await assembleArm({ modelId, arm: "C", fixture: n1s });

  const soleDiffOk =
    A.canonDataSha === C.canonDataSha &&
    A.historySha === C.historySha &&
    A.userTailSha === C.userTailSha &&
    JSON.stringify(A.generationConfig) === JSON.stringify(C.generationConfig) &&
    A.parity.hasCollaborative &&
    C.parity.hasCollaborative &&
    !A.parity.hasLivingScene &&
    !C.parity.hasLivingScene &&
    A.parity.hasSceneFlow &&
    C.parity.hasSceneDynamics &&
    !C.parity.hasSceneFlow &&
    C.applied.replacedSceneFlow &&
    A.lastUserContent.includes(USER_TAIL_LENGTH_OWNER_SENTENCE) &&
    C.lastUserContent.includes(USER_TAIL_LENGTH_OWNER_SENTENCE) &&
    !C.lastUserContent.includes("COMPLETED CUE");

  const preaudit = {
    phase: "G9A-PREAUDIT",
    latest_main: "7f0c54b60e7ace11bc6e4eea9c820caadde24853",
    api_calls: 0,
    sole_variable: "CONTEXTUAL_SCENE_DYNAMICS_ONLY",
    production_wire: "NOT_RUN",
    scene_flow_chars: SCENE_FLOW_BLOCK.length,
    scene_dynamics_chars: GEMINI_CONTEXTUAL_SCENE_DYNAMICS.length,
    CURRENT_A: {
      system_chars: A.systemChars,
      system_tokens_est: A.systemTokensApprox,
      system_sha256: A.systemSha,
      canon_data_sha256: A.canonDataSha,
      history_sha256: A.historySha,
      user_tail_sha256: A.userTailSha,
      parity: A.parity,
      generation_config: A.generationConfig,
    },
    CANDIDATE_C: {
      system_chars: C.systemChars,
      system_tokens_est: C.systemTokensApprox,
      system_sha256: C.systemSha,
      canon_data_sha256: C.canonDataSha,
      history_sha256: C.historySha,
      user_tail_sha256: C.userTailSha,
      parity: C.parity,
      generation_config: C.generationConfig,
      applied: C.applied,
    },
    invariants: {
      canon_data_sha_equal: A.canonDataSha === C.canonDataSha,
      history_sha_equal: A.historySha === C.historySha,
      user_tail_sha_equal: A.userTailSha === C.userTailSha,
      runtime_equal:
        JSON.stringify(A.generationConfig) ===
        JSON.stringify(C.generationConfig),
      agency_byte_identical_owner: A.parity.hasCollaborative && C.parity.hasCollaborative,
      no_g8_living_scene: !A.parity.hasLivingScene && !C.parity.hasLivingScene,
      scene_flow_replaced_only: soleDiffOk,
    },
    LIVE_CALL_READY: soleDiffOk,
  };

  save(DOCS, "01_G9A_PREAUDIT.json", preaudit);
  save(
    DOCS,
    "01_G9A_PREAUDIT.md",
    [
      "# G9-A Preaudit — Contextual Scene Dynamics",
      "",
      `**LIVE_CALL_READY:** ${preaudit.LIVE_CALL_READY ? "YES" : "NO"}`,
      `**sole variable:** CONTEXTUAL_SCENE_DYNAMICS_ONLY`,
      "",
      `| | A | C |`,
      `|---|---:|---:|`,
      `| system tokens≈ | ${A.systemTokensApprox} | ${C.systemTokensApprox} |`,
      `| SCENE FLOW | ${A.parity.hasSceneFlow} | ${C.parity.hasSceneFlow} |`,
      `| SCENE DYNAMICS | ${A.parity.hasSceneDynamics} | ${C.parity.hasSceneDynamics} |`,
      `| collaborative agency | ${A.parity.hasCollaborative} | ${C.parity.hasCollaborative} |`,
      `| canon/history/user-tail equal | | ${preaudit.invariants.canon_data_sha_equal && preaudit.invariants.history_sha_equal && preaudit.invariants.user_tail_sha_equal} |`,
      "",
    ].join("\n")
  );
  console.log(
    JSON.stringify(
      {
        LIVE_CALL_READY: preaudit.LIVE_CALL_READY,
        tokA: A.systemTokensApprox,
        tokC: C.systemTokensApprox,
        deltaChars: C.systemChars - A.systemChars,
        parity: preaudit.invariants,
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
    for (const arm of ["A", "C"] as const) {
      const assembled = await assembleArm({ modelId, arm, fixture });
      for (let draw = 1; draw <= DRAWS; draw++) {
        const cellId = `Gemini_${fixture.id}_${arm}_D${draw}`;
        const dir = join(OUT_ROOT, "live", cellId);
        console.log(
          `\n=== ${cellId} sysTok≈${assembled.systemTokensApprox} ===`
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
          system_sha256: assembled.systemSha,
          canon_data_sha256: assembled.canonDataSha,
          history_sha256: assembled.historySha,
          user_tail_sha256: assembled.userTailSha,
          generation_config: assembled.generationConfig,
          human_pending: true,
        };
        cells.push(row);

        save(dir, "final_display.txt", visible);
        save(dir, "meta.json", { ...row, usage: resp.usage });
        save(
          join(DOCS, "raw"),
          `${cellId}.md`,
          [
            `# ${cellId}`,
            "",
            `- fixture: ${fixture.id} (${fixture.title})`,
            `- arm: ${arm}`,
            `- draw: ${draw}`,
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
          `${cellId}: chars=${chars} dial=${vector.composition.dialogue_char_share} narr=${vector.composition.narration_char_share} anchors=${anchors.response_anchor_count}`
        );
      }
    }
  }

  const live = {
    phase: "G9A-STAGE1-LIVE",
    api_calls: apiCalls,
    target_calls: fixtures.length * 2 * DRAWS,
    fixtures: fixtures.map((f) => f.id),
    sole_variable: "CONTEXTUAL_SCENE_DYNAMICS_ONLY",
    cells,
    human_review: "PENDING",
    n3: "NOT_RUN",
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
          C: cells
            .filter((c) => c.fixture === f.id && c.arm === "C")
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
    `G9A phase=${PHASE} model=${modelId} fixtures=${FIXTURE_FILTER.join(",")}`
  );
  if (PHASE === "live") await runLive(modelId);
  else await runPreaudit(modelId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
