/**
 * Live A/B gate (no DB writes, no point charge):
 *   A = character initial + user initial (2 calls)
 *   B = dual combined initial (1 call)
 *
 * Model: google/gemini-2.5-flash
 *
 * Usage:
 *   npx tsx --conditions=react-server scripts/ab-dual-combined-status-extract-live.ts
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
const OUT = path.resolve("output/ab-dual-combined-status-extract-live");
const RUNS_PER_CASE = 2;

const CHARACTER_WIDGET = {
  version: 1 as const,
  name: "상태창",
  placement: "bottom" as const,
  htmlTemplate: "{{시간}} {{장소}} {{속마음}} {{현재상황}}",
  fields: [
    { id: "시간", label: "시간", instruction: "HH:MM 형식의 현재 시각", initialValue: "08:30" },
    { id: "장소", label: "장소", instruction: "현재 장소" },
    { id: "속마음", label: "속마음", instruction: "NPC의 현재 속마음" },
    { id: "현재상황", label: "현재상황", instruction: "지금 벌어지는 상황 한 줄" },
  ],
};

const USER_WIDGET = {
  version: 1 as const,
  name: "유저 상태",
  placement: "bottom" as const,
  htmlTemplate: "{{시간}} {{장소}} {{속마음}} {{현재감정}}",
  fields: [
    { id: "시간", label: "시간", instruction: "HH:MM 형식의 현재 시각" },
    { id: "장소", label: "장소", instruction: "유저 기준 현재 장소" },
    { id: "속마음", label: "속마음", instruction: "유저의 현재 속마음" },
    { id: "현재감정", label: "현재 감정", instruction: "유저의 현재 감정" },
  ],
};

type Scenario = {
  id: string;
  label: string;
  userMessage: string;
  assistantProse: string;
  previousCharacter: Record<string, string>;
  previousUser: Record<string, string>;
  expectTime?: string;
  expectPlace?: string;
};

const SCENARIOS: Scenario[] = [
  {
    id: "1_general_dual_pov",
    label: "일반 dual — character/user POV 분리",
    userMessage: "걱정되며 다가간다.",
    assistantProse:
      "레온은 명령서를 접으며 표정을 굳힌다. 렌은 복도 끝에서 그를 걱정스럽게 바라본다. 시각은 14:20, 장소는 사령부 복도다.",
    previousCharacter: {
      시간: "14:00",
      장소: "사령부",
      속마음: "담담하다",
      현재상황: "대기",
    },
    previousUser: {
      시간: "14:00",
      장소: "사령부",
      속마음: "평온하다",
      현재감정: "차분",
    },
    expectPlace: "복도",
  },
  {
    id: "2_time_advance",
    label: "시간 진행 — previous 18:30 + 2시간 대기 → 20:30",
    userMessage: "두 시간 기다린다",
    assistantProse:
      "복도에서 발걸음을 멈춘 채 그를 바라본다. 대기실 시계는 분명히 움직였고, 두 시간이 지난 뒤에도 그는 그 자리에 있다.",
    previousCharacter: {
      시간: "18:30",
      장소: "복도",
      속마음: "초조하다",
      현재상황: "대기",
    },
    previousUser: {
      시간: "18:30",
      장소: "복도",
      속마음: "불안하다",
      현재감정: "긴장",
    },
    expectTime: "20:30",
  },
  {
    id: "3_final_scene",
    label: "final-scene priority — 최종 장소만",
    userMessage: "따라간다.",
    assistantProse:
      "오전 9시, 숙소에서 짐을 챙긴다. 복도를 지나 엘리베이터를 탄다. 카페에 잠깐 들렀다가, 밤 11시 옥상으로 이동한다. 바람이 세다.",
    previousCharacter: {
      시간: "09:00",
      장소: "숙소",
      속마음: "침착하다",
      현재상황: "이동 준비",
    },
    previousUser: {
      시간: "09:00",
      장소: "숙소",
      속마음: "기대된다",
      현재감정: "설렘",
    },
    expectPlace: "옥상",
  },
  {
    id: "4_explicit_override",
    label: "explicit override — 현재 변화 > previous",
    userMessage: "지금은 도서관이다. 이전 카페 얘기는 잊어.",
    assistantProse:
      "레온은 책장을 쓰다듬으며 낮게 말한다. 형광등 아래 조용한 도서관. 시각은 16:10.",
    previousCharacter: {
      시간: "15:00",
      장소: "카페",
      속마음: "여유롭다",
      현재상황: "커피",
    },
    previousUser: {
      시간: "15:00",
      장소: "카페",
      속마음: "편안하다",
      현재감정: "평온",
    },
    expectPlace: "도서관",
  },
];

function usableKeys(values: Record<string, string> | null | undefined): string[] {
  if (!values) return [];
  return Object.entries(values)
    .filter(([, v]) => typeof v === "string" && v.trim() && v.trim() !== "—" && v.trim() !== "…")
    .map(([k]) => k)
    .sort();
}

function looksLikeEcho(value: string | undefined, phrases: string[]): boolean {
  if (!value) return false;
  const n = value.replace(/\s+/g, "").toLowerCase();
  return phrases.some((p) => n.includes(p.replace(/\s+/g, "").toLowerCase()) && n.length <= p.length + 4);
}

function detectTemporalUnknown(values: Record<string, string> | null | undefined): boolean {
  if (!values) return false;
  return Object.entries(values).some(
    ([k, v]) =>
      /시간|시각|clock|time/i.test(k) &&
      /알\s*수\s*없|미상|모름|unknown|n\/a/i.test(String(v ?? ""))
  );
}

function detectPovMix(
  character: Record<string, string> | null | undefined,
  user: Record<string, string> | null | undefined
): boolean {
  const charInner = character?.["속마음"] ?? "";
  const userInner = user?.["속마음"] ?? "";
  // Crude: identical non-empty inner states often indicate POV collapse.
  if (charInner.trim() && userInner.trim() && charInner.trim() === userInner.trim()) return true;
  if (/걱정|불안|초조/.test(charInner) && /명령|출동|임무/.test(userInner)) return true;
  return false;
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
  const { isUnknownLikeStatusValue } = await import("../src/lib/statusWidget/temporalUnknown");
  const { dropRepairEchoFields } = await import("../src/lib/statusWidget/extractNormalize");

  const charJson = serializeStatusWidget(CHARACTER_WIDGET);
  const userJson = serializeStatusWidget(USER_WIDGET);

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

  type RunRow = {
    scenarioId: string;
    path: "A_dual_separate" | "B_combined";
    run: number;
    callCount: number;
    inputTokens: number;
    outputTokens: number;
    upstreamCostUsd: number | null;
    finishReason: string | null;
    jsonParseOk: boolean;
    characterUsableKeys: string[];
    userUsableKeys: string[];
    temporalUnknown: boolean;
    povMix: boolean;
    instructionEcho: boolean;
    character: Record<string, string> | null;
    user: Record<string, string> | null;
    latencyMs: number;
    qualityNotes: string[];
  };

  const rows: RunRow[] = [];

  for (const scenario of SCENARIOS) {
    for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
      // ── Path A: two single extracts ─────────────────────────────────────
      {
        const charResolved = resolveStatusWidgetTurn({
          characterWidgetJson: charJson,
          userWidgetJson: null,
          chatMode: "character_only",
          displayMode: "creator",
        });
        const userResolved = resolveStatusWidgetTurn({
          characterWidgetJson: null,
          userWidgetJson: userJson,
          chatMode: "user_only",
          displayMode: "user",
          characterAllowUserOverride: true,
        });
        // Force user_only engine: resolve may clamp without character widget.
        const userOnly = {
          ...userResolved,
          active: true,
          mode: "user_only" as const,
          needsCharacterValues: false,
          needsUserValues: true,
          userWidget: USER_WIDGET,
          characterWidget: null,
        };

        const started = Date.now();
        const charResult = await extractStatusWidgetValuesForTurn({
          charName: "레온",
          personaName: "렌",
          userMessage: scenario.userMessage,
          assistantProse: scenario.assistantProse,
          resolved: charResolved,
          previousValues: { character: scenario.previousCharacter },
          primaryModelId: MODEL,
          caller,
        });
        const userResult = await extractStatusWidgetValuesForTurn({
          charName: "레온",
          personaName: "렌",
          userMessage: scenario.userMessage,
          assistantProse: scenario.assistantProse,
          resolved: userOnly,
          previousValues: { user: scenario.previousUser },
          primaryModelId: MODEL,
          caller,
        });
        const latencyMs = Date.now() - started;
        const character = (charResult.values.character ?? null) as Record<string, string> | null;
        const user = (userResult.values.user ?? null) as Record<string, string> | null;
        const echoChar = character
          ? dropRepairEchoFields(character, CHARACTER_WIDGET).droppedKeys
          : [];
        const echoUser = user ? dropRepairEchoFields(user, USER_WIDGET).droppedKeys : [];
        const qualityNotes: string[] = [];
        if (scenario.expectTime && character?.["시간"] && character["시간"] !== scenario.expectTime) {
          qualityNotes.push(`char time got ${character["시간"]} expect ${scenario.expectTime}`);
        }
        if (scenario.expectPlace && character?.["장소"] && !character["장소"].includes(scenario.expectPlace)) {
          qualityNotes.push(`char place got ${character["장소"]} expect ~${scenario.expectPlace}`);
        }
        if (
          character?.["장소"] === scenario.previousCharacter["장소"] &&
          scenario.id === "4_explicit_override"
        ) {
          qualityNotes.push("char place looks like previous copy");
        }

        const row: RunRow = {
          scenarioId: scenario.id,
          path: "A_dual_separate",
          run,
          callCount:
            (charResult.meta.actualCallCount ?? 0) + (userResult.meta.actualCallCount ?? 0),
          inputTokens:
            (charResult.usage?.inputTokens ?? 0) + (userResult.usage?.inputTokens ?? 0),
          outputTokens:
            (charResult.usage?.outputTokens ?? 0) + (userResult.usage?.outputTokens ?? 0),
          upstreamCostUsd: (() => {
            const u =
              (charResult.usage?.upstreamCostUsd ?? 0) + (userResult.usage?.upstreamCostUsd ?? 0);
            return u > 0 ? u : null;
          })(),
          finishReason:
            charResult.usage?.finishReason ?? userResult.usage?.finishReason ?? null,
          jsonParseOk: Boolean(character && user),
          characterUsableKeys: usableKeys(character),
          userUsableKeys: usableKeys(user),
          temporalUnknown:
            detectTemporalUnknown(character) ||
            detectTemporalUnknown(user) ||
            Object.values(character ?? {}).some((v) => isUnknownLikeStatusValue(v)) ||
            Object.values(user ?? {}).some((v) => isUnknownLikeStatusValue(v)),
          povMix: detectPovMix(character, user),
          instructionEcho: echoChar.length + echoUser.length > 0 ||
            looksLikeEcho(character?.["속마음"], ["NPC의 속마음", "유저의 속마음"]) ||
            looksLikeEcho(user?.["속마음"], ["NPC의 속마음", "유저의 속마음"]),
          character,
          user,
          latencyMs,
          qualityNotes,
        };
        rows.push(row);
        fs.writeFileSync(
          path.join(OUT, `${scenario.id}_A_run${run}.json`),
          JSON.stringify(row, null, 2),
          "utf8"
        );
        console.log(JSON.stringify({ ...row, character: undefined, user: undefined }));
      }

      // ── Path B: combined initial ─────────────────────────────────────────
      {
        const bothResolved = resolveStatusWidgetTurn({
          characterWidgetJson: charJson,
          userWidgetJson: userJson,
          chatMode: "both",
          displayMode: "both",
          characterAllowUserOverride: true,
        });
        const started = Date.now();
        const result = await extractStatusWidgetValuesForTurn({
          charName: "레온",
          personaName: "렌",
          userMessage: scenario.userMessage,
          assistantProse: scenario.assistantProse,
          resolved: bothResolved,
          previousValues: {
            character: scenario.previousCharacter,
            user: scenario.previousUser,
          },
          primaryModelId: MODEL,
          caller,
        });
        const latencyMs = Date.now() - started;
        const character = (result.values.character ?? null) as Record<string, string> | null;
        const user = (result.values.user ?? null) as Record<string, string> | null;
        const echoChar = character
          ? dropRepairEchoFields(character, CHARACTER_WIDGET).droppedKeys
          : [];
        const echoUser = user ? dropRepairEchoFields(user, USER_WIDGET).droppedKeys : [];
        const qualityNotes: string[] = [];
        if (scenario.expectTime && character?.["시간"] && character["시간"] !== scenario.expectTime) {
          qualityNotes.push(`char time got ${character["시간"]} expect ${scenario.expectTime}`);
        }
        if (scenario.expectPlace && character?.["장소"] && !character["장소"].includes(scenario.expectPlace)) {
          qualityNotes.push(`char place got ${character["장소"]} expect ~${scenario.expectPlace}`);
        }
        if (
          character?.["장소"] === scenario.previousCharacter["장소"] &&
          scenario.id === "4_explicit_override"
        ) {
          qualityNotes.push("char place looks like previous copy");
        }

        const row: RunRow = {
          scenarioId: scenario.id,
          path: "B_combined",
          run,
          callCount: result.meta.actualCallCount,
          inputTokens: result.usage?.inputTokens ?? 0,
          outputTokens: result.usage?.outputTokens ?? 0,
          upstreamCostUsd: result.usage?.upstreamCostUsd ?? null,
          finishReason: result.usage?.finishReason ?? null,
          jsonParseOk: Boolean(character && user),
          characterUsableKeys: usableKeys(character),
          userUsableKeys: usableKeys(user),
          temporalUnknown:
            detectTemporalUnknown(character) ||
            detectTemporalUnknown(user),
          povMix: detectPovMix(character, user),
          instructionEcho:
            echoChar.length + echoUser.length > 0 ||
            looksLikeEcho(character?.["속마음"], ["NPC의 속마음", "유저의 속마음"]) ||
            looksLikeEcho(user?.["속마음"], ["NPC의 속마음", "유저의 속마음"]),
          character,
          user,
          latencyMs,
          qualityNotes,
        };
        rows.push(row);
        fs.writeFileSync(
          path.join(OUT, `${scenario.id}_B_run${run}.json`),
          JSON.stringify(row, null, 2),
          "utf8"
        );
        console.log(JSON.stringify({ ...row, character: undefined, user: undefined }));
      }
    }
  }

  const pathA = rows.filter((r) => r.path === "A_dual_separate");
  const pathB = rows.filter((r) => r.path === "B_combined");
  const sum = (xs: RunRow[], key: "inputTokens" | "outputTokens" | "callCount" | "latencyMs") =>
    xs.reduce((s, r) => s + r[key], 0);
  const sumUpstream = (xs: RunRow[]) =>
    xs.reduce((s, r) => s + (r.upstreamCostUsd ?? 0), 0);
  const success = (xs: RunRow[]) =>
    xs.filter((r) => r.jsonParseOk && r.characterUsableKeys.length > 0 && r.userUsableKeys.length > 0)
      .length;

  const report = {
    model: MODEL,
    runsPerScenario: RUNS_PER_CASE,
    scenarioCount: SCENARIOS.length,
    totalRunsPerPath: pathA.length,
    A: {
      totalCallCount: sum(pathA, "callCount"),
      inputTokens: sum(pathA, "inputTokens"),
      outputTokens: sum(pathA, "outputTokens"),
      upstreamCostUsd: sumUpstream(pathA),
      latencyMs: sum(pathA, "latencyMs"),
      successRate: `${success(pathA)}/${pathA.length}`,
      avgCallCount: sum(pathA, "callCount") / pathA.length,
    },
    B: {
      totalCallCount: sum(pathB, "callCount"),
      inputTokens: sum(pathB, "inputTokens"),
      outputTokens: sum(pathB, "outputTokens"),
      upstreamCostUsd: sumUpstream(pathB),
      latencyMs: sum(pathB, "latencyMs"),
      successRate: `${success(pathB)}/${pathB.length}`,
      avgCallCount: sum(pathB, "callCount") / pathB.length,
    },
    savings: {
      callCount: sum(pathA, "callCount") - sum(pathB, "callCount"),
      inputTokens: sum(pathA, "inputTokens") - sum(pathB, "inputTokens"),
      outputTokens: sum(pathA, "outputTokens") - sum(pathB, "outputTokens"),
      upstreamCostUsd: sumUpstream(pathA) - sumUpstream(pathB),
    },
    rows,
  };

  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(report, null, 2), "utf8");
  console.log("\n=== A/B SUMMARY ===");
  console.log(JSON.stringify({ model: report.model, A: report.A, B: report.B, savings: report.savings }, null, 2));
  console.log("wrote", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
