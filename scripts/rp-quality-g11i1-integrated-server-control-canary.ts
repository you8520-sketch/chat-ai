/**
 * Phase G11-I1 — Integrated Server-Control Canary.
 *
 * FREEZE: G10-D3 Scene Pacing + server dialogue budget + terminal wording.
 * NO retune of budgets / classifier / cooldown / motion / provider / temp /
 * reasoning / length owner / agency owner. No new negatives.
 *
 * PRODUCTION WIRE = 0 · MERGE = 0 · retry/continuation/repair = 0
 *
 *   PHASE=preaudit|live FIXTURES=A,B,C,D,E,F DRAWS=2 \
 *     node --conditions=react-server --import tsx \
 *     scripts/rp-quality-g11i1-integrated-server-control-canary.ts
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
  renderTerminalDialogueBudgetOwner,
  resolveScenePacingDecision,
  type ScenePacingDecision,
  type TerminalDialogueBudgetResolution,
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
  "/opt/cursor/artifacts/rp-quality-g11i1-integrated-canary";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/rp-integrated-server-control-g11i1";
const FIX_PATH =
  "docs/audits/rp-integrated-server-control-g11i1/fixtures/G11_I1_FIXTURES.json";
const DRAWS = Number(process.env.DRAWS ?? "2");
const PHASE =
  (process.env.PHASE as "preaudit" | "live" | undefined) ??
  (process.argv.includes("--live") ? "live" : "preaudit");
const FIXTURE_FILTER = (process.env.FIXTURES ?? "A,B,C,D,E,F")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** D3-frozen terminal wording template — BYTE_IDENTICAL ceiling sentence. */
const D3_TERMINAL_WORDING_RE =
  /직접 발화는 필요한 만큼 사용하되 최대 \d+개 블록으로 구성한다\./;
const D3_OLD_PREFERRED_LINE_RE = /보통 1~3개면 충분/;

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
  measures?: string[];
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
  return { speech_blocks: count };
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

/** Heuristic quality flags — human review still required for FINAL seal. */
function scoreQualityHeuristics(opts: {
  text: string;
  fixture: G11Fixture;
  speechBlocks: number;
  budget: TerminalDialogueBudgetResolution | null;
  vector: ReturnType<typeof computeRpQualityVectorV2>;
}) {
  const t = opts.text;
  const speechShare = opts.vector.composition.dialogue_char_share;
  const settingOverlap = opts.vector.setting_exact_overlap;
  const continuity = opts.vector.continuity;

  const canonPadding = Boolean(
    settingOverlap?.alarm_18_plus ||
      (settingOverlap?.longest_common_substring_chars ?? 0) >= 80 ||
      (settingOverlap?.source_overlap_span_count ?? 0) >= 3
  );
  const repetition = Boolean(
    continuity?.intra_turn_reexplanation_alarm ||
      continuity?.recent_assistant_overlap_alarm ||
      (continuity?.intra_turn_abstract_restatement_hits ?? 0) >= 3
  );
  const newNpc =
    /처음 보는|낯선 (남자|여자|사람)|갑자기 .+이 들어|문 밖에서 누군가/.test(t) &&
    (opts.fixture.id === "A" ||
      opts.fixture.id === "B" ||
      opts.fixture.id === "F");
  const unrelatedEvent =
    (opts.fixture.id === "A" ||
      opts.fixture.id === "B" ||
      opts.fixture.id === "F") &&
    /(폭발|습격|경보|괴물|변이체|총성|사이렌)/.test(t);
  const worldMotion =
    opts.fixture.id === "C" || opts.fixture.id === "D"
      ? /(바람|안개|골목|경로|무전|교신|농도|진동|소리|빛)/.test(t)
      : null;
  const multiCastSpeak =
    opts.fixture.id === "E"
      ? ["카엘", "노아", "미르", "리아"].filter((n) => t.includes(n)).length >= 3
      : null;
  const dialogueOnly =
    opts.fixture.id === "E" ? speechShare >= 0.72 : null;
  const budgetOk =
    opts.budget?.maxBlocks == null
      ? opts.budget?.maxBlocks === opts.fixture.expectedBudget
      : opts.speechBlocks <= opts.budget.maxBlocks;

  return {
    budget_binding_ok: budgetOk,
    canon_padding: canonPadding,
    repetition,
    new_npc_injection: newNpc,
    unrelated_event_injection: unrelatedEvent,
    world_motion_present: worldMotion,
    multi_cast_usable: multiCastSpeak,
    dialogue_only_suppression_risk: dialogueOnly,
    dialogue_char_share: speechShare,
    narration_char_share: opts.vector.composition.narration_char_share,
    setting_lcs_chars: settingOverlap?.longest_common_substring_chars ?? 0,
    continuity_review: continuity?.continuity_review_required ?? false,
    hard_alarms: opts.vector.hard_alarms,
  };
}

async function assembleFixture(opts: {
  modelId: string;
  fixture: G11Fixture;
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
    chatId: `g11i1-${opts.fixture.id}`,
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
    arm: "V",
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
  const historyWithoutCurrent = messages.filter(
    (m, idx) =>
      m.role !== "system" && !(m.role === "user" && idx === messages.length - 1)
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
    lastUserContent: String(lastUser?.content ?? ""),
    decision,
    applied,
    owners: countPacingOwners(systemText),
    systemDialogueOwners: countDialogueBlockOwners(systemText),
    terminalOwners: countTerminalDialogueBudgetOwners(
      String(lastUser?.content ?? "")
    ),
    dialogueBudget: applied.dialogueBudget,
    settingSources,
    party,
    contentKind,
    charName: String(ch.name),
  };
}

async function runPreaudit(modelId: string) {
  const fixtures = loadFixtures();
  const byId: Record<string, Awaited<ReturnType<typeof assembleFixture>>> = {};
  for (const f of fixtures) {
    byId[f.id] = await assembleFixture({ modelId, fixture: f });
  }

  // Also freeze-check party/sim uncapped + false-positive (A-based).
  const a = fixtures.find((f) => f.id === "A");
  let partyProbe: Awaited<ReturnType<typeof assembleFixture>> | null = null;
  let simProbe: Awaited<ReturnType<typeof assembleFixture>> | null = null;
  let fpProbe: Awaited<ReturnType<typeof assembleFixture>> | null = null;
  if (a) {
    partyProbe = await assembleFixture({
      modelId,
      fixture: { ...a, id: "PARTY", party: true, expectedBudget: null },
    });
    simProbe = await assembleFixture({
      modelId,
      fixture: {
        ...a,
        id: "SIM",
        contentKind: "simulation",
        expectedBudget: null,
      },
    });
    fpProbe = await assembleFixture({
      modelId,
      fixture: {
        ...a,
        id: "FP",
        userInput:
          "*렌이 컵을 내려놓는다.* 어제 무전기가 고장났어. 오늘은 좀 조용하네.",
        expectedBudget: 4,
      },
    });
  }

  const budgetChecks = fixtures.map((f) => {
    const ass = byId[f.id]!;
    const max = ass.dialogueBudget?.maxBlocks ?? null;
    const terminal = ass.terminalOwners.terminal_dialogue_budget_owner;
    const expectedTerminal = f.expectedBudget == null ? 0 : 1;
    const wordingOk =
      f.expectedBudget == null
        ? !D3_TERMINAL_WORDING_RE.test(ass.lastUserContent) &&
          !/\[이번 응답 대화\]/.test(ass.lastUserContent)
        : D3_TERMINAL_WORDING_RE.test(ass.lastUserContent) &&
          !D3_OLD_PREFERRED_LINE_RE.test(ass.lastUserContent) &&
          ass.lastUserContent.includes(
            renderTerminalDialogueBudgetOwner(f.expectedBudget)
          );
    return {
      id: f.id,
      domain: f.domain,
      expected: f.expectedBudget,
      resolved: max,
      reason: ass.dialogueBudget?.reason ?? null,
      demand: ass.dialogueBudget?.communicationDemand ?? null,
      mode: `${ass.decision.pacingMode}/${ass.decision.motionLevel}`,
      intimate: ass.decision.intimateDyad,
      terminal_owners: terminal,
      expected_terminal: expectedTerminal,
      budget_match: max === f.expectedBudget,
      terminal_match: terminal === expectedTerminal,
      wording_d3: wordingOk,
      length_owner_present: ass.lastUserContent.includes(
        USER_TAIL_LENGTH_OWNER_SENTENCE
      ),
      scene_pacing: ass.owners.scene_pacing,
      scene_flow: ass.owners.scene_flow,
    };
  });

  const soleOk =
    budgetChecks.every(
      (c) =>
        c.budget_match &&
        c.terminal_match &&
        c.wording_d3 &&
        c.length_owner_present &&
        c.scene_pacing === 1 &&
        c.scene_flow === 0
    ) &&
    partyProbe?.dialogueBudget?.maxBlocks == null &&
    simProbe?.dialogueBudget?.maxBlocks == null &&
    fpProbe?.dialogueBudget?.maxBlocks === 4 &&
    partyProbe?.terminalOwners.terminal_dialogue_budget_owner === 0 &&
    simProbe?.terminalOwners.terminal_dialogue_budget_owner === 0;

  const preaudit = {
    phase: "G11-I1-PREAUDIT",
    seal: "DYNAMIC_DIALOGUE_BUDGET_PASS (#295) FROZEN",
    latest_main: "7f0c54b60e7ace11bc6e4eea9c820caadde24853",
    api_calls: 0,
    frozen: {
      budgets: { quiet: 4, exploration: 5, operation: 6, ensemble: null },
      terminal_placement: "CURRENT_USER_TURN_END",
      terminal_wording: "D3_BYTE_IDENTICAL",
      scene_pacing_decision: "D3_BYTE_IDENTICAL",
      no_new_negatives: true,
    },
    fixtures: FIXTURE_FILTER,
    API0: {
      checks: budgetChecks,
      party_probe: {
        budget: partyProbe?.dialogueBudget ?? null,
        terminal: partyProbe?.terminalOwners.terminal_dialogue_budget_owner,
      },
      simulation_probe: {
        budget: simProbe?.dialogueBudget ?? null,
        terminal: simProbe?.terminalOwners.terminal_dialogue_budget_owner,
      },
      false_positive: {
        mode: fpProbe
          ? `${fpProbe.decision.pacingMode}/${fpProbe.decision.motionLevel}`
          : null,
        budget: fpProbe?.dialogueBudget ?? null,
      },
    },
    LIVE_CALL_READY: soleOk,
    production_wire: "NOT_RUN",
    merge: "NOT_RUN",
  };

  save(DOCS, "00_API0.md", [
    "# G11-I1 API=0 — Integrated Server-Control Freeze",
    "",
    ...budgetChecks.map(
      (c) =>
        `- ${c.id} (${c.domain}): ${c.mode} → max=${c.resolved} expected=${c.expected} wording=${c.wording_d3 ? "D3_OK" : "FAIL"} terminal=${c.terminal_owners}`
    ),
    `- party/sim terminal: ${partyProbe?.terminalOwners.terminal_dialogue_budget_owner}/${simProbe?.terminalOwners.terminal_dialogue_budget_owner}`,
    `- false-positive: max=${fpProbe?.dialogueBudget?.maxBlocks}`,
    `- LIVE_CALL_READY: ${soleOk ? "YES" : "NO"}`,
    "",
  ].join("\n"));
  save(DOCS, "01_G11I1_PREAUDIT.json", preaudit);
  save(
    DOCS,
    "01_G11I1_PREAUDIT.md",
    [
      "# G11-I1 Preaudit",
      "",
      `**LIVE_CALL_READY:** ${preaudit.LIVE_CALL_READY ? "YES" : "NO"}`,
      "",
      "```json",
      JSON.stringify(preaudit.API0, null, 2),
      "```",
      "",
    ].join("\n")
  );
  console.log(
    JSON.stringify(
      { LIVE_CALL_READY: soleOk, checks: budgetChecks },
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
    const assembled = await assembleFixture({ modelId, fixture });
    for (let draw = 1; draw <= DRAWS; draw++) {
      const cellId = `Gemini_${fixture.id}_V_D${draw}`;
      console.log(
        `\n=== ${cellId} domain=${fixture.domain} mode=${assembled.decision.pacingMode}/${assembled.decision.motionLevel} budget=${assembled.dialogueBudget?.maxBlocks} reason=${assembled.dialogueBudget?.reason} ===`
      );
      // retry=0 for product logic; transport-only one retry allowed for infra.
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
      const heuristics = scoreQualityHeuristics({
        text: resp.text,
        fixture,
        speechBlocks: speech.speech_blocks,
        budget: assembled.dialogueBudget,
        vector,
      });

      cells.push({
        cell_id: cellId,
        fixture: fixture.id,
        domain: fixture.domain,
        arm: "V",
        draw,
        visible_chars: chars,
        speech_blocks: speech.speech_blocks,
        budget: assembled.dialogueBudget,
        expected_budget: fixture.expectedBudget,
        dialogue_char_share: vector.composition.dialogue_char_share,
        narration_char_share: vector.composition.narration_char_share,
        pacing: {
          mode: assembled.decision.pacingMode,
          motion: assembled.decision.motionLevel,
          intimate: assembled.decision.intimateDyad,
        },
        heuristics,
        provider: resp.provider,
        latency_s: resp.latency_s,
        human_pending: true,
      });

      save(
        join(DOCS, "raw"),
        `${cellId}.md`,
        [
          `# ${cellId}`,
          "",
          `- domain: ${fixture.domain}`,
          `- arm: V (frozen D3 dynamic terminal budget)`,
          `- pacing: ${assembled.decision.pacingMode} / ${assembled.decision.motionLevel}`,
          `- intimate: ${assembled.decision.intimateDyad}`,
          `- budget: max=${assembled.dialogueBudget?.maxBlocks} reason=${assembled.dialogueBudget?.reason} demand=${assembled.dialogueBudget?.communicationDemand}`,
          `- expected_budget: ${fixture.expectedBudget}`,
          `- visible_chars: ${chars}`,
          `- speech_blocks: ${speech.speech_blocks}`,
          `- dialogue_share: ${vector.composition.dialogue_char_share}`,
          `- heuristics: ${JSON.stringify(heuristics)}`,
          `- provider: ${resp.provider}`,
          "",
          "## user_tail_end",
          "",
          "```text",
          assembled.lastUserContent.slice(-350),
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
        `${cellId}: chars=${chars} blocks=${speech.speech_blocks}/${assembled.dialogueBudget?.maxBlocks ?? "∞"}`
      );
    }
  }

  const charList = cells.map((c) => Number(c.visible_chars));
  const sorted = [...charList].sort((a, b) => a - b);
  const mean =
    charList.reduce((a, b) => a + b, 0) / Math.max(1, charList.length);
  const median =
    sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]!
      : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;

  const live = {
    phase: "G11-I1-STAGE1-LIVE",
    api_calls: apiCalls,
    target_calls: fixtures.length * DRAWS,
    fixtures: fixtures.map((f) => f.id),
    sole_variable: "NONE — INTEGRATION CANARY (D3 FROZEN)",
    length_summary: {
      mean: Math.round(mean),
      median: Math.round(median),
      lt_2000: charList.filter((n) => n < 2000).length,
      gt_4000: charList.filter((n) => n > 4000).length,
      gt_5000: charList.filter((n) => n > 5000).length,
    },
    cells,
    human_review: "PENDING",
    production_wire: "NOT_RUN",
    merge: "NOT_RUN",
  };
  save(join(DOCS, "stage1"), "01_STAGE1_LIVE.json", live);
  console.log(
    JSON.stringify(
      {
        apiCalls,
        length_summary: live.length_summary,
        cells: cells.map((c) => ({
          id: c.cell_id,
          chars: c.visible_chars,
          blocks: c.speech_blocks,
          budget: (c.budget as { maxBlocks: number | null })?.maxBlocks,
          binding: (c.heuristics as { budget_binding_ok: boolean })
            ?.budget_binding_ok,
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
    `G11I1 phase=${PHASE} model=${modelId} fixtures=${FIXTURE_FILTER.join(",")} draws=${DRAWS}`
  );
  if (PHASE === "live") await runLive(modelId);
  else await runPreaudit(modelId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
