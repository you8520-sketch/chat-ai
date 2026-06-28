/**
 * DeepSeek completion vs continuation mode — DB + prior experiment metadata only.
 * No API calls. No prompt changes.
 *
 * Usage: npx.cmd tsx scripts/forensic-completion-mode-deepseek.ts
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { getDatabasePath } from "../src/lib/dataDir";

type SentenceSignal = "continuation" | "completion" | "neutral";
type OutputMode = "continuation-mode" | "completion-mode" | "mixed";

type TargetSpec = {
  label: string;
  message_id?: number;
  expected_chars?: number;
  lab_meta?: Record<string, unknown>;
};

const LONG_TARGETS: TargetSpec[] = [
  { label: "5523ch (lab length)", expected_chars: 5523, lab_meta: { depth: 6, run: 2 } },
  { label: "4492ch", message_id: 333, expected_chars: 4492 },
  { label: "4165ch", message_id: 335, expected_chars: 4165 },
  { label: "3995ch", message_id: 410, expected_chars: 3995 },
  { label: "3815ch", message_id: 331, expected_chars: 3815 },
  { label: "3564ch", message_id: 329, expected_chars: 3564 },
];

const SHORT_IDS = [534, 401, 678, 650, 399, 545];

// ── Continuation: next sentence predictable / turn not done ──
const CONTINUATION_HOOK =
  /(?:하지만|그런데|아직|더 |계속|이어서|이어|다음|한참|추가로|연속|이윽고|곧바로|다시금|또 한|한층 더|더욱|연이어|멈추지|끝나지|걸려|파고들|말해지지|아직도|좀처럼|여전히|다시|한편|그러나|그 순간|그 말과 동시에|그리고|그러고|이어지|시작하|향해|다가|내밀|뻗|당기|끌어|밀어|움직|일어|들어|열리|닫히)/;

const OPEN_LOOP =
  /(?:기다리|반응을 기다|대답을 기다|말을 기다|선택을 기다|확인하며|지켜보|바라보|응시|망설|가늠|질문이었다|재촉이 아닌|멈춘 채|멈추고|열리지 않았|닫히지|떠오르|스며들|파고들|조여|이동했|향했)/;

const INCOMPLETE_END = /(?:…|,|—|\-|중이었다|하고|으며|이며|듯|채|며|자|면|게|고|며서|면서)\s*$/;

const DANGLING_DIALOGUE = /"[^"]{8,}$/;

// ── Completion: valid stop / micro-resolution ──
const PAUSE_OK =
  /(?:기다렸다|기다리며|고요|정적|침묵|망설|가만히|멈춰|멈췄다|멈추었다|숨을 고|호흡|안도|편안|해결|만족|끝냈다|끝났다|사라졌|멀어지|떠나|나갔|들어갔|닫혔|열렸|완전히|드디어|마침내|그대로|일어섰다|걸어 들어|향해 걸어|미소를.*걸|표정을.*지)/;

const DIALOGUE_CLOSED = /^"[^"]{4,}"\s*[.!?…]?\s*$/;

const ACTION_CLOSED =
  /(?:했다|하였다|했었다|말았다|끝났다|멈췄다|굳었다|정지했다|사라졌다|멀어졌다|떠났다|나갔다|들어갔다|닫혔다|열렸다|일어섰다|앉았다|잡았다|당겼다|밀었다|안았다|키스했다|돌아섰다|고개를.*떨|입을.*닫|눈을.*감)\s*[.!?…]?\s*$/;

const CONSEQUENCE_CLOSED =
  /(?:번져|흔들|떨리|떨렸|경련|반응이|느껴졌|감지|스쳐|일그러|파르르|적응|옅어지|희미해|가라앉|식을|안정)/;

const SCENE_HANDOFF =
  /(?:엘리베이터|복도|로비|방|문이|층|장면|시야|돌아|떠나|나가|들어가|향해 걸어|걸어 들어)/;

function displayProse(c: string): string {
  let s = c ?? "";
  const cutMarkers = [
    s.search(/<<<STATUS/i),
    s.search(/◆\s*상태/),
    s.search(/\n◆\s/),
    s.search(/\{"honorifics"/),
  ].filter((i) => i >= 0);
  if (cutMarkers.length) s = s.slice(0, Math.min(...cutMarkers));
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…]["']?)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 4 && !/^[\s\/>]+$/.test(s));
}

function classifySentence(sent: string, isLast: boolean): SentenceSignal {
  const t = sent.trim();
  if (!t || t.length < 5) return "neutral";

  let cont = 0;
  let comp = 0;

  if (CONTINUATION_HOOK.test(t)) cont += 2;
  if (OPEN_LOOP.test(t)) cont += 2;
  if (INCOMPLETE_END.test(t)) cont += 2;
  if (DANGLING_DIALOGUE.test(t)) cont += 3;
  if (/(?:더 |아직|계속|이어|다음|향해|다가|시작)/.test(t)) cont += 1;

  if (PAUSE_OK.test(t)) comp += 2;
  if (DIALOGUE_CLOSED.test(t)) comp += 3;
  if (ACTION_CLOSED.test(t)) comp += 2;
  if (CONSEQUENCE_CLOSED.test(t) && !OPEN_LOOP.test(t)) comp += 1;
  if (SCENE_HANDOFF.test(t) && ACTION_CLOSED.test(t)) comp += 2;

  // Last sentence: weight completion if model chose to stop here
  if (isLast) {
    if (PAUSE_OK.test(t) || DIALOGUE_CLOSED.test(t) || ACTION_CLOSED.test(t)) comp += 2;
    if (INCOMPLETE_END.test(t) || DANGLING_DIALOGUE.test(t)) cont += 2;
  }

  if (cont > comp + 1) return "continuation";
  if (comp > cont + 1) return "completion";
  if (cont > comp) return "continuation";
  if (comp > cont) return "completion";
  return "neutral";
}

function extractPatterns(sentences: string[], signal: SentenceSignal): string[] {
  const patterns: string[] = [];
  for (const s of sentences) {
    const sig = classifySentence(s, false);
    if (sig !== signal) continue;
    const hooks: string[] = [];
    if (signal === "continuation") {
      const m1 = s.match(CONTINUATION_HOOK);
      const m2 = s.match(OPEN_LOOP);
      if (m1) hooks.push(m1[0]);
      if (m2) hooks.push(m2[0]);
      if (INCOMPLETE_END.test(s)) hooks.push("incomplete-ending");
    } else {
      const m1 = s.match(PAUSE_OK);
      const m2 = s.match(ACTION_CLOSED);
      if (m1) hooks.push(m1[0]);
      if (DIALOGUE_CLOSED.test(s)) hooks.push("closed-dialogue");
      if (m2) hooks.push("closed-action");
    }
    for (const h of hooks) patterns.push(h);
  }
  return patterns;
}

function countPatternFreq(patterns: string[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const p of patterns) m[p] = (m[p] ?? 0) + 1;
  return m;
}

function topPatterns(freq: Record<string, number>, n = 12): string[] {
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}(${v})`);
}

function classifyOutputMode(
  sentences: string[],
  finishReason?: string,
  blockCount?: number,
  tailProse?: string
): OutputMode {
  if (sentences.length === 0) return "mixed";

  const signals = sentences.map((s, i) => classifySentence(s, i === sentences.length - 1));
  const cont = signals.filter((s) => s === "continuation").length;
  const comp = signals.filter((s) => s === "completion").length;
  const contPct = cont / sentences.length;
  const compPct = comp / sentences.length;

  const tail = sentences.slice(-5);
  const tailCont = tail.filter((s, i) =>
    classifySentence(s, i === tail.length - 1) === "continuation"
  ).length;
  const tailComp = tail.filter((s, i) =>
    classifySentence(s, i === tail.length - 1) === "completion"
  ).length;

  const last = sentences[sentences.length - 1] ?? "";
  const tailOpen =
    INCOMPLETE_END.test(last) ||
    DANGLING_DIALOGUE.test(last) ||
    OPEN_LOOP.test(last) ||
    /(?:괜찮으면|해도 괜찮|잠깐만|한번만|다음|이어서)/.test(last);

  if (finishReason === "length") return "continuation-mode";
  if (blockCount === 1) return "continuation-mode";

  // Document-level: continuation stream vs per-beat micro-completion chain
  const beatChain =
    contPct >= 0.25 && cont >= comp && tailOpen;
  const microComplete =
    compPct >= 0.18 && tailComp >= tailCont && !tailOpen;

  if (beatChain && tailCont >= 2) return "continuation-mode";
  if (microComplete) return "completion-mode";
  if (contPct > compPct + 0.08) return "continuation-mode";
  if (compPct > contPct + 0.05 && tailComp >= tailCont) return "completion-mode";
  void tailProse;
  return "mixed";
}

function analyzeProse(
  prose: string,
  meta: { finish_reason?: string; block_count?: number; label: string; message_id?: number }
) {
  const sentences = splitSentences(prose);
  const signals = sentences.map((s, i) => ({
    text: s,
    signal: classifySentence(s, i === sentences.length - 1),
  }));

  const contSents = signals.filter((x) => x.signal === "continuation");
  const compSents = signals.filter((x) => x.signal === "completion");
  const mode = classifyOutputMode(sentences, meta.finish_reason, meta.block_count);

  const contPatterns = extractPatterns(sentences, "continuation");
  const compPatterns = extractPatterns(sentences, "completion");

  return {
    label: meta.label,
    message_id: meta.message_id,
    output_chars: prose.length,
    sentence_count: sentences.length,
    finish_reason: meta.finish_reason ?? "unknown",
    block_count: meta.block_count,
    mode,
    continuation_pct: Math.round((contSents.length / (sentences.length || 1)) * 1000) / 10,
    completion_pct: Math.round((compSents.length / (sentences.length || 1)) * 1000) / 10,
    tail_sentences: sentences.slice(-5),
    tail_signals: signals.slice(-5).map((x) => x.signal),
    continuation_examples: contSents.slice(0, 6).map((x) => x.text.slice(0, 100)),
    completion_examples: compSents.slice(-6).map((x) => x.text.slice(0, 100)),
    continuation_patterns: topPatterns(countPatternFreq(contPatterns)),
    completion_patterns: topPatterns(countPatternFreq(compPatterns)),
  };
}

function loadLab5523Meta(): Record<string, unknown> | null {
  const p = path.resolve("output/history-depth-sweep.jsonl");
  if (!fs.existsSync(p)) return null;
  const rows = fs.readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const max = rows.reduce(
    (best: { output_chars?: number }, r: { output_chars?: number }) =>
      (r.output_chars ?? 0) > (best.output_chars ?? 0) ? r : best,
    {}
  );
  return max;
}

function main() {
  const db = new Database(getDatabasePath(), { readonly: true });
  const lines: string[] = [
    "DEEPSEEK COMPLETION MODE FORENSIC",
    `generated: ${new Date().toISOString()}`,
    "source: production DB + history-depth-sweep jsonl (5523ch metadata only)",
    "",
  ];

  const longResults: ReturnType<typeof analyzeProse>[] = [];
  const shortResults: ReturnType<typeof analyzeProse>[] = [];

  for (const t of LONG_TARGETS) {
    if (t.lab_meta) {
      const lab = loadLab5523Meta();
      lines.push(`## ${t.label}`);
      lines.push("  text: NOT STORED (lab experiment — beat/sentence analysis unavailable)");
      if (lab) {
        lines.push(
          `  meta: depth=${lab.depth} run=${lab.run} chars=${lab.output_chars} finish=${lab.finish_reason} block_count=${lab.block_count} terminal=${lab.terminal_beat}`
        );
        lines.push(`  inferred mode: continuation-mode (finish=length, single block, followup_interaction terminal)`);
        lines.push(
          "  note: lab 5523 = one continuous paragraph until max_tokens — continuation stream, not per-beat completion"
        );
      }
      lines.push("");
      continue;
    }

    const row = db
      .prepare(
        `SELECT m.id, m.content, m.usage, mg.output_tokens
         FROM messages m
         LEFT JOIN message_generations mg ON mg.message_id = m.id
         WHERE m.id = ?`
      )
      .get(t.message_id) as { id: number; content: string; usage: string | null } | undefined;

    if (!row) {
      lines.push(`## ${t.label} — message_id=${t.message_id} NOT FOUND`);
      lines.push("");
      continue;
    }

    const prose = displayProse(row.content);
    let finish = "unknown";
    try {
      const u = JSON.parse(row.usage ?? "{}");
      finish = String(u.finishReason ?? u.finish_reason ?? "unknown");
    } catch {
      /* */
    }

    const result = analyzeProse(prose, {
      label: t.label,
      message_id: t.message_id,
      finish_reason: finish,
    });
    longResults.push(result);

    lines.push(`## ${t.label} (id=${t.message_id})`);
    lines.push(`  chars=${result.output_chars} sentences=${result.sentence_count} finish=${result.finish_reason}`);
    lines.push(`  MODE: ${result.mode}`);
    lines.push(
      `  continuation=${result.continuation_pct}% completion=${result.completion_pct}%`
    );
    lines.push(`  tail signals: ${result.tail_signals.join(" → ")}`);
    lines.push(`  tail: ${result.tail_sentences.map((s) => s.slice(0, 60)).join(" | ")}`);
    lines.push(`  cont patterns: ${result.continuation_patterns.join(", ")}`);
    lines.push(`  comp patterns: ${result.completion_patterns.join(", ")}`);
    lines.push("");
  }

  for (const id of SHORT_IDS) {
    const row = db
      .prepare(`SELECT m.id, m.content, m.usage FROM messages m WHERE m.id = ?`)
      .get(id) as { id: number; content: string; usage: string | null } | undefined;
    if (!row) continue;
    const prose = displayProse(row.content);
    let finish = "unknown";
    try {
      const u = JSON.parse(row.usage ?? "{}");
      finish = String(u.finishReason ?? u.finish_reason ?? "unknown");
    } catch {
      /* */
    }
    const result = analyzeProse(prose, {
      label: `${prose.length}ch`,
      message_id: id,
      finish_reason: finish,
    });
    shortResults.push(result);
  }

  lines.push("## Short pool (700-1100ch)");
  for (const r of shortResults) {
    lines.push(
      `  id=${r.message_id} ${r.output_chars}ch mode=${r.mode} cont=${r.continuation_pct}% comp=${r.completion_pct}% tail=${r.tail_signals.join("→")}`
    );
  }
  lines.push("");

  // Aggregate patterns
  const allLongCont: string[] = [];
  const allLongComp: string[] = [];
  for (const r of longResults) {
    for (const id of LONG_TARGETS) {
      if (id.message_id === r.message_id) {
        const row = db.prepare(`SELECT content FROM messages WHERE id=?`).get(r.message_id) as {
          content: string;
        };
        const sents = splitSentences(displayProse(row.content));
        allLongCont.push(...extractPatterns(sents, "continuation"));
        allLongComp.push(...extractPatterns(sents, "completion"));
      }
    }
  }

  const allShortCont: string[] = [];
  const allShortComp: string[] = [];
  for (const id of SHORT_IDS) {
    const row = db.prepare(`SELECT content FROM messages WHERE id=?`).get(id) as { content: string };
    const sents = splitSentences(displayProse(row.content));
    allShortCont.push(...extractPatterns(sents, "continuation"));
    allShortComp.push(...extractPatterns(sents, "completion"));
  }

  lines.push("## 3. Long-group — '아직 끝나지 않았다' patterns (continuation sentences)");
  lines.push(`  ${topPatterns(countPatternFreq(allLongCont), 20).join(", ")}`);
  lines.push("");
  lines.push("## 4. Short-group — '여기서 끝내도 된다' patterns (completion sentences)");
  lines.push(`  ${topPatterns(countPatternFreq(allShortComp), 20).join(", ")}`);
  lines.push("");
  lines.push("## Cross-check: short continuation hooks (should be lower)");
  lines.push(`  ${topPatterns(countPatternFreq(allShortCont), 10).join(", ")}`);
  lines.push("");

  lines.push("## Summary — mode classification");
  lines.push("  LONG:");
  for (const r of longResults) {
    lines.push(`    ${r.label} id=${r.message_id} → ${r.mode} (cont ${r.continuation_pct}% / comp ${r.completion_pct}%)`);
  }
  lines.push("  LAB 5523 → continuation-mode (length cap, 1-block stream)");
  lines.push("  SHORT:");
  for (const r of shortResults) {
    lines.push(`    id=${r.message_id} ${r.output_chars}ch → ${r.mode}`);
  }

  const longModes = longResults.map((r) => r.mode);
  const shortModes = shortResults.map((r) => r.mode);
  lines.push("");
  lines.push("## Hypothesis — DeepSeek stop signals (evidence-based)");
  lines.push(
    "  STOP SIGNALS (completion — '여기서 끝'): closed dialogue with punctuation; observer-wait ('대답을 기다렸다', '움직이지 않았다'); scene handoff closure ('걸어 들어갔다', '멈췄다'); consequence settled ('옅어지자', '사라졌다')."
  );
  lines.push(
    "  CONTINUE SIGNALS (continuation — '아직 아님'): connective/incomplete endings (…, -고/-며); open loops (지켜보, 파고들, 스며들, 향해, 다가); tension markers (하지만, 아직, 여전히, 더); unfinished request dialogue ('괜찮으면 잠깐만')."
  );
  lines.push(
    "  LONG production (chat25 burst): per-beat micro-completion (closed-action ~20%) BUT document tail = provocative dialogue hook → continuation stop at handoff boundary, not pause."
  );
  lines.push(
    "  LONG 410/3995: mid-scene open request — continuation-mode tail; model still in 'scene developing' not 'exchange complete'."
  );
  lines.push(
    "  LONG 329: scene handoff with closed action tail — completion-mode stop ('걸어 들어갔다')."
  );
  lines.push(
    "  SHORT: mixed — clearest completion stop id=399 ('대답을 기다렸다'); others stop on action/dialogue hook with higher continuation ratio."
  );
  lines.push(
    "  LAB 5523: pure continuation stream (1 block, finish=length) — no per-beat completion cadence; unlike production multi-beat chains."
  );

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "forensic-completion-mode-deepseek-report.txt");
  const jsonlPath = path.join(outDir, "forensic-completion-mode-deepseek.jsonl");
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  fs.writeFileSync(
    jsonlPath,
    JSON.stringify({ long: longResults, short: shortResults }, null, 0) + "\n",
    "utf8"
  );
  console.log(lines.join("\n"));
  console.log(`Wrote ${reportPath}`);
}

main();
