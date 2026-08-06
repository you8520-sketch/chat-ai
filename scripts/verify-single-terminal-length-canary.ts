/** Offline check: ds_single_terminal_length_owner → one length owner. */
import { readFileSync } from "node:fs";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

async function main() {
  const fixture = JSON.parse(readFileSync("/tmp/c18_fixture.json", "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
  const ch = fixture.character;
  const persona = fixture.persona;
  const user = fixture.user;
  const { loadCharacterChunks } = await import("../src/lib/characterChunks");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const { buildSceneDirective, renderSceneDirectiveForPrompt } = await import(
    "../src/lib/sceneDirective"
  );
  const { buildContext } = await import("../src/services/contextBuilder");
  const { USER_TAIL_LENGTH_OWNER_SENTENCE } = await import("../src/lib/responseLength");

  const greeting = String(ch.greeting ?? "").trim();
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
  const personaName = String(persona.name);
  const shortTermHistory = [
    { role: "user" as const, content: OPENING_TURN_USER },
    { role: "assistant" as const, content: greeting },
  ];
  const turn1 =
    "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.";
  const sceneDirectiveBlock = renderSceneDirectiveForPrompt(
    buildSceneDirective({
      characterName: String(ch.name),
      recentMessages: shortTermHistory,
      currentUserMessage: turn1,
      contentKind: "character",
    })
  );
  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(user.nickname),
    userPersona: formatSelectedPersonaForPrompt(
      personaName,
      "other",
      String(persona.description ?? "")
    ),
    userNote: "",
    longTermMemory: "",
    shortTermHistory,
    currentUserMessage: turn1,
    nsfw: false,
    gender: "male",
    memoryMeta: "",
    modelId: "deepseek-v4-pro",
    userImpersonation: false,
    novelModeEnabled: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: 0,
    provider: "openrouter",
    contentKind: "character",
    sceneDirectiveBlock,
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: 34,
    rpDiagnosticCanary: { variant: "ds_single_terminal_length_owner" },
  });
  const finalUser = built.history[built.history.length - 1]!.content;
  const flags = {
    deepseek_length: finalUser.includes("[DEEPSEEK LENGTH — SINGLE CALL]"),
    short_history: finalUser.includes("[SHORT HISTORY]"),
    short_user: finalUser.includes("[SHORT USER TURN]"),
    user_tail: finalUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE.slice(0, 40)),
    opening: finalUser.includes("[OPENING SCENE CONTEXT"),
    style: finalUser.includes("[System Reminder:"),
  };
  const lengthCount = [
    flags.deepseek_length,
    flags.short_history,
    flags.short_user,
    flags.user_tail,
  ].filter(Boolean).length;
  const ok = lengthCount === 1 && flags.user_tail && flags.opening && flags.style;
  console.log(JSON.stringify({ ok, flags, lengthCount, historyLen: built.history.length }, null, 2));
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
