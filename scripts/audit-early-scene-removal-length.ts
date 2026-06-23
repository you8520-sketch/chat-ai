/**
 * A/B — early_scene overlay vs production (removed) on early turns t=1–3.
 * Usage: npx.cmd tsx scripts/audit-early-scene-removal-length.ts
 */
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const MODEL = process.env.EARLY_SCENE_AUDIT_MODEL ?? "qwen/qwen3.7-max";
const PERSONA = "렌";
const CHAR = "백하율";

const EARLY_SCENE_LINE = (t: number) =>
  `[early_scene t=${t}] Plausible social distance — no instant intimacy, touch escalation, or weather theatrics.`;

const TURNS: { completedTurns: number; userMsg: string }[] = [
  { completedTurns: 1, userMsg: "…가이드님, 손만 잡아주면 되지? 일어나봐." },
  { completedTurns: 2, userMsg: "…무서워. 천천히만 해줘." },
  { completedTurns: 3, userMsg: "밤산책 같이 갈래?" },
  { completedTurns: 1, userMsg: "오늘 밤 공기가 좀 이상하지 않아?" },
  { completedTurns: 2, userMsg: "그래, 같이 가자. 천천히." },
];

function injectEarlyScene(system: string, t: number): string {
  const line = EARLY_SCENE_LINE(t);
  const marker = "[genre_tone]";
  if (system.includes(marker)) {
    return system.replace(marker, `${line}\n\n${marker}`);
  }
  const core = "[NARRATIVE CORE]";
  if (system.includes(core)) {
    return system.replace(core, `${line}\n\n${core}`);
  }
  return `${system}\n\n${line}`;
}

async function main() {
  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  const removedLine = EARLY_SCENE_LINE(1);
  console.log("── Token savings (per early turn, t<8) ──");
  console.log(`removed line: ${estimateTokens(removedLine)} tok · ${removedLine.length} chars`);

  const chunks = parseCharacterSetting({
    characterId: "mock-early-scene",
    characterName: CHAR,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며.`,
    world: `# 세계관\n현대.`,
    exampleDialog: `유저: hi\n${CHAR}: …`,
    statusWindowPrompt: "",
  });

  const rows: {
    turn: number;
    t: number;
    without: number;
    withScene: number;
    delta: number;
  }[] = [];

  for (let i = 0; i < TURNS.length; i++) {
    const { completedTurns, userMsg } = TURNS[i];
    const built = buildContext({
      charName: CHAR,
      personaDisplayName: PERSONA,
      chunks,
      userNickname: PERSONA,
      userPersona: formatSelectedPersonaForPrompt(PERSONA, "other", "20대. 반말."),
      userNote: formatUserNoteForPrompt(""),
      longTermMemory: "",
      shortTermHistory: [],
      currentUserMessage: userMsg,
      nsfw: true,
      gender: "male",
      userPersonaGender: "other",
      userImpersonation: false,
      novelModeEnabled: false,
      targetResponseChars: 2500,
      completedTurns,
      genres: ["현대/일상"],
      modelId: MODEL,
      provider: "openrouter",
      promptDumpSource: "audit",
      promptDumpDetail: `early-scene-ab t=${completedTurns}`,
    });

    if (built.systemPrompt.includes("[early_scene t=")) {
      console.error("FAIL: production prompt still contains early_scene");
      process.exitCode = 1;
      return;
    }
    if (!/\[EARLY t=\d+\]/.test(built.systemPrompt)) {
      console.error(`FAIL: missing [EARLY t=N] for completedTurns=${completedTurns}`);
      process.exitCode = 1;
      return;
    }

    const withSystem = injectEarlyScene(built.systemPrompt, completedTurns);
    console.log(`\n── Turn ${i + 1} (completedTurns=${completedTurns}) ──`);

    const without = await callOpenRouterAdult(
      built.systemPrompt,
      [{ role: "user", content: userMsg }],
      MODEL,
      2500,
      { charName: CHAR },
      { chargeTurnBudget: false, requestKind: `early-no-scene-${i + 1}` }
    );

    const withScene = await callOpenRouterAdult(
      withSystem,
      [{ role: "user", content: userMsg }],
      MODEL,
      2500,
      { charName: CHAR },
      { chargeTurnBudget: false, requestKind: `early-with-scene-${i + 1}` }
    );

    const delta = without.text.length - withScene.text.length;
    rows.push({
      turn: i + 1,
      t: completedTurns,
      without: without.text.length,
      withScene: withScene.text.length,
      delta,
    });
    console.log(
      `without early_scene: ${without.text.length} chars · with overlay: ${withScene.text.length} chars · Δ ${delta >= 0 ? "+" : ""}${delta}`
    );
  }

  const avgWithout = rows.reduce((s, r) => s + r.without, 0) / rows.length;
  const avgWith = rows.reduce((s, r) => s + r.withScene, 0) / rows.length;
  const avgDelta = rows.reduce((s, r) => s + r.delta, 0) / rows.length;

  console.log("\n── Summary ──");
  console.log(`avg chars without early_scene: ${Math.round(avgWithout)}`);
  console.log(`avg chars with early_scene overlay: ${Math.round(avgWith)}`);
  console.log(`avg Δ (removal benefit): ${avgDelta >= 0 ? "+" : ""}${Math.round(avgDelta)} chars`);
  console.log(
    "turns where removal increased length:",
    rows.filter((r) => r.delta > 0).length,
    "/",
    rows.length
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
