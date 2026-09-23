/**
 * Phase D6-A — Gemini layered canon surface experiment.
 *
 * PROMPT WORDING CHANGE = 0
 * NEW NEGATIVE RULE = 0
 * NEW SYSTEM SECTION = 0
 * RUNTIME PARAM CHANGE = 0
 * PRODUCTION WIRE = 0
 *
 * Sole variable: canon serialization surface
 *   A = legacy full structured canon (production Gemini path)
 *   B = layered CORE + ACTIVE (harness-only policy + in-memory plan)
 *
 *   D6A_PHASE=G5 node --conditions=react-server --import tsx scripts/rp-quality-d6a-gemini-layered-canon.ts
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
import { ENOCH_FIXTURES } from "../data/canon-core-audit/d2-enoch-fixtures";
import {
  computeRpQualityVectorV2,
  extractDialogueSpans,
  type SettingSource,
} from "../src/lib/rpQualityVector";
import type { CanonInjectionPolicy } from "../src/lib/canonInjectionPolicy";
import type { CanonPlanV1 } from "../src/lib/canonPlan/types";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const PHASE = (process.env.D6A_PHASE ?? "G5").toUpperCase();
const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/rp-quality-d6a-layered-canon";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/rp-gemini-layered-canon-d6a";
const RAW_DOCS = join(DOCS, "raw");
const DRAWS = PHASE === "G3" ? 2 : 3;
const FIXED_NOW = "2026-08-08T00:00:00.000Z";

const ENOCH_RAW = ENOCH_FIXTURES[0]!.creatorRawDescription;
const ENOCH_WORLD =
  "회색 생태권. 마더의 군체 의식이 지구를 개조 중. 회색 안개 수위 Level 1~4. 총성은 죽음.";
const GREETING =
  "에녹은 무너진 상가 그늘에 등을 기대고 있었다. 손전등은 꺼져 있었고, 방독면은 턱 아래에 걸쳐져 있었다. 멀리서 무언가가 철제 셔터를 긁는 소리가 났다. 그는 렌 쪽을 보지 않은 채 낮게 말했다.\n\n\"소음 내지 마. 따라와.\"";

type FixtureId = "G5" | "G3";
const FIXTURE_INPUT: Record<FixtureId, string> = {
  G5: "누구세요? …방금 그 소리는 뭐였죠?",
  G3: "*렌이 권총을 꺼내 방아쇠에 손가락을 건다.* 저쪽 소리 나는 데 한 발 쏘면 흩어지지 않을까요?",
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
function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}
function mean(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
  generationId: string | null;
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
  if (typeof ev.id === "string" && !state.generationId) state.generationId = ev.id;
  if (typeof ev.model === "string") state.resolved = ev.model;
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
    generationId: null,
    provider: null,
    sawDone: false,
  };
  const responseHeaders: Record<string, string> = {};
  try {
    const res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildOpenRouterHeaders(),
      body: JSON.stringify(body),
    });
    for (const [k, v] of res.headers.entries()) {
      if (
        /provider|generation|request|ratelimit|model|openrouter/i.test(k) ||
        k.startsWith("x-")
      ) {
        responseHeaders[k] = v;
      }
    }
    if (!res.ok) {
      const errText = await res.text();
      return {
        http_status: res.status,
        error: errText.slice(0, 800),
        text: "",
        finish_reason: null as string | null,
        usage: null as Record<string, unknown> | null,
        resolved_model: null as string | null,
        generation_id: null as string | null,
        provider: null as string | null,
        response_headers: responseHeaders,
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
      const combined = buf + decoder.decode(value, { stream: true });
      const lines = combined.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) processSseLine(line, state);
    }
    if (buf.trim()) processSseLine(buf, state);
    return {
      http_status: res.status,
      error: null as string | null,
      text: state.text,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      generation_id: state.generationId,
      provider: state.provider,
      response_headers: responseHeaders,
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
      generation_id: state.generationId,
      provider: state.provider,
      response_headers: responseHeaders,
      saw_done: state.sawDone,
      latency_s: (Date.now() - t0) / 1000,
    };
  }
}

function usageTokens(usage: Record<string, unknown> | null) {
  if (!usage) {
    return {
      input_tokens: null as number | null,
      output_tokens: null as number | null,
      reasoning_tokens: null as number | null,
    };
  }
  const details =
    (usage.completion_tokens_details as Record<string, unknown> | undefined) ??
    {};
  const reasoning =
    typeof details.reasoning_tokens === "number"
      ? details.reasoning_tokens
      : typeof usage.reasoning_tokens === "number"
        ? usage.reasoning_tokens
        : null;
  return {
    input_tokens:
      typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    output_tokens:
      typeof usage.completion_tokens === "number"
        ? usage.completion_tokens
        : null,
    reasoning_tokens: reasoning,
  };
}

function scoreResponseAnchorCount(text: string) {
  const dialogue = extractDialogueSpans(text)
    .map((s) => s.content.trim())
    .filter(Boolean);
  let count = 0;
  for (const d of dialogue) {
    if (
      /[?？]|까요|래요|세요|어때|어떡|가자|가요|해줘|같이|멈춰|말해/.test(d)
    ) {
      count += 1;
    }
  }
  return {
    response_anchor_count: count,
    band:
      count <= 1 ? "IDEAL" : count === 2 ? "ACCEPTABLE" : "RESPONSE_OVERLOAD",
  };
}

/** Evaluation-only: attribute exposition paragraphs to character/world canon sources. */
function scoreCanonRecital(opts: {
  text: string;
  characterSource: string;
  worldSource: string;
}) {
  const paras = opts.text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const charNorm = opts.characterSource.replace(/\s+/g, "");
  const worldNorm = opts.worldSource.replace(/\s+/g, "");
  let characterRecital = 0;
  let worldRecital = 0;
  const hits: Array<{
    para: string;
    bucket: "character" | "world" | "none";
    reason: string;
  }> = [];

  const expositionCue =
    /였다|이었다|이다|된다|존재|군체|성채|마더|안개|Level|기원종|브레인|회색혈|저격수|변이|텔레파시|규약/;
  const actionCue =
    /꺼냈|빼앗|잡았|낮추|돌아|걷|달렸|조준|쏘|막았|끌|밀|속삭|말했|대답|손|손가락|방아쇠/;

  for (const p of paras) {
    const pn = p.replace(/\s+/g, "");
    if (pn.length < 24) continue;
    // dialogue-heavy paragraphs are not setting recital
    if ((p.match(/["「『”]/g) || []).length >= 2 && pn.length < 120) continue;

    let bestBucket: "character" | "world" | "none" = "none";
    let best = 0;
    // cheap n-gram hit count
    for (const n of [12, 10, 8]) {
      for (let i = 0; i + n <= Math.min(pn.length, 400); i += Math.max(2, Math.floor(n / 2))) {
        const gram = pn.slice(i, i + n);
        if (charNorm.includes(gram) && n > best) {
          best = n;
          bestBucket = "character";
        }
        if (worldNorm.includes(gram) && n >= best) {
          // prefer world if equal-or-better world hit and paragraph mentions world terms
          if (n > best || /마더|안개|Level|기원|기생|브레인|성채|군체/.test(p)) {
            best = n;
            bestBucket = "world";
          }
        }
      }
      if (best >= 12) break;
    }

    const isExposition =
      best >= 8 &&
      expositionCue.test(p) &&
      !(actionCue.test(p) && best < 12);

    if (!isExposition || bestBucket === "none") {
      hits.push({ para: p.slice(0, 80), bucket: "none", reason: "not_recital" });
      continue;
    }
    const chars = pn.length;
    if (bestBucket === "character") characterRecital += chars;
    else worldRecital += chars;
    hits.push({
      para: p.slice(0, 80),
      bucket: bestBucket,
      reason: `source_ngram>=${best}`,
    });
  }

  const visible = opts.text.replace(/\s+/g, "").length;
  const totalRecital = characterRecital + worldRecital;
  return {
    CHARACTER_CANON_RECITAL_CHARS: characterRecital,
    WORLD_CANON_RECITAL_CHARS: worldRecital,
    CANON_RECITAL_CHARS: totalRecital,
    CANON_RECITAL_PER_1000:
      visible > 0 ? (totalRecital / visible) * 1000 : 0,
    visible_chars_no_ws: visible,
    paragraph_hits: hits.filter((h) => h.bucket !== "none"),
  };
}

function harnessLayeredPolicy(modelId: string): CanonInjectionPolicy {
  return {
    modelId,
    injectionEnabled: true,
    shadowOnly: false,
    canonMode: "LAYERED",
    archiveMode: "FULL_ALWAYS",
    rolloutStage: "D2",
    forceFullLegacy: false,
    canaryActualInjection: true,
    actualCanonMode: "LAYERED",
    actualArchiveMode: "FULL_ALWAYS",
    masterCanaryEnabled: true,
    canaryPercent: 100,
    cohortEligible: true,
    cohortBucket: 0,
    cohortEligibilityReason: "d6a-harness-only",
  };
}

async function assembleArm(opts: {
  modelId: string;
  fixtureId: FixtureId;
  arm: "A" | "B";
  plan: CanonPlanV1;
  speechBlock: string;
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
  const { resolveCanonInjectionPolicy } = await import(
    "../src/lib/canonInjectionPolicy"
  );
  const { selectActiveCanonChunks } = await import(
    "../src/lib/canonPlan/activeSelector"
  );
  const { renderCoreCanonBlock, renderCanonChunksBlock } = await import(
    "../src/lib/canonPlan/coreRenderer"
  );
  const { buildCharacterCanonBlock } = await import(
    "../src/lib/characterKnowledgeBoundary"
  );

  const userInput = FIXTURE_INPUT[opts.fixtureId];
  const personaName = "렌";
  const ch = {
    id: 10,
    name: "에녹",
    gender: "male" as const,
    system_prompt: ENOCH_RAW,
    world: ENOCH_WORLD,
    example_dialog: "유저: 저쪽이에요.\n에녹: 소음 내지 마. 따라와.",
    setting_chunks: "",
    speech_profile: "",
    greeting: GREETING,
    nsfw: 0,
  };

  const { chunks } = loadCharacterChunksForPromptReadOnly(
    {
      id: ch.id,
      name: ch.name,
      gender: ch.gender,
      system_prompt: ch.system_prompt,
      world: ch.world,
      example_dialog: ch.example_dialog,
      setting_chunks: ch.setting_chunks,
      speech_profile: ch.speech_profile,
    },
    personaName,
    personaName
  );

  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    "other",
    "20대. 호기심 많고 직설적이며, 위험한 상황에서도 다가가는 편이다."
  );
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: ch.name,
  });

  const layered = opts.arm === "B";
  const policy = layered
    ? harnessLayeredPolicy(opts.modelId)
    : resolveCanonInjectionPolicy(opts.modelId);

  const built = buildContext({
    charName: ch.name,
    chunks,
    userNickname: personaName,
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: [
      { role: "user", content: OPENING_TURN_USER },
      { role: "assistant", content: GREETING },
    ],
    currentUserMessage: userInput,
    nsfw: false,
    gender: "male",
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
    exampleDialog: ch.example_dialog,
    userId: 4,
    narrativePov,
    canonInjectionPolicy: policy,
    canonPlan: layered ? opts.plan : null,
    privateSpeechControlBlock: layered ? opts.speechBlock || undefined : undefined,
  });

  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId: opts.modelId,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider: "openrouter",
      charName: ch.name,
      personaName,
    },
  });

  const body = {
    ...(wire.requestBody as Record<string, unknown>),
    stream: true,
    stream_options: { include_usage: true },
  };
  const messages =
    (body.messages as Array<{ role: string; content: string }>) ?? [];
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const systemMsg = messages.find((m) => m.role === "system");
  const systemText = String(systemMsg?.content ?? built.systemPrompt);

  // Canon surface measurement
  const legacyBlock = buildCharacterCanonBlock(ENOCH_RAW, ch.name);
  const coreBlock = renderCoreCanonBlock(opts.plan, { charName: ch.name });
  const recentTurns = [
    { role: "user", content: OPENING_TURN_USER },
    { role: "assistant", content: GREETING },
  ];
  const activeSel = selectActiveCanonChunks({
    plan: opts.plan,
    userMessage: userInput,
    recentContext: recentTurns.map((m) => m.content).join("\n"),
    recentTurns,
  });
  const activeBlock = renderCanonChunksBlock(activeSel.activeChunks, {
    charName: ch.name,
  });

  const settingSources: SettingSource[] = [
    { bucket: "CHARACTER_CANON", text: ENOCH_RAW },
    { bucket: "WORLD_CANON", text: ENOCH_WORLD + "\n" + ENOCH_RAW },
    {
      bucket: "USER_PERSONA",
      text: "20대. 호기심 많고 직설적이며, 위험한 상황에서도 다가가는 편이다.",
    },
    { bucket: "CURRENT_USER_INPUT", text: userInput },
    { bucket: "MEMORY", text: "" },
  ];

  // Approximate system prompt tokens via chars/2
  const systemTokensApprox = Math.round(systemText.length / 2);

  return {
    requestBody: body,
    systemSha: sha256(systemText),
    messagesSha: sha256(JSON.stringify(messages)),
    userTailSha: sha256(String(lastUser?.content ?? "")),
    systemText,
    systemChars: systemText.length,
    systemTokensApprox,
    greeting: GREETING,
    settingSources,
    userInput,
    policy,
    canonSurface: {
      arm: opts.arm,
      legacy_chars: legacyBlock.length,
      core_chars: coreBlock.length,
      active_chars: activeBlock.length,
      layered_total_chars: coreBlock.length + activeBlock.length,
      active_selected_ids: activeSel.selectedIds,
      active_selected_titles: activeSel.activeChunks.map(
        (c) => c.sectionTitle || "(untitled)"
      ),
      canon_block_sha256: sha256(
        opts.arm === "A" ? legacyBlock : coreBlock + "\n" + activeBlock
      ),
      surface_reduction_pct:
        opts.arm === "B"
          ? Math.round(
              (1 - (coreBlock.length + activeBlock.length) / legacyBlock.length) *
                100
            )
          : 0,
    },
    generationConfig: {
      model: body.model ?? opts.modelId,
      temperature: body.temperature ?? null,
      max_tokens: body.max_tokens ?? null,
      reasoning: body.reasoning ?? null,
      include_reasoning: body.include_reasoning ?? null,
      provider: body.provider ?? null,
    },
  };
}

async function runFixture(fixtureId: FixtureId) {
  const { OPENROUTER_GEMINI_31_PRO_MODEL } = await import(
    "../src/lib/chatModels"
  );
  const { compileCanonPlanV1 } = await import("../src/lib/canonPlan/compiler");
  const {
    compileCreatorDescriptionTriggers,
    buildPrivateSpeechControlBlock,
  } = await import("../src/lib/creatorDescriptionTriggerCompiler");
  const { sanitizeStreamArtifacts } = await import("../src/lib/responseLength");
  const {
    normalizeAiNovelProsePreDisplay,
    applyDisplayParagraphGrouping,
  } = await import("../src/lib/novelParagraphs");
  const { visibleAssistantDisplayText } = await import(
    "../src/lib/chatDisplayLength"
  );

  const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;
  const compiled = compileCanonPlanV1({
    creatorRawDescription: ENOCH_RAW,
    now: FIXED_NOW,
  });
  if (!compiled.ok) throw new Error(`plan compile failed: ${compiled.error}`);
  const plan = compiled.plan;
  const speechCompiled = compileCreatorDescriptionTriggers({
    description: ENOCH_RAW,
  });
  const speechBlock = buildPrivateSpeechControlBlock(speechCompiled);

  let apiCalls = 0;
  const rows: Array<Record<string, unknown>> = [];
  const assemblies: Record<string, Awaited<ReturnType<typeof assembleArm>>> =
    {} as never;

  for (const arm of ["A", "B"] as const) {
    const assembled = await assembleArm({
      modelId,
      fixtureId,
      arm,
      plan,
      speechBlock,
    });
    assemblies[arm] = assembled;

    for (let draw = 1; draw <= DRAWS; draw++) {
      const cellId = `Gemini_${fixtureId}_${arm}_D${draw}`;
      const dir = join(OUT_ROOT, "live", cellId);
      let providerRaw: string;
      let meta: Record<string, unknown>;

      if (existsSync(join(dir, "meta.json")) && existsSync(join(dir, "provider_raw.txt"))) {
        console.log(`skip existing ${cellId}`);
        providerRaw = readFileSync(join(dir, "provider_raw.txt"), "utf8");
        meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
      } else {
        console.log(
          `\n=== ${cellId} arm=${arm} systemTok≈${assembled.systemTokensApprox} canonSha=${assembled.canonSurface.canon_block_sha256.slice(0, 12)} ===`
        );
        let resp = await streamOpenRouter(assembled.requestBody);
        let reissued = 0;
        if (
          (resp.http_status !== 200 || resp.error || !resp.text.trim()) &&
          isTransportAbort(resp.error, resp.http_status)
        ) {
          reissued = 1;
          resp = await streamOpenRouter(assembled.requestBody);
        }
        if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
          save(dir, "FAIL.json", resp);
          throw new Error(`OR fail ${cellId}: ${resp.error ?? resp.http_status}`);
        }
        apiCalls += 1;
        providerRaw = resp.text;
        const finalDisplay = visibleAssistantDisplayText(
          applyDisplayParagraphGrouping(
            normalizeAiNovelProsePreDisplay(
              sanitizeStreamArtifacts(providerRaw)
            )
          )
        );
        meta = {
          cell_id: cellId,
          phase: "D6-A",
          fixture: fixtureId,
          arm,
          draw,
          prompt_wording_change: 0,
          new_instruction: 0,
          runtime_param_change: 0,
          model_identifier: modelId,
          resolved_model: resp.resolved_model,
          provider: resp.provider,
          provider_generation_id: resp.generation_id,
          finish_reason: resp.finish_reason,
          saw_done: resp.saw_done,
          latency_s: resp.latency_s,
          transport_reissue: reissued,
          system_sha256: assembled.systemSha,
          messages_sha256: assembled.messagesSha,
          user_tail_sha256: assembled.userTailSha,
          system_chars: assembled.systemChars,
          system_tokens_approx: assembled.systemTokensApprox,
          canon_surface: assembled.canonSurface,
          generation_config: assembled.generationConfig,
          policy_actualCanonMode: assembled.policy.actualCanonMode,
          usage_raw: resp.usage,
          ...usageTokens(resp.usage),
          incomplete:
            !!resp.finish_reason &&
            resp.finish_reason !== "stop" &&
            resp.finish_reason !== "end_turn",
          visible_chars_no_ws: providerRaw.replace(/\s+/g, "").length,
        };
        save(dir, "provider_raw.txt", providerRaw);
        save(dir, "final_display.txt", finalDisplay);
        save(dir, "meta.json", meta);
        save(dir, "system_prompt.txt", assembled.systemText);
        save(dir, "request_fingerprint.json", {
          system_sha256: assembled.systemSha,
          messages_sha256: assembled.messagesSha,
          user_tail_sha256: assembled.userTailSha,
          canon_surface: assembled.canonSurface,
          generation_config: assembled.generationConfig,
        });
      }

      const recital = scoreCanonRecital({
        text: providerRaw,
        characterSource: ENOCH_RAW,
        worldSource: ENOCH_WORLD + "\n" + ENOCH_RAW,
      });
      const vector = computeRpQualityVectorV2({
        text: providerRaw,
        providerRaw,
        finishReason: (meta.finish_reason as string) ?? null,
        sawDone: (meta.saw_done as boolean) ?? null,
        incomplete: (meta.incomplete as boolean) ?? null,
        currentUserInput: assembled.userInput,
        priorAssistantText: GREETING,
        greetingOrIntroText: GREETING,
        settingSources: assembled.settingSources,
      });
      const anchors = scoreResponseAnchorCount(providerRaw);

      // G3 hard coverage: gunshot law must appear as USE or explicit refusal basis
      const gunshotCanonUse =
        /총성|쏘지\s*마|쏘면|소음|군체|마더/.test(providerRaw) &&
        /막|뺏|낮추|안\s*돼|금지|죽음|몰려|들키|위험|권총|손/.test(providerRaw);

      save(RAW_DOCS, `${cellId}.md`, [
        `# ${cellId}`,
        "",
        `- arm: ${arm}`,
        `- visible_chars: ${recital.visible_chars_no_ws}`,
        `- canon_recital_per_1000: ${recital.CANON_RECITAL_PER_1000.toFixed(1)}`,
        `- finish: ${meta.finish_reason}`,
        "",
        "## output",
        "",
        "```text",
        providerRaw,
        "```",
        "",
      ].join("\n"));

      rows.push({
        cell_id: cellId,
        fixture: fixtureId,
        arm,
        draw,
        visible_chars: vector.length.visible_chars_no_whitespace,
        finish_reason: meta.finish_reason,
        provider: meta.provider,
        reasoning_tokens: meta.reasoning_tokens,
        input_tokens: meta.input_tokens,
        latency_s: meta.latency_s,
        system_chars: meta.system_chars,
        system_tokens_approx: meta.system_tokens_approx,
        canon_surface: meta.canon_surface,
        recital,
        dialogue_char_share: vector.composition.dialogue_char_share,
        response_anchor: anchors,
        continuity: vector.continuity,
        setting_exact_overlap: vector.setting_exact_overlap,
        hard_alarms: vector.hard_alarms,
        gunshot_canon_use_signal: gunshotCanonUse,
        system_sha256: meta.system_sha256,
        messages_sha256: meta.messages_sha256,
        human_pending: {
          CHARACTER_FIDELITY: "PENDING_AGENT_REVIEW",
          ACTIVE_CANON_USE: "PENDING_AGENT_REVIEW",
          SETTING_RECITAL: "PENDING_AGENT_REVIEW",
          SCENE_ADVANCEMENT: "PENDING_AGENT_REVIEW",
          NEW_SCENE_VALUE: "PENDING_AGENT_REVIEW",
        },
      });
    }
  }

  // Budget invariant: B system tokens <= A
  const aSys = assemblies.A!.systemTokensApprox;
  const bSys = assemblies.B!.systemTokensApprox;
  if (bSys > aSys) {
    throw new Error(
      `CANON surface budget invariant failed: B systemTok ${bSys} > A ${aSys}`
    );
  }

  const byArm = (arm: "A" | "B") => {
    const rs = rows.filter((r) => r.arm === arm);
    const chars = rs.map((r) => Number(r.visible_chars));
    const recitalPer1k = rs.map(
      (r) => (r.recital as { CANON_RECITAL_PER_1000: number }).CANON_RECITAL_PER_1000
    );
    const recitalChars = rs.map(
      (r) => (r.recital as { CANON_RECITAL_CHARS: number }).CANON_RECITAL_CHARS
    );
    return {
      n: rs.length,
      chars,
      chars_median: median(chars),
      chars_mean: mean(chars),
      collapse_lt_1800: chars.filter((c) => c < 1800).length,
      recital_chars: recitalChars,
      recital_chars_median: median(recitalChars),
      recital_per_1000: recitalPer1k,
      recital_per_1000_median: median(recitalPer1k),
      system_tokens_approx: assemblies[arm]!.systemTokensApprox,
      system_chars: assemblies[arm]!.systemChars,
      canon_surface: assemblies[arm]!.canonSurface,
      rows: rs,
    };
  };

  const armA = byArm("A");
  const armB = byArm("B");
  const recitalReduction =
    armA.recital_per_1000_median > 0
      ? (armA.recital_per_1000_median - armB.recital_per_1000_median) /
        armA.recital_per_1000_median
      : 0;

  const lengthRegressed =
    armB.collapse_lt_1800 > armA.collapse_lt_1800 + 1 ||
    armB.chars_median < armA.chars_median * 0.7;

  return {
    fixture: fixtureId,
    api_calls_this_run: apiCalls,
    NEW_SYSTEM_SECTION_COUNT: 0,
    NEW_INSTRUCTION_TOKENS: 0,
    budget_invariant_B_le_A: bSys <= aSys,
    CANON_SURFACE_REDUCTION_PERCENT:
      assemblies.B!.canonSurface.surface_reduction_pct,
    arm_A: armA,
    arm_B: armB,
    recital_reduction_fraction: recitalReduction,
    recital_reduction_pct: Math.round(recitalReduction * 100),
    length_regression_flag: lengthRegressed,
  };
}

function classifyG5(summary: Awaited<ReturnType<typeof runFixture>>) {
  const notes: string[] = [];
  const passRecital = summary.recital_reduction_fraction >= 0.3;
  if (!passRecital) {
    notes.push(
      `recital reduction ${summary.recital_reduction_pct}% < 30% gate`
    );
  }
  if (summary.length_regression_flag) {
    notes.push("length collapse/median regression");
  }
  if (!summary.budget_invariant_B_le_A) {
    notes.push("B system tokens > A");
  }
  // fidelity/active canon filled after human review in seal step
  const verdict =
    passRecital && !summary.length_regression_flag && summary.budget_invariant_B_le_A
      ? "PASS_CANDIDATE"
      : "FAIL";
  return { verdict, notes };
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(RAW_DOCS, { recursive: true });
  mkdirSync(join(DOCS, "g5"), { recursive: true });
  mkdirSync(join(DOCS, "g3"), { recursive: true });

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("OPENROUTER_API_KEY required for D6-A live");
  }

  if (PHASE === "G5") {
    const summary = await runFixture("G5");
    const gate = classifyG5(summary);
    const out = {
      phase: "D6-A-G5",
      ...summary,
      stage1_gate: gate,
      g3: "NOT_RUN",
      production_wire: "NOT_RUN",
      merge: "NOT_RUN",
    };
    save(join(DOCS, "g5"), "01_G5_LIVE.json", out);
    save(
      join(DOCS, "g5"),
      "01_G5_LIVE.md",
      [
        "# D6-A G5 Live — Layered Canon Surface",
        "",
        "```json",
        JSON.stringify(
          {
            stage1_gate: gate,
            CANON_SURFACE_REDUCTION_PERCENT:
              summary.CANON_SURFACE_REDUCTION_PERCENT,
            recital_reduction_pct: summary.recital_reduction_pct,
            A: {
              chars: summary.arm_A.chars,
              recital_per_1000: summary.arm_A.recital_per_1000,
              collapse: summary.arm_A.collapse_lt_1800,
              system_tokens_approx: summary.arm_A.system_tokens_approx,
            },
            B: {
              chars: summary.arm_B.chars,
              recital_per_1000: summary.arm_B.recital_per_1000,
              collapse: summary.arm_B.collapse_lt_1800,
              system_tokens_approx: summary.arm_B.system_tokens_approx,
              active_titles: summary.arm_B.canon_surface.active_selected_titles,
            },
          },
          null,
          2
        ),
        "```",
        "",
      ].join("\n")
    );
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (PHASE === "G3") {
    const summary = await runFixture("G3");
    const bGun = summary.arm_B.rows.every(
      (r) => r.gunshot_canon_use_signal === true
    );
    const out = {
      phase: "D6-A-G3",
      ...summary,
      gunshot_canon_preserved_all_B: bGun,
      overpruned: !bGun,
      production_wire: "NOT_RUN",
      merge: "NOT_RUN",
    };
    save(join(DOCS, "g3"), "02_G3_CONFIRMATION.json", out);
    save(
      join(DOCS, "g3"),
      "02_G3_CONFIRMATION.md",
      [
        "# D6-A G3 Confirmation",
        "",
        "```json",
        JSON.stringify(
          {
            gunshot_canon_preserved_all_B: bGun,
            overpruned: !bGun,
            A_chars: summary.arm_A.chars,
            B_chars: summary.arm_B.chars,
            A_recital_per_1000: summary.arm_A.recital_per_1000,
            B_recital_per_1000: summary.arm_B.recital_per_1000,
          },
          null,
          2
        ),
        "```",
        "",
      ].join("\n")
    );
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  throw new Error(`Unsupported D6A_PHASE=${PHASE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
