/**
 * STEP C2-R — Stage 1 live ablation on fixture T only.
 *
 * Models: Gemini 3.1 Pro + DeepSeek V4 Pro (OpenRouter)
 * Arms: A / M1 / M2 / AB
 * Total: 8 successful calls
 *
 * Usage:
 *   node --conditions=react-server --import tsx scripts/rp-prompt-c2r-live-ablation.ts
 */
import { createHash, randomBytes } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  C2R_ARM_MARKER,
  C2R_ARM_PROSE,
  fingerprintArm,
  replaceProseStyleSectionWithC2rArm,
  type C2rArm,
} from "../src/lib/proseC2rAblation";
import { PROSE_STYLE_SECTION } from "../src/lib/advancedProseNsfwGuidelines";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT_ROOT =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/rp-prompt-c2r-ablation";
const DOCS = process.env.DOCS_DIR ?? "docs/audits/rp-prompt-c2r";
const FIXTURE_DIR =
  process.env.FIXTURE_DIR ?? "docs/audits/rp-prompt-c2r/fixtures";

type ModelKey = "Gemini" | "DeepSeek";
type Cell = {
  id: string;
  fixture: "T";
  arm: C2rArm;
  modelKey: ModelKey;
  modelId: string;
  characterId: number;
  userInput: string;
  provenance: string;
};

const T_FIXTURE = {
  characterId: 10,
  label: "Action / tension (Enoch)",
  userInput:
    "*멀리서 비명과 금속 마찰음이 겹친다. 렌은 에녹 쪽으로 몸을 낮춘다.* 저쪽이에요. 같이 가요?",
  provenance:
    "C2-R Stage1 — same T fixture as C2 (terra_action T1 / d2-enoch card)",
} as const;

const ARMS: C2rArm[] = ["A", "M1", "M2", "AB"];
const BLIND_LABELS = ["W", "X", "Y", "Z"] as const;

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
function est(t: string) {
  return Math.max(1, Math.ceil(t.length * 0.9));
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
    resolved: null,
    sawDone: false,
  };
  try {
    const res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildOpenRouterHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      return {
        http_status: res.status,
        error: errText.slice(0, 500),
        text: "",
        finish_reason: null,
        usage: null,
        resolved_model: null,
        saw_done: false,
        latency_s: (Date.now() - t0) / 1000,
      };
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
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
      resolved_model: state.resolved,
      saw_done: state.sawDone,
      latency_s: (Date.now() - t0) / 1000,
    };
  } catch (e) {
    return {
      http_status: 0,
      error: e instanceof Error ? e.message : String(e),
      text: state.text,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      saw_done: state.sawDone,
      latency_s: (Date.now() - t0) / 1000,
    };
  }
}

function extractUsage(usage: Record<string, unknown> | null) {
  if (!usage) {
    return {
      input_tokens: null,
      cached_input_tokens: null,
      visible_output_tokens: null,
    };
  }
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || null;
  const completion =
    Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || null;
  const details = (usage.prompt_tokens_details ??
    usage.input_tokens_details) as Record<string, unknown> | undefined;
  const cached =
    Number(details?.cached_tokens ?? usage.cached_tokens ?? 0) || null;
  return {
    input_tokens: prompt,
    cached_input_tokens: cached,
    visible_output_tokens: completion,
  };
}

function countSentences(p: string): number {
  return (p.match(/[.!?…。！？]+/g) ?? []).length || (p.trim() ? 1 : 0);
}
function isDialogueParagraph(p: string): boolean {
  return /["“「『]/.test(p);
}
function proseMetrics(text: string) {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const dialogue = paras.filter(isDialogueParagraph).length;
  return {
    visible_chars: text.replace(/\s+/g, "").length,
    total_paragraphs: paras.length,
    dialogue_paragraphs: dialogue,
    narration_paragraphs: paras.length - dialogue,
    approx_sentences: countSentences(text),
  };
}

function agencySevereAlarm(text: string, userInput: string): 0 | 1 {
  const userName = "렌";
  if (new RegExp(`${userName}.{0,12}(말했다|외쳤다|속삭였다|답했다)`).test(text)) {
    return 1;
  }
  if (userInput.includes("같이 가요") && /렌이\s*먼저\s*달려/.test(text)) {
    return 1;
  }
  return 0;
}

function incompleteAlarm(text: string, finish: string | null): boolean {
  if (finish && finish !== "stop" && finish !== "end_turn") return true;
  const t = text.trim();
  if (t.length < 400) return true;
  if (/[.!?…。！？」"』]\s*$/.test(t)) return false;
  return t.length < 800;
}

function loadFixture(characterId: number) {
  const path = join(FIXTURE_DIR, `c${characterId}_fixture.json`);
  return JSON.parse(readFileSync(path, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
}

async function assembleCell(opts: {
  modelId: string;
  fixture: ReturnType<typeof loadFixture>;
  currentUserMessage: string;
  arm: C2rArm;
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
  const { buildWebnovelOutputLayoutRecencyBlock } = await import(
    "../src/lib/webnovelOutputFormat"
  );
  const { buildOpenRouterKoreanProseTopBlock } = await import(
    "../src/lib/openRouterProsePolicy"
  );
  const { buildNoGodmoddingBlock } = await import("../src/lib/noGodmodding");

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
    shortTermHistory: [
      { role: "user", content: OPENING_TURN_USER },
      { role: "assistant", content: String(ch.greeting ?? "") },
    ],
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

  const layoutA = buildWebnovelOutputLayoutRecencyBlock();
  let system = built.systemPrompt;
  if (opts.arm === "A") {
    if (!system.includes(PROSE_STYLE_SECTION)) {
      throw new Error("arm A missing production PROSE_STYLE_SECTION");
    }
    system = `${system}\n${C2R_ARM_MARKER.A}`;
  } else {
    system = replaceProseStyleSectionWithC2rArm(system, opts.arm);
  }
  const lastUser = built.history[built.history.length - 1]?.content ?? "";
  const marker = C2R_ARM_MARKER[opts.arm];
  const protectedOk = {
    layout_A_present: system.includes(layoutA.slice(0, 40)),
    arm_marker: system.includes(marker),
    arm_prose:
      opts.arm === "A"
        ? system.includes(PROSE_STYLE_SECTION)
        : system.includes(C2R_ARM_PROSE[opts.arm]),
    production_absent_when_not_A:
      opts.arm === "A" ? true : !system.includes(PROSE_STYLE_SECTION),
    canon_top: system.includes(buildOpenRouterKoreanProseTopBlock().slice(0, 40)),
    no_godmodding: system.includes(
      buildNoGodmoddingBlock("캐릭터", "렌", "standard").slice(0, 40)
    ),
  };

  const wire = assemblePrimaryRpRequest({
    system,
    history: built.history ?? [],
    modelId: opts.modelId,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider: "openrouter",
      charName: String(ch.name),
      personaName,
    },
  });
  return {
    requestBody: {
      ...(wire.requestBody as Record<string, unknown>),
      stream: true,
      stream_options: { include_usage: true },
    },
    systemSha: sha256(system),
    lastUserSha: sha256(lastUser),
    protectedOk,
  };
}

function shuffleArms(arms: C2rArm[]): C2rArm[] {
  const out = [...arms];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0]! % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(DOCS, { recursive: true });

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("OPENROUTER_API_KEY is required for C2-R live ablation");
  }

  const {
    OPENROUTER_GEMINI_31_PRO_MODEL,
    OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  } = await import("../src/lib/chatModels");
  const { sanitizeStreamArtifacts } = await import("../src/lib/responseLength");
  const {
    normalizeAiNovelProsePreDisplay,
    applyDisplayParagraphGrouping,
  } = await import("../src/lib/novelParagraphs");
  const { visibleAssistantDisplayText } = await import(
    "../src/lib/chatDisplayLength"
  );

  const models: Record<ModelKey, string> = {
    Gemini: OPENROUTER_GEMINI_31_PRO_MODEL,
    DeepSeek: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  };

  const cells: Cell[] = [];
  for (const modelKey of ["Gemini", "DeepSeek"] as ModelKey[]) {
    for (const arm of ARMS) {
      cells.push({
        id: `${modelKey}_T_${arm}`,
        fixture: "T",
        arm,
        modelKey,
        modelId: models[modelKey],
        characterId: T_FIXTURE.characterId,
        userInput: T_FIXTURE.userInput,
        provenance: T_FIXTURE.provenance,
      });
    }
  }

  const fingerprints = ARMS.map(fingerprintArm);
  save(DOCS, "00_FINGERPRINTS_LIVE_SNAPSHOT.json", fingerprints);
  save(OUT_ROOT, "FIXTURE_PROVENANCE.json", { T: T_FIXTURE });
  save(DOCS, "FIXTURE_PROVENANCE.json", { T: T_FIXTURE });

  // Seal hidden display order BEFORE calls (and before scoring).
  const hiddenPath = join(DOCS, "08_HIDDEN_MAP.json");
  if (!existsSync(hiddenPath)) {
    const blindMap: Record<string, Record<(typeof BLIND_LABELS)[number], C2rArm>> =
      {};
    for (const modelKey of ["Gemini", "DeepSeek"] as ModelKey[]) {
      const order = shuffleArms(ARMS);
      blindMap[`${modelKey}_T`] = {
        W: order[0]!,
        X: order[1]!,
        Y: order[2]!,
        Z: order[3]!,
      };
    }
    save(DOCS, "08_HIDDEN_MAP.json", {
      note: "Reveal only after scoring seal",
      fixture: "T",
      blindMap,
      arm_meanings: {
        A: "production PROSE_STYLE_SECTION",
        M1: "short-sentence / translationese merge only",
        M2: "quiet-scene anti-summary relocation/merge only",
        AB: "M1+M2 (= C2-B candidate composition)",
      },
      m2_change_kind: {
        wording_change: true,
        position_change: true,
        recency_order_change:
          "quiet-scene clause moves earlier into SCENE FLOW; OUTPUT-LAYOUT recency unchanged",
      },
    });
    save(OUT_ROOT, "08_HIDDEN_MAP.json", JSON.parse(readFileSync(hiddenPath, "utf8")));
  }

  let successful = 0;
  let transportAborted = 0;
  let transportReissues = 0;
  const accounting: Record<string, number> = { Gemini: 0, DeepSeek: 0 };
  const rows: Record<string, unknown>[] = [];

  for (const cell of cells) {
    const dir = join(OUT_ROOT, "live", cell.id);
    const rawPath = join(dir, "provider_raw.txt");
    if (existsSync(rawPath) && existsSync(join(dir, "meta.json"))) {
      console.log(`skip existing ${cell.id}`);
      const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
      rows.push(meta);
      successful += 1;
      accounting[cell.modelKey] = (accounting[cell.modelKey] ?? 0) + 1;
      continue;
    }

    const fixture = loadFixture(cell.characterId);
    const assembled = await assembleCell({
      modelId: cell.modelId,
      fixture,
      currentUserMessage: cell.userInput,
      arm: cell.arm,
    });
    if (Object.values(assembled.protectedOk).some((v) => v === false)) {
      throw new Error(
        `protected owner check failed for ${cell.id}: ${JSON.stringify(assembled.protectedOk)}`
      );
    }

    console.log(`\n=== ${cell.id} ${cell.modelId} arm=${cell.arm} ===`);
    let resp = await streamOpenRouter(assembled.requestBody);
    let reissued = 0;
    if (
      (resp.http_status !== 200 || resp.error || !resp.text.trim()) &&
      isTransportAbort(resp.error, resp.http_status)
    ) {
      transportAborted += 1;
      reissued = 1;
      transportReissues += 1;
      console.log("transport abort — reissue once");
      resp = await streamOpenRouter(assembled.requestBody);
    }
    if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
      save(dir, "FAIL.json", resp);
      throw new Error(`OR fail ${cell.id}: ${resp.error ?? resp.http_status}`);
    }

    successful += 1;
    accounting[cell.modelKey] = (accounting[cell.modelKey] ?? 0) + 1;

    const providerRaw = resp.text;
    const preNormalize = sanitizeStreamArtifacts(providerRaw);
    const preDisplay = normalizeAiNovelProsePreDisplay(preNormalize);
    const finalDisplay = visibleAssistantDisplayText(
      applyDisplayParagraphGrouping(preDisplay)
    );
    const rawM = proseMetrics(providerRaw);
    const finalM = proseMetrics(finalDisplay);
    const agency = agencySevereAlarm(providerRaw, cell.userInput);
    const incomplete = incompleteAlarm(providerRaw, resp.finish_reason);
    const usage = extractUsage(resp.usage);
    const metadataLeak =
      /```/.test(providerRaw) ||
      /^\s{0,3}#{1,3}\s/m.test(providerRaw) ||
      /\[CURRENT USER INPUT\]/.test(providerRaw) ||
      /\[OUTPUT LAYOUT\]/.test(providerRaw);
    const inputEcho =
      providerRaw.includes("[CURRENT USER INPUT]") ||
      (cell.userInput.length >= 20 &&
        providerRaw.includes(cell.userInput.slice(0, 24)));
    const densityCollapse =
      rawM.visible_chars < 900 || rawM.total_paragraphs <= 2;

    const meta = {
      cell_id: cell.id,
      fixture: cell.fixture,
      arm: cell.arm,
      modelKey: cell.modelKey,
      modelId: cell.modelId,
      resolved_model: resp.resolved_model,
      character_id: cell.characterId,
      user_input: cell.userInput,
      provenance: cell.provenance,
      prose_arm_tokens: est(C2R_ARM_PROSE[cell.arm]),
      system_sha256: assembled.systemSha,
      last_user_sha256: assembled.lastUserSha,
      protectedOk: assembled.protectedOk,
      finish_reason: resp.finish_reason,
      saw_done: resp.saw_done,
      latency_s: resp.latency_s,
      retry: 0,
      continuation: 0,
      recovery: 0,
      transport_reissue: reissued,
      usage,
      PROVIDER_RAW: rawM,
      FINAL_DISPLAY: finalM,
      agency_severe: agency,
      incomplete,
      metadata_leak: metadataLeak,
      input_echo_regression: inputEcho,
      language_regression: /[A-Za-z]{40,}/.test(providerRaw) && !/[가-힣]{20,}/.test(providerRaw),
      scene_density_collapse: densityCollapse,
      raw_hash: sha256(providerRaw),
      final_hash: sha256(finalDisplay),
    };
    save(dir, "provider_raw.txt", providerRaw);
    save(dir, "final_display.txt", finalDisplay);
    save(dir, "meta.json", meta);
    rows.push(meta);
    console.log({
      id: cell.id,
      chars: rawM.visible_chars,
      paras: rawM.total_paragraphs,
      agency,
      incomplete,
      echo: inputEcho,
      densityCollapse,
      in: usage.input_tokens,
      out: usage.visible_output_tokens,
    });
  }

  const accountingOut = {
    stage: "C2R_STAGE1_T",
    Gemini_successful_calls: accounting.Gemini ?? 0,
    DeepSeek_successful_calls: accounting.DeepSeek ?? 0,
    transport_aborted: transportAborted,
    transport_reissues: transportReissues,
    quality_retries: 0,
    continuations: 0,
    recoveries: 0,
    successful_total: successful,
    fingerprints,
  };
  save(OUT_ROOT, "RUNTIME_stage1.json", { accounting: accountingOut, rows });
  save(DOCS, "05_LIVE_RESULTS_stage1.json", { accounting: accountingOut, rows });

  const hidden = JSON.parse(readFileSync(hiddenPath, "utf8")) as {
    blindMap: Record<string, Record<(typeof BLIND_LABELS)[number], C2rArm>>;
  };

  const blindLines: string[] = [
    "# 06_BLIND_REVIEW — C2-R Stage1 (fixture T)",
    "",
    "Identity hidden (W/X/Y/Z). Score before reading `09_REVEAL.md`.",
    "",
    "Human score /100 (same C2 rubric):",
    "- 문장 리듬 / 문장 선택 15",
    "- 문학적 이미지의 정확성 10",
    "- 감각의 구체성 10",
    "- 내면의 자연스러운 연속성 10",
    "- 캐릭터 고유성 15",
    "- 장면 밀도 10",
    "- NPC/환경의 살아 있는 움직임 10",
    "- 대사의 자연스러움 5",
    "- 과설명·AI문체 억제 10",
    "- 완성도 5",
    "",
    "Diagnostic sub-scores (do not replace /100):",
    "- OVER_EXPLANATION /10",
    "- SCENE MOMENTUM /10",
    "- MODEL-SPECIFIC VOICE /10",
    "",
    "PREFERRED = W / X / Y / Z / TIE (or ordered ranking)",
    "",
  ];

  for (const key of Object.keys(hidden.blindMap)) {
    const map = hidden.blindMap[key]!;
    const modelKey = key.split("_")[0] as ModelKey;
    blindLines.push(`## Set ${key}`);
    blindLines.push("");
    blindLines.push(`- character_id: ${T_FIXTURE.characterId}`);
    blindLines.push(`- label: ${T_FIXTURE.label}`);
    blindLines.push(`- provenance: ${T_FIXTURE.provenance}`);
    blindLines.push("");
    blindLines.push("### User input");
    blindLines.push("");
    blindLines.push(T_FIXTURE.userInput);
    blindLines.push("");
    for (const label of BLIND_LABELS) {
      const arm = map[label];
      const meta = rows.find(
        (r) => r.modelKey === modelKey && r.arm === arm
      ) as Record<string, unknown> | undefined;
      if (!meta) continue;
      const raw = readFileSync(
        join(OUT_ROOT, "live", String(meta.cell_id), "provider_raw.txt"),
        "utf8"
      );
      const m = meta as {
        agency_severe: number;
        incomplete: boolean;
        metadata_leak: boolean;
        input_echo_regression: boolean;
        language_regression: boolean;
        scene_density_collapse: boolean;
      };
      blindLines.push(`### Output ${label}`);
      blindLines.push("");
      blindLines.push(
        `Hard gates (auto): agency=${m.agency_severe} incomplete=${m.incomplete} echo=${m.input_echo_regression} metadata=${m.metadata_leak} lang=${m.language_regression} density_collapse=${m.scene_density_collapse}`
      );
      blindLines.push("");
      blindLines.push(raw);
      blindLines.push("");
    }
    blindLines.push("---");
    blindLines.push("");
  }
  save(DOCS, "06_BLIND_REVIEW_stage1.md", blindLines.join("\n"));
  save(OUT_ROOT, "06_BLIND_REVIEW_stage1.md", blindLines.join("\n"));
  save(DOCS, "05_LIVE_RESULTS.md", [
    "# 05_LIVE_RESULTS — C2-R Stage1 T",
    "",
    "```json",
    JSON.stringify(accountingOut, null, 2),
    "```",
    "",
  ].join("\n"));

  console.log(JSON.stringify(accountingOut, null, 2));
  if (successful !== 8) {
    throw new Error(`expected 8 successful calls, got ${successful}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
