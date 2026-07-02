/**
 * Step 7.5 — Character Dialogue Register Root Cause Audit (static).
 * Usage: npm.cmd exec tsx -- scripts/step75-register-root-cause-audit.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PROSE_STYLE_SECTION } from "@/lib/advancedProseNsfwGuidelines";
import { buildNarrativeStyleLayer } from "@/lib/narrativeStyle";
import { SPEECH_METADATA_INVISIBLE_RULE } from "@/lib/speechMetadataPolicy";
import { buildOpenRouterKoreanProseTopBlock } from "@/lib/openRouterProsePolicy";
import { STEP43_GENRE_TONE_HINTS } from "@/lib/registerPatchExperiment";
import { REGISTER_AUDIT_SOURCES } from "@/lib/registerMetaAudit";
import { buildCharacterSpeechRecencyTail } from "@/lib/characterKnowledgeBoundary";
import { formatSpeechSectionAsMetadata } from "@/lib/speechMetadataPolicy";

const OUT = join(process.cwd(), "output", "step75-register-root-cause-audit.md");

const RUNTIME_CALL_GRAPH = `
Character Speech Runtime Flow (Production)

[Character Form Save]
  characterFormSave.ts
    └─ composeExampleDialog()          speechCreatorFields.ts  ✓ SAVE-TIME
         └─ formatSpeechSectionAsMetadata()  speechMetadataPolicy.ts

[Character Card Parse]
  characterParser.ts / characterSettingSections.ts
    └─ category "speech" for 말투|어조|예시 대화 headers

[Context Assembly — every turn]
  contextBuilder.ts :: buildContext()
    └─ collectCharacterSettingText()     bodyHairRules.ts
    └─ buildCharacterCanonBlock()        characterKnowledgeBoundary.ts
         └─ buildStructuredCharacterCanonBlock()
              └─ formatSection() only   ✗ NO formatSpeechSectionAsMetadata (unless REGISTER_PATCH=B)
    └─ buildAdvancedProseNsfwGuidelines / buildProseStyleXmlBundle
         └─ SPEECH_METADATA_INVISIBLE_RULE (global)
         └─ PROSE_STYLE [NARRATION REGISTER] (narration -다 only)
    └─ buildNarrativeStyleLayer()       narrativeStyle.ts
         └─ [genre_tone] with dialogue register hints (Step 7.3+)
    └─ buildLengthInstruction()           responseLength.ts

[NOT in live chat path]
  speechLock/deriveProfile.ts → speech_profile JSON (DB only)
  validateSpeechLock() → post-gen (not wired in chat/route.ts)
  formatSpeechSectionAsMetadata at runtime → DEAD unless Patch B
  buildCharacterSpeechRecencyTail → DEAD unless Patch D
`;

const DEAD_PATHS = [
  {
    fn: "formatSpeechSectionAsMetadata() @ runtime canon",
    saveOnly: "composeExampleDialog() on character save",
    generation: "NOT called from buildStructuredCharacterCanonBlock (production)",
    patch: "B wires existing function",
  },
  {
    fn: "buildCharacterSpeechRecencyTail()",
    saveOnly: "—",
    generation: "NOT called unless REGISTER_PATCH=D",
    patch: "D re-emits canon speech at dynamic tail",
  },
  {
    fn: "speech_profile / deriveSpeechProfile",
    saveOnly: "DB column",
    generation: "NOT injected in system prompt",
    patch: "out of scope (validator only)",
  },
  {
    fn: "validateSpeechLock / speechLock validator",
    saveOnly: "—",
    generation: "NOT wired in api/chat/route.ts",
    patch: "out of scope",
  },
];

const TIMELINE = [
  {
    phase: "Step 4.3 (~095401d)",
    speech: "genre_tone = atmosphere only; BEAT FLOW validated; SPEECH METADATA in prose bundle",
    risk: "low — character card + examples primary",
  },
  {
    phase: "Step 7 (4519366^)",
    speech: "TOP OR-NO-META-WRITING removed; prose consolidated; M2M merged",
    risk: "medium — speech reminder moved deeper in stack",
  },
  {
    phase: "Step 7.3 (2dfcc32)",
    speech: "genre_tone extended with per-genre dialogue register (합니다·해요 mandates)",
    risk: "HIGH — recency override vs CHARACTER CANON context registers",
  },
  {
    phase: "Current (4519366)",
    speech: "Step 7.5 habit merge; genre register still present",
    risk: "HIGH — Leon private 해요 vs 판타지/SF → 합니다 conflict",
  },
];

const CONFLICTS = [
  {
    owners: "CHARACTER CANON vs [genre_tone]",
    conflict: "Card: 공적=다나까 / 둘만=해요 vs Genre: 판타지/SF → 현대 존댓말(합니다) + 하오 금지",
    winner: "Should be CHARACTER CANON",
    fix: "Patch A — remove register from genre_tone (Step 4.3 hints)",
  },
  {
    owners: "SPEECH METADATA vs [NARRATION REGISTER]",
    conflict: "Both mention register; narration -다 vs dialogue register",
    winner: "Split owners (Step 7.3 label fix) — OK if not confused",
    fix: "No change — already renamed NARRATION REGISTER",
  },
  {
    owners: "SPEECH METADATA vs CHARACTER CANON",
    conflict: "Global '한 턴 register 섞지 마라' vs card context pairs (public/private)",
    winner: "CHARACTER CANON context for scene",
    fix: "Merge rewrite in SPEECH METADATA (future) — not in A/B/C/D",
  },
  {
    owners: "[genre_tone] vs SPEECH CONSISTENCY (example_dialog)",
    conflict: "Late genre register vs early examples win rule",
    winner: "Examples + canon",
    fix: "Patch A removes competing register; Patch D adds recency",
  },
];

function main() {
  const currentGenre = buildNarrativeStyleLayer({ genres: ["판타지/SF"] });
  const step43Genre = `[genre_tone] 판타지/SF: ${STEP43_GENRE_TONE_HINTS["판타지/SF"]}.`;

  const leonSpeechSample = formatSpeechSectionAsMetadata(
    "레온의 말투",
    "공적인 자리: 다나까체\n유저와 둘만 있을 때: 해요체"
  );
  const recencySample = buildCharacterSpeechRecencyTail(
    "# 말투\n공적인 자리: 다나까체\n유저와 둘만: 해요체"
  );

  const md = [
    "# Step 7.5 — Character Dialogue Register Root Cause Audit",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## 1. Root cause (code-confirmed)",
    "",
    "**Primary regression:** Step 7.3 (`2dfcc32`) added **dialogue register mandates** to `[genre_tone]` in `narrativeStyle.ts`.",
    "",
    "Step 4.3 genre hints were **atmosphere-only** (no `대사 register`).",
    "",
    "**Secondary:** `formatSpeechSectionAsMetadata()` is **save-time only** — raw `# 말투` in system_prompt stays prose at generation.",
    "",
    "**Tertiary:** `[genre_tone]` is injected **late** (dynamic tail) after prose bundle — recency favors genre over canon.",
    "",
    "## 2. Timeline",
    "",
    "| Phase | Speech stack | Risk |",
    "|-------|--------------|------|",
    ...TIMELINE.map((t) => `| ${t.phase} | ${t.speech} | ${t.risk} |`),
    "",
    "## 3. Prompt layer order (OpenRouter production)",
    "",
    "1. TOP priority (canon #1 declaration) — `openRouterProsePolicy.ts`",
    "2. Core rules / knowledge boundary",
    "3. **CHARACTER CANON** (말투 raw prose) — `cacheCharacter`",
    "4. Identity & persona",
    "5. **ADVANCED PROSE** (SPEECH METADATA + NARRATION REGISTER + RHYTHM/EMOTION/BREATH) — `cacheCharacter`",
    "6. Memory / RAG",
    "7. **[genre_tone] + SCENE MODE** — `dynamic` ← **late register override**",
    "8. LENGTH / OUTPUT LAYOUT / terminal tail",
    "",
    "## 4. Runtime call graph",
    "",
    "```",
    RUNTIME_CALL_GRAPH.trim(),
    "```",
    "",
    "## 5. Dead paths",
    "",
    "| Function | Save-time | Generation | Patch |",
    "|----------|-----------|------------|-------|",
    ...DEAD_PATHS.map(
      (d) => `| \`${d.fn}\` | ${d.saveOnly} | ${d.generation} | ${d.patch} |`
    ),
    "",
    "## 6. Conflict inventory",
    "",
    ...CONFLICTS.map(
      (c) =>
        `### ${c.owners}\n- **Conflict:** ${c.conflict}\n- **Owner should win:** ${c.winner}\n- **Fix:** ${c.fix}\n`
    ),
    "",
    "## 7. Register rule owners (duplicate scan)",
    "",
    "| File | Owner | Impact |",
    "|------|-------|--------|",
    ...REGISTER_AUDIT_SOURCES.map(
      (r) =>
        `| ${r.file} | ${r.owner} | ${r.impact}${r.duplicateOf ? ` (dup: ${r.duplicateOf})` : ""} |`
    ),
    "",
    "## 8. genre_tone diff (Step 4.3 vs current)",
    "",
    "**Step 4.3:**",
    "```",
    step43Genre,
    "```",
    "",
    "**Current:**",
    "```",
    currentGenre,
    "```",
    "",
    "## 9. Metadata wiring sample (Leon)",
    "",
    "If Patch B/D active, `# 말투` becomes:",
    "",
    "```",
    leonSpeechSample,
    "```",
    "",
    "Patch D tail preview:",
    "",
    "```",
    recencySample || "(empty — run with REGISTER_PATCH=D)",
    "```",
    "",
    "## 10. Patch experiment matrix",
    "",
    "| Patch | Mechanism | Layer |",
    "|-------|-----------|-------|",
    "| A | STEP43 genre hints (no dialogue register) | Rewrite narrativeStyle |",
    "| B | formatSpeechSectionAsMetadata @ canon build | Wiring characterKnowledgeBoundary |",
    "| C | narrative-style before prose bundle | Priority reorder contextBuilder |",
    "| D | buildCharacterSpeechRecencyTail before LENGTH | Recency reorder contextBuilder |",
    "| step43 | Same genre as A (acceptance baseline threshold) | — |",
    "",
  ].join("\n");

  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  writeFileSync(OUT, md);
  console.log(`Report: ${OUT}`);
}

main();
