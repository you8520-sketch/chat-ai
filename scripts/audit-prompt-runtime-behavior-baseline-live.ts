/**
 * PROMPT/RUNTIME BEHAVIOR AUDIT — live Main RP prose baseline (no prompt mutation).
 *
 * Uses the same synthetic fixtures as audit-prompt-runtime-behavior-inventory.ts.
 * Requires CHEAPER_INFERENCE_BENCHMARK_API_KEY (never production key).
 *
 * Usage:
 *   npx tsx scripts/audit-prompt-runtime-behavior-baseline-live.ts
 *   MODELS=gemini-3.1-pro-preview,deepseek-v4-pro-0813 FIXTURES=quiet_intimacy npx tsx ...
 */
import "./lib/server-only-mock";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  exitIfBenchmarkCheaperInferenceApiKeyMissing,
  sanitizeBenchmarkCredentialText,
} from "./lib/benchmarkCheaperInferenceCredential";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const MAIN_SHA =
  process.env.AUDIT_MAIN_SHA?.trim() ||
  "c127d3030f50d5b8214cf87b920bf44a5503d80c";

const OUT_DOCS = path.join(
  process.cwd(),
  "docs/audits/prompt-runtime-behavior-audit-2026-09-27/baseline"
);
const OUT_ART = "/opt/cursor/artifacts/prompt-runtime-behavior-audit/baseline";

const INVENTORY_ROOT = path.join(
  process.cwd(),
  "docs/audits/prompt-runtime-behavior-audit-2026-09-27"
);

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
  sawDone: boolean;
};

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeBoth(rel: string, content: string | object) {
  const body = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  for (const root of [OUT_DOCS, OUT_ART]) {
    ensureDir(path.dirname(path.join(root, rel)));
    fs.writeFileSync(path.join(root, rel), body, "utf8");
  }
}

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
  const choices = ev.choices as Array<Record<string, unknown>> | undefined;
  const choice0 = choices?.[0];
  const delta = choice0?.delta as Record<string, unknown> | undefined;
  const content =
    typeof delta?.content === "string"
      ? delta.content
      : typeof (choice0?.message as Record<string, unknown> | undefined)?.content ===
          "string"
        ? String((choice0!.message as Record<string, unknown>).content)
        : "";
  if (content) state.text += content;
  if (typeof choice0?.finish_reason === "string" && choice0.finish_reason) {
    state.finish = choice0.finish_reason;
  }
  if (ev.usage && typeof ev.usage === "object") {
    state.usage = ev.usage as Record<string, unknown>;
  }
}

async function streamCi(body: Record<string, unknown>, apiKey: string) {
  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const started = Date.now();
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    sawDone: false,
  };
  try {
    const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildCheaperInferenceHeaders(apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12 * 60 * 1000),
    });
    if (!res.ok) {
      return {
        text: "",
        latency_s: (Date.now() - started) / 1000,
        finish_reason: null as string | null,
        usage: null as Record<string, unknown> | null,
        resolved_model: null as string | null,
        saw_done: false,
        error: sanitizeBenchmarkCredentialText((await res.text()).slice(0, 2000)),
        http_status: res.status,
      };
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const line of parts) processSseLine(line, state);
    }
    const tail = dec.decode();
    if (tail) buf += tail;
    if (buf.trim()) processSseLine(buf, state);
    return {
      text: state.text,
      latency_s: (Date.now() - started) / 1000,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      saw_done: state.sawDone,
      error: null as string | null,
      http_status: 200,
    };
  } catch (e) {
    return {
      text: state.text,
      latency_s: (Date.now() - started) / 1000,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      saw_done: state.sawDone,
      error: sanitizeBenchmarkCredentialText(String(e)).slice(0, 2000),
      http_status: 0,
    };
  }
}

/** Objective occurrence annotations only — no quality scores. */
function annotateObjective(raw: string) {
  const text = raw.trim();
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  return {
    chars: text.length,
    paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim()).length,
    quotedDialogueSpans: count(/"[^"\n]{1,200}"/g),
    abstractEmotionExplanation: count(
      /(이었다|뜻이었다|표시였다|감정이|분노|슬픔|기쁨|설렘|긴장감이\s+느껴|마음이\s+복잡)/g
    ),
    facialPhysicalReaction: count(
      /(눈|시선|눈매|눈썹|입꼬리|입술|턱|뺨|얼굴|표정|미소|찌푸리)/g
    ),
    breathOrPulse: count(/(숨|호흡|심박|가슴이)/g),
    habitualUnconsciousBehavior: count(
      /(습관|무의식|손가락|장갑|창틀|만지작|쓸어|주무르)/g
    ),
    environmentInteraction: count(
      /(창|유리|빛|네온|온도|소리|공기|골목|아스팔트|카페|잔|메뉴)/g
    ),
    spatialDescription: count(/(거리|옆|뒤|앞|왼쪽|오른쪽|가까이|멀리|사이)/g),
    appearanceDetail: count(/(코트|장갑|머리|눈매|키|검은)/g),
    sensoryDetail: count(/(온기|차가|향|소리|빛|질감|촉|온도|냄새)/g),
    characterToCharacterExchange: count(/"[^"]+"/g) >= 2,
    repeatedMicroActionHeuristic: count(
      /(고개를\s+끄덕|입술을\s+깨물|한숨을\s+쉬|시선을\s+돌)/g
    ),
    innerThoughtMarkers: count(
      /(생각했다|느꼈다|떠올랐|문득|속으로|마음속|사실은)/g
    ),
    layoutBlankLineBetweenDialogueHeuristic:
      count(/\n\s*\n"/g) + count(/"\n\s*\n/g),
    endsWithIncompleteHangulLatinDigit: /[가-힣a-zA-Z0-9]$/.test(text),
  };
}

async function main() {
  const apiKey = exitIfBenchmarkCheaperInferenceApiKeyMissing(
    "BASELINE_NOT_RUN"
  );

  const { MAIN_RP_USER_SELECTABLE_OPTIONS, selectedAIProvider } = await import(
    "../src/lib/chatModels"
  );
  const { buildContext } = await import("../src/services/contextBuilder");
  const { adaptCheaperInferenceChatBody } = await import(
    "../src/lib/cheaperInferenceConfig"
  );
  const { estimateTokens } = await import("../src/lib/tokenEstimate");

  // Reuse fixtures from inventory script by reading FIXTURES.json
  const fixturesPath = path.join(INVENTORY_ROOT, "FIXTURES.json");
  if (!fs.existsSync(fixturesPath)) {
    throw new Error(
      `Missing ${fixturesPath} — run audit-prompt-runtime-behavior-inventory.ts first`
    );
  }
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8")) as Array<{
    id: string;
    label: string;
    currentUserMessage: string;
    shortTermHistory: { role: "user" | "assistant"; content: string }[];
  }>;

  const modelFilter = (process.env.MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const fixtureFilter = (process.env.FIXTURES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const models = MAIN_RP_USER_SELECTABLE_OPTIONS.filter(
    (m) => modelFilter.length === 0 || modelFilter.includes(m.id)
  );
  const fxList = fixtures.filter(
    (f) => fixtureFilter.length === 0 || fixtureFilter.includes(f.id)
  );

  // Import fixture builder logic by shelling inventory patterns via dynamic rebuild:
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import(
    "../src/lib/chatMemory"
  );

  const CHAR_NAME = "백하율";
  const PERSONA_NAME = "렌";

  function buildInput(
    modelId: string,
    fixture: (typeof fixtures)[number]
  ) {
    const chunks = parseCharacterSetting({
      characterId: "audit-prose-1",
      characterName: CHAR_NAME,
      gender: "male",
      systemPrompt: `# 성격
차분하고 관찰력이 뛰어나며, 감정을 겉으로 쉽게 드러내지 않는다. 필요할 때만 짧고 단호하게 말한다. 무의식적으로 장갑 가장자리를 만지작거리거나 창틀·난간을 손가락으로 쓸어보는 습관이 있다.

# 말투
- 평소: "~요", "~죠" 등 정중한 존댓말
- 긴장/분노: 문장이 짧아지고 말끝이 딱 끊긴다
- 금지: 과도한 이모티콘, 현대 인터넷 슬랭

# 외형
키 178cm, 검은 머리, 날카로운 눈매. 검은 코트와 장갑을 즐겨 착용한다.`,
      world: `# 세계관
현대 도시. 초자연적 존재와 일반인이 공존한다. 밤거리에는 젖은 아스팔트와 네온, 먼 사이렌이 섞인다.`,
      exampleDialog: `유저: 오늘 밤에도 나가?
${CHAR_NAME}: …필요하면요. 당신은 집에 계시죠.
유저: 혼자 가기 무섭잖아.
${CHAR_NAME}: 무섭다면, 제 옆에 있으면 됩니다.`,
      statusWindowPrompt: "",
    });
    return {
      charName: CHAR_NAME,
      personaDisplayName: PERSONA_NAME,
      userNickname: PERSONA_NAME,
      chunks,
      userPersona: formatSelectedPersonaForPrompt(
        PERSONA_NAME,
        "other",
        "20대 대학원생. 호기심 많고 직설적이지만 상대를 존중한다."
      ),
      userNote: formatUserNoteForPrompt(
        "렌과 오래 알고 지낸 친구. 3년 전 실종 사건 이후 더 자주 연락한다."
      ),
      longTermMemory:
        "3년 전 실종 사건 이후 서로를 더 자주 확인한다. 최근 도심 골목에서 이상한 그림자를 목격했다.",
      memoryMeta: formatMemoryMetaForPrompt(
        parseMemoryMeta(
          JSON.stringify({
            affection: 65,
            trust: 58,
            relationshipLabel: "오래된 지인",
          })
        )
      ),
      shortTermHistory: fixture.shortTermHistory,
      currentUserMessage: fixture.currentUserMessage,
      nsfw: false,
      gender: "male" as const,
      userPersonaGender: "other" as const,
      userImpersonation: false,
      novelModeEnabled: false,
      targetResponseChars: 3200,
      completedTurns: 8,
      genres: ["현대/일상" as const],
      provider: selectedAIProvider(modelId),
      modelId,
      recentNarrativeContext:
        "[RECENT NARRATIVE CONTEXT · turn 8]\n장면이 자연스럽게 이어지고 있다.",
      promptDumpSource: "audit" as const,
      promptDumpDetail: `baseline-live fixture=${fixture.id} model=${modelId}`,
    };
  }

  ensureDir(OUT_DOCS);
  ensureDir(OUT_ART);

  const index: Record<string, unknown>[] = [];

  for (const model of models) {
    for (const fixture of fxList) {
      const built = buildContext(buildInput(model.id, fixture));
      const history = built.history;
      const systemPrompt = built.systemPrompt;
      const messages = [
        { role: "system", content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
      ];

      const rawBody = {
        model: model.id,
        messages,
        stream: true,
        max_tokens: 8192,
      };
      const body = adaptCheaperInferenceChatBody(rawBody);

      console.log(`[baseline] ${model.id} / ${fixture.id} …`);
      const result = await streamCi(body, apiKey);
      const ann = annotateObjective(result.text);
      const rel = `${fixture.id}/${model.id}`;
      writeBoth(`${rel}/raw.txt`, result.text);
      writeBoth(`${rel}/annotation.json`, ann);
      writeBoth(`${rel}/meta.json`, {
        exactMain: MAIN_SHA,
        modelId: model.id,
        displayName: model.label,
        fixtureId: fixture.id,
        fixtureLabel: fixture.label,
        http_status: result.http_status,
        finish_reason: result.finish_reason,
        resolved_model: result.resolved_model,
        latency_s: result.latency_s,
        usage: result.usage,
        saw_done: result.saw_done,
        error: result.error,
        systemSha256: sha256(systemPrompt),
        userSha256: sha256(history[history.length - 1]?.content ?? ""),
        systemTokensEst: estimateTokens(systemPrompt),
        outputChars: result.text.length,
        outputTokensEst: estimateTokens(result.text),
        providerActualPromptTokens:
          typeof result.usage?.prompt_tokens === "number"
            ? result.usage.prompt_tokens
            : null,
        providerActualCompletionTokens:
          typeof result.usage?.completion_tokens === "number"
            ? result.usage.completion_tokens
            : null,
      });

      index.push({
        modelId: model.id,
        fixtureId: fixture.id,
        ok: result.http_status === 200 && result.text.trim().length > 0 && !result.error,
        outputChars: result.text.length,
        finish_reason: result.finish_reason,
        providerPromptTokens:
          typeof result.usage?.prompt_tokens === "number"
            ? result.usage.prompt_tokens
            : null,
        annotation: ann,
        error: result.error,
      });
      console.log(
        `  → chars=${result.text.length} finish=${result.finish_reason} prompt_tok=${
          (result.usage as { prompt_tokens?: number } | null)?.prompt_tokens ?? "?"
        } err=${result.error ? "YES" : "no"}`
      );
    }
  }

  writeBoth("INDEX.json", {
    exactMain: MAIN_SHA,
    generatedAt: new Date().toISOString(),
    runs: index,
    note: "Objective annotations only — no model quality scores.",
  });
  console.log(`Wrote baseline to ${OUT_DOCS}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
