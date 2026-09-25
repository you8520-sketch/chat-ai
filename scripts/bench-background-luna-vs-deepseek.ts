#!/usr/bin/env tsx
/**
 * Direct-provider benchmark only. No DB access, no point charge, no retry/failover.
 * Compares CheaperInference:
 *   - deepseek-v4-flash-0731 (thinking disabled)
 *   - gpt-5.6-luna (reasoning none)
 *
 * 5 Korean 5-turn summary cases + 5 OOC/HTML cases per model = 20 calls.
 * Interleaved order to reduce time-of-day/provider-load bias.
 * Uses the current production long-form completion deadline: 45s.
 *
 * Usage (Railway/local env with CHEAPER_INFERENCE_API_KEY):
 *   npx tsx scripts/bench-background-luna-vs-deepseek.ts
 *
 * Results:
 *   /tmp/background-model-ab/results.json
 */

import fs from "node:fs";
import path from "node:path";

const ENDPOINT = "https://api.cheaperinference.com/v1/chat/completions";
const API_KEY = process.env.CHEAPER_INFERENCE_API_KEY?.trim();
const DEADLINE_MS = 45_000;
const OUT_DIR = process.env.BENCH_OUT_DIR || "/tmp/background-model-ab";
const OUT_FILE = path.join(OUT_DIR, "results.json");

if (!API_KEY) {
  console.error("CHEAPER_INFERENCE_API_KEY missing");
  process.exit(2);
}

const MODELS = {
  deepseek: "deepseek-v4-flash-0731",
  luna: "gpt-5.6-luna",
} as const;

type ModelKey = keyof typeof MODELS;

type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  reasoning_tokens?: number;
  cost?: number;
  [key: string]: unknown;
};

type BenchRow = {
  task: "summary" | "html";
  caseId: string;
  modelKey: ModelKey;
  model: string;
  startedAt: string;
  httpStatus: number | null;
  timeout: boolean;
  error: string | null;
  latencyMs: number;
  finishReason: string | null;
  usage: Usage | null;
  outputChars: number;
  output: string;
  expectedKeep?: string[];
  expectedAvoid?: string[];
  htmlRequired?: string[];
};

const SUMMARY_SYSTEM = `[5턴 히스토리 요약]

5턴 배치의 사건을 발생 순서대로 요약한다. 사건 시기와 인과관계를 누락하지 않는다.
마지막 턴만 보고 요약하지 않는다. 응답 전에 요약 대상 source 턴의 앞·중간·뒤를 모두 검토하고,
서로 다른 중요한 사건이 있으면 각 구간의 원인·전환·결과가 최종 요약에 남았는지 자체 점검한다.
단, 변화가 없는 짧은 반응이나 반복은 생략할 수 있다.
작중 시간은 본문·상태창·정본에 명시된 경우에만 기록하며, 불명확하면 추측하지 않는다.
현실 날짜·요약 생성일·턴 범위는 본문에 쓰지 않고 서버 metadata로 관리한다.

[형식]
- 음슴체(명사형·~함·~임 종결)로 간결하게. 존댓말 서술(~했다/~였다)보다 글자를 절약한다.
- 원인 → 행동·선택 → 결과 → 관계·감정 변화 순
- 최대 1000자. 중요 정보가 적으면 짧게 끝내며 분량을 억지로 채우지 않는다. 반복 장면이면 짧아도 된다.
- 파편식 단문 나열과 분위기 묘사 중심 요약 금지
- 유저의 명확한 선택이 캐릭터의 태도·감정·행동에 영향을 주었으면 반드시 기록
- 유저의 생각·의도·감정을 입력에 없는 내용으로 추측하지 않는다.

[반드시 보존]
1. 주요 사건과 그 결과
2. 관계 역학 또는 감정 방향의 변화
3. 인물이 자신이나 상대를 규정한 선언
4. 약속·계약·임무·미해결 목표
5. 중요한 물건의 획득·전달·분실과 현재 소유자
6. 새로 밝혀진 비밀·정체·세계관 정보
7. 부상·능력·신분·장소 등 이후 전개에 영향을 주는 상태 변화
8. 관계와 사건의 전환점이 된 대사

[전환점 대사]
- 원문 메시지에서 정확히 확인 가능한 경우에만 최대 1~2개를 그대로 인용
- 문구가 불확실하면 인용문을 새로 만들지 말고 의미만 요약
- 장식적인 대사와 반복 대사는 제외

[삭제·압축]
- 같은 관계 역학의 반복은 최초 또는 가장 강한 전환점 한 번만 보존
- 관계나 사건 변화가 없는 분위기·감각·일상 묘사 삭제
- 같은 흐름이 여러 턴 이어지면 하나의 인과 흐름으로 병합
- 이미 캐논에 고정된 외형·직업·말투를 반복 기록하지 않음

[판단 기준]
다음 질문 중 하나라도 "예"이면 보존한다.
- 이 줄을 삭제하면 이후 사건의 인과가 달라지는가?
- 관계 궤적이나 감정 방향이 달라지는가?
- 누가 무엇을 알고 있는지가 달라지는가?
- 약속·임무·소유물·현재 상태가 달라지는가?

[OOC 제외]: (OOC:) 메타·UI·SNS mock·RP 중단 연출은 기록하지 않는다. 요약 본문만 출력한다.

[CANONICAL GROUNDING — REQUIRED]
- Output the event summary itself. Never repeat, paraphrase, or explain these summary instructions.
- Write a normal, concise RP scene summary.
- Only for strong claims that would change canon: if the source had them as a character's guess, keep the guess framing.
- Do not expose turn numbers, source checklists, or prompt wording in the final summary.`;

const summaryCases = [
  {
    id: "S1_promise_item",
    expectedKeep: ["방독면 필터", "내일", "북문", "강이현"],
    expectedAvoid: ["관리자 패널", "OOC"],
    dialogue: `[1턴]\n유저: 필터가 거의 끝났어. 남은 게 하나뿐이야.\n강이현: 강이현은 배낭을 뒤져 새 방독면 필터 하나를 꺼내 렌에게 건넸다. "이건 네가 가져. 난 아직 버틸 만해."\n\n[2턴]\n유저: 그럼 내일 북문 정찰 같이 가. 혼자 가지 마.\n강이현: 잠시 망설이다가 고개를 끄덕였다. "내일 북문. 같이 간다. 약속."\n\n[3턴]\n유저: 필터를 장착하고 상태를 확인한다.\n강이현: 새 필터는 정상 작동했고 렌의 예비 필터 보유량은 0개가 됐다. 강이현은 자신의 낡은 필터를 계속 사용했다.\n\n[4턴]\n유저: (OOC: 관리자 패널에는 정찰 일정 카드를 파란색으로 표시해줘.)\n강이현: 강이현은 북문 쪽 지도를 펼쳐 위험 구간 세 곳에 표시를 남겼다.\n\n[5턴]\n유저: 내일 도망가면 진짜 화낼 거야.\n강이현: "안 도망가." 농담기 없이 답하며 지도 위 북문을 두드렸다.`
  },
  {
    id: "S2_uncertain_identity",
    expectedKeep: ["에녹", "성채", "추측", "문양"],
    expectedAvoid: ["확정적으로 배신", "기억상실 확정"],
    dialogue: `[1턴]\n유저: 이 문양, 성채에서 본 것 같아. 확실하진 않아.\n에녹: 에녹은 금속 표식의 삼중 원 문양을 살폈다. 성채 정찰대 표식과 닮았지만 위조 가능성이 있다고 말했다.\n\n[2턴]\n유저: 그럼 성채가 우릴 쫓는 거야?\n에녹: "가능성 중 하나다. 아직 결론 내리지 마."라며 추적 주체를 확정하지 않았다.\n\n[3턴]\n유저: 머리가 아파. 예전에 이걸 봤는지는 잘 모르겠어.\n에녹: 렌의 통증을 확인했지만 기억상실이나 과거 연관성을 단정하지 않았다.\n\n[4턴]\n유저: 표식은 챙겨두자.\n에녹: 금속 표식을 증거물 봉투에 넣어 자신이 보관했다.\n\n[5턴]\n유저: 일단 성채 쪽으로 간다는 건 보류하자.\n에녹: 에녹은 동의하며 성채 접근 계획을 보류하고 표식 출처 조사부터 하기로 했다.`
  },
  {
    id: "S3_injury_status",
    expectedKeep: ["권태현", "왼팔", "출혈", "후퇴", "탄약"],
    expectedAvoid: ["사망", "절단"],
    dialogue: `[1턴]\n유저: 오른쪽 통로에서 포드 소리가 나.\n권태현: 권태현은 렌을 뒤로 밀고 왼쪽 통로로 이동하라고 지시했다.\n\n[2턴]\n유저: 같이 움직여!\n권태현: 뒤를 막으며 두 발을 쐈고 탄약은 6발에서 4발로 줄었다.\n\n[3턴]\n유저: 태현아, 팔!\n권태현: 파편에 왼팔이 길게 베여 출혈이 시작됐지만 뼈나 신경 손상 징후는 없었다.\n\n[4턴]\n유저: 지혈대를 감는다.\n권태현: 렌의 처치로 출혈이 크게 줄었다. 권태현은 전투 지속보다 후퇴를 선택했다.\n\n[5턴]\n유저: 출구까지 뛴다.\n권태현: 둘은 폐쇄된 정비실로 후퇴해 문을 잠갔다. 권태현의 탄약은 4발, 왼팔은 지혈된 상태로 남았다.`
  },
  {
    id: "S4_time_location",
    expectedKeep: ["18:40", "지하철역", "옥상", "22:10"],
    expectedAvoid: ["20:00"],
    dialogue: `[1턴]\n유저: 지금 몇 시야?\n레온: 역 벽의 시계를 확인했다. 18:40, 장소는 폐쇄된 지하철역 대합실이었다.\n\n[2턴]\n유저: 지상으로 올라가자.\n레온: 비상계단을 통해 지상 상가로 이동했다.\n\n[3턴]\n유저: 여기서 좀 쉬자.\n레온: 상가에서 정확한 시간 확인 없이 한동안 휴식했다.\n\n[4턴]\n유저: 옥상 신호기를 확인하러 간다.\n레온: 두 사람은 건물 옥상으로 올라갔고 신호기는 꺼져 있었다.\n\n[5턴]\n유저: 시계가 보인다.\n레온: 옥상 전광시계가 22:10을 표시했다. 둘은 옥상에서 신호기 고장을 확인했다.`
  },
  {
    id: "S5_relationship_boundary",
    expectedKeep: ["렌", "싫다", "거리", "사과"],
    expectedAvoid: ["연인 확정", "동의했다"],
    dialogue: `[1턴]\n유저: 가까이 다가오는 건 괜찮지만 갑자기 손목 잡는 건 싫어.\n라이크: 라이크는 즉시 손을 놓고 한 걸음 물러섰다.\n\n[2턴]\n유저: 화난 건 아니야. 그냥 먼저 말해줘.\n라이크: "알았어. 다음부턴 묻고 할게."라고 답했다.\n\n[3턴]\n유저: 그 정도 거리면 괜찮아.\n라이크: 정해준 거리를 유지한 채 옆에 섰다.\n\n[4턴]\n유저: 아까는 좀 놀랐어.\n라이크: 자신의 행동 때문에 놀라게 한 점을 사과했다.\n\n[5턴]\n유저: 이제 가자.\n라이크: 손을 대지 않고 렌의 속도에 맞춰 함께 출발했다.`
  }
] as const;

const htmlSystem = `너는 한국어 OOC/UI HTML 조각을 만드는 백그라운드 포매터다.
사용자의 OOC 요청 내용을 정확히 반영해 보기 좋은 HTML fragment만 출력한다.
마크다운 코드펜스, 설명문, 사과문, JSON은 출력하지 않는다.
script, iframe, 외부 리소스는 쓰지 않는다.
요청된 텍스트·숫자·순서를 임의로 바꾸지 않는다.
닫는 태그를 누락하지 않는다.`;

const htmlCases = [
  {
    id: "H1_notice",
    required: ["data-bench=\"H1_notice\"", "북문 정찰", "07:30", "필터 2개"],
    prompt: `OOC: data-bench="H1_notice" 속성을 가진 하나의 카드로 꾸며줘. 제목은 "북문 정찰", 시간은 "07:30", 준비물은 "필터 2개". 제목/시간/준비물을 시각적으로 구분하고 HTML만 출력.`
  },
  {
    id: "H2_status",
    required: ["data-bench=\"H2_status\"", "오염도", "37%", "탄약", "4발", "장소", "정비실"],
    prompt: `OOC: data-bench="H2_status" 상태 카드를 HTML로 만들어줘. 정확한 값: 오염도 37%, 탄약 4발, 장소 정비실. 세 항목 모두 보여야 하고 HTML fragment만 출력.`
  },
  {
    id: "H3_long_korean",
    required: ["data-bench=\"H3_long_korean\"", "관측 기록", "청록색 균사", "서쪽 벽", "접촉 금지"],
    prompt: `OOC: data-bench="H3_long_korean" 정보 패널. 제목 "관측 기록". 본문 문구를 그대로 보존: "청록색 균사가 서쪽 벽 전체로 번지고 있음. 포자 농도 상승 징후가 있어 접촉 금지." 중요 경고를 강조해서 HTML만 출력.`
  },
  {
    id: "H4_conditional",
    required: ["data-bench=\"H4_conditional\"", "필터", "12%", "즉시 교체", "식량", "3일분"],
    prompt: `OOC: data-bench="H4_conditional" 자원 카드. 필터 잔량 12%는 위험 상태라 "즉시 교체" 경고를 붙이고, 식량 3일분은 일반 상태로 표시. 두 자원을 분리해서 HTML fragment만 출력.`
  },
  {
    id: "H5_special_chars",
    required: ["data-bench=\"H5_special_chars\"", "렌 & 에녹", "A-17", "'회색 안개'", "3 < 5"],
    prompt: `OOC: data-bench="H5_special_chars" 로그 카드. 다음 문자열의 의미와 표시를 보존해줘: 이름 "렌 & 에녹", 코드 "A-17", 메모 "'회색 안개' 경보", 비교식 "3 < 5". HTML에서 특수문자를 안전하게 처리하고 HTML만 출력.`
  }
] as const;

function modelBody(modelKey: ModelKey, messages: Array<{role: "system" | "user"; content: string}>, maxTokens: number) {
  const body: Record<string, unknown> = {
    model: MODELS[modelKey],
    messages,
    temperature: 0,
    max_tokens: maxTokens,
  };
  if (modelKey === "deepseek") {
    body.thinking = { type: "disabled" };
  } else {
    body.reasoning = { effort: "none" };
    body.reasoning_effort = "none";
  }
  return body;
}

function visibleText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((p) => {
    if (typeof p === "string") return p;
    if (p && typeof p === "object" && "text" in p) {
      const t = (p as { text?: unknown }).text;
      return typeof t === "string" ? t : "";
    }
    return "";
  }).join("");
}

async function oneCall(opts: {
  task: "summary" | "html";
  caseId: string;
  modelKey: ModelKey;
  system: string;
  user: string;
  maxTokens: number;
  expectedKeep?: readonly string[];
  expectedAvoid?: readonly string[];
  htmlRequired?: readonly string[];
}): Promise<BenchRow> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("deadline exceeded")), DEADLINE_MS);
  let httpStatus: number | null = null;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(modelBody(opts.modelKey, [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ], opts.maxTokens)),
      signal: controller.signal,
    });
    httpStatus = res.status;
    const raw = await res.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch {}
    const output = visibleText(json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? "").trim();
    const usage = (json?.usage && typeof json.usage === "object") ? json.usage as Usage : null;
    const finishReason = typeof json?.choices?.[0]?.finish_reason === "string" ? json.choices[0].finish_reason : null;
    return {
      task: opts.task,
      caseId: opts.caseId,
      modelKey: opts.modelKey,
      model: MODELS[opts.modelKey],
      startedAt,
      httpStatus,
      timeout: false,
      error: res.ok ? null : `HTTP ${res.status}: ${raw.slice(0, 800)}`,
      latencyMs: Date.now() - started,
      finishReason,
      usage,
      outputChars: output.length,
      output,
      expectedKeep: opts.expectedKeep ? [...opts.expectedKeep] : undefined,
      expectedAvoid: opts.expectedAvoid ? [...opts.expectedAvoid] : undefined,
      htmlRequired: opts.htmlRequired ? [...opts.htmlRequired] : undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    const timeout = controller.signal.aborted || /abort|deadline|timeout/i.test(msg);
    return {
      task: opts.task,
      caseId: opts.caseId,
      modelKey: opts.modelKey,
      model: MODELS[opts.modelKey],
      startedAt,
      httpStatus,
      timeout,
      error: msg,
      latencyMs: Date.now() - started,
      finishReason: null,
      usage: null,
      outputChars: 0,
      output: "",
      expectedKeep: opts.expectedKeep ? [...opts.expectedKeep] : undefined,
      expectedAvoid: opts.expectedAvoid ? [...opts.expectedAvoid] : undefined,
      htmlRequired: opts.htmlRequired ? [...opts.htmlRequired] : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rows: BenchRow[] = [];

  for (let i = 0; i < summaryCases.length; i++) {
    const c = summaryCases[i]!;
    const order: ModelKey[] = i % 2 === 0 ? ["deepseek", "luna"] : ["luna", "deepseek"];
    for (const modelKey of order) {
      const row = await oneCall({
        task: "summary",
        caseId: c.id,
        modelKey,
        system: SUMMARY_SYSTEM,
        user: c.dialogue,
        maxTokens: 900,
        expectedKeep: c.expectedKeep,
        expectedAvoid: c.expectedAvoid,
      });
      rows.push(row);
      console.log(JSON.stringify({ task: row.task, caseId: row.caseId, model: row.model, status: row.httpStatus, timeout: row.timeout, latencyMs: row.latencyMs, outputChars: row.outputChars, error: row.error }));
    }
  }

  for (let i = 0; i < htmlCases.length; i++) {
    const c = htmlCases[i]!;
    const order: ModelKey[] = i % 2 === 0 ? ["deepseek", "luna"] : ["luna", "deepseek"];
    for (const modelKey of order) {
      const row = await oneCall({
        task: "html",
        caseId: c.id,
        modelKey,
        system: htmlSystem,
        user: c.prompt,
        maxTokens: 1200,
        htmlRequired: c.required,
      });
      rows.push(row);
      console.log(JSON.stringify({ task: row.task, caseId: row.caseId, model: row.model, status: row.httpStatus, timeout: row.timeout, latencyMs: row.latencyMs, outputChars: row.outputChars, error: row.error }));
    }
  }

  const result = {
    benchmark: "background-luna-vs-deepseek",
    sourceMainSha: "0780df9d89f2ef493d5aae8ef118874d270d5f6e",
    endpoint: ENDPOINT,
    deadlineMs: DEADLINE_MS,
    retry: 0,
    failover: 0,
    dbWrites: 0,
    pointCharges: 0,
    modelSettings: {
      deepseek: { model: MODELS.deepseek, thinking: { type: "disabled" } },
      luna: { model: MODELS.luna, reasoning: { effort: "none" }, reasoning_effort: "none" },
    },
    rows,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), "utf8");
  console.log(`RESULT_FILE=${OUT_FILE}`);
  console.log(`CALLS=${rows.length}`);
  console.log("NO_WINNER_COMPUTED=true");
  console.log("Paste results.json back to ChatGPT for manual quality/reliability/speed scoring.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
