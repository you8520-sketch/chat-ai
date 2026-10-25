/**
 * Phase D2 — Gemini 3.1 Pro Scene Continuity A/B (Stage 1).
 *
 * A = production prompt (adapter absent)
 * B = A + GEMINI_SCENE_CONTINUITY (Gemini 3.1 Pro only)
 *
 * Fixtures: G5 / G6-T1 / G3 / G2 × A/B = 8 successful calls
 * quality retry / continuation / recovery = 0
 * transport abort: same payload reissue once
 *
 *   node --conditions=react-server --import tsx scripts/rp-quality-d2-gemini-continuity-ab.ts
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
import { computeRpQualityVectorV2 } from "../src/lib/rpQualityVector";
import {
  applyGeminiSceneContinuityArmToSystem,
  estimateGeminiSceneContinuityTokens,
  type GeminiSceneContinuityArm,
} from "../src/lib/geminiSceneContinuityAdapter";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT_ROOT =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/rp-quality-d2-continuity";
const DOCS = process.env.DOCS_DIR ?? "docs/audits/rp-quality-v2-gemini";
const RAW_DOCS = join(DOCS, "d2", "raw");
const FIXTURE_DIR = join(DOCS, "fixtures");

type FixtureId = "G5" | "G6T1" | "G3" | "G2";

type FixtureSpec = {
  id: FixtureId;
  characterId: number;
  userInput: string;
  provenance: string;
  /** Overlay persona description (G2 secrets). */
  personaDescriptionOverride?: string;
  /** Extra system_prompt append for denser canon (optional). */
  systemPromptAppend?: string;
  measures: string[];
};

const FIXTURES: FixtureSpec[] = [
  {
    id: "G5",
    characterId: 10,
    userInput: "누구세요? …방금 그 소리는 뭐였죠?",
    provenance:
      "D2 G5 — short Turn-1 after greeting already established shutter/ruins event (Enoch)",
    measures: [
      "INTRO_REPLAY",
      "SETTING_RECITAL",
      "CURRENT_INPUT_REPLAY",
      "SCENE_ADVANCEMENT",
      "NEW_SCENE_VALUE",
    ],
  },
  {
    id: "G6T1",
    characterId: 10,
    userInput:
      "*멀리서 비명과 금속 마찰음이 겹친다. 렌은 에녹 쪽으로 몸을 낮춘다.* 저쪽이에요. 같이 가요?",
    provenance:
      "D2 G6-T1 — user completes env/action/speech; measure CURRENT_INPUT restage (terra_action T1)",
    measures: [
      "CURRENT_INPUT_REPLAY",
      "SCENE_ADVANCEMENT",
      "NEW_SCENE_VALUE",
      "visible_chars",
    ],
  },
  {
    id: "G3",
    characterId: 10,
    userInput:
      "*렌이 권총을 꺼내 방아쇠에 손가락을 건다.* 저쪽 소리 나는 데 한 발 쏘면 흩어지지 않을까요?",
    provenance:
      "D2 G3 — canon-required: 총성=죽음 / 통제형 에녹 must refuse gunshot (ACTIVE_CANON_USE)",
    measures: [
      "ACTIVE_CANON_USE",
      "CHARACTER_FIDELITY",
      "SETTING_RECITAL",
      "SCENE_ADVANCEMENT",
    ],
  },
  {
    id: "G2",
    characterId: 10,
    userInput:
      "*낡은 배낭 끈을 고쳐 멘다.* …조금만요. 숨이 차서요. 아까부터 계속 뛰어왔더니.",
    provenance:
      "D2 G2 — persona boundary: observable + known OK; undisclosed spy/token must NOT leak",
    personaDescriptionOverride: [
      "20대. 짧은 갈색 머리. 낡은 배낭을 멘다. 호기심 많고 직설적이며, 위험한 상황에서도 다가가는 편이다.",
      "[OBSERVABLE] 짧은 갈색 머리, 낡은 배낭, 거친 호흡, 땀에 젖은 옷깃.",
      "[PREVIOUSLY_KNOWN_TO_ENOCH] 어제 에녹에게 이름을 ‘렌’이라고 말했고, 함께 회색 안개 구역을 이동 중이다.",
      "[NOT_DISCLOSED_TO_ENOCH] 렌은 성채 정보부 잠입 요원이다. 왼팔 안쪽에 성채 인식표를 숨기고 있다. 에녹에게 소속·인식표를 말한 적 없다.",
    ].join("\n"),
    measures: [
      "USER_PERSONA_PARROT",
      "SETTING_RECITAL",
      "KNOWLEDGE_LEAK",
      "ACTIVE_CANON_USE",
    ],
  },
];

const ARMS: GeminiSceneContinuityArm[] = ["A", "B"];
const BLIND = ["P", "Q"] as const;

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
        finish_reason: null as string | null,
        usage: null as Record<string, unknown> | null,
        resolved_model: null as string | null,
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
  spec: FixtureSpec;
  arm: GeminiSceneContinuityArm;
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

  const ch = { ...opts.fixture.character };
  if (opts.spec.systemPromptAppend) {
    ch.system_prompt = `${String(ch.system_prompt ?? "")}\n${opts.spec.systemPromptAppend}`;
  }
  const persona = { ...opts.fixture.persona };
  if (opts.spec.personaDescriptionOverride) {
    persona.description = opts.spec.personaDescriptionOverride;
  }
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
    currentUserMessage: opts.spec.userInput,
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

  const applied = applyGeminiSceneContinuityArmToSystem({
    systemPrompt: built.systemPrompt,
    modelId: opts.modelId,
    arm: opts.arm,
  });
  if (opts.arm === "B" && !applied.injected) {
    throw new Error("arm B must inject Gemini 3.1 Pro continuity adapter");
  }
  if (opts.arm === "A" && applied.injected) {
    throw new Error("arm A must not inject continuity adapter");
  }

  const wire = assemblePrimaryRpRequest({
    system: applied.systemPrompt,
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
    systemSha: sha256(applied.systemPrompt),
    greeting: String(ch.greeting ?? ""),
    injected: applied.injected,
    adapterTokens: applied.estimatedTokens,
  };
}

function agencySevereAlarm(text: string, userInput: string): 0 | 1 {
  if (/렌.{0,12}(말했다|외쳤다|속삭였다|답했다)/.test(text)) return 1;
  if (userInput.includes("같이 가요") && /렌이\s*먼저\s*달려/.test(text)) {
    return 1;
  }
  return 0;
}

function knowledgeLeakAlarm(text: string, fixtureId: FixtureId): 0 | 1 {
  if (fixtureId !== "G2") return 0;
  if (/(성채\s*정보부|잠입\s*요원|인식표)/.test(text)) return 1;
  return 0;
}

function writeRawMd(opts: {
  cellId: string;
  fixture: FixtureId;
  arm: GeminiSceneContinuityArm;
  modelId: string;
  finish: string | null;
  text: string;
  userInput: string;
}) {
  const name = `${opts.fixture}_${opts.arm}.md`;
  const body = [
    `# ${opts.cellId}`,
    "",
    `- fixture: ${opts.fixture}`,
    `- arm: ${opts.arm}`,
    `- model: ${opts.modelId}`,
    `- finish_reason: ${opts.finish ?? "null"}`,
    `- visible_chars_no_ws: ${opts.text.replace(/\s+/g, "").length}`,
    "",
    "## user_input",
    "",
    "```text",
    opts.userInput,
    "```",
    "",
    "## visible_output",
    "",
    "```text",
    opts.text,
    "```",
    "",
  ].join("\n");
  save(RAW_DOCS, name, body);
  save(join(OUT_ROOT, "raw"), name, body);
}

function shufflePair(): [GeminiSceneContinuityArm, GeminiSceneContinuityArm] {
  const a: GeminiSceneContinuityArm[] = ["A", "B"];
  if ((randomBytes(1)[0]! & 1) === 1) return [a[1]!, a[0]!];
  return [a[0]!, a[1]!];
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(join(DOCS, "d2"), { recursive: true });
  mkdirSync(RAW_DOCS, { recursive: true });

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("OPENROUTER_API_KEY required for D2 live A/B");
  }

  const { OPENROUTER_GEMINI_31_PRO_MODEL } = await import(
    "../src/lib/chatModels"
  );
  const { sanitizeStreamArtifacts } = await import("../src/lib/responseLength");
  const {
    normalizeAiNovelProsePreDisplay,
    applyDisplayParagraphGrouping,
  } = await import("../src/lib/novelParagraphs");
  const { visibleAssistantDisplayText } = await import(
    "../src/lib/chatDisplayLength"
  );

  const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;

  // Blind map sealed before scoring
  const hiddenPath = join(DOCS, "d2", "08_HIDDEN_MAP.json");
  let blindMap: Record<string, Record<(typeof BLIND)[number], GeminiSceneContinuityArm>>;
  if (existsSync(hiddenPath)) {
    blindMap = (
      JSON.parse(readFileSync(hiddenPath, "utf8")) as {
        blindMap: typeof blindMap;
      }
    ).blindMap;
  } else {
    blindMap = {};
    for (const f of FIXTURES) {
      const [p, q] = shufflePair();
      blindMap[f.id] = { P: p, Q: q };
    }
    save(join(DOCS, "d2"), "08_HIDDEN_MAP.json", {
      note: "Reveal only after human scoring seal",
      model: modelId,
      blindMap,
      arm_meanings: {
        A: "production prompt — continuity adapter absent",
        B: "production + GEMINI_SCENE_CONTINUITY",
      },
    });
  }

  save(join(DOCS, "d2"), "00_FIXTURE_PROVENANCE.json", {
    fixtures: FIXTURES,
    modelId,
    adapter_estimated_tokens: estimateGeminiSceneContinuityTokens(),
  });

  let apiCalls = 0;
  const rows: Record<string, unknown>[] = [];

  for (const spec of FIXTURES) {
    const fixture = loadFixture(spec.characterId);
    for (const arm of ARMS) {
      const cellId = `Gemini_${spec.id}_${arm}`;
      const dir = join(OUT_ROOT, "live", cellId);
      const rawPath = join(dir, "provider_raw.txt");

      let providerRaw: string;
      let meta: Record<string, unknown>;

      if (existsSync(rawPath) && existsSync(join(dir, "meta.json"))) {
        console.log(`skip existing ${cellId}`);
        providerRaw = readFileSync(rawPath, "utf8");
        meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
      } else {
        const assembled = await assembleCell({
          modelId,
          fixture,
          spec,
          arm,
        });
        console.log(`\n=== ${cellId} arm=${arm} injected=${assembled.injected} ===`);
        let resp = await streamOpenRouter(assembled.requestBody);
        let reissued = 0;
        if (
          (resp.http_status !== 200 || resp.error || !resp.text.trim()) &&
          isTransportAbort(resp.error, resp.http_status)
        ) {
          reissued = 1;
          console.log("transport abort — reissue once");
          resp = await streamOpenRouter(assembled.requestBody);
        }
        if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
          save(dir, "FAIL.json", resp);
          throw new Error(`OR fail ${cellId}: ${resp.error ?? resp.http_status}`);
        }
        apiCalls += 1;
        providerRaw = resp.text;
        const preNormalize = sanitizeStreamArtifacts(providerRaw);
        const preDisplay = normalizeAiNovelProsePreDisplay(preNormalize);
        const finalDisplay = visibleAssistantDisplayText(
          applyDisplayParagraphGrouping(preDisplay)
        );
        meta = {
          cell_id: cellId,
          fixture: spec.id,
          arm,
          modelId,
          resolved_model: resp.resolved_model,
          finish_reason: resp.finish_reason,
          saw_done: resp.saw_done,
          latency_s: resp.latency_s,
          transport_reissue: reissued,
          quality_retry: 0,
          continuation: 0,
          recovery: 0,
          adapter_injected: assembled.injected,
          adapter_estimated_tokens: assembled.adapterTokens,
          system_sha256: assembled.systemSha,
          incomplete:
            !!resp.finish_reason &&
            resp.finish_reason !== "stop" &&
            resp.finish_reason !== "end_turn",
          visible_chars_no_ws: providerRaw.replace(/\s+/g, "").length,
          agency_severe: agencySevereAlarm(providerRaw, spec.userInput),
          knowledge_leak: knowledgeLeakAlarm(providerRaw, spec.id),
        };
        save(dir, "provider_raw.txt", providerRaw);
        save(dir, "final_display.txt", finalDisplay);
        save(dir, "meta.json", meta);
      }

      writeRawMd({
        cellId,
        fixture: spec.id,
        arm,
        modelId: String(meta.modelId ?? modelId),
        finish: (meta.finish_reason as string) ?? null,
        text: providerRaw,
        userInput: spec.userInput,
      });

      const vector = computeRpQualityVectorV2({
        text: providerRaw,
        providerRaw,
        finishReason: (meta.finish_reason as string) ?? null,
        sawDone: (meta.saw_done as boolean) ?? null,
        incomplete: (meta.incomplete as boolean) ?? null,
        currentUserInput: spec.userInput,
        greetingOrIntroText: String(fixture.character.greeting ?? ""),
      });

      rows.push({
        cell_id: cellId,
        fixture: spec.id,
        arm,
        measures: spec.measures,
        visible_chars_no_ws: vector.length.visible_chars_no_whitespace,
        length_band: vector.length.length_band,
        dialogue_char_share: vector.composition.dialogue_char_share,
        narration_char_share: vector.composition.narration_char_share,
        dialogue_paragraph_share: vector.composition.dialogue_paragraph_share,
        same_speaker_dialogue_fragments:
          vector.dialogue_fragmentation.same_speaker_dialogue_fragments,
        max_consecutive_short_dialogue_run:
          vector.dialogue_fragmentation.max_consecutive_short_dialogue_run,
        one_sentence_narration_ratio:
          vector.narration_fragmentation.one_sentence_narration_ratio,
        continuity: vector.continuity,
        hard_alarms: vector.hard_alarms,
        review_flags: vector.review_flags,
        agency_severe: meta.agency_severe ?? 0,
        knowledge_leak: meta.knowledge_leak ?? 0,
        finish_reason: meta.finish_reason,
        incomplete: meta.incomplete,
        adapter_injected: meta.adapter_injected,
        human: {
          CURRENT_INPUT_REPLAY: "PENDING",
          INTRO_REPLAY: "PENDING",
          SETTING_RECITAL: "PENDING",
          USER_PERSONA_PARROT: "PENDING",
          INTRA_TURN_REEXPLANATION: "PENDING",
          ACTIVE_CANON_USE: "PENDING",
          CHARACTER_FIDELITY: "PENDING",
          SCENE_ADVANCEMENT: "PENDING",
          NPC_ENVIRONMENT_MOTION: "PENDING",
          PROSE_QUALITY: "PENDING",
          NEW_SCENE_VALUE: "PENDING",
          COMPLETION: "PENDING",
        },
      });
    }
  }

  const summary = {
    phase: "D2",
    model: modelId,
    api_calls_this_run: apiCalls,
    stage1_target: 8,
    stage1_cells: rows.length,
    adapter_estimated_tokens: estimateGeminiSceneContinuityTokens(),
    raw_outputs_committed_path: "docs/audits/rp-quality-v2-gemini/d2/raw/",
    confirmation: "NOT_RUN",
    deepseek: "NOT_RUN",
    opus: "NOT_RUN",
    terra: "NOT_RUN",
    production_prompt: "UNCHANGED",
    rows,
  };
  save(join(DOCS, "d2"), "01_STAGE1_LIVE.json", summary);
  save(
    join(DOCS, "d2"),
    "01_STAGE1_LIVE.md",
    [
      "# D2 Stage1 Live — Gemini Scene Continuity A/B",
      "",
      `API calls this run: **${apiCalls}**`,
      "",
      "RAW outputs: `docs/audits/rp-quality-v2-gemini/d2/raw/`",
      "",
      "```json",
      JSON.stringify(
        {
          ...summary,
          rows: rows.map((r) => ({
            cell_id: r.cell_id,
            visible_chars_no_ws: r.visible_chars_no_ws,
            length_band: r.length_band,
            dialogue_char_share: r.dialogue_char_share,
            hard_alarms: r.hard_alarms,
            review_flags: r.review_flags,
            continuity_alarms: (r.continuity as { alarms?: string[] } | null)
              ?.alarms,
            agency_severe: r.agency_severe,
            knowledge_leak: r.knowledge_leak,
          })),
        },
        null,
        2
      ),
      "```",
      "",
    ].join("\n")
  );

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
