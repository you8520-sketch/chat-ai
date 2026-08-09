/**
 * Phase G11-C1 — Server Control Length Tax Baseline.
 *
 * Measurement only. NO prompt wording / owner changes.
 * Live Arm A (production baseline, no experimental server controls).
 * Reference Arm V = stored G11-I1 B/D/F outputs (no new V calls).
 *
 * PRODUCTION WIRE = 0 · MERGE = 0 · retry/continuation/repair = 0
 *
 *   PHASE=preaudit|live FIXTURES=B,D,F DRAWS=2 \
 *     node --conditions=react-server --import tsx \
 *     scripts/rp-quality-g11c1-server-control-length-tax.ts
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
  countPacingOwners,
  countTerminalDialogueBudgetOwners,
  resolveScenePacingDecision,
  type ScenePacingArm,
  type ScenePacingDecision,
} from "../src/lib/scenePacingController";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import { OPENING_TURN_USER } from "../src/lib/chatGreetingContext";
import { IMMERSIVE_PROSE_BLOCK } from "../src/lib/advancedProseNsfwGuidelines";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}
if (!process.env.OPENROUTER_API_KEY?.trim() && existsSync("/tmp/d6b1_or_key")) {
  process.env.OPENROUTER_API_KEY = readFileSync("/tmp/d6b1_or_key", "utf8").trim();
}

const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/rp-quality-g11c1-length-tax";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/rp-length-tax-g11c1";
const FIX_PATH =
  "docs/audits/rp-integrated-server-control-g11i1/fixtures/G11_I1_FIXTURES.json";
const V_REF_PATH =
  "docs/audits/rp-length-tax-g11c1/ref/I1_V_BDF_REFERENCE.json";
const I1_LIVE_PATH =
  "docs/audits/rp-integrated-server-control-g11i1/stage1/01_STAGE1_LIVE.json";
const DRAWS = Number(process.env.DRAWS ?? "2");
const PHASE =
  (process.env.PHASE as "preaudit" | "live" | undefined) ??
  (process.argv.includes("--live") ? "live" : "preaudit");
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
function visibleChars(text: string) {
  return text.replace(/\s+/g, "").length;
}
function countDirectSpeechBlocks(text: string) {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  let count = 0;
  for (const p of paras) {
    if (/^["“「『]/.test(p) || /["”」』]\s*$/.test(p)) count += 1;
  }
  return { speech_blocks: count, paragraphs: paras.length };
}
function countParagraphs(text: string) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean).length;
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
function loadStoredV(): {
  cells: Array<Record<string, unknown>>;
  mean: number;
  providers: string[];
} {
  if (existsSync(V_REF_PATH)) {
    return JSON.parse(readFileSync(V_REF_PATH, "utf8"));
  }
  const live = JSON.parse(readFileSync(I1_LIVE_PATH, "utf8")) as {
    cells: Array<Record<string, unknown>>;
  };
  const cells = live.cells.filter((c) =>
    FIXTURE_FILTER.includes(String(c.fixture))
  );
  return {
    cells,
    mean: Math.round(
      cells.reduce((a, c) => a + Number(c.visible_chars), 0) /
        Math.max(1, cells.length)
    ),
    providers: [
      ...new Set(cells.map((c) => String(c.provider ?? "unknown"))),
    ],
  };
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

async function assembleFixture(opts: {
  modelId: string;
  fixture: G11Fixture;
  arm: ScenePacingArm;
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

  const bundle = loadCharBundle(opts.fixture.characterFixture);
  const ch = { ...bundle.character };
  const persona = { ...bundle.persona };
  const personaName = String(persona.name ?? "유저");
  const contentKind = opts.fixture.contentKind ?? "character";
  const party = Boolean(opts.fixture.party ?? bundle.party);
  const support = opts.fixture.knownSupportingCastNames ?? [];
  const established =
    opts.fixture.establishedActiveCastNames ??
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
    ...opts.fixture.historyAfterGreeting.map((m) => ({
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
    currentUserMessage: opts.fixture.userInput,
    nsfw: !!ch.nsfw || !!opts.fixture.adultModeEnabled,
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
    userId: Number(bundle.user.id ?? 4),
    narrativePov,
  });

  const decision: ScenePacingDecision = resolveScenePacingDecision({
    contentKind,
    party,
    primaryCharacterName: String(ch.name),
    currentUserMessage: opts.fixture.userInput,
    recentMessages: shortTermHistory,
    currentTurn: Math.max(1, Math.floor(shortTermHistory.length / 2) + 1),
    progressionHistory: [],
    knownSupportingCastNames: support,
    establishedActiveCastNames: established,
    adultModeEnabled: opts.fixture.adultModeEnabled ?? false,
    chatId: `g11c1-${opts.arm}-${opts.fixture.id}`,
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
    dialogueBudgetInput: {
      currentUserMessage: opts.fixture.userInput,
      recentMessages: shortTermHistory,
      knownSupportingCastNames: support,
      party,
      contentKind,
    },
  });

  const body = { ...bodyBase, messages: applied.messages };
  const messages = applied.messages;
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const systemText = applied.systemText;

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
    systemText,
    lastUserContent: String(lastUser?.content ?? ""),
    decision,
    applied,
    owners: countPacingOwners(systemText),
    terminalOwners: countTerminalDialogueBudgetOwners(
      String(lastUser?.content ?? "")
    ),
    dialogueBudget: applied.dialogueBudget,
    settingSources,
    generationConfig: {
      model: body.model ?? opts.modelId,
      temperature: body.temperature ?? null,
      max_tokens: body.max_tokens ?? null,
      reasoning: body.reasoning ?? null,
      include_reasoning: body.include_reasoning ?? null,
      provider: body.provider ?? null,
    },
    systemSha: sha256(systemText),
    userTailSha: sha256(String(lastUser?.content ?? "")),
  };
}

async function runPreaudit(modelId: string) {
  const fixtures = loadFixtures();
  const sample = fixtures[0] ??
    (
      JSON.parse(readFileSync(FIX_PATH, "utf8")) as { fixtures: G11Fixture[] }
    ).fixtures.find((f) => f.id === "B")!;

  const A = await assembleFixture({ modelId, arm: "A", fixture: sample });
  const V = await assembleFixture({ modelId, arm: "V", fixture: sample });
  const vRef = loadStoredV();

  const armAOk =
    A.owners.scene_pacing === 0 &&
    A.owners.scene_flow >= 0 && // production may still have SCENE FLOW
    A.terminalOwners.terminal_dialogue_budget_owner === 0 &&
    !/\[이번 응답\](?! 대화)/.test(A.lastUserContent) &&
    !/\[IMMERSIVE LONGFORM PROSE\]/.test(A.systemText) &&
    A.systemText.includes("[IMMERSIVE PROSE]") &&
    A.systemText.includes(IMMERSIVE_PROSE_BLOCK.slice(0, 40)) &&
    A.lastUserContent.includes(USER_TAIL_LENGTH_OWNER_SENTENCE) &&
    A.dialogueBudget == null;

  const armVRefOk =
    V.owners.scene_pacing === 1 &&
    V.owners.scene_flow === 0 &&
    V.terminalOwners.terminal_dialogue_budget_owner === 1 &&
    V.lastUserContent.includes(USER_TAIL_LENGTH_OWNER_SENTENCE) &&
    vRef.cells.length === 6 &&
    vRef.mean === 2148;

  const soleOk = armAOk && armVRefOk;

  const preaudit = {
    phase: "G11-C1-PREAUDIT",
    sole_question:
      "Is short Gemini length baseline, or do Scene Pacing + dialogue budget impose LENGTH TAX?",
    no_prompt_changes: true,
    arm_W_forbidden: true,
    p1_positive_prose_forbidden: true,
    api_calls: 0,
    ArmA: {
      scene_pacing: A.owners.scene_pacing,
      scene_flow: A.owners.scene_flow,
      dialogue_terminal: A.terminalOwners.terminal_dialogue_budget_owner,
      l1_combined: /\[이번 응답\](?! 대화)/.test(A.lastUserContent) ? 1 : 0,
      p1_positive_prose: /\[IMMERSIVE LONGFORM PROSE\]/.test(A.systemText)
        ? 1
        : 0,
      production_immersive_prose: A.systemText.includes("[IMMERSIVE PROSE]")
        ? 1
        : 0,
      production_length_owner: A.lastUserContent.includes(
        USER_TAIL_LENGTH_OWNER_SENTENCE
      )
        ? 1
        : 0,
      generationConfig: A.generationConfig,
      ok: armAOk,
    },
    ArmV_assemble_check: {
      scene_pacing: V.owners.scene_pacing,
      scene_flow: V.owners.scene_flow,
      dialogue_terminal: V.terminalOwners.terminal_dialogue_budget_owner,
      length_owner: V.lastUserContent.includes(USER_TAIL_LENGTH_OWNER_SENTENCE)
        ? 1
        : 0,
      note: "assemble-only; live V forbidden — use stored I1",
    },
    stored_V_reference: {
      path: I1_LIVE_PATH,
      cells: vRef.cells.length,
      mean: vRef.mean,
      providers: vRef.providers,
      ok: armVRefOk,
    },
    LIVE_CALL_READY: soleOk,
    production_wire: "NOT_RUN",
    merge: "NOT_RUN",
  };

  save(DOCS, "00_API0.md", [
    "# G11-C1 API=0 — Length Tax Baseline",
    "",
    `- Arm A experimental SCENE PACING: ${A.owners.scene_pacing}`,
    `- Arm A experimental dialogue terminal: ${A.terminalOwners.terminal_dialogue_budget_owner}`,
    `- Arm A production IMMERSIVE PROSE: ${preaudit.ArmA.production_immersive_prose}`,
    `- Arm A production length owner: ${preaudit.ArmA.production_length_owner}`,
    `- Arm A L1/P1 owners: ${preaudit.ArmA.l1_combined}/${preaudit.ArmA.p1_positive_prose}`,
    `- Stored V ref mean: ${vRef.mean} cells=${vRef.cells.length}`,
    `- LIVE_CALL_READY: ${soleOk ? "YES" : "NO"}`,
    "",
  ].join("\n"));
  save(DOCS, "01_G11C1_PREAUDIT.json", preaudit);
  console.log(JSON.stringify(preaudit, null, 2));
  return preaudit;
}

function summarize(chars: number[]) {
  const sorted = [...chars].sort((a, b) => a - b);
  const mean = chars.reduce((a, b) => a + b, 0) / Math.max(1, chars.length);
  const median =
    sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]!
      : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  return {
    mean: Math.round(mean),
    median: Math.round(median),
    lt_2000: chars.filter((n) => n < 2000).length,
    gt_4000: chars.filter((n) => n > 4000).length,
    max: chars.length ? Math.max(...chars) : 0,
    chars,
  };
}

function classify(opts: {
  aMean: number;
  vMean: number;
  aLt2000: number;
  vLt2000: number;
}) {
  const pct = opts.aMean / Math.max(1, opts.vMean);
  const absDelta = opts.aMean - opts.vMean;
  const strongTax =
    (opts.aMean >= 2800 && pct >= 1.25) ||
    (opts.aLt2000 <= 1 && opts.vLt2000 >= 3);
  const noTax =
    opts.aMean < 2500 ||
    Math.abs(pct - 1) < 0.15 ||
    Math.abs(opts.aLt2000 - opts.vLt2000) <= 1;
  let classification:
    | "SERVER_CONTROL_LENGTH_TAX_CONFIRMED"
    | "POSSIBLE_SERVER_CONTROL_LENGTH_TAX"
    | "BASELINE_GEMINI_LENGTH_INSTABILITY";
  let next_branch: "C2 COMPONENT ABLATION" | "R1 SELECTIVE UNDER-LENGTH RECOVERY";
  if (strongTax) {
    classification = "SERVER_CONTROL_LENGTH_TAX_CONFIRMED";
    next_branch = "C2 COMPONENT ABLATION";
  } else if (noTax) {
    classification = "BASELINE_GEMINI_LENGTH_INSTABILITY";
    next_branch = "R1 SELECTIVE UNDER-LENGTH RECOVERY";
  } else {
    classification = "POSSIBLE_SERVER_CONTROL_LENGTH_TAX";
    next_branch = "C2 COMPONENT ABLATION";
  }
  return {
    classification,
    next_branch,
    length_delta_absolute: absDelta,
    length_delta_percent: Math.round((pct - 1) * 1000) / 10,
  };
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
  const vRef = loadStoredV();
  const cells: Array<Record<string, unknown>> = [];
  let apiCalls = 0;
  const providerConfounds: string[] = [];

  for (const fixture of fixtures) {
    const assembled = await assembleFixture({
      modelId,
      fixture,
      arm: "A",
    });
    for (let draw = 1; draw <= DRAWS; draw++) {
      const cellId = `Gemini_${fixture.id}_A_D${draw}`;
      const vCell = vRef.cells.find(
        (c) => c.fixture === fixture.id && c.draw === draw
      );
      console.log(
        `\n=== ${cellId} domain=${fixture.domain} arm=A (no experimental server controls) ===`
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

      const vProvider = String(vCell?.provider ?? "unknown");
      const aProvider = String(resp.provider ?? "unknown");
      if (vProvider !== aProvider) {
        providerConfounds.push(
          `${cellId}: A=${aProvider} V=${vProvider}`
        );
      }

      cells.push({
        cell_id: cellId,
        fixture: fixture.id,
        domain: fixture.domain,
        arm: "A",
        draw,
        visible_chars: chars,
        speech_blocks: speech.speech_blocks,
        paragraphs: countParagraphs(resp.text),
        dialogue_char_share: vector.composition.dialogue_char_share,
        narration_char_share: vector.composition.narration_char_share,
        finish_reason: resp.finish_reason,
        provider: aProvider,
        v_ref: {
          cell_id: vCell?.cell_id ?? null,
          visible_chars: vCell?.visible_chars ?? null,
          speech_blocks: vCell?.speech_blocks ?? null,
          provider: vProvider,
        },
        latency_s: resp.latency_s,
        generationConfig: assembled.generationConfig,
      });

      save(
        join(DOCS, "raw"),
        `${cellId}.md`,
        [
          `# ${cellId}`,
          "",
          `- arm: A (production baseline; experimental SCENE PACING / dialogue terminal = 0)`,
          `- domain: ${fixture.domain}`,
          `- visible_chars: ${chars}`,
          `- speech_blocks: ${speech.speech_blocks} (observational; no cap)`,
          `- paragraphs: ${countParagraphs(resp.text)}`,
          `- dialogue_share: ${vector.composition.dialogue_char_share}`,
          `- finish_reason: ${resp.finish_reason}`,
          `- provider: ${aProvider}`,
          `- V_ref chars/blocks/provider: ${vCell?.visible_chars}/${vCell?.speech_blocks}/${vProvider}`,
          "",
          "## user_tail_end",
          "",
          "```text",
          assembled.lastUserContent.slice(-300),
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
        `${cellId}: chars=${chars} blocks=${speech.speech_blocks} provider=${aProvider} | V=${vCell?.visible_chars}/${vCell?.speech_blocks}`
      );
    }
  }

  const aChars = cells.map((c) => Number(c.visible_chars));
  const vChars = vRef.cells.map((c) => Number(c.visible_chars));
  const aSum = summarize(aChars);
  const vSum = summarize(vChars);
  const gate = classify({
    aMean: aSum.mean,
    vMean: vSum.mean,
    aLt2000: aSum.lt_2000,
    vLt2000: vSum.lt_2000,
  });

  const byDomain: Record<string, unknown> = {};
  for (const id of FIXTURE_FILTER) {
    const aDom = cells.filter((c) => c.fixture === id);
    const vDom = vRef.cells.filter((c) => c.fixture === id);
    byDomain[id] = {
      A_chars: aDom.map((c) => c.visible_chars),
      V_chars: vDom.map((c) => c.visible_chars),
      A_blocks: aDom.map((c) => c.speech_blocks),
      V_blocks: vDom.map((c) => c.speech_blocks),
      A_mean: Math.round(
        aDom.reduce((s, c) => s + Number(c.visible_chars), 0) /
          Math.max(1, aDom.length)
      ),
      V_mean: Math.round(
        vDom.reduce((s, c) => s + Number(c.visible_chars), 0) /
          Math.max(1, vDom.length)
      ),
    };
  }

  const live = {
    phase: "G11-C1-LIVE",
    api_calls: apiCalls,
    target_calls: 6,
    new_V_calls: 0,
    fixtures: FIXTURE_FILTER,
    provider_parity:
      providerConfounds.length === 0 ? "PASS" : "CONFOUNDED",
    provider_confounds: providerConfounds,
    A_summary: aSum,
    V_summary: vSum,
    by_domain: byDomain,
    gate,
    cells,
    production_wire: "NOT_RUN",
    merge: "NOT_RUN",
  };
  save(join(DOCS, "stage1"), "01_STAGE1_LIVE.json", live);
  console.log(
    JSON.stringify(
      {
        apiCalls,
        provider_parity: live.provider_parity,
        A: aSum,
        V: vSum,
        gate,
        by_domain: byDomain,
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
  mkdirSync(join(DOCS, "stage1"), { recursive: true });
  mkdirSync(join(DOCS, "raw"), { recursive: true });
  mkdirSync(join(DOCS, "ref"), { recursive: true });
  const { OPENROUTER_GEMINI_31_PRO_MODEL } = await import(
    "../src/lib/chatModels"
  );
  const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;
  console.log(
    `G11C1 phase=${PHASE} model=${modelId} fixtures=${FIXTURE_FILTER.join(",")} draws=${DRAWS} (live arm=A only)`
  );
  if (PHASE === "live") await runLive(modelId);
  else await runPreaudit(modelId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
