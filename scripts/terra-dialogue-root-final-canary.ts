/**
 * Terra dialogue-root final experiment harness.
 * Production main-home only — allowlist canary variant must be active server-side.
 *
 * Env:
 *   PROD_BASE, PROD_COOKIE_FILE, VARIANT_LABEL, OUT_DIR, ART_DIR
 *   RUNS (default 3), MAX_TURNS (default 4), PERSONA_ID (default 62)
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.PROD_BASE ?? "https://chat-ai-production-3e84.up.railway.app";
const COOKIE_FILE = process.env.PROD_COOKIE_FILE ?? "/tmp/terra_axis_cookies.txt";
const VARIANT_LABEL = process.env.VARIANT_LABEL ?? "dialogue_root_baseline";
const RUNS = Number(process.env.RUNS ?? "3");
const START_RUN = Number(process.env.START_RUN ?? "1");
const MAX_TURNS = Number(process.env.MAX_TURNS ?? "4");
const OUT_ROOT =
  process.env.OUT_DIR ??
  `/opt/cursor/artifacts/terra-dialogue-root-final/${VARIANT_LABEL}`;
const ART_ROOT = process.env.ART_DIR ?? OUT_ROOT;
const CHARACTER_ID = 18;
const PERSONA_ID = Number(process.env.PERSONA_ID ?? "62");

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
    selectedAI: "gpt-5.6-terra",
    isAdultMode: false,
    isNsfwMode: false,
    clientRequestId: `droot_${VARIANT_LABEL}_r${opts.run}_t${opts.turn}_${Date.now().toString(36)}`,
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
      if (ev.type === "done") {
        done = ev;
        if (typeof ev.text === "string" && ev.text.length > 0) final_text = ev.text;
      }
      if (ev.type === "error") error = String(ev.message ?? JSON.stringify(ev));
    }
  }
  if (!final_text) final_text = provider_raw;
  if (done && persistedChatId && !done.chatId) done.chatId = persistedChatId;
  if (!done && persistedChatId && provider_raw.trim()) {
    done = { chatId: persistedChatId, text: final_text };
  }
  return {
    http_status: res.status,
    latency_s: (Date.now() - started) / 1000,
    provider_raw,
    final_text,
    done,
    statuses,
    error,
    events,
  };
}

function dialogueBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /"([^"\n]{1,800})"|“([^”\n]{1,800})”/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) blocks.push((m[1] ?? m[2] ?? "").trim());
  return blocks.filter(Boolean);
}

function analyze(text: string, turn: number) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const quotes = dialogueBlocks(text);
  const dialogueChars = quotes.reduce((a, b) => a + b.length, 0);
  const canon = text.length;
  const noWs = text.replace(/\s/g, "").length;
  const narrationChars = Math.max(0, canon - dialogueChars);

  let islands = 0;
  let inIsland = false;
  for (const p of paras) {
    const qo = Boolean(p.match(/^[“"][^”"\n]+[”"]$/));
    if (qo) {
      if (!inIsland) {
        islands += 1;
        inIsland = true;
      }
    } else inIsland = false;
  }
  const resumeAuto = Math.max(0, islands - 1);

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

  const adminParas = paras.filter((p) =>
    /(등록|접수|문진|차트|진료|환자|신원|바이탈|서류|보호\s*대상|대기실|확인실)/.test(p)
  );
  let adminStreak = 0;
  let maxAdminStreak = 0;
  for (const p of paras) {
    if (/(등록|접수|문진|차트|진료|신원|바이탈|서류|보호\s*대상|대기실|확인실)/.test(p)) {
      adminStreak += 1;
      maxAdminStreak = Math.max(maxAdminStreak, adminStreak);
    } else adminStreak = 0;
  }

  const trailing = /([?？]|어때|할래|갈래|뭐\s*해|봐|여기|따라와|같이\s*가|골라|선택|믿어도|말해봐|괜찮)/.test(
    text.slice(-320)
  )
    ? 1
    : 0;

  const relationChange =
    /(이름.*(외웠|기억)|거리|다가|손|같이\s*가|알아|처음\s*보|라이크|태형).{0,40}(달라|바뀌|정해|골랐|믿|함께|가까)/.test(
      text
    ) ||
    /(렌|라이크|태형).{0,80}(거리|손|같이|안내|곁|소매|옆)/.test(text);

  const externalDecidesNext =
    staff.length >= 2 &&
    /(등록\s*대기|확인실|담당자|지원국|접수실)/.test(text) &&
    !/(식당|밥|바람\s*쐬|옆에\s*있)/.test(text.slice(-400));
  const npcSubplot = staff.length >= 2 || maxAdminStreak >= 2 || externalDecidesNext;

  const foreignMeta =
    /(\bthe\b|\bI\b|\byou\b|\bassistant\b|\buser\b|\[SYSTEM\]|OUTPUT LAYOUT)/i.test(
      text
    );

  return {
    turn,
    canonical_length_ws: canon,
    canonical_length_no_ws: noWs,
    paragraph_count: paras.length,
    dialogue_block_count: quotes.length,
    like_dialogue_blocks: Math.max(0, quotes.length - staff.length),
    external_dialogue_blocks: staff.length,
    dialogue_chars: dialogueChars,
    narration_ratio_pct: canon ? Math.round((narrationChars / canon) * 1000) / 10 : 0,
    avg_like_dialogue_len:
      quotes.length - staff.length > 0
        ? Math.round(
            (quotes.slice(0, quotes.length - staff.length).reduce((a, b) => a + b.length, 0) /
              Math.max(1, quotes.length - staff.length)) *
              10
          ) / 10
        : 0,
    resume_bundles_auto: resumeAuto,
    npc_subplot: npcSubplot,
    admin_register_paragraphs: adminParas.length,
    admin_streak_max: maxAdminStreak,
    trailing_reaction_points: trailing,
    scene_completion: relationChange,
    short_dialogue_le_10: quotes.filter((q) => q.length <= 10).length,
    staff_quotes: staff,
    foreign_or_meta_leak: foreignMeta,
  };
}

function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

async function main() {
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
    body: JSON.stringify({ selectedAI: "gpt-5.6-terra" }),
  });
  const sel = await (
    await fetch(`${BASE}/api/user/selected-ai`, {
      headers: { Cookie: `session=${token}` },
    })
  ).json();
  if (sel.selectedAI !== "gpt-5.6-terra") {
    throw new Error(`Terra model not selected: ${sel.selectedAI}`);
  }

  const meta = {
    variant_label: VARIANT_LABEL,
    base: BASE,
    health,
    user_id: me.user?.id,
    points: me.user?.points,
    runs: RUNS,
    max_turns: MAX_TURNS,
    character_id: CHARACTER_ID,
    persona_id: PERSONA_ID,
    started_at: new Date().toISOString(),
  };
  save(OUT_ROOT, "env_meta.json", meta);
  save(ART_ROOT, "env_meta.json", meta);
  console.log("start", meta);

  const allRows: unknown[] = [];
  for (let run = START_RUN; run <= RUNS; run++) {
    const runDir = join(OUT_ROOT, `run${run}`);
    const artDir = join(ART_ROOT, `run${run}`);
    mkdirSync(runDir, { recursive: true });
    mkdirSync(artDir, { recursive: true });
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
        personaId: PERSONA_ID,
        turn,
        run,
      });
      if (turn === 1) {
        chatId = Number((resp.done as { chatId?: number } | null)?.chatId);
        if (!chatId && resp.provider_raw.trim().length === 0) {
          save(runDir, `turn${turn}-error.json`, resp);
          throw new Error(`run${run} turn1 failed: empty stream (${resp.error || resp.http_status})`);
        }
        if (!chatId) {
          save(runDir, `turn${turn}-error.json`, resp);
          throw new Error(`run${run} turn1 failed: missing chatId`);
        }
      }
      if (!resp.provider_raw.trim()) {
        save(runDir, `turn${turn}-error.json`, resp);
        throw new Error(`run${run} turn${turn} failed: empty provider_raw`);
      }
      const m = analyze(resp.provider_raw, turn);
      const api = {
        chatId,
        latency_s: resp.latency_s,
        http_status: resp.http_status,
        model: (resp.done as { usage?: { model?: string } } | null)?.usage?.model,
        provider: (resp.done as { usage?: { provider?: string } } | null)?.usage?.provider,
        reasoning_tokens:
          (resp.done as { usage?: { reasoningTokens?: number } } | null)?.usage
            ?.reasoningTokens ?? 0,
        output_tokens: (resp.done as { usage?: { output?: number } } | null)?.usage?.output,
        input_tokens: (resp.done as { usage?: { input?: number } } | null)?.usage?.input,
        finish_reason: (resp.done as { finishReason?: string } | null)?.finishReason,
        lengthRecoveryPasses:
          (resp.done as { usage?: { lengthRecoveryPasses?: number } } | null)?.usage
            ?.lengthRecoveryPasses ?? 0,
        retry_count: resp.statuses.filter((s) => /retry|재시도/i.test(s)).length,
        raw_equals_final: resp.provider_raw === resp.final_text,
        error: resp.error,
      };
      const payload = { ...m, api };
      save(runDir, `turn${turn}-provider-raw.txt`, resp.provider_raw);
      save(artDir, `turn${turn}-provider-raw.txt`, resp.provider_raw);
      save(runDir, `turn${turn}-final.txt`, resp.final_text);
      save(artDir, `turn${turn}-final.txt`, resp.final_text);
      save(runDir, `turn${turn}-metrics.json`, payload);
      save(artDir, `turn${turn}-metrics.json`, payload);
      runMetrics.push(payload);
      console.log("turn", {
        turn,
        len: m.canonical_length_ws,
        resume: m.resume_bundles_auto,
        npc: m.npc_subplot,
        trailing: m.trailing_reaction_points,
      });
    }

    save(
      runDir,
      "manual-dialogue-review.md",
      `# Run ${run} manual dialogue review\n\nVariant: ${VARIANT_LABEL}\nChat: ${chatId}\n\nRecord manual resume-bundle counts after reading RAW.\n`
    );
    allRows.push({ run, chatId, metrics: runMetrics });
    if (run < RUNS) await new Promise((r) => setTimeout(r, 3000));
  }

  save(OUT_ROOT, "all_runs.json", allRows);
  save(ART_ROOT, "all_runs.json", allRows);
  console.log("done", VARIANT_LABEL, "runs", allRows.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
