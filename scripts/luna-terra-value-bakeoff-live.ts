/**
 * Audit 46 — Luna/Terra/DeepSeek collaborative value bake-off (live).
 *
 * Relationship: reuse frozen DeepSeek COLLAB ×4; Luna 2×T1→T2; Terra 2×T1→T2.
 * Action: DeepSeek/Luna/Terra each 1 chat × T1→T2.
 * Replacement budget: max 2 per model×test-set. No quality auto-verdict.
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

const BASE =
  process.env.PROD_BASE ?? "https://chat-ai-production-3e84.up.railway.app";
const COOKIE_FILE = process.env.PROD_COOKIE_FILE ?? "/tmp/terra_axis_cookies.txt";
const CHARACTER_ID = 18;
const PERSONA_ID = 61;
const OUT_ROOT =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/luna-terra-value-bakeoff";
const FROZEN_COLLAB =
  process.env.FROZEN_COLLAB_ROOT ??
  "/opt/cursor/artifacts/default-collaborative/arm-COLLAB";

const RELATIONSHIP_TURNS = [
  "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.",
  "너는 이름이뭐야? 뭐하는 중이었어?",
] as const;

const ACTION_TURNS = [
  "*로비 천장에서 갑자기 비상 경보가 울리고 출입문 쪽에서 둔탁한 폭발음이 터진다. 렌은 소리가 난 쪽으로 고개를 돌린다.* 저거 뭐야?",
  "*렌은 태형의 소매를 잡고 곁에 붙는다.* 나도 같이 갈게.",
] as const;

type ModelKey = "deepseek" | "luna" | "terra";
type TestSet = "relationship" | "action";

const MODELS: Record<ModelKey, string> = {
  deepseek: "deepseek-v4-pro",
  luna: "gpt-5.6-luna",
  terra: "gpt-5.6-terra",
};

type CallResult = {
  http_status: number;
  latency_s: number;
  provider_raw: string;
  final_text: string;
  done: Record<string, unknown> | null;
  error: string | null;
  chatId?: number;
  finish_reason: string | null;
  model?: string;
  provider?: string;
  usage: Record<string, unknown> | null;
  cost_points: number | null;
  total_points_cost: number | null;
};

type ValidRow = {
  attempt_id: string;
  model_key: ModelKey;
  model_ui: string;
  test_set: TestSet;
  run: number;
  turn: number;
  user_input: string;
  provider_raw: string;
  final_text: string;
  finish_reason: string | null;
  latency_s: number;
  visible_chars: number;
  korean_chars: number;
  chat_id?: number;
  replacement: boolean;
  raw_hash: string;
  resolved_model?: string;
  provider?: string;
  usage: Record<string, unknown> | null;
  cost_points: number | null;
  total_points_cost: number | null;
  upstream_cost_usd: number | null;
  api_raw_cost_krw: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  total_billed_output_tokens: number | null;
};

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}
function countKorean(text: string): number {
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0xac00 && c <= 0xd7a3) n += 1;
  }
  return n;
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

async function setSelectedAI(token: string, modelUi: string) {
  const res = await fetch(`${BASE}/api/user/selected-ai`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({ selectedAI: modelUi }),
  });
  const body = await res.json();
  if (!res.ok || body.selectedAI !== modelUi) {
    throw new Error(
      `model not selected ${modelUi}: http=${res.status} body=${JSON.stringify(body).slice(0, 300)}`
    );
  }
}

async function postChat(opts: {
  token: string;
  chatId?: number;
  message: string;
  tag: string;
}): Promise<CallResult> {
  const started = Date.now();
  const body: Record<string, unknown> = {
    characterId: CHARACTER_ID,
    message: opts.message,
    selectedPersonaId: PERSONA_ID,
    isAdultMode: false,
    isNsfwMode: false,
    clientRequestId: `lt46_${opts.tag}_${Date.now().toString(36)}`,
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
      done: null,
      error: (await res.text()).slice(0, 2000),
      finish_reason: null,
      usage: null,
      cost_points: null,
      total_points_cost: null,
    };
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const dec = new TextDecoder();
  let buf = "";
  let provider_raw = "";
  let final_text = "";
  let done: Record<string, unknown> | null = null;
  let persistedChatId: number | undefined;
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
      if (ev.type === "delta" && typeof ev.text === "string") provider_raw += ev.text;
      if (ev.type === "replace" && typeof ev.text === "string") {
        provider_raw = ev.text;
        final_text = ev.text;
      }
      if (ev.type === "turn_persisted" && ev.chatId != null) {
        persistedChatId = Number(ev.chatId);
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
  const usage = (done?.usage ?? null) as Record<string, unknown> | null;
  const finish =
    (typeof done?.finishReason === "string" ? done.finishReason : null) ??
    (typeof usage?.finishReason === "string"
      ? (usage.finishReason as string)
      : null);
  return {
    http_status: res.status,
    latency_s: (Date.now() - started) / 1000,
    provider_raw,
    final_text,
    done,
    error,
    chatId:
      persistedChatId ??
      (done?.chatId != null ? Number(done.chatId) : undefined),
    finish_reason: finish,
    model: typeof usage?.model === "string" ? usage.model : undefined,
    provider: typeof usage?.provider === "string" ? usage.provider : undefined,
    usage,
    cost_points: typeof done?.cost === "number" ? done.cost : null,
    total_points_cost:
      typeof done?.totalPointsCost === "number" ? done.totalPointsCost : null,
  };
}

function runtimeExclude(resp: CallResult): string[] {
  const reasons: string[] = [];
  if (resp.http_status !== 200) reasons.push(`http_${resp.http_status}`);
  if (resp.error) reasons.push(`sse_error:${resp.error.slice(0, 120)}`);
  if (!resp.provider_raw.trim()) reasons.push("empty_upstream_stream");
  if (resp.finish_reason == null && resp.provider_raw.trim()) {
    reasons.push("finish_metadata_missing");
  }
  // Mid-stream provider cut: finish length/content_filter with empty-ish final
  if (
    resp.finish_reason &&
    resp.finish_reason !== "stop" &&
    resp.finish_reason !== "end_turn" &&
    !resp.provider_raw.trim()
  ) {
    reasons.push(`provider_cut:${resp.finish_reason}`);
  }
  return reasons;
}

function num(u: Record<string, unknown> | null, ...keys: string[]): number | null {
  if (!u) return null;
  for (const k of keys) {
    const v = u[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function toRow(
  opts: {
    attemptId: string;
    modelKey: ModelKey;
    testSet: TestSet;
    run: number;
    turn: number;
    userInput: string;
    resp: CallResult;
    chatId?: number;
    replacement: boolean;
  }
): ValidRow {
  const usage = opts.resp.usage;
  const done = opts.resp.done ?? {};
  return {
    attempt_id: opts.attemptId,
    model_key: opts.modelKey,
    model_ui: MODELS[opts.modelKey],
    test_set: opts.testSet,
    run: opts.run,
    turn: opts.turn,
    user_input: opts.userInput,
    provider_raw: opts.resp.provider_raw,
    final_text: opts.resp.final_text,
    finish_reason: opts.resp.finish_reason,
    latency_s: opts.resp.latency_s,
    visible_chars: [...opts.resp.provider_raw].length,
    korean_chars: countKorean(opts.resp.provider_raw),
    chat_id: opts.chatId,
    replacement: opts.replacement,
    raw_hash: sha256(opts.resp.provider_raw),
    resolved_model: opts.resp.model,
    provider: opts.resp.provider,
    usage,
    cost_points: opts.resp.cost_points,
    total_points_cost: opts.resp.total_points_cost,
    // App `usage.cost` = charged points. Actual provider money cost = apiRawCostKrw.
    upstream_cost_usd: num(usage, "upstreamCostUsd") ??
      num(done as Record<string, unknown>, "upstreamCostUsd"),
    api_raw_cost_krw: num(usage, "apiRawCostKrw") ??
      num(done as Record<string, unknown>, "apiRawCostKrw"),
    input_tokens: num(usage, "apiInputTokens", "input", "inputTokens", "prompt_tokens"),
    output_tokens: num(usage, "apiOutputTokens", "output", "outputTokens", "completion_tokens"),
    reasoning_tokens: num(
      usage,
      "reasoning",
      "reasoningTokens",
      "reasoning_tokens",
      "thinkingTokens"
    ),
    total_billed_output_tokens: num(
      usage,
      "apiOutputTokens",
      "totalOutput",
      "total_output_tokens",
      "completion_tokens"
    ),
  };
}

function loadFrozenDeepSeekRelationship(): ValidRow[] {
  const idxPath = join(FROZEN_COLLAB, "outputs_index.json");
  if (!existsSync(idxPath)) throw new Error(`missing frozen collab ${idxPath}`);
  const rows: ValidRow[] = [];
  for (const run of [1, 2]) {
    for (const turn of [1, 2]) {
      const rawPath = join(FROZEN_COLLAB, `run${run}`, `turn${turn}-provider-raw.txt`);
      const metaPath = join(FROZEN_COLLAB, `run${run}`, `turn${turn}-meta.json`);
      if (!existsSync(rawPath)) throw new Error(`missing ${rawPath}`);
      const raw = readFileSync(rawPath, "utf8");
      const meta = existsSync(metaPath)
        ? (JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>)
        : {};
      const userInput = RELATIONSHIP_TURNS[turn - 1]!;
      rows.push({
        attempt_id: `DEEPSEEK-REL-R${run}T${turn}`,
        model_key: "deepseek",
        model_ui: MODELS.deepseek,
        test_set: "relationship",
        run,
        turn,
        user_input: userInput,
        provider_raw: raw,
        final_text: raw,
        finish_reason: typeof meta.finish_reason === "string" ? meta.finish_reason : "stop",
        latency_s: typeof meta.latency_s === "number" ? meta.latency_s : 0,
        visible_chars: [...raw].length,
        korean_chars: countKorean(raw),
        chat_id: typeof meta.chat_id === "number" ? meta.chat_id : undefined,
        replacement: Boolean(meta.replacement),
        raw_hash: sha256(raw),
        resolved_model: typeof meta.model === "string" ? meta.model : undefined,
        provider: typeof meta.provider === "string" ? meta.provider : undefined,
        usage: null,
        cost_points: null,
        total_points_cost: null,
        upstream_cost_usd: null,
        api_raw_cost_krw: null,
        input_tokens: null,
        output_tokens:
          typeof meta.output_tokens === "number" ? meta.output_tokens : null,
        reasoning_tokens: null,
        total_billed_output_tokens: null,
        // mark frozen
      });
    }
  }
  // Copy frozen sources into artifact tree for provenance
  const dest = join(OUT_ROOT, "frozen-deepseek-relationship");
  mkdirSync(dest, { recursive: true });
  copyFileSync(idxPath, join(dest, "outputs_index.json"));
  for (const run of [1, 2]) {
    mkdirSync(join(dest, `run${run}`), { recursive: true });
    for (const turn of [1, 2]) {
      copyFileSync(
        join(FROZEN_COLLAB, `run${run}`, `turn${turn}-provider-raw.txt`),
        join(dest, `run${run}`, `turn${turn}-provider-raw.txt`)
      );
    }
  }
  return rows;
}

async function runChatSeries(opts: {
  token: string;
  modelKey: ModelKey;
  testSet: TestSet;
  turns: readonly string[];
  targetRuns: number;
  replacementBudget: { left: number };
  stats: {
    attempts: number;
    replacements: number;
    exclusions: unknown[];
  };
}): Promise<ValidRow[]> {
  const modelUi = MODELS[opts.modelKey];
  await setSelectedAI(opts.token, modelUi);
  const valid: ValidRow[] = [];
  let completedRuns = 0;
  let runSlot = 0;
  const maxSlots = opts.targetRuns + opts.replacementBudget.left + 2;

  while (completedRuns < opts.targetRuns && runSlot < maxSlots) {
    runSlot += 1;
    const run = completedRuns + 1;
    const runDir = join(
      OUT_ROOT,
      opts.testSet,
      opts.modelKey,
      `run${run}`
    );
    mkdirSync(runDir, { recursive: true });
    let chatId: number | undefined;
    let runFailed = false;
    const runRows: ValidRow[] = [];

    for (let turn = 1; turn <= opts.turns.length; turn++) {
      const userInput = opts.turns[turn - 1]!;
      const tag = `${opts.modelKey}_${opts.testSet}_r${run}_t${turn}`;
      console.log(`\n=== ${opts.modelKey} ${opts.testSet} run${run} turn${turn} ===`);

      let resp = await postChat({
        token: opts.token,
        chatId,
        message: userInput,
        tag,
      });
      opts.stats.attempts += 1;
      let usedReplacement = false;
      let reasons = runtimeExclude(resp);

      if (reasons.length > 0 && opts.replacementBudget.left > 0) {
        save(join(OUT_ROOT, "runtime_excluded"), `${tag}_attempt1.json`, {
          reasons,
          finish_reason: resp.finish_reason,
          provider_raw: resp.provider_raw.slice(0, 500),
          error: resp.error,
        });
        opts.stats.exclusions.push({
          model: opts.modelKey,
          test_set: opts.testSet,
          run,
          turn,
          attempt: 1,
          reasons,
        });
        resp = await postChat({
          token: opts.token,
          chatId: turn === 1 ? undefined : chatId,
          message: userInput,
          tag: `${tag}_repl`,
        });
        opts.stats.attempts += 1;
        opts.stats.replacements += 1;
        opts.replacementBudget.left -= 1;
        usedReplacement = true;
        reasons = runtimeExclude(resp);
      }

      if (reasons.length > 0) {
        save(join(OUT_ROOT, "runtime_excluded"), `${tag}_final.json`, {
          reasons,
          finish_reason: resp.finish_reason,
          provider_raw: resp.provider_raw.slice(0, 500),
          error: resp.error,
          usedReplacement,
        });
        opts.stats.exclusions.push({
          model: opts.modelKey,
          test_set: opts.testSet,
          run,
          turn,
          attempt: "final",
          reasons,
          usedReplacement,
        });
        console.error(`EXCLUDED ${tag}: ${reasons.join(",")}`);
        runFailed = true;
        break;
      }

      if (turn === 1) {
        chatId = resp.chatId;
        if (!chatId) {
          runFailed = true;
          opts.stats.exclusions.push({
            model: opts.modelKey,
            test_set: opts.testSet,
            run,
            turn,
            reasons: ["chat_id_missing"],
          });
          break;
        }
      }

      const attemptId = `${opts.modelKey.toUpperCase()}-${opts.testSet === "relationship" ? "REL" : "ACT"}-R${run}T${turn}`;
      const row = toRow({
        attemptId,
        modelKey: opts.modelKey,
        testSet: opts.testSet,
        run,
        turn,
        userInput,
        resp,
        chatId,
        replacement: usedReplacement,
      });
      runRows.push(row);
      save(runDir, `turn${turn}-provider-raw.txt`, resp.provider_raw);
      save(runDir, `turn${turn}-sse-final.txt`, resp.final_text);
      save(runDir, `turn${turn}-meta.json`, {
        ...row,
        provider_raw: undefined,
        final_text: undefined,
      });
      console.log({
        attemptId,
        chars: row.visible_chars,
        finish: row.finish_reason,
        latency_s: row.latency_s,
        points: row.cost_points,
        upstream_usd: row.upstream_cost_usd,
      });
    }

    if (runFailed) {
      console.log("RUN_ABORTED", opts.modelKey, opts.testSet, run);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    valid.push(...runRows);
    completedRuns += 1;
    if (completedRuns < opts.targetRuns) await new Promise((r) => setTimeout(r, 2000));
  }

  if (completedRuns < opts.targetRuns) {
    save(OUT_ROOT, `RUNTIME_RELIABILITY_FAIL_${opts.modelKey}_${opts.testSet}.json`, {
      status: "RUNTIME_RELIABILITY_FAIL",
      model: opts.modelKey,
      test_set: opts.testSet,
      completed_runs: completedRuns,
      target_runs: opts.targetRuns,
      attempts: opts.stats.attempts,
      replacements: opts.stats.replacements,
      exclusions: opts.stats.exclusions,
    });
    throw new Error(
      `RUNTIME_RELIABILITY_FAIL ${opts.modelKey}/${opts.testSet}: completed=${completedRuns}`
    );
  }
  return valid;
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(join(OUT_ROOT, "runtime_excluded"), { recursive: true });
  const token = loadSessionCookie();
  const me = await (
    await fetch(`${BASE}/api/auth/me`, {
      headers: { Cookie: `session=${token}` },
    })
  ).json();
  if (me.user?.id !== 34) throw new Error(`expected user 34 got ${me.user?.id}`);

  save(OUT_ROOT, "env_meta.json", {
    audit: 46,
    base: BASE,
    user_id: 34,
    character_id: CHARACTER_ID,
    persona_id: PERSONA_ID,
    points_start: me.user?.points ?? null,
    started_at: new Date().toISOString(),
    frozen_collab: FROZEN_COLLAB,
    salt: randomBytes(8).toString("hex"),
  });

  const all: ValidRow[] = [];
  const stats = {
    attempts: 0,
    replacements: 0,
    exclusions: [] as unknown[],
  };

  // DeepSeek relationship = frozen (0 new calls)
  const frozen = loadFrozenDeepSeekRelationship();
  all.push(...frozen);
  console.log("FROZEN_DEEPSEEK_REL", frozen.length);

  // Luna / Terra relationship: 2 runs each
  for (const modelKey of ["luna", "terra"] as ModelKey[]) {
    const budget = { left: 2 };
    const rows = await runChatSeries({
      token,
      modelKey,
      testSet: "relationship",
      turns: RELATIONSHIP_TURNS,
      targetRuns: 2,
      replacementBudget: budget,
      stats,
    });
    all.push(...rows);
  }

  // Action: all three models, 1 run each
  for (const modelKey of ["deepseek", "luna", "terra"] as ModelKey[]) {
    const budget = { left: 2 };
    const rows = await runChatSeries({
      token,
      modelKey,
      testSet: "action",
      turns: ACTION_TURNS,
      targetRuns: 1,
      replacementBudget: budget,
      stats,
    });
    all.push(...rows);
  }

  // restore default model
  await setSelectedAI(token, MODELS.deepseek);

  const meEnd = await (
    await fetch(`${BASE}/api/auth/me`, {
      headers: { Cookie: `session=${token}` },
    })
  ).json();

  save(OUT_ROOT, "outputs_index.json", {
    status: "LUNA_TERRA_VALUE_BAKEOFF_LIVE_CAPTURED",
    attempts: stats.attempts,
    replacement_calls: stats.replacements,
    exclusions: stats.exclusions,
    frozen_deepseek_relationship: frozen.length,
    live_new_calls: stats.attempts,
    points_end: meEnd.user?.points ?? null,
    outputs: all.map((o) => ({
      attempt_id: o.attempt_id,
      model_key: o.model_key,
      test_set: o.test_set,
      run: o.run,
      turn: o.turn,
      visible_chars: o.visible_chars,
      finish_reason: o.finish_reason,
      replacement: o.replacement,
      cost_points: o.cost_points,
      upstream_cost_usd: o.upstream_cost_usd,
      latency_s: o.latency_s,
      provider: o.provider,
    })),
  });
  save(OUT_ROOT, "all_valid_rows.json", all);
  console.log(
    "BAKEOFF_LIVE_DONE",
    JSON.stringify({
      valid: all.length,
      attempts: stats.attempts,
      replacements: stats.replacements,
      exclusions: stats.exclusions.length,
    })
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
