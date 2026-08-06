/**
 * Muse Spark 1.2 shares PR #248 collaborative architecture; length owner = USER_TAIL (1).
 * No Muse-specific style adapter before first baseline.
 * Verdict: MUSE_COLLABORATIVE_BASELINE_OFFLINE_PASS
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT = "docs/audits/49-muse-spark-baseline";
const FIXTURE = process.env.FIXTURE_PATH ?? "/tmp/c18_fixture.json";
const TURN1 =
  "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.";

function save(name: string, content: string | object) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}
function countOccurrences(hay: string, needle: string): number {
  let n = 0;
  let i = 0;
  while (true) {
    const j = hay.indexOf(needle, i);
    if (j < 0) break;
    n += 1;
    i = j + needle.length;
  }
  return n;
}

async function main() {
  if (!existsSync(FIXTURE)) throw new Error(`missing ${FIXTURE}`);
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const { loadCharacterChunks } = await import("../src/lib/characterChunks");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const { buildSceneDirective, renderSceneDirectiveForPrompt } = await import(
    "../src/lib/sceneDirective"
  );
  const { buildContext } = await import("../src/services/contextBuilder");
  const { buildOpenRouterMessages } = await import("../src/lib/openRouterAdult");
  const { COLLABORATIVE_INTERACTIVE_OWNER_TITLE } = await import("../src/lib/noGodmodding");
  const { USER_TAIL_LENGTH_OWNER_SENTENCE } = await import("../src/lib/responseLength");
  const { LUNA_TERMINAL_OUTPUT_CONTRACT } = await import(
    "../src/lib/lunaSinglePrimaryAdapter"
  );
  const { TERRA_TERMINAL_LENGTH_OWNER_CONTRACT } = await import(
    "../src/lib/terraTerminalLengthOwner"
  );

  const modelId = "meta/muse-spark-1.2";
  const ch = fixture.character;
  const persona = fixture.persona;
  const user = fixture.user;
  const chunks = loadCharacterChunks({
    id: Number(ch.id),
    name: String(ch.name),
    gender: String(ch.gender ?? ""),
    system_prompt: String(ch.system_prompt ?? ""),
    world: String(ch.world ?? ""),
    example_dialog: String(ch.example_dialog ?? ""),
    setting_chunks: String(ch.setting_chunks ?? ""),
    speech_profile: String(ch.speech_profile ?? ""),
  });
  const personaName = String(persona.name ?? "렌");
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );
  const shortTermHistory = [
    { role: "user" as const, content: OPENING_TURN_USER },
    { role: "assistant" as const, content: String(ch.greeting ?? "") },
  ];
  const sceneDirectiveBlock = renderSceneDirectiveForPrompt(
    buildSceneDirective({
      characterName: String(ch.name),
      recentMessages: shortTermHistory,
      currentUserMessage: TURN1,
      contentKind: "character",
      mode: "interactive",
    })
  );
  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory,
    currentUserMessage: TURN1,
    nsfw: false,
    gender: "male",
    memoryMeta: "",
    modelId,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: 0,
    provider: "openrouter",
    contentKind: "character",
    sceneDirectiveBlock,
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: 34,
  });
  const wire = buildOpenRouterMessages(built.systemPrompt, built.history, {
    systemSplit: built.openRouterSystemSplit!,
  });
  const systemJoined = Array.isArray(wire[0]?.content)
    ? (wire[0]!.content as Array<{ text?: string }>)
        .map((p) => p.text ?? "")
        .join("\n\n")
    : String(wire[0]?.content ?? "");
  const finalUser = String(wire[wire.length - 1]?.content ?? "");
  const full = `${systemJoined}\n\n${finalUser}`;

  const reasons: string[] = [];
  const collab = countOccurrences(full, COLLABORATIVE_INTERACTIVE_OWNER_TITLE);
  const novel = countOccurrences(full, "[USER CONTROL MODE - NOVEL / EXPLICIT FULL]");
  const scene = (built.meta.trackedSections ?? []).some((s) => s.id === "scene-directive");
  const userTail = countOccurrences(finalUser, USER_TAIL_LENGTH_OWNER_SENTENCE);
  const luna = countOccurrences(finalUser, LUNA_TERMINAL_OUTPUT_CONTRACT);
  const terra = countOccurrences(finalUser, TERRA_TERMINAL_LENGTH_OWNER_CONTRACT);
  const deepseekLen = countOccurrences(full, "[DEEPSEEK LENGTH — SINGLE CALL]");
  const shortHist = countOccurrences(full, "[SHORT HISTORY]");
  const lengthOwners =
    (userTail > 0 ? 1 : 0) +
    (luna > 0 ? 1 : 0) +
    (terra > 0 ? 1 : 0) +
    (deepseekLen > 0 ? 1 : 0) +
    (shortHist > 0 ? 1 : 0);

  if (collab !== 1) reasons.push(`collab_${collab}`);
  if (novel !== 0) reasons.push("novel");
  if (scene) reasons.push("scene_on");
  if (lengthOwners !== 1 || userTail !== 1) reasons.push(`length_owners_${lengthOwners}_tail_${userTail}`);

  const pass = reasons.length === 0;
  const verdict = pass
    ? "MUSE_COLLABORATIVE_BASELINE_OFFLINE_PASS"
    : "MUSE_COLLABORATIVE_BASELINE_OFFLINE_FAIL";
  save("OFFLINE_VERDICT.json", {
    verdict,
    reasons,
    modelId,
    collab,
    novel,
    scene,
    lengthOwners,
    userTail,
  });
  save("README.md", [
    "# Audit 49 — Muse Spark 1.2 collaborative baseline",
    "",
    `\`${verdict}\``,
    "",
    "Same architecture as PR #248. No Muse-specific style adapter before baseline live.",
    "",
  ].join("\n"));
  console.log(JSON.stringify({ verdict, reasons }, null, 2));
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
