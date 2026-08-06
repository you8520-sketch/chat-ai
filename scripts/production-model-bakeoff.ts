/**
 * Production prompt-stack model bake-off (audit 38).
 *
 * Each model uses its live production selectedAI stack (no canary / no compact).
 * DeepSeek is NOT called — reference only from prior baseline artifacts.
 *
 * Env:
 *   PROD_BASE, PROD_COOKIE_FILE, OUT_ROOT, ART_ROOT
 *   CHARACTER_ID (18), PERSONA_ID (61)
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHash, randomInt } from "node:crypto";
import { detectHumanGoldLabels } from "./lib/rpBakeoffAlarms";

const BASE =
  process.env.PROD_BASE ?? "https://chat-ai-production-3e84.up.railway.app";
const COOKIE_FILE = process.env.PROD_COOKIE_FILE ?? "/tmp/terra_axis_cookies.txt";
const CHARACTER_ID = Number(process.env.CHARACTER_ID ?? "18");
const PERSONA_ID = Number(process.env.PERSONA_ID ?? "61");
const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/production-model-bakeoff";
const ART_ROOT =
  process.env.ART_ROOT ??
  "data/human-review/38-production-model-bakeoff";
const PACKET =
  process.env.PACKET_DIR ??
  "docs/audits/38-production-model-bakeoff";

const TURNS = [
  "나는 렌이라고 부르면 돼....나는 본기억이 안나는데....나 알아?(갸웃)",
  "같이갈래?*두리번 거리면서 다가오는 사람들을 보다가 다시 라이크를 쳐다본다*",
] as const;

/** Muse Spark remapped → not live. Substitute Claude Opus 5 as distinct premium family. */
const MODELS = [
  {
    slot: "A",
    id: "gpt-5.6-terra",
    family: "F3_terra_terminal_length_owner",
    role: "best_quality_korean_long_rp",
    note: "Production Korean long-RP flagship (Terra terminal length owner).",
  },
  {
    slot: "B",
    id: "claude-opus-5",
    family: "F5_common_terminal_anthropic",
    role: "muse_family_substitute_premium",
    note:
      "Muse Spark remapped to deepseek-v4-pro (not live selectable). Substitute: picker-visible Anthropic premium with distinct provider/adapter.",
  },
  {
    slot: "C",
    id: "gemini-3.1-pro-preview",
    family: "F5_common_terminal_google",
    role: "other_provider_premium",
    note: "Picker-visible Google premium on CheaperInference; F5 common terminal.",
  },
] as const;

type ModelSpec = (typeof MODELS)[number];

type CallResult = {
  http_status: number;
  latency_s: number;
  provider_raw: string;
  final_text: string;
  db_saved: string;
  done: Record<string, unknown> | null;
  diagnostic_pipeline: Record<string, unknown> | null;
  statuses: string[];
  error: string | null;
  chatId?: number;
  finish_reason: string | null;
  model?: string;
  provider?: string;
  output_tokens: number | null;
  retry_count: number;
  length_recovery_passes: number;
};

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function loadSessionCookie(): string {
  const raw = readFileSync(COOKIE_FILE, "utf8");
  for (const line of raw.split("\n")) {
    const normalized = line.startsWith("#HttpOnly_")
      ? line.slice("#HttpOnly_".length)
      : line.startsWith("#")
        ? ""
        : line;
    if (!normalized) continue;
    const parts = normalized.split("\t");
    if (parts.length >= 7 && parts[5] === "session") return parts[6]!.trim();
  }
  throw new Error("session cookie not found");
}

function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

async function setSelectedAI(token: string, modelId: string) {
  const res = await fetch(`${BASE}/api/user/selected-ai`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({ selectedAI: modelId }),
  });
  if (!res.ok) throw new Error(`selected-ai PATCH ${res.status}`);
  const sel = await (
    await fetch(`${BASE}/api/user/selected-ai`, {
      headers: { Cookie: `session=${token}` },
    })
  ).json();
  if (sel.selectedAI !== modelId) {
    throw new Error(`model not selected: want ${modelId} got ${sel.selectedAI}`);
  }
}

async function postChat(opts: {
  token: string;
  characterId: number;
  chatId?: number;
  message: string;
  personaId: number;
  tag: string;
}): Promise<CallResult> {
  const started = Date.now();
  const body: Record<string, unknown> = {
    characterId: opts.characterId,
    message: opts.message,
    selectedPersonaId: opts.personaId,
    isAdultMode: false,
    isNsfwMode: false,
    clientRequestId: `bakeoff_${opts.tag}_${Date.now().toString(36)}`,
  };
  if (opts.chatId) body.chatId = opts.chatId;
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${opts.token}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return {
      http_status: res.status,
      latency_s: (Date.now() - started) / 1000,
      provider_raw: "",
      final_text: "",
      db_saved: "",
      done: null,
      diagnostic_pipeline: null,
      statuses: [],
      error: (await res.text()).slice(0, 2000),
      finish_reason: null,
      output_tokens: null,
      retry_count: 0,
      length_recovery_passes: 0,
    };
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const dec = new TextDecoder();
  let buf = "";
  let provider_raw = "";
  let final_text = "";
  let done: Record<string, unknown> | null = null;
  let diagnostic_pipeline: Record<string, unknown> | null = null;
  let persistedChatId: number | undefined;
  const statuses: string[] = [];
  let error: string | null = null;
  while (true) {
    const { done: eof, value } = await reader.read();
    if (eof) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data || data === "[DONE]") continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (ev.type === "status" && typeof ev.message === "string") {
        statuses.push(ev.message);
      }
      if (ev.type === "delta" && typeof ev.text === "string") {
        provider_raw += ev.text;
      }
      if (ev.type === "replace" && typeof ev.text === "string") {
        provider_raw = ev.text;
        final_text = ev.text;
      }
      if (ev.type === "turn_persisted" && ev.chatId != null) {
        persistedChatId = Number(ev.chatId);
      }
      if (ev.type === "diagnostic_pipeline") {
        diagnostic_pipeline = ev;
      }
      if (ev.type === "done") {
        done = ev;
        if (typeof ev.finalContent === "string" && ev.finalContent.length > 0) {
          final_text = ev.finalContent;
        } else if (typeof ev.text === "string" && ev.text.length > 0) {
          final_text = ev.text;
        }
      }
      if (ev.type === "error") error = String(ev.message ?? JSON.stringify(ev));
    }
  }
  if (!final_text) final_text = provider_raw;
  if (done && persistedChatId && !done.chatId) done.chatId = persistedChatId;
  if (!done && persistedChatId && provider_raw.trim()) {
    done = { chatId: persistedChatId, text: final_text };
  }
  const usage = (done?.usage ?? null) as Record<string, unknown> | null;
  const finish =
    (typeof done?.finishReason === "string" ? done.finishReason : null) ??
    (typeof usage?.finishReason === "string" ? (usage.finishReason as string) : null);
  const outputTokens =
    typeof usage?.output === "number"
      ? usage.output
      : typeof usage?.outputTokens === "number"
        ? (usage.outputTokens as number)
        : null;
  return {
    http_status: res.status,
    latency_s: (Date.now() - started) / 1000,
    provider_raw,
    final_text,
    db_saved: final_text,
    done,
    diagnostic_pipeline,
    statuses,
    error,
    chatId: persistedChatId ?? (done?.chatId != null ? Number(done.chatId) : undefined),
    finish_reason: finish,
    model: typeof usage?.model === "string" ? usage.model : undefined,
    provider: typeof usage?.provider === "string" ? usage.provider : undefined,
    output_tokens: outputTokens,
    retry_count: statuses.filter((s) => /retry|재시도/i.test(s)).length,
    length_recovery_passes:
      typeof usage?.lengthRecoveryPasses === "number"
        ? (usage.lengthRecoveryPasses as number)
        : 0,
  };
}

async function fetchDbAssistant(
  chatId: number,
  token: string,
  turn: number
): Promise<string> {
  const res = await fetch(
    `${BASE}/api/chat/messages?chatId=${chatId}&turnLimit=${Math.max(turn + 2, 8)}`,
    { headers: { Cookie: `session=${token}` } }
  );
  if (!res.ok) return "";
  const data = (await res.json()) as {
    messages?: Array<{ role: string; content: string; model?: string }>;
  };
  const assistants = (data.messages ?? []).filter(
    (m) => m.role === "assistant" && m.model !== "greeting"
  );
  const msg = assistants[turn - 1];
  return msg?.content ?? assistants[assistants.length - 1]?.content ?? "";
}

/** Runtime exclusions for quality set — preserve artifacts. */
function runtimeExcludeReasons(resp: CallResult): string[] {
  const reasons: string[] = [];
  if (resp.http_status !== 200) reasons.push(`http_${resp.http_status}`);
  if (resp.error) reasons.push(`sse_error:${resp.error.slice(0, 120)}`);
  if (!resp.provider_raw.trim()) reasons.push("empty_upstream_stream");
  if (resp.finish_reason == null && resp.provider_raw.trim()) {
    reasons.push("finish_metadata_missing_or_null");
  }
  if (
    resp.done == null &&
    resp.provider_raw.trim() &&
    !resp.final_text.trim()
  ) {
    reasons.push("raw_sse_db_incomplete");
  }
  // Do NOT exclude finish=stop short outputs.
  return reasons;
}

type ValidOutput = {
  attempt_id: string;
  model_id: string;
  slot: string;
  run: number;
  turn: number;
  user_input: string;
  provider_raw: string;
  final_text: string;
  db_saved: string;
  finish_reason: string | null;
  latency_s: number;
  raw_chars: number;
  output_tokens: number | null;
  chat_id?: number;
  replacement: boolean;
  alarms: string[];
  raw_hash: string;
};

function detectAlarms(
  text: string,
  userInput: string,
  previousAssistantText: string | undefined,
  turn: number
): string[] {
  return detectHumanGoldLabels({
    text,
    userInput,
    previousAssistantText,
    turnIndex: turn,
  });
}

function shufflePlaceholders<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

async function runModel(
  token: string,
  model: ModelSpec,
  runtimeLog: unknown[]
): Promise<{
  outputs: ValidOutput[];
  new_calls: number;
  replacement_calls: number;
  exclusions: unknown[];
}> {
  const modelDir = join(OUT_ROOT, model.id);
  mkdirSync(modelDir, { recursive: true });
  await setSelectedAI(token, model.id);

  const outputs: ValidOutput[] = [];
  const exclusions: unknown[] = [];
  let new_calls = 0;
  let replacement_calls = 0;
  let replacement_budget = 1;

  for (let run = 1; run <= 2; run++) {
    const runDir = join(modelDir, `run${run}`);
    mkdirSync(runDir, { recursive: true });
    let chatId: number | undefined;
    let prevAssistant: string | undefined;

    for (let turn = 1; turn <= 2; turn++) {
      const userInput = TURNS[turn - 1]!;
      const tag = `${model.slot}_r${run}_t${turn}`;
      console.log(`\n=== ${model.id} run${run} turn${turn} ===`);

      let resp = await postChat({
        token,
        characterId: CHARACTER_ID,
        chatId,
        message: userInput,
        personaId: PERSONA_ID,
        tag,
      });
      new_calls += 1;
      let usedReplacement = false;
      let reasons = runtimeExcludeReasons(resp);

      if (reasons.length > 0 && replacement_budget > 0) {
        console.log("RUNTIME_EXCLUDE_RETRY", model.id, run, turn, reasons);
        const arch = join(modelDir, "runtime_excluded", `r${run}_t${turn}_attempt1`);
        mkdirSync(arch, { recursive: true });
        save(arch, "call.json", {
          reasons,
          finish_reason: resp.finish_reason,
          http_status: resp.http_status,
          error: resp.error,
          latency_s: resp.latency_s,
          provider_raw: resp.provider_raw,
        });
        exclusions.push({
          model_id: model.id,
          run,
          turn,
          attempt: 1,
          reasons,
          finish_reason: resp.finish_reason,
        });
        runtimeLog.push({
          model_id: model.id,
          run,
          turn,
          event: "replacement_call",
          reasons,
        });
        // Same-condition replacement: retry once (same chat if turn2 and chat exists)
        resp = await postChat({
          token,
          characterId: CHARACTER_ID,
          chatId: turn === 1 ? undefined : chatId,
          message: userInput,
          personaId: PERSONA_ID,
          tag: `${tag}_repl`,
        });
        new_calls += 1;
        replacement_calls += 1;
        replacement_budget -= 1;
        usedReplacement = true;
        reasons = runtimeExcludeReasons(resp);
      }

      if (reasons.length > 0) {
        const arch = join(
          modelDir,
          "runtime_excluded",
          `r${run}_t${turn}_final`
        );
        mkdirSync(arch, { recursive: true });
        save(arch, "call.json", {
          reasons,
          finish_reason: resp.finish_reason,
          http_status: resp.http_status,
          error: resp.error,
          latency_s: resp.latency_s,
          provider_raw: resp.provider_raw,
          replacement_used: usedReplacement,
        });
        exclusions.push({
          model_id: model.id,
          run,
          turn,
          attempt: "final",
          reasons,
          finish_reason: resp.finish_reason,
          replacement_used: usedReplacement,
        });
        runtimeLog.push({
          model_id: model.id,
          run,
          turn,
          event: "runtime_excluded_no_more_budget",
          reasons,
        });
        // Cannot continue chat chain without valid turn
        throw new Error(
          `runtime exclusion without valid output: ${model.id} r${run}t${turn}: ${reasons.join(",")}`
        );
      }

      if (turn === 1) {
        chatId = resp.chatId;
        if (!chatId) throw new Error(`no chatId after turn1 ${model.id} run${run}`);
      }
      const dbSaved = chatId
        ? (await fetchDbAssistant(chatId, token, turn)) || resp.final_text
        : resp.final_text;
      resp.db_saved = dbSaved;

      const attempt_id = `${model.slot}-R${run}T${turn}`;
      const alarms = detectAlarms(
        resp.provider_raw,
        userInput,
        prevAssistant,
        turn
      );
      const row: ValidOutput = {
        attempt_id,
        model_id: model.id,
        slot: model.slot,
        run,
        turn,
        user_input: userInput,
        provider_raw: resp.provider_raw,
        final_text: resp.final_text,
        db_saved: dbSaved,
        finish_reason: resp.finish_reason,
        latency_s: resp.latency_s,
        raw_chars: [...resp.provider_raw].length,
        output_tokens: resp.output_tokens,
        chat_id: chatId,
        replacement: usedReplacement,
        alarms,
        raw_hash: sha256(resp.provider_raw),
      };
      outputs.push(row);
      prevAssistant = resp.provider_raw;

      save(runDir, `turn${turn}-provider-raw.txt`, resp.provider_raw);
      save(runDir, `turn${turn}-sse-final.txt`, resp.final_text);
      save(runDir, `turn${turn}-db-saved.txt`, dbSaved);
      save(runDir, `turn${turn}-meta.json`, {
        ...row,
        provider_raw: undefined,
        final_text: undefined,
        db_saved: undefined,
        model_resolved: resp.model,
        provider: resp.provider,
        statuses: resp.statuses,
        length_recovery_passes: resp.length_recovery_passes,
        retry_count: resp.retry_count,
      });
      if (resp.diagnostic_pipeline) {
        save(runDir, `turn${turn}-pipeline.json`, resp.diagnostic_pipeline);
      }
      console.log({
        attempt_id,
        chars: row.raw_chars,
        finish: row.finish_reason,
        alarms,
        latency_s: row.latency_s,
        replacement: usedReplacement,
      });
    }
    if (run < 2) await new Promise((r) => setTimeout(r, 2000));
  }

  save(modelDir, "outputs_index.json", {
    model: model.id,
    slot: model.slot,
    outputs: outputs.map((o) => ({
      attempt_id: o.attempt_id,
      run: o.run,
      turn: o.turn,
      finish_reason: o.finish_reason,
      raw_chars: o.raw_chars,
      alarms: o.alarms,
      replacement: o.replacement,
      raw_hash: o.raw_hash,
    })),
    new_calls,
    replacement_calls,
    exclusions,
  });

  return { outputs, new_calls, replacement_calls, exclusions };
}

function buildBlindPacket(all: ValidOutput[]) {
  mkdirSync(ART_ROOT, { recursive: true });
  mkdirSync(PACKET, { recursive: true });

  // Group by (turn, run) across models → 4 comparison units of SIDE A/B/C
  type Unit = { turn: number; run: number; sides: Record<string, ValidOutput> };
  const units: Unit[] = [];
  for (const run of [1, 2]) {
    for (const turn of [1, 2]) {
      const sides: Record<string, ValidOutput> = {};
      for (const o of all) {
        if (o.run === run && o.turn === turn) sides[o.slot] = o;
      }
      units.push({ turn, run, sides });
    }
  }

  const hiddenMap: Record<
    string,
    { pair: string; side: string; model_id: string; attempt_id: string; slot: string }
  > = {};
  const blindSections: string[] = [];
  blindSections.push("# Blind production model bake-off\n");
  blindSections.push(
    "Status: `MODEL_BAKEOFF_HUMAN_REVIEW_PENDING`\n\n" +
      "Reviewer sees only user input + assistant raw text.\n" +
      "Model id / provider / price / length / alarms / latency / run number are hidden.\n\n" +
      "Do **not** declare PASS / improved / near-pass / best model / production candidate before ChatGPT blind read.\n"
  );

  let pairIdx = 0;
  for (const unit of units) {
    pairIdx += 1;
    const slots = shufflePlaceholders(["A", "B", "C"] as const);
    const sideLabels = ["SIDE A", "SIDE B", "SIDE C"] as const;
    blindSections.push(
      `\n---\n\n## Pair ${pairIdx} — Turn ${unit.turn}\n\n` +
        `### User input\n\n\`\`\`text\n${TURNS[unit.turn - 1]}\n\`\`\`\n`
    );
    for (let i = 0; i < 3; i++) {
      const slot = slots[i]!;
      const side = sideLabels[i]!;
      const o = unit.sides[slot];
      if (!o) {
        blindSections.push(`\n### ${side}\n\n_(missing)_\n`);
        continue;
      }
      hiddenMap[`pair${pairIdx}_${side.replace(" ", "")}`] = {
        pair: `Pair ${pairIdx}`,
        side,
        model_id: o.model_id,
        attempt_id: o.attempt_id,
        slot: o.slot,
      };
      blindSections.push(
        `\n### ${side}\n\n\`\`\`text\n${o.provider_raw}\n\`\`\`\n`
      );
    }
  }

  // RAW full (not blind)
  const rawLines: string[] = [
    "# Production model bake-off — RAW outputs (full)\n",
    "Status: `MODEL_BAKEOFF_HUMAN_REVIEW_PENDING`\n",
    "DeepSeek: not newly called (reference arm only).\n",
  ];
  for (const o of all) {
    rawLines.push(
      `\n---\n\n## ${o.attempt_id} · \`${o.model_id}\` · run${o.run} turn${o.turn}\n\n` +
        `- finish: ${o.finish_reason}\n` +
        `- raw_chars: ${o.raw_chars}\n` +
        `- replacement: ${o.replacement}\n` +
        `- alarms (auto): ${o.alarms.join(", ") || "(none)"}\n\n` +
        `### User\n\n\`\`\`text\n${o.user_input}\n\`\`\`\n\n` +
        `### Assistant provider_raw\n\n\`\`\`text\n${o.provider_raw}\n\`\`\`\n`
    );
  }

  const alarmCounts: Record<string, number> = {};
  const perAttempt = all.map((o) => {
    for (const a of o.alarms) alarmCounts[a] = (alarmCounts[a] ?? 0) + 1;
    return {
      attempt_id: o.attempt_id,
      model_id: o.model_id,
      slot: o.slot,
      run: o.run,
      turn: o.turn,
      finish_reason: o.finish_reason,
      raw_chars: o.raw_chars,
      alarms: o.alarms,
    };
  });

  for (const dir of [ART_ROOT, PACKET]) {
    save(dir, "RAW_OUTPUTS_FULL.md", rawLines.join("\n"));
    save(dir, "BLIND_MODEL_BAKEOFF.md", blindSections.join("\n"));
    save(dir, "_HIDDEN_MODEL_MAP.json", {
      status: "MODEL_BAKEOFF_HUMAN_REVIEW_PENDING",
      note: "Reveal only after ChatGPT blind review is recorded.",
      map: hiddenMap,
      models: MODELS,
    });
    save(dir, "HARD_FAIL_ALARMS.json", {
      generated_at: new Date().toISOString(),
      status: "MODEL_BAKEOFF_HUMAN_REVIEW_PENDING",
      note: "Detector alarms only — not a PASS/FAIL quality verdict. Human review required.",
      valid_outputs: all.length,
      per_attempt: perAttempt,
      alarm_counts: alarmCounts,
      by_model: Object.fromEntries(
        MODELS.map((m) => [
          m.id,
          {
            attempts: perAttempt.filter((p) => p.model_id === m.id),
            alarm_counts: perAttempt
              .filter((p) => p.model_id === m.id)
              .flatMap((p) => p.alarms)
              .reduce((acc: Record<string, number>, a) => {
                acc[a] = (acc[a] ?? 0) + 1;
                return acc;
              }, {}),
          },
        ])
      ),
    });
  }
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(ART_ROOT, { recursive: true });
  mkdirSync(PACKET, { recursive: true });

  const token = loadSessionCookie();
  const me = await (
    await fetch(`${BASE}/api/auth/me`, {
      headers: { Cookie: `session=${token}` },
    })
  ).json();
  if (me.user?.id !== 34) {
    throw new Error(`expected user 34, got ${me.user?.id}`);
  }

  // Confirm persona 61 exists and is 렌
  const personas = await (
    await fetch(`${BASE}/api/personas`, {
      headers: { Cookie: `session=${token}` },
    })
  ).json();
  const persona = (personas.personas ?? []).find(
    (p: { id: number }) => p.id === PERSONA_ID
  );
  if (!persona || persona.name.trim() !== "렌") {
    throw new Error(`persona ${PERSONA_ID} is not 렌`);
  }

  const selection = {
    status: "MODEL_BAKEOFF_HUMAN_REVIEW_PENDING",
    muse_family: {
      requested: "Muse-line representative",
      live_selectable: false,
      reason:
        "resolveSelectedAI remaps muse / muse-spark / meta/muse-spark-1.1 → deepseek-v4-pro",
      substitute: "claude-opus-5",
    },
    selected: MODELS,
    conditions: {
      user_id: 34,
      character_id: CHARACTER_ID,
      persona_id: PERSONA_ID,
      contentKind: "character",
      single_primary: true,
      retry: 0,
      continuation: 0,
      recovery: 0,
      one_api_call_per_assistant_response: true,
      deepseek_new_calls: false,
      forbidden_prompt_overrides: [
        "clean_slate_compact_contract",
        "structured_palette",
        "deepseek_short_history_forced_on_others",
        "common_new_prompt",
        "stripped_minimal_prompt",
      ],
    },
    production_canary: {
      RP_DIAGNOSTIC_CANARY_ENABLED: false,
      RP_DIAGNOSTIC_CANARY_VARIANT: "baseline",
    },
    started_at: new Date().toISOString(),
  };
  save(OUT_ROOT, "MODEL_SELECTION.json", selection);
  save(PACKET, "MODEL_SELECTION.md", [
    "# Production model bake-off — representative selection\n",
    "Source: `SELECTED_AI_OPTIONS` / `USER_SELECTABLE_AI_OPTIONS` + `docs/audits/35-cross-model-inventory/`.\n",
    "## Muse unavailable\n",
    "Muse Spark is **not live selectable** — remapped to `deepseek-v4-pro`. Slot B uses `claude-opus-5` instead.\n",
    "## Selected arms\n",
    "| Slot | Model id | Family | Role |\n| --- | --- | --- | --- |\n",
    ...MODELS.map(
      (m) =>
        `| ${m.slot} | \`${m.id}\` | ${m.family} | ${m.role} |\n`
    ),
    "\nDeepSeek V4 Pro: **reference only** (no new calls).\n",
  ].join("\n"));

  const runtimeLog: unknown[] = [];
  const allOutputs: ValidOutput[] = [];
  let totalCalls = 0;
  let totalRepl = 0;
  const allExclusions: unknown[] = [];

  for (const model of MODELS) {
    try {
      const result = await runModel(token, model, runtimeLog);
      allOutputs.push(...result.outputs);
      totalCalls += result.new_calls;
      totalRepl += result.replacement_calls;
      allExclusions.push(...result.exclusions);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("MODEL_ARM_FAILED", model.id, message);
      runtimeLog.push({ model_id: model.id, event: "arm_failed", message });
      allExclusions.push({ model_id: model.id, event: "arm_failed", message });
    }
  }
  if (allOutputs.length === 0) {
    throw new Error("no valid bake-off outputs");
  }

  // Restore default selected AI
  await setSelectedAI(token, "deepseek-v4-pro");

  const runtimeResults = {
    generated_at: new Date().toISOString(),
    status: "MODEL_BAKEOFF_HUMAN_REVIEW_PENDING",
    user_id: 34,
    character_id: CHARACTER_ID,
    persona_id: PERSONA_ID,
    new_call_count: totalCalls,
    replacement_calls: totalRepl,
    runtime_exclusions: allExclusions,
    events: runtimeLog,
    valid_outputs: allOutputs.length,
    per_model: MODELS.map((m) => ({
      model_id: m.id,
      outputs: allOutputs.filter((o) => o.model_id === m.id).length,
      replacements: allOutputs.filter((o) => o.model_id === m.id && o.replacement)
        .length,
    })),
    deepseek_new_calls: 0,
    human_review: "NOT_RUN — waiting for ChatGPT",
  };
  save(OUT_ROOT, "RUNTIME_RESULTS.json", runtimeResults);
  save(ART_ROOT, "RUNTIME_RESULTS.json", runtimeResults);
  save(PACKET, "RUNTIME_RESULTS.json", runtimeResults);

  buildBlindPacket(allOutputs);

  // Prompt hashes: extract frozen constant strings from source (offline; canary OFF).
  function exportedStringConst(file: string, name: string): string {
    const src = readFileSync(file, "utf8");
    const re = new RegExp(
      `export const ${name}\\s*=\\s*\\n?\\s*"((?:\\\\.|[^"\\\\])*)"`,
      "m"
    );
    const m = src.match(re);
    if (!m) throw new Error(`const ${name} not found in ${file}`);
    return m[1]!.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  const terraContract = exportedStringConst(
    "src/lib/terraTerminalLengthOwner.ts",
    "TERRA_TERMINAL_LENGTH_OWNER_CONTRACT"
  );
  const userTailLength = exportedStringConst(
    "src/lib/responseLength.ts",
    "USER_TAIL_LENGTH_OWNER_SENTENCE"
  );
  const sceneDirectiveVersion = exportedStringConst(
    "src/lib/sceneDirective.ts",
    "SCENE_DIRECTIVE_VERSION"
  );
  let gitHead = "unknown";
  try {
    const head = readFileSync(".git/HEAD", "utf8").trim();
    if (head.startsWith("ref:")) {
      gitHead = readFileSync(
        join(".git", head.slice(5).trim()),
        "utf8"
      ).trim();
    } else gitHead = head;
  } catch {
    /* ignore */
  }
  const promptHashes = {
    generated_at: new Date().toISOString(),
    git_head: gitHead,
    method:
      "sha256 of production adapter/common constants for each bake-off arm (offline). No live prompt dump (canary OFF).",
    models: {
      "gpt-5.6-terra": {
        family: "F3",
        hashes: {
          "adapter.terra.terminal_length_owner_contract": sha256(terraContract),
          "common.scene_directive.version": sha256(sceneDirectiveVersion),
        },
      },
      "claude-opus-5": {
        family: "F5",
        hashes: {
          "common.terminal.user_tail_length_owner_sentence": sha256(
            userTailLength
          ),
          "common.scene_directive.version": sha256(sceneDirectiveVersion),
        },
      },
      "gemini-3.1-pro-preview": {
        family: "F5",
        hashes: {
          "common.terminal.user_tail_length_owner_sentence": sha256(
            userTailLength
          ),
          "common.scene_directive.version": sha256(sceneDirectiveVersion),
        },
      },
    },
    note: "Each arm uses its production prompt stack only — no compact/canary overlays.",
  };
  save(OUT_ROOT, "PROMPT_HASHES.json", promptHashes);
  save(ART_ROOT, "PROMPT_HASHES.json", promptHashes);
  save(PACKET, "PROMPT_HASHES.json", promptHashes);

  const summary = {
    status: "MODEL_BAKEOFF_HUMAN_REVIEW_PENDING",
    selected_representative_models: MODELS.map((m) => m.id),
    new_call_count: totalCalls,
    runtime_exclusions: allExclusions.length,
    replacement_calls: totalRepl,
    blind_packet: ART_ROOT,
    hard_fail_alarms: join(ART_ROOT, "HARD_FAIL_ALARMS.json"),
    human_review: "NOT_RUN — waiting for ChatGPT",
    deepseek_optimization: "STOPPED",
    pr_245: "CLOSED WITHOUT MERGE",
    production_db_apply: "NO",
    general_rollout: "NO",
    auto_merge: "NO",
    auto_deploy: "NO",
  };
  save(OUT_ROOT, "FINAL_SUMMARY.json", summary);
  save(PACKET, "FINAL_SUMMARY.json", summary);
  console.log("\nBAKEOFF_DONE", summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
