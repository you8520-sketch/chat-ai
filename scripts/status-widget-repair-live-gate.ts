/**
 * Pre-merge gate: force initial empty, call real V3 repair only. No DB writes.
 *
 * Usage:
 *   npx tsx --conditions=react-server scripts/status-widget-repair-live-gate.ts
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

const OUT = path.resolve("output/status-widget-repair-live");

const CHARACTER10_LIKE_WIDGET = {
  version: 1 as const,
  name: "상태창",
  placement: "bottom" as const,
  htmlTemplate: "{{시간}} {{장소}} {{속마음}} {{현재상황}} {{소지품}} {{다음일정}}",
  fields: [
    { id: "시간", label: "시간", instruction: "HH:MM 형식의 현재 시각", initialValue: "08:30" },
    { id: "장소", label: "장소", instruction: "현재 장소" },
    { id: "속마음", label: "속마음", instruction: "NPC의 현재 속마음" },
    { id: "현재상황", label: "현재상황", instruction: "지금 벌어지는 상황 한 줄" },
    { id: "소지품", label: "소지품", instruction: "손에 들거나 지닌 물건" },
    { id: "다음일정", label: "다음일정", instruction: "곧 할 일 또는 예정" },
  ],
};

const USER_WIDGET = {
  version: 1 as const,
  name: "유저 상태",
  placement: "bottom" as const,
  htmlTemplate: "{{속마음}} {{현재감정}}",
  fields: [
    { id: "속마음", label: "속마음", instruction: "유저의 현재 속마음" },
    { id: "현재감정", label: "현재 감정", instruction: "유저의 현재 감정" },
  ],
};

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

  const charJson = serializeStatusWidget(CHARACTER10_LIKE_WIDGET);
  const userJson = serializeStatusWidget(USER_WIDGET);

  type Case = {
    id: string;
    userMessage: string;
    assistantProse: string;
    previousCharacter: Record<string, string> | null;
    both?: boolean;
  };

  const cases: Case[] = [
    {
      id: "A_no_time_pass",
      userMessage: "계속 말한다.",
      assistantProse: "복도에서 잠시 숨을 고른다. 창밖 불빛만 희미하다.",
      previousCharacter: {
        시간: "18:30",
        장소: "복도",
        속마음: "경계한다",
        현재상황: "대화",
        소지품: "통신기",
        다음일정: "보고",
      },
    },
    {
      id: "B_user_two_hours",
      userMessage: "두 시간 기다린다",
      assistantProse: "복도에서 발걸음을 멈춘 채 그를 바라본다. 시계 숫자는 읽히지 않는다.",
      previousCharacter: {
        시간: "18:30",
        장소: "복도",
        속마음: "초조하다",
        현재상황: "대기",
        소지품: "통신기",
        다음일정: "보고",
      },
    },
    {
      id: "C_dual_inner_state",
      userMessage: "걱정되며 다가간다.",
      assistantProse:
        "레온은 명령서를 접으며 표정을 굳힌다. 렌은 복도 끝에서 그를 걱정스럽게 바라본다.",
      previousCharacter: {
        시간: "18:30",
        장소: "복도",
        속마음: "담담하다",
        현재상황: "대기",
        소지품: "서류",
        다음일정: "출동",
      },
      both: true,
    },
    {
      id: "D_final_scene",
      userMessage: "따라간다.",
      assistantProse:
        "오전 9시, 숙소에서 짐을 챙긴다. 복도를 지나 엘리베이터를 탄다. 잠시 후 밤 11시, 옥상으로 이동한다. 바람이 세다.",
      previousCharacter: {
        시간: "09:00",
        장소: "숙소",
        속마음: "침착하다",
        현재상황: "이동 준비",
        소지품: "가방",
        다음일정: "대기",
      },
    },
  ];

  const summary: unknown[] = [];

  for (const c of cases) {
    for (let run = 1; run <= 2; run += 1) {
      const resolved = resolveStatusWidgetTurn({
        characterWidgetJson: charJson,
        userWidgetJson: c.both ? userJson : null,
        chatMode: c.both ? "both" : "character_only",
        displayMode: c.both ? "both" : "creator",
        characterAllowUserOverride: true,
      });

      const caller = async (
        system: string,
        history: { role: "user" | "assistant"; content: string }[],
        opts: { requestKind: string; maxTokens?: number; temperature?: number; modelId: string }
      ) => {
        if (!opts.requestKind.includes("repair")) {
          return {
            text: "",
            usage: { inputTokens: 0, outputTokens: 0, estimated: true as const },
          };
        }
        return callBackgroundMemory(system, history, undefined, opts.requestKind, {
          maxTokens: opts.maxTokens,
          temperature: opts.temperature ?? 0,
        });
      };

      const started = Date.now();
      const result = await extractStatusWidgetValuesForTurn({
        charName: "레온",
        personaName: "렌",
        userMessage: c.userMessage,
        assistantProse: c.assistantProse,
        resolved,
        previousValues: {
          character: c.previousCharacter,
          ...(c.both ? { user: { 속마음: "불안하다", 현재감정: "걱정" } } : {}),
        },
        caller,
      });
      const latencyMs = Date.now() - started;
      const row = {
        id: c.id,
        run,
        latencyMs,
        totalCallCount: result.meta.totalCallCount,
        usedRepair: result.meta.usedRepair,
        exhausted: result.meta.exhausted,
        character: result.values.character ?? null,
        user: result.values.user ?? null,
        echoDroppedKeys: {
          character: result.meta.character?.echoDroppedKeys ?? [],
          user: result.meta.user?.echoDroppedKeys ?? [],
        },
        repairMaxTokens: result.meta.character?.repairMaxTokens ?? null,
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        finishReason: result.usage?.finishReason ?? null,
      };
      summary.push(row);
      fs.writeFileSync(path.join(OUT, `${c.id}_run${run}.json`), JSON.stringify(row, null, 2), "utf8");
      console.log(JSON.stringify(row));
    }
  }

  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log("wrote", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
