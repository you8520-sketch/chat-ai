/**
 * Phase D3-0 — Offline Gemini 3.1 Pro prompt owner map (API CALL = 0).
 *
 * Dumps production buildContext tracked sections + A/T/C fingerprints.
 *
 *   node --conditions=react-server --import tsx scripts/rp-quality-d3-offline-owner-map.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  applyGeminiSceneContinuityPlacement,
  contextBoundaryPreservesOtherSections,
  estimateGeminiSceneContinuityTokens,
  GEMINI_SCENE_CONTINUITY_BLOCK,
  OUTPUT_LAYOUT_BOUNDARY_MARKER,
  type GeminiContinuityPlacement,
} from "../src/lib/geminiSceneContinuityAdapter";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const DOCS = "docs/audits/rp-quality-v2-gemini/d3";
const FIXTURE = "docs/audits/rp-quality-v2-gemini/fixtures/c10_fixture.json";

function sha256(t: string) {
  return createHash("sha256").update(t).digest("hex");
}
function save(name: string, content: string | object) {
  mkdirSync(DOCS, { recursive: true });
  writeFileSync(
    join(DOCS, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}
function estTok(s: string) {
  return Math.max(1, Math.ceil(s.length * 0.9));
}

async function main() {
  const { OPENROUTER_GEMINI_31_PRO_MODEL } = await import(
    "../src/lib/chatModels"
  );
  const { loadCharacterChunksForPromptReadOnly } = await import(
    "../src/lib/characterChunks"
  );
  const { formatSelectedPersonaForPrompt } = await import(
    "../src/lib/userPersonas"
  );
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import(
    "../src/lib/openRouterAdult"
  );
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");

  const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
  const ch = fixture.character;
  const persona = fixture.persona;
  const personaName = String(persona.name ?? "렌");
  const { chunks } = loadCharacterChunksForPromptReadOnly(
    {
      id: Number(ch.id),
      name: String(ch.name),
      gender: String(ch.gender ?? ""),
      system_prompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      example_dialog: String(ch.example_dialog ?? ""),
      setting_chunks: String(ch.setting_chunks ?? ""),
      speech_profile: String(ch.speech_profile ?? ""),
    },
    personaName,
    String(fixture.user.nickname ?? personaName)
  );
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: String(ch.name),
  });
  const userInput =
    "*멀리서 비명과 금속 마찰음이 겹친다. 렌은 에녹 쪽으로 몸을 낮춘다.* 저쪽이에요. 같이 가요?";

  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(fixture.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: [
      { role: "user", content: OPENING_TURN_USER },
      { role: "assistant", content: String(ch.greeting ?? "") },
    ],
    currentUserMessage: userInput,
    nsfw: !!ch.nsfw,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
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
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(fixture.user.id ?? 4),
    narrativePov,
  });

  const sections = (built.meta.trackedSections ?? []).map((s, order_index) => {
    const head = s.text.slice(0, 80).replace(/\s+/g, " ");
    const marker = /^(\[[^\]]+\])/.exec(s.text.trim())?.[1] ?? null;
    return {
      order_index,
      id: s.id,
      label: s.label,
      category: s.category,
      role: "system" as const,
      marker,
      estimated_tokens: estTok(s.text),
      text_chars: s.text.length,
      head,
      semantic_owner: classifyOwner(s.id, s.label, marker, s.text),
    };
  });

  const lastUser = [...(built.history ?? [])]
    .reverse()
    .find((m) => m.role === "user");
  const userTail = lastUser?.content ?? "";
  const hasLengthTail = userTail.includes(
    USER_TAIL_LENGTH_OWNER_SENTENCE.slice(0, 20)
  );
  const hasLayoutTail = /레이아웃:/.test(userTail);

  const placements: GeminiContinuityPlacement[] = [
    "absent",
    "terminal_system",
    "context_boundary",
  ];
  const fingerprints: Record<string, unknown> = {};
  for (const placement of placements) {
    const applied = applyGeminiSceneContinuityPlacement({
      systemPrompt: built.systemPrompt,
      modelId,
      placement,
    });
    const wire = assemblePrimaryRpRequest({
      system: applied.systemPrompt,
      history: built.history ?? [],
      modelId,
      targetResponseChars: 3200,
      messageOpts: {
        transportProvider: "openrouter",
        charName: String(ch.name),
        personaName,
      },
    });
    const messages = (wire.requestBody as { messages?: unknown[] }).messages;
    const msgsJson = JSON.stringify(messages);
    fingerprints[placement] = {
      system_sha256: sha256(applied.systemPrompt),
      messages_sha256: sha256(msgsJson),
      system_token_estimate: estTok(applied.systemPrompt),
      user_tail_sha256: sha256(userTail),
      injected: applied.injected,
      insert_marker: applied.insertMarker,
      continuity_index:
        applied.systemPrompt.indexOf("[GEMINI SCENE CONTINUITY]"),
      output_layout_index: applied.systemPrompt.indexOf(
        OUTPUT_LAYOUT_BOUNDARY_MARKER
      ),
    };
  }

  const cApplied = applyGeminiSceneContinuityPlacement({
    systemPrompt: built.systemPrompt,
    modelId,
    placement: "context_boundary",
  });
  const preserveOk = contextBoundaryPreservesOtherSections({
    baselineSystem: built.systemPrompt,
    placedSystem: cApplied.systemPrompt,
    block: GEMINI_SCENE_CONTINUITY_BLOCK,
  });

  const layoutSection = sections.find((s) => s.id === "rule-output-layout-recency");
  const proseSection = sections.find((s) => s.id === "prose-style-xml-bundle");
  const personaSection = sections.find((s) => s.id === "identity-and-rules");
  const memorySections = sections.filter((s) =>
    /memory|episodic|archive|active-canon|private-character/i.test(s.id)
  );

  const authorityAnswers = {
    "1_length_owner": {
      location: "USER_TAIL (after current user input)",
      constant: "USER_TAIL_LENGTH_OWNER_SENTENCE",
      file: "src/lib/responseLength.ts",
      in_system_for_openrouter: false,
      present_on_final_user_message: hasLengthTail,
    },
    "2_scene_continue_owner": {
      note: "No single dedicated 'continue scene' system section; scene continuity is implied by history + prose/layout. Layout owner = rule-output-layout-recency.",
      primary_execution_owner: "rule-output-layout-recency → [OUTPUT LAYOUT]",
      order_index: layoutSection?.order_index ?? null,
    },
    "3_terminal_user_instruction_after_input": {
      present: hasLayoutTail || hasLengthTail,
      layout_tail: hasLayoutTail,
      length_tail: hasLengthTail,
      excerpt_tail: userTail.slice(-280),
    },
    "4_d2_continuity_vs_owners": {
      d2_placement: "SYSTEM_TAIL (after narrative-pov-owner / final system sections)",
      relative_to_output_layout: "AFTER [OUTPUT LAYOUT]",
      relative_to_user_length_owner: "BEFORE user-tail length (system vs user role)",
    },
    "5_system_last_section": {
      id: sections[sections.length - 1]?.id ?? null,
      label: sections[sections.length - 1]?.label ?? null,
      marker: sections[sections.length - 1]?.marker ?? null,
      order_index: sections.length ? sections.length - 1 : null,
    },
    "6_content_vs_prose_boundary": {
      note: "Production OpenRouter places prose-style-xml-bundle BEFORE volatile memory. Content-interpretation boundary for D3 C is therefore defined as immediately before [OUTPUT LAYOUT] (after active canon / private secret / status / speech), not before early prose.",
      prose_order_index: proseSection?.order_index ?? null,
      persona_order_index: personaSection?.order_index ?? null,
      memory_order_indices: memorySections.map((s) => ({
        id: s.id,
        order_index: s.order_index,
      })),
      output_layout_order_index: layoutSection?.order_index ?? null,
      d3_c_insert: `immediately before ${OUTPUT_LAYOUT_BOUNDARY_MARKER} (section rule-output-layout-recency)`,
    },
  };

  const report = {
    phase: "D3-0",
    api_calls: 0,
    modelId,
    baseline_main_note: "branch from origin/main at start",
    wording_bytes_sha256: sha256(GEMINI_SCENE_CONTINUITY_BLOCK),
    adapter_estimated_tokens: estimateGeminiSceneContinuityTokens(),
    offline_owner_map: "PASS",
    context_boundary_preserves_other_sections: preserveOk,
    continuity_current_d2_placement: "SYSTEM_TAIL",
    context_boundary_insertion_point: `before ${OUTPUT_LAYOUT_BOUNDARY_MARKER} / rule-output-layout-recency`,
    length_owner_position: "user-tail USER_TAIL_LENGTH_OWNER_SENTENCE",
    user_terminal_owner_position: "layout line + length sentence after [CURRENT USER INPUT] body",
    system_section_order: sections,
    authority_answers: authorityAnswers,
    fingerprints,
    final_user_message_chars: userTail.length,
  };

  if (!preserveOk) {
    throw new Error("C insertion rewrote non-continuity sections — FAIL");
  }
  if (!built.systemPrompt.includes(OUTPUT_LAYOUT_BOUNDARY_MARKER)) {
    throw new Error("production system missing [OUTPUT LAYOUT]");
  }

  save("00_OFFLINE_OWNER_MAP.json", report);

  const md = [
    "# D3-0 Offline Owner Map (API=0)",
    "",
    "## Authority answers",
    "",
    "```json",
    JSON.stringify(authorityAnswers, null, 2),
    "```",
    "",
    "## System section order (Gemini 3.1 Pro / OpenRouter MAIN RP)",
    "",
    "| idx | id | marker | est_tok | semantic_owner |",
    "|----:|----|--------|--------:|----------------|",
    ...sections.map(
      (s) =>
        `| ${s.order_index} | \`${s.id}\` | ${s.marker ?? "—"} | ${s.estimated_tokens} | ${s.semantic_owner} |`
    ),
    "",
    "## Fingerprints",
    "",
    "```json",
    JSON.stringify(fingerprints, null, 2),
    "```",
    "",
    `context_boundary_preserves_other_sections: **${preserveOk}**`,
    "",
  ].join("\n");
  save("00_OFFLINE_OWNER_MAP.md", md);
  console.log(JSON.stringify({ ok: true, sections: sections.length, preserveOk }, null, 2));
}

function classifyOwner(
  id: string,
  label: string,
  marker: string | null,
  text: string
): string {
  if (/openrouter-korean-prose-top|canon|knowledge|core-rp/i.test(id + label)) {
    return "CANON_SCOPE_RULES";
  }
  if (/no-godmodding|user.control|agency/i.test(id + label + text)) {
    return "AGENCY";
  }
  if (/character-core|character canon|world canon/i.test(id + label + (marker ?? ""))) {
    return "CHARACTER_WORLD_CANON";
  }
  if (/identity|persona|mandatory/i.test(id + label + (marker ?? ""))) {
    return "PERSONA";
  }
  if (/prose-style|advanced-prose|webnovel output format|narration register|immersive/i.test(id + label + text)) {
    return "COMMON_PROSE";
  }
  if (/memory|episodic|archive|relationship|active-canon|private-character|scene-directive|lore/i.test(id)) {
    return "MEMORY_RECENT_CONTEXT";
  }
  if (/output-layout|semantic paragraph|dialogue/i.test(id + label + (marker ?? ""))) {
    return "OUTPUT_LAYOUT";
  }
  if (/length/i.test(id + label)) return "LENGTH";
  if (/persona-reference|narrative-pov/i.test(id)) return "DYNAMIC_TAIL_OWNER";
  return "OTHER_SYSTEM";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
