/**
 * Live gate: large dual-widget combined B path only (no DB / no points).
 * Model: google/gemini-2.5-flash
 *
 * Usage:
 *   npx tsx --conditions=react-server scripts/ab-combined-large-dual-budget-live.ts
 */
import fs from "fs";
import path from "path";
import Module from "module";
import { loadEnvLocal } from "./load-env-local";

const origLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return origLoad(request, parent as NodeModule, isMain);
};

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const MODEL = "google/gemini-2.5-flash";
process.env.BACKGROUND_MEMORY_MODEL = MODEL;
const OUT = path.resolve("output/ab-combined-large-dual-budget-live");
const RUNS = 3;

/** Chat-27-like large dual widgets (many free-text fields). */
const CHARACTER_WIDGET = {
  version: 1 as const,
  name: "대형 캐릭터 상태창",
  placement: "bottom" as const,
  htmlTemplate:
    "{{시간}} {{장소}} {{속마음}} {{현재상황}} {{의식의흐름}} {{유저와의_관계}} {{안개_수위}} {{소지품}} {{NPC의의상}} {{PC의의상}} {{가이딩수치}} {{속마음표정}}",
  fields: [
    { id: "시간", label: "시간", instruction: "현재 시각" },
    { id: "장소", label: "장소", instruction: "현재 장소" },
    { id: "속마음", label: "속마음", instruction: "NPC의 현재 속마음 서술" },
    { id: "현재상황", label: "현재상황", instruction: "지금 벌어지는 상황 한 줄 서술" },
    { id: "의식의흐름", label: "의식의 흐름", instruction: "NPC의 의식의 흐름 문장" },
    { id: "유저와의_관계", label: "유저와의 관계", instruction: "유저와의 관계" },
    { id: "안개_수위", label: "안개 수위", instruction: "안개 수위" },
    { id: "소지품", label: "소지품", instruction: "소지품 목록" },
    { id: "NPC의의상", label: "NPC의 의상", instruction: "NPC 의상" },
    { id: "PC의의상", label: "PC의 의상", instruction: "PC 의상" },
    { id: "가이딩수치", label: "가이딩 수치", instruction: "수치" },
    { id: "속마음표정", label: "속마음 표정", instruction: "표정 이모지" },
  ],
};

const USER_WIDGET = {
  version: 1 as const,
  name: "대형 유저 상태창",
  placement: "bottom" as const,
  htmlTemplate: "{{시간}} {{장소}} {{속마음}} {{현재상황}} {{의식의흐름}} {{현재감정}} {{컨디션}} {{목표}}",
  fields: [
    { id: "시간", label: "시간", instruction: "유저 기준 현재 시각" },
    { id: "장소", label: "장소", instruction: "유저 기준 현재 장소" },
    { id: "속마음", label: "속마음", instruction: "유저의 현재 속마음 서술" },
    { id: "현재상황", label: "현재상황", instruction: "유저 시점 현재 상황 서술" },
    { id: "의식의흐름", label: "의식의 흐름", instruction: "유저의 의식의 흐름 문장" },
    { id: "현재감정", label: "현재 감정", instruction: "유저의 현재 감정" },
    { id: "컨디션", label: "컨디션", instruction: "유저 컨디션" },
    { id: "목표", label: "목표", instruction: "유저 단기 목표" },
  ],
};

function usableKeys(values: Record<string, string> | null | undefined): string[] {
  if (!values) return [];
  return Object.entries(values)
    .filter(([, v]) => typeof v === "string" && v.trim() && v.trim() !== "—" && v.trim() !== "…")
    .map(([k]) => k)
    .sort();
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY missing");
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const { callBackgroundMemory } = await import("../src/lib/ai");
  const { extractStatusWidgetValuesForTurn } = await import("../src/lib/statusWidget/extract");
  const { serializeStatusWidget } = await import("../src/lib/statusWidget/serialize");
  const { resolveStatusWidgetTurn } = await import("../src/lib/statusWidget/resolve");
  const { resolveCombinedDualWidgetExtractMaxTokens } = await import(
    "../src/lib/statusWidget/extractNormalize"
  );

  const expectedMax = resolveCombinedDualWidgetExtractMaxTokens(CHARACTER_WIDGET, USER_WIDGET);
  console.log(JSON.stringify({ expectedCombinedMaxTokens: expectedMax, model: MODEL }));

  const charJson = serializeStatusWidget(CHARACTER_WIDGET);
  const userJson = serializeStatusWidget(USER_WIDGET);
  const bothResolved = resolveStatusWidgetTurn({
    characterWidgetJson: charJson,
    userWidgetJson: userJson,
    chatMode: "both",
    displayMode: "both",
    characterAllowUserOverride: true,
  });

  const caller = async (
    system: string,
    history: { role: "user" | "assistant"; content: string }[],
    opts: { requestKind: string; maxTokens?: number; temperature?: number; modelId: string }
  ) => {
    return callBackgroundMemory(system, history, undefined, opts.requestKind, {
      maxTokens: opts.maxTokens,
      temperature: opts.temperature ?? 0,
    });
  };

  const scene = {
    userMessage: "지금은 지하철 환승 통로다. 브레인 포드를 처치하고 포위를 돌파한다.",
    assistantProse:
      "레온은 마체테를 고쳐 쥐며 낮게 숨을 고른다. 형광등 아래 지하철 환승 통로가 아수라장이다. " +
      "브레인 포드의 정신 공격으로 휘청이던 태현이 서연의 외침에 중심을 잡고, 포드를 베어낸다. " +
      "성채 타격대가 모든 출입구를 틀어막자 레온은 루시안을 뒤로 밀어 넣고 요새 위로 화력을 쏟으라고 지시한다. " +
      "시각은 밤, 장소는 지하철 환승 통로. 렌의 가슴에는 생전 처음 느껴보는 동요가 남는다.",
    previousCharacter: {
      시간: "저녁",
      장소: "지하 통로",
      속마음: "경계한다",
      현재상황: "이동",
      의식의흐름: "위험하다",
      유저와의_관계: "임시 동행",
      안개_수위: "Level 1",
      소지품: "권총",
      NPC의의상: "전투복",
      PC의의상: "캐주얼",
      가이딩수치: "40",
      속마음표정: "(・_・)",
    },
    previousUser: {
      시간: "저녁",
      장소: "지하 통로",
      속마음: "긴장한다",
      현재상황: "따라간다",
      의식의흐름: "살아야 한다",
      현재감정: "긴장",
      컨디션: "보통",
      목표: "생존",
    },
  };

  const rows = [];
  for (let run = 1; run <= RUNS; run += 1) {
    let passedMax: number | undefined;
    const wrappedCaller: typeof caller = async (system, history, opts) => {
      if (opts.requestKind.includes("combined")) passedMax = opts.maxTokens;
      return caller(system, history, opts);
    };

    const started = Date.now();
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: scene.userMessage,
      assistantProse: scene.assistantProse,
      resolved: bothResolved,
      previousValues: {
        character: scene.previousCharacter,
        user: scene.previousUser,
      },
      primaryModelId: MODEL,
      caller: wrappedCaller,
    });
    const latencyMs = Date.now() - started;
    const character = (result.values.character ?? null) as Record<string, string> | null;
    const user = (result.values.user ?? null) as Record<string, string> | null;
    const repairCalls = Math.max(0, (result.meta.actualCallCount ?? 0) - 1);
    const row = {
      run,
      effectiveMaxTokens: passedMax ?? null,
      expectedMaxTokens: expectedMax,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      finishReason: result.usage?.finishReason ?? null,
      upstreamCostUsd: result.usage?.upstreamCostUsd ?? null,
      jsonParseOk: Boolean(character && user),
      characterUsableKeys: usableKeys(character),
      userUsableKeys: usableKeys(user),
      actualCallCount: result.meta.actualCallCount,
      repairCalls,
      extractMode: result.meta.extractMode,
      latencyMs,
      characterInner: character?.["속마음"] ?? null,
      userInner: user?.["속마음"] ?? null,
      characterPlace: character?.["장소"] ?? null,
      userPlace: user?.["장소"] ?? null,
    };
    rows.push(row);
    fs.writeFileSync(path.join(OUT, `run${run}.json`), JSON.stringify(row, null, 2), "utf8");
    console.log(JSON.stringify(row));
  }

  const pass = rows.filter(
    (r) =>
      r.jsonParseOk &&
      r.characterUsableKeys.length > 0 &&
      r.userUsableKeys.length > 0 &&
      r.actualCallCount === 1 &&
      r.repairCalls === 0 &&
      r.effectiveMaxTokens === expectedMax &&
      !/length|max[_-]?tokens/i.test(String(r.finishReason ?? ""))
  ).length;

  const summary = {
    model: MODEL,
    expectedCombinedMaxTokens: expectedMax,
    runs: RUNS,
    passRate: `${pass}/${RUNS}`,
    totalInputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
    totalOutputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
    totalCalls: rows.reduce((s, r) => s + r.actualCallCount, 0),
    upstreamCostUsdSum: rows.reduce((s, r) => s + (r.upstreamCostUsd ?? 0), 0),
    note: "upstreamCostUsd often null — do not claim USD savings from maxTokens ask",
    rows,
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log("\n=== LARGE DUAL COMBINED B SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("wrote", OUT);
  if (pass < RUNS) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
