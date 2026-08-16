/**
 * Audit 50 — capture exact final isContinue payload and map owners after AUTO block.
 * No wording changes. Verdict: AUTO_OWNER_RECENCY_CONFLICT_CONFIRMED | AUTO_OWNER_PLACEMENT_PASS
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT = "docs/audits/50-auto-progression-owner-placement";
const FIXTURE = process.env.FIXTURE_PATH ?? "/tmp/c18_fixture.json";
const MODEL = "deepseek-v4-pro";

const CONFLICT_PATTERNS: Array<{ id: string; re: RegExp }> = [
  // Prohibit writing B dialogue (not “does not change control rights”).
  {
    id: "do_not_write_b_dialogue",
    re: /(?:유저|\[B\]).{0,24}(?:대사|대화).{0,24}(?:대신\s*쓰지|쓰지\s*마|생성하지\s*마)|(?:대사|대화).{0,20}(?:유저|\[B\]).{0,12}(?:만\s*가능|전용)|do not write.{0,40}(?:user|\[B\]).{0,20}dialogue/i,
  },
  {
    id: "do_not_control_b",
    re: /(?:유저|\[B\]).{0,20}(?:조종|통제|제어)(?:하지\s*마|금지)|do not control.{0,20}(?:user|\[B\])/i,
  },
  {
    id: "wait_for_user",
    re: /유저.{0,16}(?:응답|입력).{0,16}(?:기다려|대기해|기다린다)|wait for (?:the )?user (?:response|input)/i,
  },
  {
    id: "leave_b_actions_open",
    re: /(?:유저|\[B\]).{0,24}(?:행동|선택).{0,24}(?:열어\s*두|남겨\s*두)|leave .{0,20}(?:user|\[B\]).{0,20}(?:action|choice).{0,20}open/i,
  },
  {
    id: "b_dialogue_user_only",
    re: /(?:유저|\[B\]).{0,16}대사.{0,24}(?:유저만|직접\s*입력만)|dialogue belongs only to the user/i,
  },
  {
    id: "do_not_assume_b_follows",
    re: /(?:유저|\[B\]).{0,24}(?:따른다|따라온).{0,16}(?:가정하지|단정하지)|do not assume.{0,30}follows/i,
  },
  {
    id: "stop_at_b_reaction",
    re: /(?:반응|선택).{0,16}(?:지점|포인트).{0,16}(?:멈춰|중단해)|stop at .{0,30}reaction/i,
  },
  {
    id: "no_user_control_scene",
    re: /유저 행동·감정·대사:\s*대신 쓰지 않음/,
  },
];

function save(name: string, content: string | object) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

type BlockRec = {
  message_index: number;
  role: string;
  block_name: string;
  owner_type: string;
  source_function: string;
  source_file: string;
  character_count: number;
  position_vs_auto_owner: "before" | "is_auto_owner" | "after" | "n/a";
  preview: string;
};

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
  const { buildContinueNarrativeCommand } = await import("../src/lib/continueNarrative");
  const { AUTO_PROGRESSION_BLOCK_TITLE, buildAutoProgressionUserControlBlock } = await import(
    "../src/lib/autoProgressionRules"
  );
  const { COLLABORATIVE_INTERACTIVE_OWNER_TITLE } = await import("../src/lib/noGodmodding");
  const { USER_TAIL_LENGTH_OWNER_SENTENCE } = await import("../src/lib/responseLength");

  const ch = fixture.character;
  const persona = fixture.persona;
  const user = fixture.user;
  const personaName = String(persona.name ?? "렌");
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
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );
  const shortTermHistory = [
    { role: "user" as const, content: OPENING_TURN_USER },
    { role: "assistant" as const, content: String(ch.greeting ?? "") },
    {
      role: "user" as const,
      content: "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.",
    },
    { role: "assistant" as const, content: "테스트 응답1" },
    { role: "user" as const, content: "너는 이름이뭐야? 뭐하는 중이었어?" },
    { role: "assistant" as const, content: "테스트 응답2" },
  ];
  const continueCmd = buildContinueNarrativeCommand({
    personaName,
    charName: String(ch.name),
  });
  const sceneDirectiveBlock = renderSceneDirectiveForPrompt(
    buildSceneDirective({
      characterName: String(ch.name),
      recentMessages: shortTermHistory,
      currentUserMessage: continueCmd,
      contentKind: "character",
      mode: "auto_progression",
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
    currentUserMessage: continueCmd,
    nsfw: false,
    gender: "male",
    memoryMeta: "",
    modelId: MODEL,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: true,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: 2,
    provider: "openrouter",
    contentKind: "character",
    sceneDirectiveBlock,
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: 34,
  });

  const wire = buildOpenRouterMessages(built.systemPrompt, built.history, {
    systemSplit: built.openRouterSystemSplit!,
  });

  const exactLines: string[] = [];
  for (let i = 0; i < wire.length; i++) {
    const m = wire[i]!;
    const role = String(m.role);
    let content = "";
    if (typeof m.content === "string") content = m.content;
    else if (Array.isArray(m.content)) {
      content = (m.content as Array<{ text?: string; type?: string }>)
        .map((p) => p.text ?? "")
        .join("\n\n");
    }
    exactLines.push(`===== MESSAGE ${i} role=${role} chars=${[...content].length} =====`);
    exactLines.push(content);
    exactLines.push("");
  }
  save("EXACT_FINAL_PAYLOAD.txt", exactLines.join("\n"));

  const autoBody = buildAutoProgressionUserControlBlock();
  const sections = built.meta.trackedSections ?? [];
  const autoSectionIdx = sections.findIndex((s) => s.id === "no-godmodding");
  const blocks: BlockRec[] = [];

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    let position: BlockRec["position_vs_auto_owner"] = "n/a";
    if (autoSectionIdx >= 0) {
      if (i < autoSectionIdx) position = "before";
      else if (i === autoSectionIdx) position = "is_auto_owner";
      else position = "after";
    }
    let ownerType = "section";
    if (s.id === "no-godmodding") ownerType = "auto_progression_owner";
    if (s.text.includes(COLLABORATIVE_INTERACTIVE_OWNER_TITLE)) {
      ownerType = "collaborative_interactive_owner";
    }
    if (s.id === "scene-directive") ownerType = "scene_directive";
    blocks.push({
      message_index: 0,
      role: "system",
      block_name: s.id,
      owner_type: ownerType,
      source_function: "buildContext/pushSection",
      source_file: "src/services/contextBuilder.ts",
      character_count: [...s.text].length,
      position_vs_auto_owner: position,
      preview: s.text.slice(0, 160).replace(/\n/g, " "),
    });
  }

  // Final user message sub-blocks
  const finalUser = String(wire[wire.length - 1]?.content ?? "");
  const finalIdx = wire.length - 1;
  const userParts: Array<{ name: string; type: string; file: string; fn: string; needle: string }> =
    [
      {
        name: "continue_narrative_command",
        type: "continue_short_ref",
        file: "src/lib/continueNarrative.ts",
        fn: "buildContinueNarrativeCommand",
        needle: "[SYSTEM DIRECTIVE: CONTINUE THE NARRATIVE]",
      },
      {
        name: "deepseek_style_only_reminder",
        type: "style_reminder",
        file: "src/lib/deepseekPromptStructure.ts",
        fn: "prependDeepSeekStyleOnlyReminder",
        needle: "[System Reminder:",
      },
      {
        name: "user_tail_length_owner",
        type: "terminal_length_owner",
        file: "src/lib/responseLength.ts",
        fn: "appendCompactTerminalLengthToUserTurn",
        needle: USER_TAIL_LENGTH_OWNER_SENTENCE.slice(0, 40),
      },
    ];
  for (const p of userParts) {
    if (!finalUser.includes(p.needle)) continue;
    blocks.push({
      message_index: finalIdx,
      role: "user",
      block_name: p.name,
      owner_type: p.type,
      source_function: p.fn,
      source_file: p.file,
      character_count: 0,
      position_vs_auto_owner: "after",
      preview: p.needle,
    });
  }

  // Scan text AFTER auto owner in system + all subsequent messages
  const systemJoined = Array.isArray(wire[0]?.content)
    ? (wire[0]!.content as Array<{ text?: string }>)
        .map((p) => p.text ?? "")
        .join("\n\n")
    : String(wire[0]?.content ?? "");
  const autoPos = systemJoined.indexOf(AUTO_PROGRESSION_BLOCK_TITLE);
  const afterAutoSystem =
    autoPos >= 0
      ? systemJoined.slice(autoPos + AUTO_PROGRESSION_BLOCK_TITLE.length)
      : "";
  // Also include sections after no-godmodding by reconstructing from trackedSections
  const afterOwnerSections = sections
    .slice(autoSectionIdx + 1)
    .map((s) => `## ${s.id}\n${s.text}`)
    .join("\n\n");
  const afterCorpus = [
    afterOwnerSections,
    afterAutoSystem,
    ...wire.slice(1).map((m, i) => {
      const c =
        typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? (m.content as Array<{ text?: string }>).map((p) => p.text ?? "").join("\n")
            : "";
      return `## message_${i + 1}_${m.role}\n${c}`;
    }),
  ].join("\n\n");

  const conflicts: Array<{
    pattern_id: string;
    match: string;
    location_hint: string;
  }> = [];
  for (const pat of CONFLICT_PATTERNS) {
    const m = afterCorpus.match(pat.re);
    if (m) {
      conflicts.push({
        pattern_id: pat.id,
        match: m[0]!.slice(0, 200),
        location_hint: "after_auto_owner_corpus",
      });
    }
  }

  // Specific structural checks
  const collabCount = (systemJoined + finalUser).split(COLLABORATIVE_INTERACTIVE_OWNER_TITLE)
    .length - 1;
  const autoCount = (systemJoined + finalUser).split(AUTO_PROGRESSION_BLOCK_TITLE).length - 1;
  const autoInFinalUser = finalUser.includes(AUTO_PROGRESSION_BLOCK_TITLE);
  const hasUserTail = finalUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE.slice(0, 30));

  // Scene directive no_user_control style lines after owner
  if (/유저 행동·감정·대사:\s*대신 쓰지 않음/.test(afterCorpus)) {
    conflicts.push({
      pattern_id: "scene_v2_no_user_control_line",
      match: "유저 행동·감정·대사: 대신 쓰지 않음",
      location_hint: "scene_directive_after_auto",
    });
  }

  const placementPass = conflicts.length === 0 && collabCount === 0 && autoCount === 1;
  const verdict = placementPass
    ? "AUTO_OWNER_PLACEMENT_PASS"
    : "AUTO_OWNER_RECENCY_CONFLICT_CONFIRMED";

  save("OWNER_POSITION_MAP.json", {
    verdict,
    auto_owner_title: AUTO_PROGRESSION_BLOCK_TITLE,
    auto_owner_count: autoCount,
    collaborative_count: collabCount,
    auto_in_final_user: autoInFinalUser,
    user_tail_present: hasUserTail,
    auto_section_index: autoSectionIdx,
    tracked_section_count: sections.length,
    blocks,
  });

  save(
    "FINAL_MESSAGE_ORDER.md",
    [
      "# Final message order — isContinue=true",
      "",
      `## Verdict: \`${verdict}\``,
      "",
      `| idx | role | chars | notes |`,
      `|---:|---|---:|---|`,
      ...wire.map((m, i) => {
        const c =
          typeof m.content === "string"
            ? m.content
            : Array.isArray(m.content)
              ? (m.content as Array<{ text?: string }>).map((p) => p.text ?? "").join("\n")
              : "";
        const notes: string[] = [];
        if (c.includes(AUTO_PROGRESSION_BLOCK_TITLE)) notes.push("AUTO_OWNER");
        if (c.includes(COLLABORATIVE_INTERACTIVE_OWNER_TITLE)) notes.push("COLLAB");
        if (c.includes("[SYSTEM DIRECTIVE: CONTINUE THE NARRATIVE]")) notes.push("CONTINUE_CMD");
        if (c.includes(USER_TAIL_LENGTH_OWNER_SENTENCE.slice(0, 20))) notes.push("USER_TAIL");
        return `| ${i} | ${m.role} | ${[...c].length} | ${notes.join(", ") || "—"} |`;
      }),
      "",
      "## Tracked system sections (buildContext)",
      "",
      ...sections.map((s, i) => {
        const mark =
          i === autoSectionIdx ? " ← AUTO OWNER" : i > autoSectionIdx ? " (after)" : " (before)";
        return `${i}. \`${s.id}\`${mark} — ${[...s.text].length} chars`;
      }),
      "",
    ].join("\n")
  );

  save("POST_AUTO_OWNER_CONFLICTS.json", {
    verdict,
    conflicts,
    structural: {
      autoCount,
      collabCount,
      autoInFinalUser,
      hasUserTail,
      after_owner_section_ids: sections.slice(autoSectionIdx + 1).map((s) => s.id),
    },
  });

  save(
    "POST_AUTO_OWNER_CONFLICTS.md",
    [
      "# Post-auto-owner conflicts",
      "",
      `## Verdict: \`${verdict}\``,
      "",
      conflicts.length
        ? conflicts
            .map((c) => `- **${c.pattern_id}**: \`${c.match}\` (${c.location_hint})`)
            .join("\n")
        : "_No conflicting patterns matched after the auto owner._",
      "",
      "## Structural",
      "",
      "```json",
      JSON.stringify(
        {
          autoCount,
          collabCount,
          autoInFinalUser,
          hasUserTail,
          after_owner_section_ids: sections.slice(autoSectionIdx + 1).map((s) => s.id),
        },
        null,
        2
      ),
      "```",
      "",
      placementPass
        ? [
            "```text",
            "AUTO_OWNER_PLACEMENT_PASS",
            "MODEL_FAILED_EXPLICIT_CO_NARRATION_REQUIREMENT",
            "DEEPSEEK_AUTO_PROGRESSION_NOT_RELIABLE",
            "```",
          ].join("\n")
        : [
            "```text",
            "AUTO_OWNER_RECENCY_CONFLICT_CONFIRMED",
            "```",
            "",
            "Fix placement/routing only (same wording, owner count = 1).",
          ].join("\n"),
      "",
    ].join("\n")
  );

  console.log(
    JSON.stringify(
      {
        verdict,
        conflicts: conflicts.length,
        autoCount,
        collabCount,
        afterSections: sections.slice(autoSectionIdx + 1).map((s) => s.id),
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
