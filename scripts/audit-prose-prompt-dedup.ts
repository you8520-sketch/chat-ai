/**
 * Runtime prose prompt duplicate audit — OpenRouter DeepSeek assembly
 */
import Module from "module";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

async function main() {
  const { buildOpenRouterKoreanProseTopBlock } = await import("@/lib/openRouterProsePolicy");
  const { buildProseStyleXmlBundle } = await import("@/lib/proseStyleXmlBundle");
  const { buildLengthInstruction, buildTerminalLengthOverrideBlock } = await import(
    "@/lib/responseLength"
  );
  const {
    buildWebnovelOutputLayoutRecencyBlock,
    WEBNOVEL_OUTPUT_FORMAT_BLOCK,
    buildUserInputParsingBlock,
  } = await import("@/lib/webnovelOutputFormat");
  const { buildDeepSeekBottomReminderBlock } = await import("@/lib/deepseekPromptStructure");
  const { SPEECH_METADATA_INVISIBLE_RULE } = await import("@/lib/speechMetadataPolicy");
  const { DIALOGUE_FORMAT_DIRECTIVE } = await import("@/lib/promptTranslation");
  const {
    NARRATIVE_DENSITY_BLOCK,
    MOMENT_TO_MOMENT_WRITING_BLOCK,
    NO_GENERIC_REACTIONS_BLOCK,
    NO_INPUT_ECHO_RULE,
  } = await import("@/lib/sceneExpansionPolicy");

  const blocks: [string, string][] = [
    ["1 TOP Korean prose", buildOpenRouterKoreanProseTopBlock()],
    ["2 ADVANCED PROSE (cacheCharacter)", buildProseStyleXmlBundle({ nsfwEnabled: false })],
    [
      "3 LENGTH CONTROL (dynamic)",
      buildLengthInstruction(null, {
        htmlFlashOwned: true,
        proseStylePolicyOwnsSceneExpansion: true,
      }),
    ],
    ["4 OUTPUT LAYOUT (dynamic)", buildWebnovelOutputLayoutRecencyBlock()],
    ["5 Terminal length (dynamic)", buildTerminalLengthOverrideBlock()],
    ["6 DeepSeek bottom reminder (user turn)", buildDeepSeekBottomReminderBlock()],
    ["7 USER INPUT PARSING (dynamic)", buildUserInputParsingBlock(false)],
    ["— Gemini tail only", DIALOGUE_FORMAT_DIRECTIVE],
    ["— sceneExpansionPolicy (source)", [NO_INPUT_ECHO_RULE, NARRATIVE_DENSITY_BLOCK, MOMENT_TO_MOMENT_WRITING_BLOCK, NO_GENERIC_REACTIONS_BLOCK].join("\n\n")],
  ];

  const lines = new Map<string, Set<string>>();
  for (const [name, text] of blocks) {
    for (const raw of text.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
      if (raw.length < 20) continue;
      const key = raw.replace(/\s+/g, " ").toLowerCase();
      if (!lines.has(key)) lines.set(key, new Set());
      lines.get(key)!.add(name);
    }
  }

  const dupLines = [...lines.entries()]
    .filter(([, sources]) => sources.size > 1)
    .sort((a, b) => b[1].size - a[1].size);

  const overlaps: string[] = [];
  const prose = blocks[1][1];
  const length = blocks[2][1];
  const layout = blocks[3][1];
  const terminal = blocks[4][1];
  const top = blocks[0][1];

  overlaps.push(
    `[WEBNOVEL OUTPUT FORMAT] ADVANCED PROSE ⊃ block: ${prose.includes("[WEBNOVEL OUTPUT FORMAT]")}`
  );
  overlaps.push(
    `[WEBNOVEL OUTPUT FORMAT] Gemini tail duplicate of ADVANCED: ${DIALOGUE_FORMAT_DIRECTIVE === WEBNOVEL_OUTPUT_FORMAT_BLOCK}`
  );
  overlaps.push(
    `[SPEECH METADATA] TOP mentions 말투·register + ADVANCED has block: ${top.includes("말투") && prose.includes("[SPEECH METADATA]")}`
  );
  overlaps.push(
    `[Layout] LENGTH has dialogue-merge ban + OUTPUT LAYOUT recency: ${length.includes("병합하지") && layout.includes("Never append")}`
  );
  overlaps.push(
    `[Length target] LENGTH + Terminal both state TARGET/MINIMUM: ${length.includes("TARGET_LENGTH") && terminal.includes("TARGET_LENGTH")}`
  );
  overlaps.push(
    `[sceneExpansion] proseStylePolicyOwnsSceneExpansion=true but scene blocks still only in LENGTH (not in ADVANCED): ${!prose.includes("[NARRATIVE DENSITY]") && length.includes("[NARRATIVE DENSITY]")}`
  );
  overlaps.push(
    `[Dump artifact] sections 6/6b/9g in comprehensive.txt list same ADVANCED PROSE 3× — documentation only, not runtime`
  );

  const out: string[] = [
    "문체 프롬프트 런타임 중복 점검 (OpenRouter DeepSeek 기준)",
    `생성: ${new Date().toISOString()}`,
    "",
    "=== 블록별 토큰 근사 (chars) ===",
    ...blocks.map(([n, t]) => `${n}: ${t.length.toLocaleString()} chars`),
    "",
    "=== 구조적 중복 (의도·버그 구분) ===",
    ...overlaps.map((o) => `- ${o}`),
    "",
    "=== 동일/유사 문장이 2+ 블록에 등장 (상위 20) ===",
  ];

  for (const [line, sources] of dupLines.slice(0, 20)) {
    out.push(`[${[...sources].join(" + ")}]`);
    out.push(`  ${line.slice(0, 140)}${line.length > 140 ? "…" : ""}`);
    out.push("");
  }

  out.push(`총 중복 라인 그룹: ${dupLines.length}`);
  out.push("");
  out.push("=== 권장 정리 (우선순위) ===");
  out.push("1. HIGH — Gemini: DIALOGUE_FORMAT_DIRECTIVE tail = ADVANCED PROSE 내 WEBNOVEL OUTPUT FORMAT과 100% 동일 → tail 제거 검토");
  out.push("2. MED — OpenRouter: TOP 말투·register 1줄 + [SPEECH METADATA] 블록 의미 중복 → TOP에서 축약 가능");
  out.push("3. MED — LENGTH의 '지문·대사 병합 금지' + [OUTPUT LAYOUT] recency → LENGTH에서 레이아웃 줄 제거 가능");
  out.push("4. LOW — TARGET_LENGTH/MINIMUM_FLOOR: LENGTH 본문 + Terminal 1줄 recency — 의도적 recency 중복");
  out.push("5. INFO — comprehensive.txt 659줄: SFW/NSFW/9g/15번 섹션이 동일 블록 재나열(덤프용), 런타임 1회만 주입");
  out.push("6. BUG — proseStylePolicyOwnsSceneExpansion 옵션이 contextBuilder에 전달되나 responseLength.ts에서 미사용");

  const path = join(process.cwd(), "output", "prose-style-prompts-dedup-audit.txt");
  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  writeFileSync(path, out.join("\n"), "utf8");
  console.log("Wrote", path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
