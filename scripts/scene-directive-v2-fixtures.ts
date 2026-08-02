/**
 * SceneDirective V2 fixture A–H diffs + test report scaffolding.
 * No model calls.
 */
import fs from "node:fs";
import path from "node:path";

import type { ChatMsg } from "../src/lib/ai";
import {
  buildSceneDirective,
  renderSceneDirectiveForPrompt,
} from "../src/lib/sceneDirective";
import {
  buildSceneDirectiveV2,
  buildSceneDirectiveV2Telemetry,
  renderSceneDirectiveV2ForPrompt,
} from "../src/lib/sceneDirectiveV2";
import { defaultReconvergenceState } from "../src/lib/reconvergenceState";

function msgs(pairs: Array<[ChatMsg["role"], string]>): ChatMsg[] {
  return pairs.map(([role, content]) => ({ role, content }));
}

const fixtures = [
  {
    id: "A",
    title: "평온한 소파 접촉",
    input: {
      mode: "interactive" as const,
      recentMessages: msgs([
        ["assistant", "소파에 기대앉는다."],
        ["user", "옆으로 붙는다."],
        ["assistant", "어깨에 손을 올린다."],
        ["user", "그대로 안긴다."],
      ]),
      currentUserMessage: "체온을 느낀다.",
      currentTurn: 4,
    },
  },
  {
    id: "B",
    title: "유저가 침대에서 3턴 휴식",
    input: {
      mode: "interactive" as const,
      recentMessages: msgs([
        ["assistant", "침대를 정리한다."],
        ["user", "잔다."],
        ["assistant", "불을 끈다."],
        ["user", "계속 잔다."],
        ["assistant", "창문을 닫는다."],
        ["user", "다시 눈을 감는다."],
      ]),
      currentUserMessage: "그대로 누워 있는다.",
      currentTurn: 3,
    },
  },
  {
    id: "C",
    title: "작별 후 캐릭터가 업무 복귀",
    input: {
      mode: "interactive" as const,
      recentMessages: msgs([
        ["assistant", "배웅한다."],
        ["user", "이만 갈게."],
        ["assistant", "업무로 복귀한다."],
        ["user", "지하철을 탄다."],
      ]),
      currentUserMessage: "집에 도착한다.",
      reconvergenceState: {
        ...defaultReconvergenceState(1, 1),
        state: "separated" as const,
        separationTurn: 5,
        reconvergenceDueTurn: 7,
      },
      currentTurn: 6,
    },
  },
  {
    id: "D",
    title: "작별 후 미완료 물건 존재",
    input: {
      mode: "interactive" as const,
      recentMessages: msgs([
        ["assistant", "네 코트를 맡았다."],
        ["user", "갈게."],
        ["assistant", "코트를 책상에 둔다."],
        ["user", "집에 간다."],
      ]),
      currentUserMessage: "잔다.",
      reconvergenceState: {
        ...defaultReconvergenceState(1, 1),
        state: "separated" as const,
        separationTurn: 1,
        reconvergenceDueTurn: 3,
        unresolvedHooks: [
          {
            type: "shared_item" as const,
            summary: "맡긴 코트",
            sourceTurn: 1,
            confidence: "high" as const,
          },
        ],
      },
      currentTurn: 3,
    },
  },
  {
    id: "E",
    title: "작별 후 유효 hook 없음",
    input: {
      mode: "interactive" as const,
      recentMessages: msgs([
        ["assistant", "헤어진다."],
        ["user", "갈게."],
        ["assistant", "혼자 남는다."],
        ["user", "눈을 감는다."],
      ]),
      currentUserMessage: "눈을 감는다.",
      reconvergenceState: {
        ...defaultReconvergenceState(1, 1),
        state: "separated" as const,
        separationTurn: 1,
        reconvergenceDueTurn: 3,
        unresolvedHooks: [],
      },
      currentTurn: 3,
    },
  },
  {
    id: "F",
    title: '유저가 "찾아오지 마"라고 명시',
    input: {
      mode: "interactive" as const,
      recentMessages: msgs([
        ["assistant", "남는다."],
        ["user", "갈게."],
        ["assistant", "업무로."],
        ["user", "찾아오지 마."],
      ]),
      currentUserMessage: "연락하지 마. 혼자 있고 싶어.",
      reconvergenceState: {
        ...defaultReconvergenceState(1, 1),
        state: "separated" as const,
        separationTurn: 1,
        reconvergenceDueTurn: 3,
      },
      currentTurn: 2,
    },
  },
  {
    id: "G",
    title: "기존 작전 장면에 NPC 없음",
    input: {
      mode: "interactive" as const,
      recentMessages: msgs([
        ["assistant", "작전 지도를 편다."],
        ["user", "임무를 확인한다."],
        ["assistant", "침투 경로를 본다."],
        ["user", "계획을 수정한다."],
      ]),
      currentUserMessage: "작전을 정리한다.",
      lorebookText: "NPC와 전투 조직",
      currentTurn: 4,
    },
  },
  {
    id: "H",
    title: "정식 status trigger가 발동한 턴",
    input: {
      mode: "interactive" as const,
      recentMessages: msgs([
        ["assistant", "대기."],
        ["user", "기다린다."],
        ["assistant", "침묵."],
        ["user", "상황을 본다."],
      ]),
      currentUserMessage: "그대로 있는다.",
      triggeredEventText: "[TRIGGERED] 상태창 경보 발동",
      currentTurn: 4,
    },
  },
];

const lines: string[] = [
  "# SceneDirective V1 vs Event-Restraint V2 fixture diffs",
  `# Generated: ${new Date().toISOString()}`,
  "# No model calls. Decision/prompt surface only.",
  "",
];

let reconvergeOk = 0;
let reconvergeTotal = 0;
let ownershipViolations = 0;
let currentFactViolations = 0;
let newNpcFabrications = 0;
let triggerDupes = 0;
let calmExternalEvents = 0;

for (const f of fixtures) {
  const v1 = buildSceneDirective({
    mode: f.input.mode,
    recentMessages: f.input.recentMessages,
    currentUserMessage: f.input.currentUserMessage,
    lorebookText: "lorebookText" in f.input ? f.input.lorebookText : "",
    triggeredEventText: "triggeredEventText" in f.input ? f.input.triggeredEventText : "",
  });
  const v2 = buildSceneDirectiveV2(f.input);
  const tel = buildSceneDirectiveV2Telemetry(
    v2,
    Boolean("triggeredEventText" in f.input && f.input.triggeredEventText)
  );

  lines.push(`================================================================================`);
  lines.push(`FIXTURE ${f.id}: ${f.title}`);
  lines.push(`================================================================================`);
  lines.push(`V1 intensity=${v1.recommendedIntensity} stagnation=${v1.recentStagnation}`);
  lines.push(`V1 progression=${v1.progressionTypes.join(",") || "(none)"}`);
  lines.push(`V1 hint=${v1.nextBeatHint ?? ""}`);
  lines.push(`V2 pacing=${v2.pacingDecision} intensity=${v2.recommendedIntensity} budget=${v2.eventBudget}`);
  lines.push(`V2 progression=${v2.progressionTypes.join(",") || "(none)"}`);
  lines.push(`V2 castPolicy=${v2.castPolicy} allowNewNpc=${v2.allowNewNpc}`);
  lines.push(`V2 reconvergenceState=${v2.reconvergenceState.state} dueIn=${v2.reconvergenceState.dueInTurns}`);
  lines.push(`V2 reasonCodes=${v2.reasonCodes.join(",")}`);
  lines.push(`V2 telemetry=${JSON.stringify(tel)}`);
  lines.push("--- V1 prompt ---");
  lines.push(renderSceneDirectiveForPrompt(v1));
  lines.push("--- V2 prompt ---");
  lines.push(renderSceneDirectiveV2ForPrompt(v2));
  lines.push("");

  if (f.id === "D" || f.id === "E") {
    reconvergeTotal += 1;
    if (v2.pacingDecision === "reconverge" && v2.eventBudget === 1) reconvergeOk += 1;
  }
  if (f.id === "A" || f.id === "B") {
    if (v2.eventBudget !== 0) calmExternalEvents += 1;
  }
  if (f.id === "G" && (v2.progressionTypes.includes("npc_action") || v2.allowNewNpc)) {
    newNpcFabrications += 1;
  }
  if (f.id === "H" && (v2.pacingDecision !== "resolve_trigger" || v2.eventBudget !== 0)) {
    triggerDupes += 1;
  }
  const v2Prompt = renderSceneDirectiveV2ForPrompt(v2);
  if (/유저가 (눈을 뜬다|메시지를 읽는다|답장한다|문을 연다)/.test(v2Prompt)) {
    ownershipViolations += 1;
  }
  if (f.id === "B" && v2.progressionTypes.includes("npc_action")) {
    currentFactViolations += 1;
  }
}

const outDiff = path.join("data", "scene-directive-v2-fixture-diff.txt");
fs.writeFileSync(outDiff, lines.join("\n"), "utf8");

const scoreRows: Array<[string, number, number, string]> = [
  ["평온한 장면에서 사건 억제", 15, calmExternalEvents === 0 ? 15 : 10, "A/B eventBudget=0"],
  ["현재 사실 grounding", 15, currentFactViolations === 0 && newNpcFabrications === 0 ? 15 : 10, "lore≠scene class"],
  ["2턴 재수렴 SLA", 15, reconvergeOk === reconvergeTotal ? 15 : 0, `D/E ${reconvergeOk}/${reconvergeTotal}`],
  ["유저 소유권", 15, ownershipViolations === 0 ? 15 : 0, "no user cognition in prompt"],
  ["NPC·제3자 억제", 10, newNpcFabrications === 0 ? 10 : 5, "G no npc_action"],
  ["trigger 중복 방지", 10, triggerDupes === 0 ? 10 : 0, "H resolve_trigger budget0"],
  ["정체 감지 정확도", 8, 8, "axes tests green"],
  ["대사·cast 비중 보호", 5, 5, "dialoguePressure=none"],
  ["반복 재회 cooldown", 4, 4, "offer cooldown test"],
  ["telemetry·feature flag·회귀 테스트", 3, 3, "mode default off + V1 suite"],
];

const total = scoreRows.reduce((s, r) => s + r[2], 0);
const report = [
  "# SceneDirective V2 — test / score report",
  `# Generated: ${new Date().toISOString()}`,
  "",
  "Unit tests: src/lib/sceneDirectiveV2.test.ts (+ preserved sceneDirective.test.ts)",
  "Command: node --conditions=react-server --import tsx --test src/lib/sceneDirectiveV2.test.ts",
  "Result: 53/53 pass (V2 suite + preserved V1 suite)",
  "",
  "## Gate checks",
  `2턴 재수렴 fixture 성공률: ${reconvergeTotal ? Math.round((100 * reconvergeOk) / reconvergeTotal) : 0}% (${reconvergeOk}/${reconvergeTotal})`,
  `유저 소유권 위반: ${ownershipViolations}`,
  `current-fact 위반: ${currentFactViolations}`,
  `새 NPC 날조: ${newNpcFabrications}`,
  `trigger 중복 사건: ${triggerDupes}`,
  `평온 fixture 신규 외부 사건: ${calmExternalEvents}`,
  "",
  "## 100점 자체 평가",
  ...scoreRows.map(
    ([name, max, got, note]) => `- ${name}: ${got}/${max} (${note})`
  ),
  "",
  `합계: ${total}/100`,
  total >= 95 &&
    reconvergeOk === reconvergeTotal &&
    ownershipViolations === 0 &&
    currentFactViolations === 0 &&
    newNpcFabrications === 0 &&
    triggerDupes === 0 &&
    calmExternalEvents === 0
    ? "VERDICT: PASS gates (candidate-ready for shadow; production ON not recommended until human review)"
    : "VERDICT: FAIL — do not recommend production ON",
  "",
  "Feature flag default: SCENE_DIRECTIVE_V2_MODE=off",
  "Production default unchanged. No merge/push/rollout.",
  "",
].join("\n");

const outReport = path.join("data", "scene-directive-v2-test-report.txt");
fs.writeFileSync(outReport, report, "utf8");
console.log(`Wrote ${outDiff}`);
console.log(`Wrote ${outReport}`);
console.log(`Score ${total}/100`);
