/**
 * Offline: Luna/Terra/DeepSeek share collaborative architecture; only terminal length owners differ.
 * Verdict: LUNA_TERRA_COLLABORATIVE_BAKEOFF_OFFLINE_PASS
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT = "docs/audits/46-luna-terra-value-bakeoff";
const FIXTURE = process.env.FIXTURE_PATH ?? "/tmp/c18_fixture.json";
const TURN1 =
  "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.";

const MODELS = [
  { key: "deepseek", ui: "deepseek-v4-pro", expectOwner: "USER_TAIL" },
  { key: "luna", ui: "gpt-5.6-luna", expectOwner: "LUNA_TERMINAL" },
  { key: "terra", ui: "gpt-5.6-terra", expectOwner: "TERRA_TERMINAL" },
] as const;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
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

async function buildForModel(opts: {
  fixture: {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
  modelId: string;
}) {
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

  const ch = opts.fixture.character;
  const persona = opts.fixture.persona;
  const user = opts.fixture.user;
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
  const personaName = String(persona.name ?? "렌");
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );
  const shortTermHistory = [
    { role: "user" as const, content: OPENING_TURN_USER },
    { role: "assistant" as const, content: greeting },
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
    gender: (String(ch.gender || "male") as "male" | "female" | "other") || "male",
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

  const owners = {
    user_tail: countOccurrences(finalUser, USER_TAIL_LENGTH_OWNER_SENTENCE),
    luna: countOccurrences(finalUser, LUNA_TERMINAL_OUTPUT_CONTRACT),
    terra: countOccurrences(finalUser, TERRA_TERMINAL_LENGTH_OWNER_CONTRACT),
    deepseek_length: countOccurrences(full, "[DEEPSEEK LENGTH — SINGLE CALL]"),
    short_history: countOccurrences(full, "[SHORT HISTORY]"),
    collaborative: countOccurrences(full, COLLABORATIVE_INTERACTIVE_OWNER_TITLE),
    scene_engine: countOccurrences(full, "[PRIVATE SCENE ENGINE RULE]"),
    novel: countOccurrences(full, "[USER CONTROL MODE - NOVEL / EXPLICIT FULL]"),
  };

  const lengthOwnerCount =
    (owners.user_tail > 0 ? 1 : 0) +
    (owners.luna > 0 ? 1 : 0) +
    (owners.terra > 0 ? 1 : 0) +
    (owners.deepseek_length > 0 ? 1 : 0) +
    (owners.short_history > 0 ? 1 : 0);

  return {
    modelId: opts.modelId,
    hashes: {
      system: sha256(systemJoined),
      final_user: sha256(finalUser),
      persona: sha256(
        (built.meta.trackedSections ?? []).find((s) => s.id === "identity-and-rules")
          ?.text ?? ""
      ),
      character_core: sha256(
        (built.meta.trackedSections ?? []).find((s) => s.id === "character-core-identity")
          ?.text ?? ""
      ),
      collaborative: sha256(
        (built.meta.trackedSections ?? []).find((s) => s.id === "no-godmodding")?.text ??
          ""
      ),
    },
    owners,
    lengthOwnerCount,
    sceneSectionPresent: (built.meta.trackedSections ?? []).some(
      (s) => s.id === "scene-directive"
    ),
  };
}

async function main() {
  if (!existsSync(FIXTURE)) throw new Error(`missing ${FIXTURE}`);
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };

  const results: Record<string, Awaited<ReturnType<typeof buildForModel>>> = {};
  for (const m of MODELS) {
    results[m.key] = await buildForModel({ fixture, modelId: m.ui });
  }

  const reasons: string[] = [];
  const ds = results.deepseek!;
  const luna = results.luna!;
  const terra = results.terra!;

  // Shared collaborative architecture
  for (const [k, r] of Object.entries(results)) {
    if (r.owners.collaborative !== 1) reasons.push(`${k}_collaborative_${r.owners.collaborative}`);
    if (r.owners.novel !== 0) reasons.push(`${k}_novel_leak`);
    if (r.sceneSectionPresent || r.owners.scene_engine) reasons.push(`${k}_scene_on`);
  }

  // Invariant hashes (non-length sections)
  for (const key of ["persona", "character_core", "collaborative"] as const) {
    if (ds.hashes[key] !== luna.hashes[key] || ds.hashes[key] !== terra.hashes[key]) {
      reasons.push(`hash_mismatch_${key}`);
    }
  }

  // Length owners exactly 1 each, model-specific
  if (ds.lengthOwnerCount !== 1 || ds.owners.user_tail !== 1 || ds.owners.luna || ds.owners.terra) {
    reasons.push("deepseek_length_owner");
  }
  if (luna.lengthOwnerCount !== 1 || luna.owners.luna !== 1 || luna.owners.user_tail || luna.owners.terra) {
    reasons.push("luna_length_owner");
  }
  if (
    terra.lengthOwnerCount !== 1 ||
    terra.owners.terra !== 1 ||
    terra.owners.user_tail ||
    terra.owners.luna
  ) {
    reasons.push("terra_length_owner");
  }
  if (ds.owners.deepseek_length || ds.owners.short_history) {
    reasons.push("deepseek_competing_length");
  }

  const pass = reasons.length === 0;
  const verdict = pass
    ? "LUNA_TERRA_COLLABORATIVE_BAKEOFF_OFFLINE_PASS"
    : "LUNA_TERRA_COLLABORATIVE_BAKEOFF_OFFLINE_FAIL";

  const ownerMatrix = [
    "# Prompt owner matrix — Luna/Terra/DeepSeek collaborative bake-off",
    "",
    `## Verdict: \`${verdict}\``,
    "",
    "| model | length owners | terminal owner | collaborative | SceneDirective | novel |",
    "|---|---:|---|---:|---|---|",
    `| deepseek-v4-pro | ${ds.lengthOwnerCount} | USER_TAIL | ${ds.owners.collaborative} | OFF | ${ds.owners.novel} |`,
    `| gpt-5.6-luna | ${luna.lengthOwnerCount} | LUNA_TERMINAL | ${luna.owners.collaborative} | OFF | ${luna.owners.novel} |`,
    `| gpt-5.6-terra | ${terra.lengthOwnerCount} | TERRA_TERMINAL | ${terra.owners.collaborative} | OFF | ${terra.owners.novel} |`,
    "",
    "Shared: USER_PERSONA / character core / collaborative interactive owner.",
    "Difference allowed: terminal length owner only.",
    "",
  ].join("\n");

  save("PROMPT_OWNER_MATRIX.md", ownerMatrix);
  save("PROMPT_HASHES.json", {
    verdict,
    reasons,
    results: Object.fromEntries(
      Object.entries(results).map(([k, v]) => [
        k,
        {
          modelId: v.modelId,
          hashes: v.hashes,
          owners: v.owners,
          lengthOwnerCount: v.lengthOwnerCount,
          sceneSectionPresent: v.sceneSectionPresent,
        },
      ])
    ),
  });
  save("OFFLINE_VERDICT.json", { verdict, reasons });
  console.log(JSON.stringify({ verdict, reasons }, null, 2));
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
