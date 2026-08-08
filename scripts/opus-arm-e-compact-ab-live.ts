/**
 * Phase 2A STEP B — Opus Arm E current vs compact candidate (max 4 live calls).
 *
 * Unique variable: OPUS ARM E TERMINAL only.
 * Arm A = frozen production OPUS_ARM_E_TERMINAL
 * Arm B = OPUS_ARM_E_COMPACT_CANDIDATE (not wired into production resolve)
 *
 * Usage:
 *   npx tsx scripts/opus-arm-e-compact-ab-live.ts --parity-only
 *   npx tsx scripts/opus-arm-e-compact-ab-live.ts
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT_ROOT =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/opus-arm-e-compact-ab";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/opus-arm-e-compact-ab";
const FIXTURE_DIR =
  process.env.FIXTURE_DIR ??
  "/opt/cursor/artifacts/opus-quality-anchor/fixtures";
const PARITY_ONLY = process.argv.includes("--parity-only");
const MAX_CALLS = 4;

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };
type ArmId = "A" | "B";

type Scenario = {
  id: string;
  label: string;
  characterId: number;
  kind: "literary" | "agency";
  userInput: string;
};

const SCENARIOS: Scenario[] = [
  {
    id: "fixture_L_literary",
    label: "Literary / first-turn (parser-fixed short input)",
    characterId: 18,
    kind: "literary",
    userInput: "신입 ...맞아.나 본적있어?(갸웃)나는 렌이라고 부르면 돼.",
  },
  {
    id: "fixture_A_agency",
    label: "Agency boundary — Audit 58 s2 blanket compliance T1",
    characterId: 9,
    kind: "agency",
    // Strongest instruction-boundary fixture Arm E was accepted for.
    userInput: "시키는 대로 할게요. 뭘 하면 돼요?",
  },
];

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

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
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
  if (typeof ev.model === "string") state.resolved = ev.model;
  const choices = ev.choices as Array<Record<string, unknown>> | undefined;
  const choice0 = choices?.[0];
  const delta = choice0?.delta as Record<string, unknown> | undefined;
  const content =
    typeof delta?.content === "string"
      ? delta.content
      : typeof (choice0?.message as Record<string, unknown> | undefined)
            ?.content === "string"
        ? String((choice0!.message as Record<string, unknown>).content)
        : "";
  if (content) state.text += content;
  if (typeof choice0?.finish_reason === "string" && choice0.finish_reason) {
    state.finish = choice0.finish_reason;
  }
  if (ev.usage && typeof ev.usage === "object") {
    state.usage = ev.usage as Record<string, unknown>;
  }
}

function processSseChunk(
  chunk: string,
  state: StreamState,
  buf: { value: string }
): void {
  buf.value += chunk;
  const parts = buf.value.split("\n");
  buf.value = parts.pop() ?? "";
  for (const line of parts) processSseLine(line, state);
}

function flushRemainingSseBuffer(
  dec: TextDecoder,
  buf: { value: string },
  state: StreamState
): void {
  const tail = dec.decode();
  if (tail) buf.value += tail;
  if (buf.value.trim()) {
    processSseLine(buf.value, state);
    buf.value = "";
  }
}

async function streamCi(body: Record<string, unknown>) {
  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const started = Date.now();
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    sawDone: false,
  };
  try {
    const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildCheaperInferenceHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return {
        text: "",
        latency_s: (Date.now() - started) / 1000,
        finish_reason: null as string | null,
        usage: null as Record<string, unknown> | null,
        resolved_model: null as string | null,
        saw_done: false,
        error: (await res.text()).slice(0, 2000),
        http_status: res.status,
      };
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const dec = new TextDecoder();
    const buf = { value: "" };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      processSseChunk(dec.decode(value, { stream: true }), state, buf);
    }
    flushRemainingSseBuffer(dec, buf, state);
    return {
      text: state.text,
      latency_s: (Date.now() - started) / 1000,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      saw_done: state.sawDone,
      error: null as string | null,
      http_status: 200,
    };
  } catch (e) {
    return {
      text: state.text,
      latency_s: (Date.now() - started) / 1000,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      saw_done: state.sawDone,
      error: String(e),
      http_status: 0,
    };
  }
}

function loadFixture(characterId: number) {
  const path = join(FIXTURE_DIR, `c${characterId}_fixture.json`);
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
}

async function assemble(opts: {
  modelId: string;
  fixture: ReturnType<typeof loadFixture>;
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
  const seedHistory: ChatMsg[] = [
    { role: "user", content: OPENING_TURN_USER },
    { role: "assistant", content: String(ch.greeting ?? "") },
  ];
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
    shortTermHistory: seedHistory,
    currentUserMessage: opts.currentUserMessage,
    nsfw: !!ch.nsfw,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId: opts.modelId,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: 0,
    provider: "openrouter",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(opts.fixture.user.id ?? 4),
    narrativePov,
  });

  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId: opts.modelId,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider: "cheaperinference",
      charName: String(ch.name),
      personaName,
    },
  });

  const requestBody = {
    ...(wire.requestBody as Record<string, unknown>),
    stream: true,
    stream_options: { include_usage: true },
  };
  return {
    requestBody,
    messages: requestBody.messages as ChatMsg[],
    systemPrompt: built.systemPrompt,
  };
}

function applyArmTerminal(
  messages: ChatMsg[],
  arm: ArmId,
  armE: string,
  compact: string
): ChatMsg[] {
  const cloned = messages.map((m) => ({ ...m }));
  const last = cloned[cloned.length - 1];
  if (!last || last.role !== "user") {
    throw new Error("expected trailing user message");
  }
  if (!last.content.includes(armE)) {
    throw new Error("production Arm E missing from assembled user turn");
  }
  if (arm === "A") {
    if (last.content.includes(compact)) {
      throw new Error("compact leaked into Arm A");
    }
    return cloned;
  }
  last.content = last.content.split(armE).join(compact);
  if (last.content.includes(armE)) {
    throw new Error("Arm E still present after compact swap");
  }
  if (!last.content.includes(compact)) {
    throw new Error("compact not injected");
  }
  return cloned;
}

function extractTerminalSlice(userContent: string, markerStart: string): string {
  const idx = userContent.lastIndexOf(markerStart.slice(0, 20));
  if (idx < 0) return "";
  // Prefer full known terminals via caller.
  return userContent.slice(idx);
}

async function runParityGate() {
  const {
    OPUS_ARM_E_TERMINAL,
    OPUS_ARM_E_COMPACT_CANDIDATE,
    evaluateOpusArmESemanticParity,
  } = await import("../src/lib/opusTerminalLengthOwner");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");

  const aTok = estimateTokens(OPUS_ARM_E_TERMINAL);
  const bTok = estimateTokens(OPUS_ARM_E_COMPACT_CANDIDATE);
  const aParity = evaluateOpusArmESemanticParity(OPUS_ARM_E_TERMINAL);
  const bParity = evaluateOpusArmESemanticParity(OPUS_ARM_E_COMPACT_CANDIDATE);
  const reduction = aTok - bTok;
  const reductionPct = (reduction / aTok) * 100;
  const report = {
    arm_a_estimated_tokens: aTok,
    arm_b_estimated_tokens: bTok,
    reduction,
    reduction_percent: Number(reductionPct.toFixed(1)),
    semantic_parity_a: aParity,
    semantic_parity_b: bParity,
    semantic_parity: aParity.pass && bParity.pass ? "PASS" : "FAIL",
    production_resolve_unchanged: true,
    token_budget_ok: bTok <= 650 && bTok < 900,
    reduction_ok: reductionPct >= 35,
  };
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(DOCS, { recursive: true });
  save(OUT_ROOT, "SEMANTIC_PARITY.json", report);
  save(DOCS, "SEMANTIC_PARITY.json", report);
  console.log(JSON.stringify(report, null, 2));
  if (report.semantic_parity !== "PASS") {
    throw new Error("SEMANTIC_PARITY_FAIL — live calls forbidden");
  }
  if (!report.token_budget_ok) {
    throw new Error("COMPACT_TOKEN_BUDGET_FAIL — live calls forbidden");
  }
  return report;
}

function literaryMetrics(text: string) {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
  const dialogueChars = (text.match(/[“"][^”"]*[”"]/g) ?? []).join("").length;
  const sentences = text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const avgSentence =
    sentences.length > 0
      ? sentences.reduce((n, s) => n + s.length, 0) / sentences.length
      : 0;
  return {
    VISIBLE_CHARS: text.replace(/\s+/g, "").length,
    RAW_CHARS: text.length,
    PARAGRAPH_COUNT: paragraphs.length,
    DIALOGUE_SHARE: text.length ? dialogueChars / text.length : 0,
    AVG_SENTENCE_LENGTH: Number(avgSentence.toFixed(1)),
    FIRST_1000_CHAR_LITERARY_IMPRESSION: text.slice(0, 1000),
  };
}

async function main() {
  const parity = await runParityGate();
  if (PARITY_ONLY) {
    console.log("PARITY_ONLY — stopping before live calls");
    return;
  }

  const { CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL } = await import(
    "../src/lib/chatModels"
  );
  const {
    OPUS_ARM_E_TERMINAL,
    OPUS_ARM_E_COMPACT_CANDIDATE,
    OPUS_ARM_E_TERMINAL_MARKER,
    OPUS_ARM_E_COMPACT_CANDIDATE_MARKER,
  } = await import("../src/lib/opusTerminalLengthOwner");
  const { visibleAssistantDisplayCharCount } = await import(
    "../src/lib/chatDisplayLength"
  );
  const { estimateTokens } = await import("../src/lib/tokenEstimate");

  const modelId = CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL;
  let apiCalls = 0;
  const rows: Record<string, unknown>[] = [];
  const blindBlocks: string[] = [];
  // Fixed blind labels: Fixture L X=A Y=B; Fixture A X=B Y=A (shuffle per fixture).
  const blindMap: Record<string, { X: ArmId; Y: ArmId }> = {
    fixture_L_literary: { X: "A", Y: "B" },
    fixture_A_agency: { X: "B", Y: "A" },
  };

  for (const scenario of SCENARIOS) {
    const fixture = loadFixture(scenario.characterId);
    const assembledBase = await assemble({
      modelId,
      fixture,
      currentUserMessage: scenario.userInput,
    });
    // Sanity: parser fix — no literal (갸웃) leak on literary fixture.
    const lastUser = assembledBase.messages[assembledBase.messages.length - 1]!;
    if (scenario.id === "fixture_L_literary") {
      if (lastUser.content.includes("(갸웃)")) {
        throw new Error("RAW_PARENTHESES_LEAK still present — abort live");
      }
      if (!lastUser.content.includes("갸웃")) {
        throw new Error("expected stripped action 갸웃 in literary fixture");
      }
    }

    const order: ArmId[] = ["A", "B"];
    const outputs: Record<ArmId, string> = { A: "", B: "" };
    for (const arm of order) {
      const dir = join(OUT_ROOT, "live", scenario.id, `arm-${arm}`);
      const rawPath = join(dir, "provider-raw.txt");
      if (existsSync(rawPath)) {
        console.log(`skip ${scenario.id} arm-${arm}`);
        outputs[arm] = readFileSync(rawPath, "utf8");
        const meta = JSON.parse(
          readFileSync(join(dir, "meta.json"), "utf8")
        ) as Record<string, unknown>;
        rows.push(meta);
        continue;
      }

      if (apiCalls >= MAX_CALLS) {
        throw new Error(`API_CALL_BUDGET_EXCEEDED:${apiCalls}/${MAX_CALLS}`);
      }

      const messages = applyArmTerminal(
        assembledBase.messages,
        arm,
        OPUS_ARM_E_TERMINAL,
        OPUS_ARM_E_COMPACT_CANDIDATE
      );
      const last = messages[messages.length - 1]!;
      const terminalTokens =
        arm === "A"
          ? estimateTokens(OPUS_ARM_E_TERMINAL)
          : estimateTokens(OPUS_ARM_E_COMPACT_CANDIDATE);
      if (arm === "A" && !last.content.includes(OPUS_ARM_E_TERMINAL_MARKER)) {
        throw new Error("Arm A missing Arm E marker");
      }
      if (
        arm === "B" &&
        !last.content.includes(OPUS_ARM_E_COMPACT_CANDIDATE_MARKER)
      ) {
        throw new Error("Arm B missing compact marker");
      }

      const requestBody = {
        ...assembledBase.requestBody,
        messages,
      };
      console.log(`\n=== ${scenario.id} arm-${arm} call ${apiCalls + 1}/${MAX_CALLS} ===`);
      apiCalls += 1;
      const resp = await streamCi(requestBody);
      if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
        save(dir, "FAIL.json", resp);
        throw new Error(
          `CI fail ${scenario.id}/${arm}: ${resp.error ?? resp.http_status}`
        );
      }
      outputs[arm] = resp.text;
      const metrics = literaryMetrics(resp.text);
      const meta = {
        scenario_id: scenario.id,
        scenario_label: scenario.label,
        kind: scenario.kind,
        character_id: scenario.characterId,
        arm,
        model: modelId,
        resolved_model: resp.resolved_model,
        user_input: scenario.userInput,
        terminal_estimated_tokens: terminalTokens,
        total_visible_chars: visibleAssistantDisplayCharCount(resp.text),
        finish_reason: resp.finish_reason,
        saw_done: resp.saw_done,
        latency_s: resp.latency_s,
        usage: resp.usage,
        raw_hash: sha256(resp.text),
        retry: 0,
        continuation: 0,
        recovery: 0,
        metrics,
        system_prompt_sha256: sha256(assembledBase.systemPrompt),
        user_turn_terminal_slice_sha256: sha256(
          arm === "A" ? OPUS_ARM_E_TERMINAL : OPUS_ARM_E_COMPACT_CANDIDATE
        ),
      };
      save(dir, "provider-raw.txt", resp.text);
      save(dir, "meta.json", meta);
      save(dir, "messages.json", messages);
      rows.push(meta);
      console.log({
        arm,
        chars: meta.total_visible_chars,
        finish: resp.finish_reason,
        terminalTokens,
      });
    }

    const map = blindMap[scenario.id]!;
    blindBlocks.push(
      [
        `# Blind pair — ${scenario.id}`,
        "",
        "## Source context",
        `- character_id: ${scenario.characterId}`,
        `- kind: ${scenario.kind}`,
        `- label: ${scenario.label}`,
        "",
        "## User input",
        scenario.userInput,
        "",
        "## Output X",
        outputs[map.X],
        "",
        "## Output Y",
        outputs[map.Y],
        "",
      ].join("\n")
    );
  }

  save(OUT_ROOT, "all_rows.json", rows);
  save(OUT_ROOT, "HIDDEN_MAP.json", {
    note: "Reveal only after scoring seal",
    blindMap,
    arm_meanings: {
      A: "OPUS_ARM_E_TERMINAL (production frozen)",
      B: "OPUS_ARM_E_COMPACT_CANDIDATE",
    },
  });
  save(OUT_ROOT, "BLIND_REVIEW.md", blindBlocks.join("\n---\n\n"));
  save(DOCS, "BLIND_REVIEW.md", blindBlocks.join("\n---\n\n"));
  save(OUT_ROOT, "RUNTIME_RESULTS.json", {
    status: "OPUS_ARM_E_COMPACT_AB_LIVE_COMPLETE",
    api_calls: apiCalls,
    max_calls: MAX_CALLS,
    parity,
    production_arm_e: "UNCHANGED",
    common_prose: "UNCHANGED",
    layout: "UNCHANGED",
  });
  save(DOCS, "HIDDEN_MAP.json", {
    note: "Reveal only after scoring seal",
    blindMap,
  });
  console.log(`\nDONE api_calls=${apiCalls}/${MAX_CALLS}`);
  void extractTerminalSlice;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
