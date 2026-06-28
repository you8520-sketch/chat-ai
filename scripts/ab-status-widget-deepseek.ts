/**
 * DeepSeek HTML Status Widget Impact A/B — Phase2 baseline, no mandate, no length/prompt/runtime changes.
 *
 * Purpose: Isolate whether bare sw-hud HTML present in context (history or current turn)
 * affects DeepSeek's output length, exchange count, goal-like activation (proxies), and stop decision.
 *
 * Constraints observed:
 * - DEEPSEEK_CONTINUATION_MANDATE must be OFF
 * - No edits to LENGTH CONTROL, Phase2/3 blocks, few-shot, character prompt, or core runtime
 * - Only the test script varies widget-related *input* (history content, widget instruction presence via existing flags)
 *
 * 7 tests, each A/B on identical fixture/history/seed-attempt/temp/runtime except the widget variable.
 *
 * Usage:
 *   npx.cmd tsx scripts/ab-status-widget-deepseek.ts --help
 *   npx.cmd tsx scripts/ab-status-widget-deepseek.ts --tests=1,2,3 --runs=2
 *
 * Output:
 *   output/status-widget-deepseek-impact.jsonl
 *   output/status-widget-deepseek-impact-report.txt
 */

import fs from "fs";
import path from "path";
import Module from "module";
import { loadEnvLocal } from "./load-env-local";

const origLoad = Module._load;
// @ts-expect-error legacy hook
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  // @ts-expect-error legacy
  return origLoad(request, parent, isMain);
};

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

// === FORCE BASELINE: no continuation mandate ===
delete process.env.DEEPSEEK_CONTINUATION_MANDATE;

const MODEL_ID = "deepseek/deepseek-v4-pro";
const TARGET_CHARS = 3300;
const FLOOR = 2200;
const DELAY_MS = 4500;
const MAX_ATTEMPTS = 4;
const DEFAULT_RUNS = 2;

type Arm = "A" | "B";
type TestId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface Sample {
  test: number;
  arm: Arm; // A=with-html-or-variant, B=stripped-or-control
  run: number;
  chars: number;
  finishReason: string;
  beatCount: number;
  dialogueCount: number;
  terminal: string;
  hasObserverWait: boolean;
  protectFirstIdx: number | null;
  nsfwFirstIdx: number | null;
  priorityProtectBeforeNsfw: boolean | null;
  specialValueHits: string[]; // for test 1: 99999, Crying, 70 etc.
  excerptHead: string;
  excerptTail: string;
  note?: string;
}

const SCENARIO_BASE = {
  charName: "백하율",
  persona: "렌",
  userMessage: "정말 고장났나봐.... 나랑 떨어져야되는거아니야??",
  // Base clean prose (no widget html). This is what would be in history after sanitize in normal path.
  baseAssistant: `"가이드님. 지금 저랑 떨어져야 된다고 말씀하실 건가요?"

렌의 연두색 눈동자가 흔들렸다. 백하율은 그 흔들림을 놓치지 않고 황금빛 동공을 가늘게 떴다.

백하율은 한 걸음 더 가까이 들어와 렌의 손목을 엘리베이터 벽 쪽으로 더 세게 밀었다.`,
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function displayProse(c: string): string {
  let s = c ?? "";
  const i = s.search(/<<<STATUS/i);
  if (i >= 0) s = s.slice(0, i);
  const j = s.search(/sw-hud/i);
  if (j >= 0) {
    const divStart = s.lastIndexOf("<div", j);
    if (divStart >= 0) s = s.slice(0, divStart).trimEnd();
  }
  // also strip any trailing plain status block if present
  s = s.replace(/\n*(?:STATUS|HP|Emotion|속마음)\s*[:：].*$/is, "").trim();
  return s.trim();
}

function countDialogues(prose: string): number {
  const matches = prose.match(/"[^"]{2,}"/g);
  return matches ? matches.length : 0;
}

function classifyTerminal(block: string): string {
  const t = block.trim();
  if (!t) return "other";
  if (/[,…]\s*$/.test(t) || /(?:하지만|그런데|아직|더 |이어서|곧|멈추지|끝나지|걸려|파고들)/.test(t.slice(-80)))
    return "tension_continuation";
  if (/(?:기다리|지켜보|바라보|응시|말없이|고요히|가만히|멈춰|반응을 기다)/.test(t)) return "observer_wait_ending";
  if (/"[^"]{4,}"\s*[.!?…]?\s*$/.test(t)) return "dialogue_resolution";
  if (/(?:눈동자|시선|표정|입꼬리|미소|흔들|떨|긴장|동공|손목|숨)/.test(t)) return "immediate_reaction";
  if (/(?:문이|문을|열리|닫히|나갔|들어|이동|복도|엘리베이터)/.test(t)) return "scene_state_transition";
  if (/(?:공기가|분위기|온도|밀폐|주변|철 상자)/.test(t) && !/"[^"]{4,}"\s*[.!?…]?\s*$/.test(t))
    return "atmosphere_block";
  return "other";
}

function analyzeStop(prose: string) {
  const paragraphs = prose.trim().split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const terminal = paragraphs.length ? classifyTerminal(paragraphs[paragraphs.length - 1]) : "other";
  const hasObserver = terminal === "observer_wait_ending" || /기다리|반응을 기다|지켜보|바라보/.test(prose.slice(-300));
  return { beatCount: paragraphs.length, terminal, hasObserver };
}

const PROTECT_RE = /(?:위험|보호|가리|막아|숨|안전|경보|피해|다치|쓰러|공격|방어|가로막|받아|막서|막고)/i;
const NSFW_RE = /(?:입술|키스|안아|허리|가슴|몸|더 가까|뜨거|숨결|밀착|손끝|스킨|속삭|끌어당|욕망|파고|원해|벗|스치)/i;

function priorityCheck(prose: string) {
  const p = prose.search(PROTECT_RE);
  const n = prose.search(NSFW_RE);
  const protectIdx = p >= 0 ? p : null;
  const nsfwIdx = n >= 0 ? n : null;
  let priorityProtectBeforeNsfw: boolean | null = null;
  if (protectIdx != null && nsfwIdx != null) priorityProtectBeforeNsfw = protectIdx <= nsfwIdx;
  else if (protectIdx != null) priorityProtectBeforeNsfw = true;
  else if (nsfwIdx != null) priorityProtectBeforeNsfw = false;
  return { protectFirstIdx: protectIdx, nsfwFirstIdx: nsfwIdx, priorityProtectBeforeNsfw };
}

function findSpecialValueHits(prose: string): string[] {
  const hits: string[] = [];
  if (/99999/.test(prose)) hits.push("99999");
  if (/Crying|울고|눈물|울음/.test(prose)) hits.push("Crying");
  if (/\b70\b/.test(prose)) hits.push("70");
  if (/Emotion|감정|상태/.test(prose) && /Crying|울/.test(prose)) hits.push("emotion-ref");
  return hits;
}

function makeSwHudHtml(hp: string, emotion: string, extra?: string): string {
  // Minimal recognizable sw-hud style block (bare, not in ```html to match historical leakage cases)
  return `<div class="sw-hud" style="font-size:12px;border:1px solid #222;padding:8px;margin-top:8px;background:#111;color:#ddd;">
HP=${hp} Emotion=${emotion}${extra ? " " + extra : ""}
</div>`;
}

function makePlainTextStatus(hp: string, emotion: string): string {
  return `STATUS\nHP: ${hp}\nEmotion: ${emotion}\nRelationship: —`;
}

function buildBaseHistory(): Array<{ role: "user" | "assistant"; content: string }> {
  return [
    { role: "user", content: "자동진행" },
    { role: "assistant", content: SCENARIO_BASE.baseAssistant },
    { role: "user", content: SCENARIO_BASE.userMessage },
  ];
}

// For tests we often need the "previous assistant" to be the one carrying widget state.
function withWidgetHistory(
  base: Array<{ role: "user" | "assistant"; content: string }>,
  widgetHtml: string,
  mode: "append" | "prepend" = "append"
): Array<{ role: "user" | "assistant"; content: string }> {
  const h = [...base];
  // Find last assistant before current user
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].role === "assistant") {
      const prose = h[i].content.trim();
      const combined = mode === "append" ? `${prose}\n\n${widgetHtml}` : `${widgetHtml}\n\n${prose}`;
      h[i] = { ...h[i], content: combined };
      break;
    }
  }
  return h;
}

function withoutWidgetHistory(
  base: Array<{ role: "user" | "assistant"; content: string }>
): Array<{ role: "user" | "assistant"; content: string }> {
  return base.map((m) => {
    if (m.role !== "assistant") return m;
    let c = m.content;
    // strip any sw-hud like blocks
    c = c.replace(/\n*<div[^>]*class=["']?sw-hud[\s\S]*?<\/div>\s*$/i, "").trim();
    // also strip plain status tail if present
    c = c.replace(/\n*STATUS[\s\S]*$/i, "").trim();
    return { ...m, content: c };
  });
}

async function buildSystemAndHistoryForTest(
  test: TestId,
  arm: Arm,
  baseHistory: Array<{ role: "user" | "assistant"; content: string }>
) {
  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");

  // Default: widget instruction OFF for pure "HTML in history" isolation in most tests.
  // TEST 7 will toggle it.
  let statusWidgetActive = false;
  let widgetPromptBlock = "";

  let history = [...baseHistory];
  let note = "";

  const hpConflict = "99999";
  const emotionConflict = "Crying";
  const hpNormal = "70";

  if (test === 1) {
    // Conflicting values: prose has low HP implication, HTML has 99999 + Crying
    const prosePart = SCENARIO_BASE.baseAssistant;
    const htmlPart = makeSwHudHtml(hpConflict, emotionConflict);
    const combined = `${prosePart}\n\n${htmlPart}`;
    // Replace the last assistant (the one before current user) with conflicting
    history = history.map((m, idx) => {
      if (m.role === "assistant" && idx === history.length - 2) {
        return { ...m, content: combined };
      }
      return m;
    });
    note = "TEST1: prose implies ~70 / tired; HTML says HP=99999 Emotion=Crying";
  }

  if (test === 2) {
    // HTML removal: A has sw-hud in history, B does not
    const html = makeSwHudHtml("1420", "Tense");
    if (arm === "A") {
      history = withWidgetHistory(history, html, "append");
      note = "A: bare sw-hud HTML present in prev assistant";
    } else {
      history = withoutWidgetHistory(history);
      note = "B: sw-hud stripped (prose identical)";
    }
  }

  if (test === 3) {
    // HTML vs Plain text representation of same values
    const html = makeSwHudHtml("880", "Anxious");
    const plain = makePlainTextStatus("880", "Anxious");
    if (arm === "A") {
      history = withWidgetHistory(history, html, "append");
      note = "A: sw-hud HTML form";
    } else {
      history = withWidgetHistory(history, plain, "append");
      note = "B: plain text STATUS block (no tags)";
    }
  }

  if (test === 4) {
    // Structure present, info ~0
    const blankHtml = makeSwHudHtml("-", "-");
    if (arm === "A") {
      history = withWidgetHistory(history, blankHtml, "append");
      note = "A: sw-hud HTML skeleton with '-' values";
    } else {
      history = withoutWidgetHistory(history);
      note = "B: no status at all";
    }
  }

  if (test === 5) {
    // Position inside the assistant content: append (RP then widget) vs prepend (widget then RP)
    const html = makeSwHudHtml("650", "Guarded");
    if (arm === "A") {
      history = withWidgetHistory(history, html, "append"); // RP \n\n HTML
      note = "A: RP then status (append)";
    } else {
      history = withWidgetHistory(history, html, "prepend"); // HTML \n\n RP
      note = "B: status then RP (prepend)";
    }
  }

  if (test === 6) {
    // History accumulation vs "current turn only"
    // For A: put widget HTML in the *previous* assistant (accumulated)
    // For B: strip from history, but inject a "current-turn only" style at the *last user* content (like a reminder)
    const html = makeSwHudHtml("910", "Wary");
    if (arm === "A") {
      history = withWidgetHistory(history, html, "append");
      note = "A: widget HTML in prior assistant (accumulated in history)";
    } else {
      history = withoutWidgetHistory(history);
      // Inject into the last user message only (current turn)
      const lastIdx = history.length - 1;
      if (history[lastIdx].role === "user") {
        history[lastIdx] = {
          ...history[lastIdx],
          content: `${history[lastIdx].content}\n\n[Current status snapshot]\nHP=910 Emotion=Wary`,
        };
      }
      note = "B: widget info only in current user turn (no prior history accumulation)";
    }
  }

  if (test === 7) {
    // Widget generation responsibility
    // A: statusWidgetActive=true → model instructed to emit values (DeepSeek participates)
    // B: statusWidgetActive=false → model does RP only (simulate Flash owns widget entirely)
    if (arm === "A") {
      statusWidgetActive = true;
      // Provide a minimal widget prompt block (existing mechanism)
      widgetPromptBlock = [
        "[STATUS WIDGET — values only, NO HTML]",
        "After RP, append <<<STATUS_VALUES char>>> JSON with: 시간, 장소, 속마음, 현재상황.",
        "Use — for unknown. Do not put HTML or markdown tables in prose.",
      ].join("\n");
      note = "A: widget instruction ON (DeepSeek emits values + RP)";
    } else {
      statusWidgetActive = false;
      widgetPromptBlock = "";
      note = "B: widget instruction OFF (DeepSeek RP only; Flash would own widget)";
    }
    // Also ensure history has no leaking HTML for both arms to isolate the instruction effect
    history = withoutWidgetHistory(history);
  }

  const chunks = parseCharacterSetting({
    characterId: "bc-widget-impact",
    characterName: SCENARIO_BASE.charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 집요하며 상황 판단이 빠르다.`,
    world: `# 세계관\n현대. 밀폐된 공간에서 긴장이 고조된다.`,
    exampleDialog: `유저: hi\n${SCENARIO_BASE.charName}: …`,
    statusWindowPrompt: "",
  });

  const built = buildContext({
    charName: SCENARIO_BASE.charName,
    chunks,
    userNickname: SCENARIO_BASE.persona,
    userPersona: formatSelectedPersonaForPrompt(SCENARIO_BASE.persona, "other", "20대."),
    userNote: formatUserNoteForPrompt("검증", SCENARIO_BASE.persona),
    longTermMemory: "[요약] 엘리베이터 안에 백하율과 렌이 서 있다. 긴장감이 감돈다.",
    shortTermHistory: history.slice(0, -1), // buildContext appends current user itself
    currentUserMessage: history[history.length - 1].content,
    nsfw: true,
    gender: "male",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"tense acquaintance"}')),
    modelId: MODEL_ID,
    provider: "openrouter",
    personaDisplayName: SCENARIO_BASE.persona,
    targetResponseChars: TARGET_CHARS,
    completedTurns: 8,
    userPersonaGender: "other",
    statusWidgetActive,
    // pass the block directly when we want to force instruction presence
    statusWidgetPromptBlock: widgetPromptBlock || undefined,
  });

  const split = built.openRouterSystemSplit!;
  const system = [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock]
    .filter(Boolean)
    .join("\n\n");

  // Final history for API: everything except the last (current) user
  const apiHistory = built.history.slice(0, -1).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  return { system, apiHistory, currentUser: history[history.length - 1].content, note, statusWidgetActive };
}

async function runOne(
  test: TestId,
  arm: Arm,
  run: number,
  baseHistory: Array<{ role: "user" | "assistant"; content: string }>
): Promise<Sample> {
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { system, apiHistory, currentUser, note, statusWidgetActive } = await buildSystemAndHistoryForTest(
    test,
    arm,
    baseHistory
  );

  const result = await callOpenRouterAdult(
    system,
    [...apiHistory, { role: "user", content: currentUser }],
    MODEL_ID,
    TARGET_CHARS,
    { charName: SCENARIO_BASE.charName },
    { chargeTurnBudget: false, requestKind: `status-widget-impact-t${test}` }
  );

  const raw = result.text ?? "";
  const prose = displayProse(raw);
  const { beatCount, terminal, hasObserver } = analyzeStop(prose);
  const dialogueCount = countDialogues(prose);
  const pri = priorityCheck(prose);
  const special = findSpecialValueHits(prose);

  return {
    test,
    arm,
    run,
    chars: prose.length,
    finishReason: String((result as any).finishReason ?? (result as any).usage?.finishReason ?? "unknown"),
    beatCount,
    dialogueCount,
    terminal,
    hasObserverWait: hasObserver,
    protectFirstIdx: pri.protectFirstIdx,
    nsfwFirstIdx: pri.nsfwFirstIdx,
    priorityProtectBeforeNsfw: pri.priorityProtectBeforeNsfw,
    specialValueHits: special,
    excerptHead: prose.slice(0, 220),
    excerptTail: prose.slice(-280),
    note,
  };
}

function loadDone(jsonlPath: string): Set<string> {
  if (!fs.existsSync(jsonlPath)) return new Set();
  const done = new Set<string>();
  for (const line of fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
    try {
      const j = JSON.parse(line) as Sample & { error?: string };
      if (typeof j.chars === "number" || j.error) done.add(`${j.test}|${j.arm}|${j.run}`);
    } catch {}
  }
  return done;
}

function loadSamples(jsonlPath: string): Sample[] {
  const out: Sample[] = [];
  if (!fs.existsSync(jsonlPath)) return out;
  for (const line of fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
    try {
      const s = JSON.parse(line) as Sample;
      if (typeof s.chars === "number") out.push(s);
    } catch {}
  }
  return out;
}

function mean(a: number[]) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function buildReport(samples: Sample[], testsRun: number[]): string {
  const lines: string[] = [];
  lines.push("=== DeepSeek Status Widget Impact — Phase2 Baseline ===");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("Constraints: continuation mandate OFF, length/prompt/phase2/fewshot/char/runtime unchanged.");
  lines.push("Variable: presence/format/position/accumulation/instruction of HTML status widget only.");
  lines.push("");

  for (const t of testsRun) {
    const s = samples.filter((x) => x.test === t);
    const a = s.filter((x) => x.arm === "A");
    const b = s.filter((x) => x.arm === "B");
    lines.push(`--- TEST ${t} ---`);
    if (!a.length && !b.length) {
      lines.push("(no data)");
      lines.push("");
      continue;
    }
    lines.push(`A (variant) n=${a.length} mean=${mean(a.map((x) => x.chars)).toFixed(0)}ch`);
    lines.push(`B (control) n=${b.length} mean=${mean(b.map((x) => x.chars)).toFixed(0)}ch`);
    const aBeats = mean(a.map((x) => x.beatCount));
    const bBeats = mean(b.map((x) => x.beatCount));
    lines.push(`beats A=${aBeats.toFixed(1)} B=${bBeats.toFixed(1)}`);
    const aDlg = mean(a.map((x) => x.dialogueCount));
    const bDlg = mean(b.map((x) => x.dialogueCount));
    lines.push(`dialogue A=${aDlg.toFixed(1)} B=${bDlg.toFixed(1)}`);
    const aTerm = a.map((x) => x.terminal).join(",") || "-";
    const bTerm = b.map((x) => x.terminal).join(",") || "-";
    lines.push(`terminal A=[${aTerm}] B=[${bTerm}]`);
    const aPrio = a.filter((x) => x.priorityProtectBeforeNsfw === true).length;
    const bPrio = b.filter((x) => x.priorityProtectBeforeNsfw === true).length;
    lines.push(`protect-before-nsfw A=${aPrio}/${a.length} B=${bPrio}/${b.length}`);
    const aObs = a.filter((x) => x.hasObserverWait).length;
    const bObs = b.filter((x) => x.hasObserverWait).length;
    lines.push(`observer-wait A=${aObs} B=${bObs}`);
    if (t === 1) {
      const aHits = a.flatMap((x) => x.specialValueHits);
      const bHits = b.flatMap((x) => x.specialValueHits);
      lines.push(`TEST1 special hits (99999/Crying/70) A=${aHits.join("|") || "none"} B=${bHits.join("|") || "none"}`);
    }
    lines.push("");
  }

  // === Final 5-question judgment (data-driven, conservative) ===
  lines.push("=== FINAL JUDGMENT (based on observed data) ===");

  const t1 = samples.filter((x) => x.test === 1);
  const t1HitsA = t1.filter((x) => x.arm === "A").flatMap((x) => x.specialValueHits);
  const readHtml = t1HitsA.some((h) => /99999|Crying/.test(h));
  lines.push(`1. DeepSeek가 HTML을 실제 읽는가?`);
  lines.push(readHtml ? "   → YES (TEST1 conflicting HTML value leaked into special hits on A arm)" : "   → NO / 불확실 (no clear pickup of 99999/Crying from HTML in A)");

  // 2. Goal Planning influence: use priority + beat count + terminal differences as proxy
  const prioDiff = samples.some((s) => s.priorityProtectBeforeNsfw === false && s.arm === "A");
  const beatDeltaBig = testsRun.some((t) => {
    const a = samples.filter((x) => x.test === t && x.arm === "A");
    const b = samples.filter((x) => x.test === t && x.arm === "B");
    return Math.abs(mean(a.map((x) => x.beatCount)) - mean(b.map((x) => x.beatCount))) > 1.5;
  });
  const goalImpact = prioDiff || beatDeltaBig;
  lines.push(`2. 상태창이 Goal Planning에 영향을 주는가?`);
  lines.push(goalImpact ? "   → YES (priority inversion or large beat delta observed in some A arms)" : "   → NO / 불확실 (no consistent planning shift beyond length)");

  // 3. Stop decision
  const stopDiff = testsRun.some((t) => {
    const a = samples.filter((x) => x.test === t && x.arm === "A");
    const b = samples.filter((x) => x.test === t && x.arm === "B");
    const aTerm = new Set(a.map((x) => x.terminal));
    const bTerm = new Set(b.map((x) => x.terminal));
    return aTerm.size !== bTerm.size || [...aTerm].some((tt) => !bTerm.has(tt));
  });
  const obsDiff = testsRun.some((t) => {
    const a = samples.filter((x) => x.test === t && x.arm === "A");
    const b = samples.filter((x) => x.test === t && x.arm === "B");
    return a.filter((x) => x.hasObserverWait).length !== b.filter((x) => x.hasObserverWait).length;
  });
  lines.push(`3. 상태창이 Stop Decision에 영향을 주는가?`);
  lines.push(stopDiff || obsDiff ? "   → YES (different terminal structures or observer-wait rates)" : "   → NO / 불확실 (stop patterns similar)");

  // 4. Length reduction
  let lengthReduced = false;
  for (const t of testsRun) {
    const a = samples.filter((x) => x.test === t && x.arm === "A");
    const b = samples.filter((x) => x.test === t && x.arm === "B");
    if (a.length && b.length && mean(a.map((x) => x.chars)) + 150 < mean(b.map((x) => x.chars))) {
      lengthReduced = true;
    }
  }
  lines.push(`4. 상태창을 분리 생성하는 것이 출력 길이를 감소시키는가? (또는 HTML 존재가 길이를 줄이는가)`);
  lines.push(lengthReduced ? "   → YES (HTML-present arm produced meaningfully shorter output in at least one test)" : "   → NO (HTML presence did not consistently reduce length; sometimes increased)");

  // 5. Separate generation quality
  const t7 = samples.filter((x) => x.test === 7);
  const t7A = t7.filter((x) => x.arm === "A");
  const t7B = t7.filter((x) => x.arm === "B");
  const t7Delta = Math.abs(mean(t7A.map((x) => x.chars)) - mean(t7B.map((x) => x.chars)));
  const t7BeatDelta = Math.abs(mean(t7A.map((x) => x.beatCount)) - mean(t7B.map((x) => x.beatCount)));
  const qualityHelp = t7Delta > 200 || t7BeatDelta > 1.0;
  lines.push(`5. 상태창을 분리 생성하는 것이 출력 품질에 도움이 되는가?`);
  lines.push(qualityHelp ? "   → YES (clear difference in length/structure when instruction separated)" : "   → 불확실 (differences small or within noise; no strong quality signal)");

  lines.push("");
  lines.push("Notes:");
  lines.push("- All runs used identical fixture base, same target, same call path.");
  lines.push("- 'A' is the arm with the widget/HTML variant under test; 'B' is the cleaner control.");
  lines.push("- Goal activation is proxied via beat count, dialogue, priority ordering (protect vs nsfw), terminal type.");
  lines.push("- Raw per-sample data in status-widget-deepseek-impact.jsonl");
  return lines.join("\n");
}

function parseArgs() {
  const args = process.argv.slice(2);
  let tests: number[] = [1, 2, 3, 4, 5, 6, 7];
  let runs = DEFAULT_RUNS;
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: npx.cmd tsx scripts/ab-status-widget-deepseek.ts [--tests=1,2,3] [--runs=2]");
    process.exit(0);
  }
  for (const a of args) {
    if (a.startsWith("--tests=")) {
      tests = a.split("=")[1].split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n)) as number[];
    }
    if (a.startsWith("--runs=")) {
      runs = parseInt(a.split("=")[1], 10) || DEFAULT_RUNS;
    }
  }
  return { tests: tests as TestId[], runs };
}

async function main() {
  const { tests, runs } = parseArgs();
  console.log(`[status-widget-impact] mandate env = ${process.env.DEEPSEEK_CONTINUATION_MANDATE || "(unset)"}`);
  console.log(`[status-widget-impact] running tests=${tests.join(",")} runs-per-arm=${runs}`);

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonlPath = path.join(outDir, "status-widget-deepseek-impact.jsonl");
  const reportPath = path.join(outDir, "status-widget-deepseek-impact-report.txt");
  const done = loadDone(jsonlPath);

  const baseHistory = buildBaseHistory();

  for (const t of tests) {
    for (const arm of ["A", "B"] as Arm[]) {
      for (let r = 1; r <= runs; r++) {
        const key = `${t}|${arm}|${r}`;
        if (done.has(key)) {
          console.log(`skip ${key}`);
          continue;
        }
        process.stdout.write(`TEST ${t} arm ${arm} run ${r}/${runs} ... `);
        let ok = false;
        for (let att = 1; att <= MAX_ATTEMPTS; att++) {
          await sleep(DELAY_MS);
          try {
            const sample = await runOne(t, arm, r, baseHistory);
            fs.appendFileSync(jsonlPath, JSON.stringify(sample) + "\n", "utf8");
            console.log(`ok ${sample.chars}ch beats=${sample.beatCount} term=${sample.terminal} prio=${sample.priorityProtectBeforeNsfw} hits=${sample.specialValueHits.join(",") || "none"}`);
            ok = true;
            break;
          } catch (e) {
            console.log(`err att${att}: ${(e as Error).message.slice(0, 110)}`);
            await sleep(DELAY_MS * att);
          }
        }
        if (!ok) {
          fs.appendFileSync(jsonlPath, JSON.stringify({ test: t, arm, run: r, error: true }) + "\n", "utf8");
        }
      }
    }
  }

  const samples = loadSamples(jsonlPath);
  const report = buildReport(samples, tests);
  fs.writeFileSync(reportPath, report, "utf8");
  console.log("\n" + report);
  console.log(`\nWrote ${jsonlPath}`);
  console.log(`Wrote ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
