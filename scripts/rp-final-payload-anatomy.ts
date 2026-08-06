/**
 * Offline final-payload anatomy for DeepSeek V4 Pro production path.
 *
 * Reconstructs the exact provider message order for character 18 / persona 61
 * Turn-1 new chat (greeting present, thin history) without live provider calls.
 *
 * Fixture: /tmp/c18_fixture.json (exported from production DB) or FIXTURE_PATH.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT =
  process.env.OUT_DIR ?? "docs/audits/40-rp-first-principles";
const FIXTURE =
  process.env.FIXTURE_PATH ?? "/tmp/c18_fixture.json";
const MODEL = "deepseek-v4-pro";
const TURN1_USER =
  process.env.TURN1_USER ??
  "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function chars(text: string): number {
  return [...text].length;
}

function save(name: string, content: string | object) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

type SectionRow = {
  message_index: number | null;
  role: "system" | "user" | "assistant" | "virtual";
  semantic_owner: string;
  source_function: string;
  source_file: string;
  exact_section_header: string;
  characters: number;
  estimated_tokens: number;
  sha256: string;
  text_preview: string;
  full_text_ref?: string;
};

function headerOf(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.slice(0, 120);
}

function preview(text: string, n = 160): string {
  return text.replace(/\s+/g, " ").trim().slice(0, n);
}

function overlapRatio(a: string, b: string): number {
  const na = a.replace(/\s+/g, "");
  const nb = b.replace(/\s+/g, "");
  if (!na || !nb) return 0;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (longer.includes(shorter) && shorter.length >= 80) {
    return shorter.length / longer.length;
  }
  // trigram jaccard
  const grams = (s: string) => {
    const g = new Set<string>();
    for (let i = 0; i < s.length - 2; i++) g.add(s.slice(i, i + 3));
    return g;
  };
  const A = grams(na);
  const B = grams(nb);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

async function main() {
  if (!existsSync(FIXTURE)) {
    throw new Error(`fixture missing: ${FIXTURE}`);
  }
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
  const ch = fixture.character;
  const persona = fixture.persona;
  const user = fixture.user;

  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { loadCharacterChunks } = await import("../src/lib/characterChunks");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const { buildSceneDirective, renderSceneDirectiveForPrompt } = await import(
    "../src/lib/sceneDirective"
  );
  const { buildContext } = await import("../src/services/contextBuilder");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  const { buildOpenRouterMessages } = await import("../src/lib/openRouterAdult");
  const {
    DEEPSEEK_BOTTOM_REMINDER,
    DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA,
  } = await import("../src/lib/deepseekPromptStructure");
  const { USER_TAIL_LENGTH_OWNER_SENTENCE } = await import(
    "../src/lib/responseLength"
  );
  const { DEEPSEEK_OPENING_SCENE_CONTEXT_HEADER } = await import(
    "../src/lib/deepseekOpeningSceneContext"
  );

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

  // Fallback parser path if chunks empty
  if (!chunks?.length) {
    Object.assign(
      chunks,
      parseCharacterSetting({
        characterId: String(ch.id),
        characterName: String(ch.name),
        gender: String(ch.gender ?? "male"),
        systemPrompt: String(ch.system_prompt ?? ""),
        world: String(ch.world ?? ""),
        exampleDialog: String(ch.example_dialog ?? ""),
        statusWindowPrompt: String(ch.status_window_prompt ?? ""),
      })
    );
  }

  const personaName = String(persona.name ?? "렌").trim();
  const userPersonaPrompt = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );

  // Turn-1 new chat history as production: greeting pair then current user not yet in history
  const shortTermHistory = [
    { role: "user" as const, content: OPENING_TURN_USER },
    { role: "assistant" as const, content: greeting },
  ];

  const sceneDirective = buildSceneDirective({
    characterName: String(ch.name),
    recentMessages: shortTermHistory.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    currentUserMessage: TURN1_USER,
    contentKind: "character",
  });
  const sceneDirectiveBlock = renderSceneDirectiveForPrompt(sceneDirective);

  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(user.nickname ?? personaName),
    userPersona: userPersonaPrompt,
    userNote: "",
    longTermMemory: "",
    shortTermHistory,
    currentUserMessage: TURN1_USER,
    nsfw: false,
    gender: (String(ch.gender || "male") as "male" | "female" | "other") || "male",
    memoryMeta: "",
    modelId: MODEL,
    userImpersonation: false,
    novelModeEnabled: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: 0,
    provider: "openrouter",
    contentKind: "character",
    sceneDirectiveBlock,
    exampleDialog: String(ch.example_dialog ?? ""),
    promptDumpSource: null,
    userId: 34,
  });

  const split = built.openRouterSystemSplit!;
  const wire = buildOpenRouterMessages(built.systemPrompt, built.history, {
    systemSplit: split,
  });

  const sections: SectionRow[] = [];
  const fullTexts: Record<string, string> = {};

  function add(row: Omit<SectionRow, "characters" | "estimated_tokens" | "sha256" | "text_preview"> & { text: string }) {
    const text = row.text;
    const id = `${row.semantic_owner}__${sections.length}`;
    fullTexts[id] = text;
    sections.push({
      message_index: row.message_index,
      role: row.role,
      semantic_owner: row.semantic_owner,
      source_function: row.source_function,
      source_file: row.source_file,
      exact_section_header: row.exact_section_header || headerOf(text),
      characters: chars(text),
      estimated_tokens: estimateTokens(text),
      sha256: sha256(text),
      text_preview: preview(text),
      full_text_ref: id,
    });
  }

  // Tracked system sections from buildContext (semantic owners)
  for (const s of built.meta.trackedSections ?? []) {
    add({
      message_index: 0,
      role: "system",
      semantic_owner: s.id,
      source_function: "buildContext.pushSection",
      source_file: "src/services/contextBuilder.ts",
      exact_section_header: s.label || headerOf(s.text),
      text: s.text,
    });
  }

  // Wire-level system parts
  const sysParts = Array.isArray(wire[0]?.content)
    ? (wire[0]!.content as Array<{ type?: string; text?: string }>)
    : [{ text: String(wire[0]?.content ?? "") }];
  sysParts.forEach((p, i) => {
    const text = String(p.text ?? "");
    if (!text.trim()) return;
    add({
      message_index: 0,
      role: "system",
      semantic_owner: `wire.system_part_${i}`,
      source_function: "buildOpenRouterMessages",
      source_file: "src/lib/openRouterAdult.ts",
      exact_section_header: headerOf(text),
      text,
    });
  });

  // History + final user
  for (let i = 1; i < wire.length; i++) {
    const m = wire[i]!;
    const text = String(m.content ?? "");
    add({
      message_index: i,
      role: m.role as "user" | "assistant",
      semantic_owner:
        m.role === "assistant"
          ? "raw_recent_history.assistant"
          : i === wire.length - 1
            ? "final_user_message"
            : "raw_recent_history.user",
      source_function: "buildContext → historyWithCurrent",
      source_file: "src/services/contextBuilder.ts",
      exact_section_header: headerOf(text),
      text,
    });
  }

  const finalUser = String(wire[wire.length - 1]?.content ?? "");
  const systemJoined = sysParts.map((p) => String(p.text ?? "")).join("\n\n");

  // Explicit length/scene owner detections on final user + system
  const lengthOwners: Array<{ id: string; present: boolean; location: string; sha256: string }> = [];
  const lengthChecks = [
    {
      id: "DEEPSEEK_BOTTOM_REMINDER_LENGTH",
      needle: "[DEEPSEEK LENGTH — SINGLE CALL]",
      location: "final_user_message",
      body: DEEPSEEK_BOTTOM_REMINDER,
    },
    {
      id: "DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA",
      needle: "[SHORT HISTORY]",
      location: "final_user_message",
      body: DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA,
    },
    {
      id: "USER_TAIL_LENGTH_OWNER_SENTENCE",
      needle: USER_TAIL_LENGTH_OWNER_SENTENCE.slice(0, 40),
      location: "final_user_message",
      body: USER_TAIL_LENGTH_OWNER_SENTENCE,
    },
  ];
  for (const c of lengthChecks) {
    const present = finalUser.includes(c.needle);
    lengthOwners.push({
      id: c.id,
      present,
      location: c.location,
      sha256: sha256(c.body),
    });
  }

  const sceneOwners: Array<{
    id: string;
    present: boolean;
    location: string;
    progression_owner: boolean;
    note?: string;
  }> = [];
  sceneOwners.push({
    id: "BASE_SCENE_ENGINE_RULE+SceneDirective",
    present:
      systemJoined.includes("[PRIVATE SCENE ENGINE RULE]") ||
      systemJoined.includes("[이번 턴 장면 지시"),
    location: "system.dynamic",
    progression_owner: true,
    note: "Explicit this-turn progression owner",
  });
  sceneOwners.push({
    id: "OPENING_SCENE_CONTEXT",
    present: finalUser.includes(DEEPSEEK_OPENING_SCENE_CONTEXT_HEADER),
    location: "final_user_message",
    progression_owner: false,
    note: "Continuity facts only — not a competing progression owner",
  });
  // Competing progression owner = second block that also dictates what to advance this turn
  // (not mere NPC role-casting in CORE RP).
  const competingProgressionInSystem =
    (systemJoined.match(/\[PRIVATE SCENE ENGINE RULE\]/g) ?? []).length >= 2 ||
    (systemJoined.match(/\[이번 턴 장면 지시/g) ?? []).length >= 2 ||
    /ACTIVE_DYAD|SCENE FOCUS|전개 방향:/.test(
      systemJoined.replace(
        /\[PRIVATE SCENE ENGINE RULE\][\s\S]*?(?=\[OUTPUT LAYOUT\]|$)/,
        ""
      )
    );
  sceneOwners.push({
    id: "SECOND_EXPLICIT_PROGRESSION_OWNER",
    present: competingProgressionInSystem,
    location: "system",
    progression_owner: competingProgressionInSystem,
    note: "Duplicate SceneDirective/engine or alternate this-turn progression block",
  });

  // Duplication checks
  const greetingInOpening = finalUser.includes(greeting.slice(0, 80));
  const greetingInHistory = wire
    .slice(1, -1)
    .some((m) => String(m.content ?? "").includes(greeting.slice(0, 80)));
  const greetingInSystem = systemJoined.includes(greeting.slice(0, 80));
  const greetingOccurrences =
    (greetingInOpening ? 1 : 0) +
    (greetingInHistory ? 1 : 0) +
    (greetingInSystem ? 1 : 0);

  // Previous assistant: on turn1 after peel, no assistant in wire history.
  // Check if greeting body also appears inside long-term memory (empty here) or system.
  const assistantsInWire = wire.filter((m) => m.role === "assistant");
  const prevAssistantDup =
    assistantsInWire.length > 0 &&
    greetingInOpening &&
    assistantsInWire.some((m) =>
      overlapRatio(String(m.content), greeting) > 0.3
    );

  const presentLengthOwners = lengthOwners.filter((l) => l.present);
  const presentSceneOwners = sceneOwners.filter((s) => s.present);
  const progressionOwnerCount = sceneOwners.filter(
    (s) => s.present && s.progression_owner
  ).length;

  // Persona duplication: identity block + reference owner
  const personaHits = (built.meta.trackedSections ?? []).filter(
    (s) =>
      /persona|identity/i.test(s.id) ||
      s.text.includes("[USER_PERSONA]") ||
      s.text.includes(personaName)
  );

  const stop = {
    GREETING_DUPLICATED: greetingOccurrences >= 2,
    PREVIOUS_ASSISTANT_DUPLICATED: Boolean(prevAssistantDup),
    MULTIPLE_TERMINAL_LENGTH_OWNERS: presentLengthOwners.length >= 2,
    CONTRADICTORY_SCENE_OWNERS: progressionOwnerCount >= 2,
  };

  const stopFired = Object.entries(stop)
    .filter(([, v]) => v)
    .map(([k]) => k);

  // Duplicate text report (near-duplicate blocks > 0.35)
  const dupPairs: unknown[] = [];
  const bodies = sections.filter((s) => s.characters > 200);
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = fullTexts[bodies[i]!.full_text_ref!]!;
      const b = fullTexts[bodies[j]!.full_text_ref!]!;
      // skip comparing wire parts to tracked duplicates of same content
      if (
        bodies[i]!.semantic_owner.startsWith("wire.") &&
        !bodies[j]!.semantic_owner.startsWith("wire.")
      )
        continue;
      if (
        bodies[j]!.semantic_owner.startsWith("wire.") &&
        !bodies[i]!.semantic_owner.startsWith("wire.")
      )
        continue;
      const r = overlapRatio(a, b);
      if (r >= 0.35) {
        dupPairs.push({
          a: bodies[i]!.semantic_owner,
          b: bodies[j]!.semantic_owner,
          overlap: Math.round(r * 1000) / 1000,
          a_header: bodies[i]!.exact_section_header,
          b_header: bodies[j]!.exact_section_header,
        });
      }
    }
  }

  const payloadMapMd = [
    "# Final payload map — DeepSeek V4 Pro production (offline)",
    "",
    `- character: ${ch.id} ${ch.name}`,
    `- persona: ${persona.id} ${personaName}`,
    `- user: ${user.id}`,
    `- model: ${MODEL}`,
    `- turn: 1 (new chat, greeting in history → thin-history remap)`,
    `- user input: \`${TURN1_USER}\``,
    `- live provider calls: none`,
    "",
    "## Wire message order",
    "",
    "| idx | role | chars | est tokens | sha256 | header |",
    "|---:|---|---:|---:|---|---|",
    ...wire.map((m, i) => {
      const text = String(m.content ?? "");
      // multipart system
      if (i === 0 && Array.isArray(m.content)) {
        const joined = (m.content as Array<{ text?: string }>)
          .map((p) => p.text ?? "")
          .join("\n\n");
        return `| ${i} | system(split) | ${chars(joined)} | ${estimateTokens(joined)} | \`${sha256(joined).slice(0, 16)}\` | OpenRouter 3-part system |`;
      }
      return `| ${i} | ${m.role} | ${chars(text)} | ${estimateTokens(text)} | \`${sha256(text).slice(0, 16)}\` | ${headerOf(text).replace(/\|/g, "/")} |`;
    }),
    "",
    "## Semantic sections (tracked + wire)",
    "",
    "| msg | role | semantic owner | source | header | chars | tokens | sha256 |",
    "|---:|---|---|---|---|---:|---:|---|",
    ...sections.map(
      (s) =>
        `| ${s.message_index ?? "-"} | ${s.role} | \`${s.semantic_owner}\` | ${s.source_file} · ${s.source_function} | ${s.exact_section_header.replace(/\|/g, "/").slice(0, 60)} | ${s.characters} | ${s.estimated_tokens} | \`${s.sha256.slice(0, 16)}\` |`
    ),
    "",
    "## Deterministic stop checks",
    "",
    "```text",
    ...Object.entries(stop).map(([k, v]) => `${k}=${v}`),
    `STOP_LIVE_FACTORIAL=${stopFired.length > 0}`,
    `FIRED=${stopFired.join(",") || "(none)"}`,
    "```",
    "",
    "## Greeting placement",
    "",
    `- in OPENING SCENE CONTEXT (user turn): ${greetingInOpening}`,
    `- in raw history assistant role: ${greetingInHistory}`,
    `- in system: ${greetingInSystem}`,
    `- occurrence count (distinct locations): ${greetingOccurrences}`,
    "",
    "## Length owners present on final user turn",
    "",
    ...presentLengthOwners.map((l) => `- \`${l.id}\` @ ${l.location}`),
    presentLengthOwners.length ? "" : "- (none)",
    "",
    "## Scene owners",
    "",
    ...presentSceneOwners.map((s) => `- \`${s.id}\` @ ${s.location}`),
    "",
  ].join("\n");

  save("FINAL_PAYLOAD_MAP.md", payloadMapMd);
  save("FINAL_PAYLOAD_SECTIONS.json", {
    meta: {
      character_id: ch.id,
      persona_id: persona.id,
      model: MODEL,
      turn: 1,
      live_calls: 0,
      wire_message_count: wire.length,
      history_messages_after_peel: wire.length - 2, // minus system + final user
    },
    stop,
    stop_fired: stopFired,
    length_owners: lengthOwners,
    scene_owners: sceneOwners,
    greeting: {
      chars: chars(greeting),
      in_opening_context: greetingInOpening,
      in_history: greetingInHistory,
      in_system: greetingInSystem,
      occurrences: greetingOccurrences,
      sha256: sha256(greeting),
    },
    persona_related_sections: personaHits.map((s) => s.id),
    sections,
    wire_headers: wire.map((m, i) => ({
      index: i,
      role: m.role,
      header: headerOf(
        Array.isArray(m.content)
          ? (m.content as Array<{ text?: string }>).map((p) => p.text ?? "").join("\n")
          : String(m.content ?? "")
      ),
      chars: chars(
        Array.isArray(m.content)
          ? (m.content as Array<{ text?: string }>).map((p) => p.text ?? "").join("\n")
          : String(m.content ?? "")
      ),
    })),
  });

  save(
    "DUPLICATE_OWNER_REPORT.md",
    [
      "# Duplicate owner report",
      "",
      "## Stop conditions",
      "",
      "```text",
      ...Object.entries(stop).map(([k, v]) => `${k}=${v}`),
      "```",
      "",
      "## Required checks",
      "",
      `| check | result | notes |`,
      `|---|---|---|`,
      `| character greeting ≥2 locations | ${greetingOccurrences >= 2} | opening=${greetingInOpening} history=${greetingInHistory} system=${greetingInSystem} |`,
      `| initial assistant scene in greeting AND raw history | ${greetingInOpening && greetingInHistory} | DeepSeek thin remap should peel history |`,
      `| previous assistant in summary AND raw history | false (turn1 empty memory) | N/A on brand-new chat |`,
      `| user persona ≥2 sections | ${personaHits.length >= 2} | sections: ${personaHits.map((s) => s.id).join(", ") || "-"} |`,
      `| SceneDirective meaning duplicated as second progression owner | ${stop.CONTRADICTORY_SCENE_OWNERS} | progression_owner_count=${progressionOwnerCount} |`,
      `| length target/minimum ≥2 owners | ${presentLengthOwners.length >= 2} | ${presentLengthOwners.map((l) => l.id).join(", ")} |`,
      `| scene progression owner ≥2 | ${progressionOwnerCount >= 2} | present=${presentSceneOwners.map((s) => s.id).join(", ")} |`,
      "",
      stopFired.length
        ? `## Action\n\n\`LIVE_FACTORIAL_BLOCKED\` — create a single-duplication canary for: \`${stopFired[0]}\`\n`
        : `## Action\n\n\`LIVE_FACTORIAL_ALLOWED\`\n`,
    ].join("\n")
  );

  save("DUPLICATE_TEXT_REPORT.json", {
    pairs: dupPairs,
    note: "Near-duplicate bodies (trigram/containment overlap ≥ 0.35), excluding tracked↔wire mirrors.",
  });

  save(
    "LENGTH_OWNER_REPORT.md",
    [
      "# Length owner report (DeepSeek V4 Pro · Turn 1)",
      "",
      "| owner | present | location | sha256 |",
      "|---|---|---|---|",
      ...lengthOwners.map(
        (l) =>
          `| \`${l.id}\` | ${l.present} | ${l.location} | \`${l.sha256.slice(0, 16)}\` |`
      ),
      "",
      `**terminal length owner count (present):** ${presentLengthOwners.length}`,
      "",
      "### Notes",
      "",
      "- `DEEPSEEK_BOTTOM_REMINDER` still references `TARGET_LENGTH / MINIMUM_FLOOR` even though system numeric length owners are empty in production.",
      "- `DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA` fires on thin/new chats (no prior assistant avg ≥ 2200 no-ws).",
      "- `USER_TAIL_LENGTH_OWNER_SENTENCE` is the absolute user-turn end numeric band (3,200~4,200).",
      "",
      presentLengthOwners.length >= 2
        ? "`MULTIPLE_TERMINAL_LENGTH_OWNERS=true` → live factorial blocked until a single-owner canary lands."
        : "`MULTIPLE_TERMINAL_LENGTH_OWNERS=false`",
    ].join("\n")
  );

  // Save full final user + system for inspection (artifacts)
  const art = "/opt/cursor/artifacts/rp-first-principles-payload";
  mkdirSync(art, { recursive: true });
  writeFileSync(join(art, "final_user_turn.txt"), finalUser, "utf8");
  writeFileSync(join(art, "system_joined.txt"), systemJoined, "utf8");
  writeFileSync(
    join(art, "wire_messages.json"),
    JSON.stringify(
      wire.map((m, i) => ({
        index: i,
        role: m.role,
        content: m.content,
      })),
      null,
      2
    ),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        out: OUT,
        stop,
        stop_fired: stopFired,
        length_owner_count: presentLengthOwners.length,
        scene_owner_count: presentSceneOwners.length,
        greeting_occurrences: greetingOccurrences,
        wire_messages: wire.length,
        tracked_sections: (built.meta.trackedSections ?? []).length,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
