/**
 * Main-home canary: greeting_neutral_relationship_axis × temperature batches.
 * 3 independent chats × Turn1→Turn2 per temperature label.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.PROD_BASE ?? "https://chat-ai-production-3e84.up.railway.app";
const COOKIE_FILE = process.env.PROD_COOKIE_FILE ?? "/tmp/terra_smoke_cookies.txt";
const TEMP_LABEL = process.env.TEMP_LABEL ?? "t07";
const EXPECTED_TEMP = Number(process.env.EXPECTED_TEMP ?? "0.7");
const RUNS = Number(process.env.RUNS ?? "3");
const OUT_ROOT = process.env.OUT_DIR ?? `output/terra-axis-temp/${TEMP_LABEL}`;
const ART_ROOT = process.env.ART_DIR ?? `/opt/cursor/artifacts/terra-axis-temp/${TEMP_LABEL}`;
const CHARACTER_ID = 18;
const PERSONA_ID = Number(process.env.PERSONA_ID ?? "60");
const TURN1 = "나는 렌이라고 부르면 돼....나는 본기억이 안나는데....나 알아?(갸웃)";
const TURN2 = "같이갈래?*두리번 거리면서 다가오는 사람들을 보다가 다시 라이크를 쳐다본다*";

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
}) {
  const started = Date.now();
  const body: Record<string, unknown> = {
    characterId: opts.characterId,
    message: opts.message,
    selectedPersonaId: opts.personaId,
    selectedAI: "gpt-5.6-terra",
    isAdultMode: false,
    isNsfwMode: false,
    clientRequestId: `axis_${TEMP_LABEL}_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 6)}`,
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
      done: null,
      statuses: [] as string[],
      error: (await res.text()).slice(0, 2000),
      events: [] as any[],
    };
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const dec = new TextDecoder();
  let buf = "";
  let provider_raw = "";
  let done: any = null;
  const statuses: string[] = [];
  const events: any[] = [];
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
      let ev: any;
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      events.push(ev);
      if (ev.type === "status" && typeof ev.message === "string") statuses.push(ev.message);
      if (ev.type === "delta" && typeof ev.text === "string") provider_raw += ev.text;
      if (ev.type === "replace" && typeof ev.text === "string") provider_raw = ev.text;
      if (ev.type === "done") done = ev;
      if (ev.type === "error") error = ev.message || JSON.stringify(ev);
    }
  }
  return {
    http_status: res.status,
    latency_s: (Date.now() - started) / 1000,
    provider_raw,
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

function analyze(text: string) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const quotes = dialogueBlocks(text);
  const dialogueChars = quotes.reduce((a, b) => a + b.length, 0);
  const canon = text.length;
  const noWs = text.replace(/\s/g, "").length;
  const narrationChars = Math.max(0, canon - dialogueChars);

  // quote-only islands / resume
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
  const resume = Math.max(0, islands - 1);

  // numbered quotes with merge candidates
  const numbered = quotes.map((q, i) => ({ i: i + 1, q, len: q.length }));
  const short10 = quotes.filter((q) => q.length <= 10).length;

  // external staff quotes (attribution)
  const staff: string[] = [];
  const staffAttr =
    /(직원|스태프|간호사|의사|안내원|담당자|의료진|회색\s*셔츠|접수\s*담당)/;
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
    /(등록|접수|문진|차트|진료|환자|신원|바이탈|서류|보호\s*대상|대기실)/.test(p)
  );
  const trailing = /([?？]|어때|할래|갈래|뭐\s*해|봐|여기|따라와|같이\s*가|골라|선택|믿어도)/.test(
    text.slice(-280)
  )
    ? 1
    : 0;

  // relationship change observable?
  const relationChange =
    /(이름.*(외웠|기억)|거리|다가|손|같이\s*가|알아|처음\s*보|라이크|태형).{0,40}(달라|바뀌|정해|골랐|믿|함께)/.test(
      text
    ) ||
    /(렌|라이크|태형).{0,80}(거리|손|같이|안내|곁)/.test(text);

  // NPC subplot definition
  const externalSpeakers = staff.length > 0 ? 1 : 0;
  const adminStreak = (() => {
    let max = 0;
    let cur = 0;
    for (const p of paras) {
      if (/(등록|접수|문진|차트|진료|신원|바이탈|서류|보호\s*대상|대기실)/.test(p)) {
        cur += 1;
        max = Math.max(max, cur);
      } else cur = 0;
    }
    return max;
  })();
  const externalDecidesNext =
    staff.length >= 2 &&
    /(등록\s*대기|확인실|담당자|지원국|접수실)/.test(text) &&
    !/(식당|밥|바람\s*쐬)/.test(text.slice(-400));
  const npcSubplot =
    staff.length >= 2 || adminStreak >= 2 || externalDecidesNext;

  return {
    canonical_length: canon,
    no_ws_len: noWs,
    narration_chars: narrationChars,
    narration_ratio_pct: canon ? Math.round((narrationChars / canon) * 1000) / 10 : 0,
    dialogue_chars: dialogueChars,
    dialogue_ratio_pct: canon ? Math.round((dialogueChars / canon) * 1000) / 10 : 0,
    paragraph_count: paras.length,
    dialogue_paragraph_count: paras.filter((p) => /[“"]/.test(p)).length,
    dialogue_paragraph_ratio_pct:
      paras.length === 0
        ? 0
        : Math.round(
            (paras.filter((p) => /[“"]/.test(p)).length / paras.length) * 1000
          ) / 10,
    like_or_primary_dialogue_blocks: Math.max(0, quotes.length - staff.length),
    external_speaker_count: externalSpeakers,
    external_dialogue_blocks: staff.length,
    admin_register_paragraphs: adminParas.length,
    resume_bundles: resume,
    quote_only_islands: islands,
    avg_dialogue_block_len:
      quotes.length === 0 ? 0 : Math.round((dialogueChars / quotes.length) * 10) / 10,
    short_dialogue_le_10: short10,
    trailing_reaction_points: trailing,
    relationship_change_observable: relationChange,
    npc_subplot: npcSubplot,
    admin_streak: adminStreak,
    numbered_quotes: numbered,
    staff_quotes: staff,
    quotes,
  };
}

function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  const data = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  writeFileSync(join(dir, name), data, "utf8");
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(ART_ROOT, { recursive: true });
  const token = loadSessionCookie();
  const health = await (await fetch(`${BASE}/api/health`)).json();
  const me = await (
    await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: `session=${token}` } })
  ).json();
  await fetch(`${BASE}/api/user/selected-ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `session=${token}` },
    body: JSON.stringify({ selectedAI: "gpt-5.6-terra" }),
  });

  const meta = {
    temp_label: TEMP_LABEL,
    expected_temp: EXPECTED_TEMP,
    health,
    user: { id: me.user?.id, points: me.user?.points },
    runs: RUNS,
  };
  save(OUT_ROOT, "env_meta.json", meta);
  save(ART_ROOT, "env_meta.json", meta);
  console.log("start", meta);

  const rows: any[] = [];
  for (let i = 1; i <= RUNS; i++) {
    const runDir = join(OUT_ROOT, `run${i}`);
    const artDir = join(ART_ROOT, `run${i}`);
    mkdirSync(runDir, { recursive: true });
    mkdirSync(artDir, { recursive: true });
    console.log(`\n=== ${TEMP_LABEL} run ${i}/${RUNS} turn1 ===`);
    const t1 = await postChat({
      token,
      characterId: CHARACTER_ID,
      message: TURN1,
      personaId: PERSONA_ID,
    });
    const chatId = t1.done?.chatId;
    if (!chatId) {
      save(runDir, "turn1-error.json", t1);
      save(artDir, "turn1-error.json", t1);
      throw new Error(`run${i} turn1 failed: ${t1.error || t1.http_status}`);
    }
    const m1 = analyze(t1.provider_raw);
    save(runDir, "turn1_raw.txt", t1.provider_raw);
    save(artDir, "turn1_raw.txt", t1.provider_raw);
    save(runDir, "turn1_metrics.json", {
      ...m1,
      api: {
        chatId,
        latency_s: t1.latency_s,
        model: t1.done?.usage?.model,
        provider: t1.done?.usage?.provider,
        reasoning_tokens: t1.done?.usage?.reasoningTokens ?? 0,
        output_tokens: t1.done?.usage?.output,
        input_tokens: t1.done?.usage?.input,
        lengthRecoveryPasses: t1.done?.usage?.lengthRecoveryPasses ?? 0,
        statuses: t1.statuses,
        error: t1.error,
      },
    });
    save(artDir, "turn1_metrics.json", {
      ...m1,
      api: {
        chatId,
        latency_s: t1.latency_s,
        model: t1.done?.usage?.model,
        provider: t1.done?.usage?.provider,
        reasoning_tokens: t1.done?.usage?.reasoningTokens ?? 0,
        output_tokens: t1.done?.usage?.output,
        input_tokens: t1.done?.usage?.input,
        lengthRecoveryPasses: t1.done?.usage?.lengthRecoveryPasses ?? 0,
        statuses: t1.statuses,
        error: t1.error,
      },
    });
    console.log("t1", {
      chatId,
      len: m1.canonical_length,
      staff: m1.external_dialogue_blocks,
      npc: m1.npc_subplot,
      resume: m1.resume_bundles,
    });

    console.log(`=== ${TEMP_LABEL} run ${i}/${RUNS} turn2 ===`);
    const t2 = await postChat({
      token,
      characterId: CHARACTER_ID,
      chatId,
      message: TURN2,
      personaId: PERSONA_ID,
    });
    const m2 = analyze(t2.provider_raw);
    save(runDir, "turn2_raw.txt", t2.provider_raw);
    save(artDir, "turn2_raw.txt", t2.provider_raw);
    save(runDir, "turn2_metrics.json", {
      ...m2,
      api: {
        chatId,
        latency_s: t2.latency_s,
        model: t2.done?.usage?.model,
        provider: t2.done?.usage?.provider,
        reasoning_tokens: t2.done?.usage?.reasoningTokens ?? 0,
        output_tokens: t2.done?.usage?.output,
        input_tokens: t2.done?.usage?.input,
        lengthRecoveryPasses: t2.done?.usage?.lengthRecoveryPasses ?? 0,
        statuses: t2.statuses,
        error: t2.error,
      },
    });
    save(artDir, "turn2_metrics.json", {
      ...m2,
      api: {
        chatId,
        latency_s: t2.latency_s,
        model: t2.done?.usage?.model,
        provider: t2.done?.usage?.provider,
        reasoning_tokens: t2.done?.usage?.reasoningTokens ?? 0,
        output_tokens: t2.done?.usage?.output,
        input_tokens: t2.done?.usage?.input,
        lengthRecoveryPasses: t2.done?.usage?.lengthRecoveryPasses ?? 0,
        statuses: t2.statuses,
        error: t2.error,
      },
    });
    console.log("t2", {
      len: m2.canonical_length,
      staff: m2.external_dialogue_blocks,
      npc: m2.npc_subplot,
      resume: m2.resume_bundles,
    });

    rows.push({
      run: i,
      chatId,
      t1: m1,
      t2: m2,
      t1_api: {
        latency_s: t1.latency_s,
        output_tokens: t1.done?.usage?.output,
        reasoning_tokens: t1.done?.usage?.reasoningTokens ?? 0,
      },
      t2_api: {
        latency_s: t2.latency_s,
        output_tokens: t2.done?.usage?.output,
        reasoning_tokens: t2.done?.usage?.reasoningTokens ?? 0,
      },
    });
  }

  save(OUT_ROOT, "all_runs.json", rows);
  save(ART_ROOT, "all_runs.json", rows);
  console.log("done", TEMP_LABEL, "runs", rows.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
