/**
 * DeepSeek common-root audit harness (production main-home).
 *
 * Diagnostic model default: deepseek-v4-pro (override via MODEL_UI env).
 *
 * Env:
 *   PROD_BASE, PROD_COOKIE_FILE, VARIANT_LABEL, OUT_DIR, ART_DIR
 *   RUNS (default 3), MAX_TURNS (default 2), EXPECTED_VARIANT (server env)
 *   MODEL_UI (default deepseek-v4-pro), CHARACTER_ID, PERSONA_NAME
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { computeDialogueMetrics } from "../src/lib/dialogueMetrics";
import { visibleAssistantDisplayCharCount } from "../src/lib/chatDisplayLength";
import { evaluateLengthGate } from "../src/lib/rpDiagnosticCanary";

const BASE = process.env.PROD_BASE ?? "https://chat-ai-production-3e84.up.railway.app";
const COOKIE_FILE = process.env.PROD_COOKIE_FILE ?? "/tmp/terra_axis_cookies.txt";
const VARIANT_LABEL = process.env.VARIANT_LABEL ?? "ds_postprocess_baseline";
const EXPECTED_VARIANT = process.env.EXPECTED_VARIANT ?? VARIANT_LABEL;
const RUNS = Number(process.env.RUNS ?? "2");
const START_RUN = Number(process.env.START_RUN ?? "1");
const MAX_TURNS = Number(process.env.MAX_TURNS ?? "2");
const CHARACTER_ID = Number(process.env.CHARACTER_ID ?? "18");
const PERSONA_NAME = process.env.PERSONA_NAME ?? "렌";
const OUT_ROOT =
  process.env.OUT_DIR ??
  `/opt/cursor/artifacts/deepseek-common-root-audit/01-postprocess/${VARIANT_LABEL}`;
const ART_ROOT = process.env.ART_DIR ?? OUT_ROOT;
const MODEL_UI = process.env.MODEL_UI ?? "deepseek-v4-pro";

const TURNS = [
  "나는 렌이라고 부르면 돼....나는 본기억이 안나는데....나 알아?(갸웃)",
  "같이갈래?*두리번 거리면서 다가오는 사람들을 보다가 다시 라이크를 쳐다본다*",
  "그럼 네 옆에 있을래. *라이크의 소매 끝을 살짝 잡는다* 여기 아직 조금 낯설어.",
  "라이크는 왜 처음 보는 나한테 이렇게 잘해줘? *고개를 들어 라이크를 바라본다*",
].slice(0, MAX_TURNS);

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

async function postChat(opts: {
  token: string;
  characterId: number;
  chatId?: number;
  message: string;
  personaId: number;
  turn: number;
  run: number;
}) {
  const started = Date.now();
  const body: Record<string, unknown> = {
    characterId: opts.characterId,
    message: opts.message,
    selectedPersonaId: opts.personaId,
    isAdultMode: false,
    isNsfwMode: false,
    clientRequestId: `dsaudit_${VARIANT_LABEL}_r${opts.run}_t${opts.turn}_${Date.now().toString(36)}`,
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
      pre_normalize: "",
      post_normalize: "",
      final_text: "",
      db_saved: "",
      done: null,
      diagnostic_pipeline: null,
      statuses: [] as string[],
      error: (await res.text()).slice(0, 2000),
      events: [] as unknown[],
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
  const events: unknown[] = [];
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
      events.push(ev);
      if (ev.type === "status" && typeof ev.message === "string") statuses.push(ev.message);
      if (ev.type === "delta" && typeof ev.text === "string") provider_raw += ev.text;
      if (ev.type === "replace" && typeof ev.text === "string") {
        provider_raw = ev.text;
        final_text = ev.text;
      }
      if (ev.type === "turn_persisted" && ev.chatId != null) {
        persistedChatId = Number(ev.chatId);
      }
      if (ev.type === "diagnostic_pipeline") diagnostic_pipeline = ev;
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
  const pipeline = diagnostic_pipeline as {
    metrics?: {
      provider_raw?: { content_hash?: string };
      pre_normalize?: unknown;
      post_normalize?: unknown;
    };
    pipeline?: {
      provider_raw_merged?: string;
      pre_normalize?: string;
      pre_display_grouping?: string;
      post_display_grouping?: string;
      sse_final?: string;
      db_saved?: string;
    };
    integrity?: { valid?: boolean; invalidReasons?: string[]; canaryVariant?: string };
  } | null;
  const pipe = pipeline?.pipeline;

  return {
    http_status: res.status,
    latency_s: (Date.now() - started) / 1000,
    provider_raw,
    pre_normalize: pipe?.pre_normalize ?? pipe?.pre_display_grouping ?? "",
    post_normalize: pipe?.post_display_grouping ?? "",
    pre_display_grouping: pipe?.pre_display_grouping ?? "",
    post_display_grouping: pipe?.post_display_grouping ?? "",
    final_text,
    db_saved: pipe?.db_saved ?? final_text,
    done,
    diagnostic_pipeline,
    pipeline_integrity: pipeline?.integrity ?? null,
    statuses,
    error,
    events,
  };
}

function npcHeuristics(text: string) {
  const staff: string[] = [];
  const staffAttr =
    /(직원|스태프|간호사|의사|안내원|담당자|의료진|회색\s*셔츠|접수\s*담당|조태형\s*씨)/;
  for (const m of text.matchAll(/[“"]([^”"\n]+)[”"]/g)) {
    const q = m[1]!;
    const before = text.slice(Math.max(0, m.index! - 140), m.index!);
    if (
      staffAttr.test(before.replace(/\n/g, " ")) ||
      /(신원\s*대조|바이탈|임시\s*등록|기본\s*확인부터|안쪽으로\s*안내|등록\s*정보)/.test(q)
    ) {
      staff.push(q);
    }
  }
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let adminStreak = 0;
  let maxAdminStreak = 0;
  for (const p of paras) {
    if (/(등록|접수|문진|차트|진료|신원|바이탈|서류|보호\s*대상|대기실|확인실)/.test(p)) {
      adminStreak += 1;
      maxAdminStreak = Math.max(maxAdminStreak, adminStreak);
    } else adminStreak = 0;
  }
  const externalDecidesNext =
    staff.length >= 2 &&
    /(등록\s*대기|확인실|담당자|지원국|접수실)/.test(text) &&
    !/(식당|밥|바람\s*쐬|옆에\s*있)/.test(text.slice(-400));
  return {
    external_dialogue_blocks: staff.length,
    npc_subplot: staff.length >= 2 || maxAdminStreak >= 2 || externalDecidesNext,
  };
}

function analyze(text: string, turn: number) {
  const metrics = computeDialogueMetrics({ text, primaryCharacterName: "라이크" });
  const npc = npcHeuristics(text);
  const trailing = /([?？]|어때|할래|갈래|뭐\s*해|봐|여기|따라와|같이\s*가|골라|선택|믿어도|말해봐|괜찮)/.test(
    text.slice(-320)
  )
    ? 1
    : 0;
  const scene_completion =
    /(이름.*(외웠|기억)|거리|다가|손|같이\s*가|알아|처음\s*보|라이크|태형).{0,40}(달라|바뀌|정해|골랐|믿|함께|가까)/.test(
      text
    ) ||
    /(렌|라이크|태형).{0,80}(거리|손|같이|안내|곁|소매|옆)/.test(text);

  return {
    turn,
    ...metrics,
    raw_quote_blocks: metrics.raw_quote_blocks,
    auto_semantic_units: metrics.auto_semantic_units,
    manual_semantic_units: metrics.manual_semantic_units,
    auto_resume_transitions: metrics.auto_resume_transitions,
    manual_resume_transitions: metrics.manual_resume_transitions,
    auto_fragmentation_multiplier: metrics.auto_fragmentation_multiplier,
    manual_fragmentation_multiplier: metrics.manual_fragmentation_multiplier,
    raw_quote_blocks_per_1000_chars: metrics.raw_quote_blocks_per_1000_chars,
    manual_resume_per_1000_chars: metrics.manual_resume_per_1000_chars,
    auto_metric_unreliable: metrics.auto_metric_unreliable ? "AUTO_METRIC_UNRELIABLE" : null,
    like_dialogue_blocks: Math.max(0, metrics.quote_pair_count - npc.external_dialogue_blocks),
    ...npc,
    trailing_reaction_points: trailing,
    scene_completion,
  };
}

async function resolvePersonaId(token: string): Promise<{ id: number; name: string }> {
  const res = await fetch(`${BASE}/api/personas`, {
    headers: { Cookie: `session=${token}` },
  });
  if (!res.ok) throw new Error(`personas fetch failed: ${res.status}`);
  const data = (await res.json()) as {
    personas?: Array<{ id: number; name: string }>;
  };
  const matches = (data.personas ?? []).filter((p) => p.name.trim() === PERSONA_NAME);
  if (matches.length === 0) {
    throw new Error(`persona "${PERSONA_NAME}" not found on account`);
  }
  if (matches.length > 1) {
    console.warn(
      `multiple personas named "${PERSONA_NAME}":`,
      matches.map((p) => p.id).join(", "),
      "using lowest id"
    );
  }
  const pick = matches.sort((a, b) => a.id - b.id)[0]!;
  return { id: pick.id, name: pick.name };
}

async function fetchDbAssistant(chatId: number, token: string, turn: number): Promise<string> {
  const res = await fetch(
    `${BASE}/api/chat/messages?chatId=${chatId}&turnLimit=${Math.max(turn + 2, 8)}`,
    { headers: { Cookie: `session=${token}` } }
  );
  if (!res.ok) return "";
  const data = (await res.json()) as {
    messages?: Array<{ role: string; content: string; model?: string }>;
  };
  const assistants = (data.messages ?? []).filter((m) => m.role === "assistant" && m.model !== "greeting");
  const msg = assistants[turn - 1];
  return msg?.content ?? assistants[assistants.length - 1]?.content ?? "";
}

function loadRunMetricsFromDisk(runDir: string): unknown[] {
  const metrics: unknown[] = [];
  for (let t = 1; t <= MAX_TURNS; t++) {
    const p = join(runDir, `turn${t}-metrics.json`);
    if (!existsSync(p)) continue;
    metrics.push(JSON.parse(readFileSync(p, "utf8")) as unknown);
  }
  return metrics;
}

function collectAllRunMetrics(outRoot: string, runs: number): unknown[] {
  const flat: unknown[] = [];
  for (let r = 1; r <= runs; r++) {
    flat.push(...loadRunMetricsFromDisk(join(outRoot, `run${r}`)));
  }
  return flat;
}

async function main() {
  mkdirSync(join(OUT_ROOT, "..", "..", "00-integrity"), { recursive: true });
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(ART_ROOT, { recursive: true });
  const token = loadSessionCookie();
  const health = await (await fetch(`${BASE}/health`)).json();
  const me = await (
    await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: `session=${token}` } })
  ).json();
  await fetch(`${BASE}/api/user/selected-ai`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: `session=${token}` },
    body: JSON.stringify({ selectedAI: MODEL_UI }),
  });
  const sel = await (
    await fetch(`${BASE}/api/user/selected-ai`, {
      headers: { Cookie: `session=${token}` },
    })
  ).json();
  if (sel.selectedAI !== MODEL_UI) {
    throw new Error(`DeepSeek model not selected: ${sel.selectedAI}`);
  }
  const persona = await resolvePersonaId(token);

  const integrityMeta = {
    variant_label: VARIANT_LABEL,
    expected_variant: EXPECTED_VARIANT,
    base: BASE,
    health,
    user_id: me.user?.id,
    points: me.user?.points,
    runs: RUNS,
    max_turns: MAX_TURNS,
    character_id: CHARACTER_ID,
    persona_id: persona.id,
    persona_name: persona.name,
    model_ui_id: MODEL_UI,
    resolved_provider_model_id: MODEL_UI,
    contentKind: "character",
    single_primary: true,
    started_at: new Date().toISOString(),
  };
  save(join(OUT_ROOT, "..", "..", "00-integrity"), "run-metadata.json", integrityMeta);
  save(OUT_ROOT, "env_meta.json", integrityMeta);

  const allRows: unknown[] = [];
  for (let run = START_RUN; run <= RUNS; run++) {
    const runDir = join(OUT_ROOT, `run${run}`);
    mkdirSync(runDir, { recursive: true });
    let chatId: number | undefined;
    const runMetrics: unknown[] = [];

    for (let t = 0; t < TURNS.length; t++) {
      const turn = t + 1;
      console.log(`\n=== ${VARIANT_LABEL} run ${run}/${RUNS} turn ${turn} ===`);
      const resp = await postChat({
        token,
        characterId: CHARACTER_ID,
        chatId,
        message: TURNS[t]!,
        personaId: persona.id,
        turn,
        run,
      });

      const invalidReasons: string[] = [];
      if (resp.http_status !== 200) invalidReasons.push(`http ${resp.http_status}`);
      if (resp.error) invalidReasons.push(`provider error: ${resp.error}`);
      const integrity = resp.pipeline_integrity as {
        valid?: boolean;
        invalidReasons?: string[];
        canaryVariant?: string;
        resolvedProviderModelId?: string;
        personaId?: number;
      } | null;
      if (integrity && integrity.valid === false) {
        invalidReasons.push(...(integrity.invalidReasons ?? []));
      }
      if (integrity?.canaryVariant && integrity.canaryVariant !== EXPECTED_VARIANT) {
        invalidReasons.push("variant mismatch");
      }
      if (integrity?.resolvedProviderModelId && integrity.resolvedProviderModelId !== MODEL_UI) {
        invalidReasons.push("model mismatch");
      }
      if (integrity?.personaId != null && integrity.personaId !== persona.id) {
        invalidReasons.push("persona mismatch");
      }

      if (turn === 1) {
        chatId = Number((resp.done as { chatId?: number } | null)?.chatId);
        if (!chatId && !resp.provider_raw.trim()) {
          save(runDir, `turn${turn}-INVALID_RUN.json`, { ...resp, invalidReasons });
          throw new Error(`run${run} turn1 INVALID_RUN: ${invalidReasons.join("; ")}`);
        }
      }

      if (!resp.provider_raw.trim()) {
        save(runDir, `turn${turn}-INVALID_RUN.json`, { ...resp, invalidReasons });
        throw new Error(`run${run} turn${turn} INVALID_RUN: empty provider_raw`);
      }

      const dbSaved = chatId ? await fetchDbAssistant(chatId, token, turn) : resp.final_text;
      if (dbSaved) resp.db_saved = dbSaved;

      const rawMetrics = analyze(resp.provider_raw, turn);
      const finalMetrics = analyze(resp.final_text || resp.provider_raw, turn);
      const doneUsage = (resp.done as { usage?: Record<string, unknown>; finishReason?: string } | null)?.usage;
      const outputTokens =
        typeof doneUsage?.output === "number"
          ? doneUsage.output
          : typeof doneUsage?.outputTokens === "number"
            ? doneUsage.outputTokens
            : null;
      const finishReason =
        (resp.done as { finishReason?: string } | null)?.finishReason ??
        (typeof doneUsage?.finishReason === "string" ? doneUsage.finishReason : null);

      const payload = {
        ...rawMetrics,
        metrics_source: "provider_raw",
        provider_raw_ws: rawMetrics.canonical_length_ws,
        sse_final_ws: finalMetrics.canonical_length_ws,
        db_saved_ws: dbSaved.length,
        visible_canonical_length: visibleAssistantDisplayCharCount(resp.final_text || resp.provider_raw),
        display_metrics: {
          ...finalMetrics,
          note: "display/SSE — not used for fragmentation root-cause verdict",
        },
        invalid: invalidReasons.length > 0,
        invalid_reason: invalidReasons.join("; ") || undefined,
        integrity,
        api: {
          chatId,
          latency_s: resp.latency_s,
          model: (resp.done as { usage?: { model?: string } } | null)?.usage?.model,
          provider: (resp.done as { usage?: { provider?: string } } | null)?.usage?.provider,
          output_tokens: outputTokens,
          finish_reason: finishReason,
          raw_equals_final: resp.provider_raw === resp.final_text,
          raw_hash: sha256(resp.provider_raw),
          final_hash: sha256(resp.final_text),
          length_recovery_passes:
            (doneUsage?.lengthRecoveryPasses as number | undefined) ?? 0,
          retry_count: resp.statuses.filter((s) => /retry|재시도/i.test(s)).length,
        },
      };

      save(runDir, `turn${turn}-provider-raw.txt`, resp.provider_raw);
      save(runDir, `turn${turn}-pre-normalize.txt`, resp.pre_normalize || resp.provider_raw);
      save(runDir, `turn${turn}-pre-display-grouping.txt`, resp.pre_display_grouping || resp.pre_normalize || resp.provider_raw);
      save(runDir, `turn${turn}-post-display-grouping.txt`, resp.post_display_grouping || resp.post_normalize || resp.final_text);
      save(runDir, `turn${turn}-post-normalize.txt`, resp.post_normalize || resp.final_text);
      save(runDir, `turn${turn}-sse-final.txt`, resp.final_text);
      save(runDir, `turn${turn}-db-saved.txt`, resp.db_saved);
      save(runDir, `turn${turn}-metrics.json`, payload);
      save(
        runDir,
        `turn${turn}-manual-semantic-review.md`,
        `# Run ${run} Turn ${turn}\n\n` +
          `- raw_quote_blocks: ${rawMetrics.raw_quote_blocks}\n` +
          `- manual_semantic_units: ${rawMetrics.manual_semantic_units}\n` +
          `- manual_resume_transitions: ${rawMetrics.manual_resume_transitions}\n` +
          `- manual_fragmentation_multiplier: ${rawMetrics.manual_fragmentation_multiplier}\n` +
          `- auto_metric: ${rawMetrics.auto_metric_unreliable ?? "ok"}\n`
      );
      if (resp.diagnostic_pipeline) {
        save(runDir, `turn${turn}-pipeline.json`, resp.diagnostic_pipeline);
      }

      runMetrics.push(payload);
      console.log("turn", {
        turn,
        raw_len: rawMetrics.canonical_length_ws,
        quotes_raw: rawMetrics.raw_quote_blocks,
        frag_manual: rawMetrics.manual_fragmentation_multiplier,
        resume_manual: rawMetrics.manual_resume_transitions,
        auto_unreliable: rawMetrics.auto_metric_unreliable,
        finish: finishReason,
        npc: rawMetrics.npc_subplot,
        invalid: invalidReasons.length > 0,
      });
    }

    allRows.push({ run, chatId, metrics: runMetrics });
    if (run < RUNS) await new Promise((r) => setTimeout(r, 3000));
  }

  const flatMetrics = collectAllRunMetrics(OUT_ROOT, RUNS) as Array<{
    provider_raw_ws?: number;
    canonical_length_ws?: number;
    api?: { finish_reason?: string; length_recovery_passes?: number; retry_count?: number };
  }>;
  const lengthGate = evaluateLengthGate(flatMetrics);
  const gateSummary = {
    variant: VARIANT_LABEL,
    model: MODEL_UI,
    diagnostic_model: "deepseek-v4-pro",
    flash_matrix_status: "ON_HOLD",
    flash_d0_status: "SHORT_OUTPUT_SMOKE_ONLY",
    length_gate: lengthGate,
    audit_permission: lengthGate.pass
      ? "PRO_BASELINE_LENGTH_GATE_PASS"
      : "LENGTH_BASELINE_NOT_READY",
  };
  save(OUT_ROOT, "length_gate.json", gateSummary);
  save(join(OUT_ROOT, "..", "..", "00-integrity"), `${VARIANT_LABEL}-length_gate.json`, gateSummary);

  save(OUT_ROOT, "all_runs.json", allRows);
  console.log("done", VARIANT_LABEL, "length_gate", lengthGate);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
