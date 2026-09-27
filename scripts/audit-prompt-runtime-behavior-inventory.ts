/**
 * PROMPT/RUNTIME BEHAVIOR AUDIT — final assembled prompt inventory (offline).
 *
 * Reuses production buildContext + promptAudit. Does NOT change production prompts.
 *
 * Usage:
 *   npx tsx scripts/audit-prompt-runtime-behavior-inventory.ts
 *
 * Outputs under docs/audits/prompt-runtime-behavior-audit-2026-09-27/ and
 * /opt/cursor/artifacts/prompt-runtime-behavior-audit/
 */
import "./lib/server-only-mock";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const MAIN_SHA =
  process.env.AUDIT_MAIN_SHA?.trim() ||
  "c127d3030f50d5b8214cf87b920bf44a5503d80c";

const OUT_DOCS = path.join(
  process.cwd(),
  "docs/audits/prompt-runtime-behavior-audit-2026-09-27"
);
const OUT_ART = "/opt/cursor/artifacts/prompt-runtime-behavior-audit";

const CHAR_NAME = "백하율";
const PERSONA_NAME = "렌";

type AuditFixture = {
  id: "quiet_intimacy" | "casual_banter" | "tension_action";
  label: string;
  currentUserMessage: string;
  shortTermHistory: { role: "user" | "assistant"; content: string }[];
};

/** Shared synthetic fixtures — identical across models; no personal user data. */
const AUDIT_FIXTURES: AuditFixture[] = [
  {
    id: "quiet_intimacy",
    label: "QUIET RELATIONSHIP / INTIMACY",
    currentUserMessage:
      "*렌은 창가 쪽을 바라보다가, 백하율에게 반 발짝 다가선다.* …잠깐만. 이 자리, 조금만 더 있어도 돼?",
    shortTermHistory: [
      {
        role: "user",
        content: "밖이 시끄러워서… 여기 창가 쪽이 제일 조용하네.",
      },
      {
        role: "assistant",
        content: `백하율은 창틀에 손을 올린 채 잠시 거리를 내려다보았다.

"…그래요. 여기는 소리가 덜합니다."

그는 렌 쪽을 힐끗 보았다가, 다시 유리에 비친 불빛으로 시선을 되돌렸다.`,
      },
      {
        role: "user",
        content: "*렌은 어깨를 살짝 기대듯 가까이 선다.* 오늘은 말이 별로 없네.",
      },
      {
        role: "assistant",
        content: `백하율의 숨이 짧게 멈추었다가, 곧 평소처럼 고르게 이어졌다.

"…말할 게 없어서가 아니라. 지금 이 공기가 괜찮아서요."

손가락이 창틀 위를 한 번 쓸었다.`,
      },
    ],
  },
  {
    id: "casual_banter",
    label: "CASUAL BANTER",
    currentUserMessage:
      "야, 네가 커피 고른 거 맞지? 이거 미묘하게 쓰운데. 일부러 그런 거지?",
    shortTermHistory: [
      {
        role: "user",
        content: "나 먼저 자리 잡을게. 너는 음료만 맞춰 와.",
      },
      {
        role: "assistant",
        content: `백하율은 메뉴판을 훑고는 짧게 고개를 끄덕였다.

"알겠어요. 취향은 제가 기억합니다."

카운터 쪽으로 몸을 돌리며 입꼬리가 아주 조금 올라갔다.`,
      },
      {
        role: "user",
        content: "어휴, 자신감 넘치네. 실망시키면 안다?",
      },
      {
        role: "assistant",
        content: `그는 잔을 내려놓으며 렌을 똑바로 보았다.

"실망시키면, 다음엔 당신이 고르세요. 그게 공정하잖아요."`,
      },
    ],
  },
  {
    id: "tension_action",
    label: "TENSION / ACTION",
    currentUserMessage:
      "*골목 끝에서 발소리가 급해진다. 렌은 낮은 목소리로 말한다.* 왼쪽이야. 지금 빠져나가야 해.",
    shortTermHistory: [
      {
        role: "user",
        content: "방금 그 그림자, 우리 뒤를 쫓는 것 같아.",
      },
      {
        role: "assistant",
        content: `백하율은 코트 안자락을 붙잡은 채 골목 모서리에 등을 붙였다.

"…거리를 벌리세요. 제가 먼저 확인합니다."

시선이 젖은 아스팔트 위 반사광을 짧게 훑었다.`,
      },
      {
        role: "user",
        content: "*렌은 숨을 죽이고 그의 소매를 짧게 잡아끈다.* 오른쪽은 막혔어.",
      },
      {
        role: "assistant",
        content: `그는 짧게 숨을 들이쉬고 왼쪽 골목으로 턱을 움직였다.

"그러면 왼쪽. 제 뒤로 붙으세요. 신호 없이 뛰지 마세요."`,
      },
    ],
  },
];

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeBoth(rel: string, content: string | object) {
  const body = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  for (const root of [OUT_DOCS, OUT_ART]) {
    ensureDir(path.dirname(path.join(root, rel)));
    fs.writeFileSync(path.join(root, rel), body, "utf8");
  }
}

async function main() {
  const {
    MAIN_RP_USER_SELECTABLE_OPTIONS,
    isDeepSeekMainRpFamilyModel,
    isCheaperInferenceDeepSeekV4ProModel,
    isCheaperInferenceDeepSeekV41FlashModel,
    isGemini31ProModel,
    selectedAIProvider,
  } = await import("../src/lib/chatModels");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  const { resolveProseStyleRouteName } = await import("../src/lib/proseStyleResolver");
  const { resolveDeepSeekLengthAdapterSection } = await import(
    "../src/lib/sharedNovelProseModelAdapters"
  );
  const { shouldInjectGemini31UserAgencySupplement } = await import(
    "../src/lib/gemini31UserAgencyAdapter"
  );
  const { shouldInjectSystemLayoutRecency } = await import(
    "../src/lib/gemini31LayoutOwnerPolicy"
  );
  const { DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY } = await import(
    "../src/lib/deepseekPromptStructure"
  );
  const { DEEPSEEK_APPEARANCE_VARIATION_RULE } = await import(
    "../src/lib/appearanceCompiler"
  );
  const { USER_TAIL_LENGTH_OWNER_SENTENCE } = await import("../src/lib/responseLength");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import(
    "../src/lib/chatMemory"
  );

  type PromptSectionCategory =
    | "systemRules"
    | "characterSetting"
    | "worldLore"
    | "memory"
    | "persona"
    | "userNote"
    | "dialogueExamples"
    | "recentConversation";

  function sumCategory(
    sections: { category: PromptSectionCategory; text: string }[],
    category: PromptSectionCategory
  ): number {
    return sections
      .filter((s) => s.category === category)
      .reduce((n, s) => n + estimateTokens(s.text), 0);
  }

  function classifySystemRuleTokens(
    sections: { id: string; label: string; text: string }[]
  ) {
    const buckets = {
      proseStyle: 0,
      agency: 0,
      layout: 0,
      modelAdapter: 0,
      lengthRelated: 0,
      otherRules: 0,
    };
    for (const s of sections) {
      const tok = estimateTokens(s.text);
      const id = s.id.toLowerCase();
      const label = s.label.toLowerCase();
      const text = s.text;
      if (
        id.includes("prose") ||
        id.includes("immersive") ||
        label.includes("prose") ||
        /\[IMMERSIVE PROSE\]|\[NARRATION REGISTER\]|\[SENSATION\]|\[WEBNOVEL BREATH\]/.test(
          text
        )
      ) {
        buckets.proseStyle += tok;
      } else if (
        id.includes("godmod") ||
        id.includes("agency") ||
        /USER CONTROL|USER AGENCY|NO.?GODMODDING|유저\s*조종/.test(text)
      ) {
        buckets.agency += tok;
      } else if (
        id.includes("layout") ||
        /\[OUTPUT LAYOUT\]|\[DIALOGUE & NARRATION\]/.test(text)
      ) {
        buckets.layout += tok;
      } else if (
        id.includes("deepseek") ||
        id.includes("adapter") ||
        id.includes("gemini31") ||
        text.includes(DEEPSEEK_APPEARANCE_VARIATION_RULE)
      ) {
        buckets.modelAdapter += tok;
      } else if (/\[LENGTH|TARGET_LENGTH|MINIMUM_FLOOR|USER_TAIL/.test(text)) {
        buckets.lengthRelated += tok;
      } else {
        buckets.otherRules += tok;
      }
    }
    return buckets;
  }

  function detectDuplicateSemantics(systemPrompt: string, userTurn: string) {
    const hay = `${systemPrompt}\n${userTurn}`;
    const checks: { semantic: string; patterns: RegExp[] }[] = [
      {
        semantic: "show_emotion_through_behavior",
        patterns: [
          /감정은 이름으로 단정/,
          /행동·감각·신체 반응·시선·호흡/,
          /표정|시선|호흡|거리·침묵/,
        ],
      },
      {
        semantic: "do_not_reexplain_shown_emotion",
        patterns: [
          /이미 드러난 동기·감정/,
          /추상 판정·정답 해설/,
          /뜻이었다|표시였다/,
        ],
      },
      {
        semantic: "avoid_repetitive_micro_action",
        patterns: [
          /미세 행동·반복 해설/,
          /짧은 문장마다 새 문단/,
          /한두 단어짜리 파편문/,
          /micro-action/i,
        ],
      },
      {
        semantic: "environment_affects_scene",
        patterns: [
          /공간·온도·소리/,
          /환경 변화로 장면을 전진/,
          /\[SENSATION\]/,
        ],
      },
      {
        semantic: "inner_thought_affects_choice",
        patterns: [
          /생각·연상·기억·오해·감정·판단이 행동/,
          /새 판단이나 이후 선택을 바꾸는 사고/,
          /필요한 내면/,
        ],
      },
      {
        semantic: "dialogue_reflects_personality",
        patterns: [
          /이 캐릭터가 지금 이 상대에게 실제로 할 법한 말/,
          /SPEECH METADATA/,
          /캐릭터 말투/,
        ],
      },
      {
        semantic: "advance_to_next_meaningful_change",
        patterns: [
          /새로운 반응·행동·감각·환경 변화로 장면을 전진/,
          /분위기·관계·이해·긴장·결과를 바꾸는 디테일/,
          /성급히 닫지 말/,
        ],
      },
      {
        semantic: "sensory_specificity",
        patterns: [
          /깊이는 밀도가 아니라 구체성/,
          /1~2채널만 깊게/,
          /질감·공간·온도·소리/,
        ],
      },
      {
        semantic: "korean_narration_register",
        patterns: [/해체\(-다\/-했다/, /지문은 -다\/-했다체/, /NARRATION REGISTER/],
      },
      {
        semantic: "response_length_owner",
        patterns: [/3,200자 이상/, /USER_TAIL_LENGTH|충분히 전개된 장면/],
      },
    ];

    return checks.map((c) => {
      const hits = c.patterns.filter((re) => re.test(hay)).length;
      return {
        semantic: c.semantic,
        patternHits: hits,
        present: hits > 0,
        likelyDuplicatedInPayload: hits >= 2,
      };
    });
  }

  function buildFixtureInput(
    modelId: (typeof MAIN_RP_USER_SELECTABLE_OPTIONS)[number]["id"],
    fixture: AuditFixture
  ) {
    const chunks = parseCharacterSetting({
      characterId: "audit-prose-1",
      characterName: CHAR_NAME,
      gender: "male",
      systemPrompt: `# 성격
차분하고 관찰력이 뛰어나며, 감정을 겉으로 쉽게 드러내지 않는다. 필요할 때만 짧고 단호하게 말한다. 무의식적으로 장갑 가장자리를 만지작거리거나 창틀·난간을 손가락으로 쓸어보는 습관이 있다.

# 말투
- 평소: "~요", "~죠" 등 정중한 존댓말
- 긴장/분노: 문장이 짧아지고 말끝이 딱 끊긴다
- 금지: 과도한 이모티콘, 현대 인터넷 슬랭

# 외형
키 178cm, 검은 머리, 날카로운 눈매. 검은 코트와 장갑을 즐겨 착용한다.`,
      world: `# 세계관
현대 도시. 초자연적 존재와 일반인이 공존한다. 밤거리에는 젖은 아스팔트와 네온, 먼 사이렌이 섞인다.`,
      exampleDialog: `유저: 오늘 밤에도 나가?
${CHAR_NAME}: …필요하면요. 당신은 집에 계시죠.
유저: 혼자 가기 무섭잖아.
${CHAR_NAME}: 무섭다면, 제 옆에 있으면 됩니다.`,
      statusWindowPrompt: "",
    });

    return {
      charName: CHAR_NAME,
      personaDisplayName: PERSONA_NAME,
      userNickname: PERSONA_NAME,
      chunks,
      userPersona: formatSelectedPersonaForPrompt(
        PERSONA_NAME,
        "other",
        "20대 대학원생. 호기심 많고 직설적이지만 상대를 존중한다."
      ),
      userNote: formatUserNoteForPrompt(
        "렌과 오래 알고 지낸 친구. 3년 전 실종 사건 이후 더 자주 연락한다."
      ),
      longTermMemory:
        "3년 전 실종 사건 이후 서로를 더 자주 확인한다. 최근 도심 골목에서 이상한 그림자를 목격했다.",
      memoryMeta: formatMemoryMetaForPrompt(
        parseMemoryMeta(
          JSON.stringify({
            affection: 65,
            trust: 58,
            relationshipLabel: "오래된 지인",
          })
        )
      ),
      shortTermHistory: fixture.shortTermHistory,
      currentUserMessage: fixture.currentUserMessage,
      nsfw: false,
      gender: "male" as const,
      userPersonaGender: "other" as const,
      userImpersonation: false,
      novelModeEnabled: false,
      targetResponseChars: 3200,
      completedTurns: 8,
      genres: ["현대/일상" as const],
      provider: selectedAIProvider(modelId),
      modelId,
      recentNarrativeContext:
        "[RECENT NARRATIVE CONTEXT · turn 8]\n장면이 자연스럽게 이어지고 있다.",
      promptDumpSource: "audit" as const,
      promptDumpDetail: `prompt-runtime-behavior-audit fixture=${fixture.id} model=${modelId}`,
    };
  }

  ensureDir(OUT_DOCS);
  ensureDir(OUT_ART);

  const inventoryRows: Record<string, unknown>[] = [];
  const modelSummaries: Record<string, unknown>[] = [];

  for (const option of MAIN_RP_USER_SELECTABLE_OPTIONS) {
    const modelId = option.id;
    const fixture = AUDIT_FIXTURES[0]!;
    const input = buildFixtureInput(modelId, fixture);
    const built = buildContext(input);
    const sections = built.meta.trackedSections ?? [];
    const audit = built.meta.promptAudit;
    const systemPrompt = built.systemPrompt;
    // buildContext returns history WITH current user turn appended.
    const historyWithCurrent = built.history;
    const userTurn = historyWithCurrent[historyWithCurrent.length - 1]?.content ?? "";
    const history = historyWithCurrent.slice(0, -1);
    const provider = selectedAIProvider(modelId);
    const routeName = resolveProseStyleRouteName(undefined, modelId);
    const lengthAdapter = resolveDeepSeekLengthAdapterSection(modelId);
    const geminiAgency = shouldInjectGemini31UserAgencySupplement({
      modelId,
      godmoddingMode: "standard",
      contentKind: "character",
    });
    const layoutRecency = shouldInjectSystemLayoutRecency({ modelId });

    const categoryTokens = {
      systemRules: sumCategory(sections, "systemRules"),
      characterSetting: sumCategory(sections, "characterSetting"),
      worldLore: sumCategory(sections, "worldLore"),
      memory: sumCategory(sections, "memory"),
      persona: sumCategory(sections, "persona"),
      userNote: sumCategory(sections, "userNote"),
      dialogueExamples: sumCategory(sections, "dialogueExamples"),
      recentConversation: sumCategory(sections, "recentConversation"),
    };

    const systemRuleBuckets = classifySystemRuleTokens(
      sections.filter((s) => s.category === "systemRules")
    );
    const proseTokens = estimateTokens(
      sections
        .filter(
          (s) =>
            s.category === "systemRules" &&
            (/prose|immersive|style/i.test(s.id) ||
              /\[IMMERSIVE PROSE\]|\[NARRATION REGISTER\]/.test(s.text))
        )
        .map((s) => s.text)
        .join("\n\n")
    );

    const providerRequestStructure = {
      provider,
      model: modelId,
      messages: [
        {
          role: "system",
          contentChars: systemPrompt.length,
          contentTokensEst: estimateTokens(systemPrompt),
        },
        ...history.map((m) => ({
          role: m.role,
          contentChars: m.content.length,
          contentTokensEst: estimateTokens(m.content),
        })),
        {
          role: "user",
          contentChars: userTurn.length,
          contentTokensEst: estimateTokens(userTurn),
          notes:
            "current user turn (includes DeepSeek style reminder / USER_TAIL when applicable)",
        },
      ],
    };

    const sectionInventory = sections.map((s, idx) => ({
      order: idx + 1,
      id: s.id,
      label: s.label,
      category: s.category,
      role: "system" as const,
      chars: s.text.length,
      estimatedTokens: estimateTokens(s.text),
    }));

    const deepSeekFamily = isDeepSeekMainRpFamilyModel(modelId);
    const hasStyleReminder = userTurn.includes(
      DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY.slice(0, 40)
    );
    const hasUserTail = userTurn.includes(USER_TAIL_LENGTH_OWNER_SENTENCE.slice(0, 20));
    const hasAppearanceRule = systemPrompt.includes(DEEPSEEK_APPEARANCE_VARIATION_RULE);
    const hasXmlPersona = systemPrompt.includes("<PERSONA>");
    const hasXmlWorld = systemPrompt.includes("<WORLD_LORE>");
    const hasXmlLtm = systemPrompt.includes("<LONG_TERM_MEMORY>");

    const semanticDup = detectDuplicateSemantics(systemPrompt, userTurn);

    const modelDir = `models/${modelId}`;
    writeBoth(`${modelDir}/system.txt`, systemPrompt);
    writeBoth(`${modelDir}/user-turn.txt`, userTurn);
    writeBoth(
      `${modelDir}/history.json`,
      history.map((m) => ({
        role: m.role,
        chars: m.content.length,
        tokensEst: estimateTokens(m.content),
      }))
    );
    writeBoth(`${modelDir}/sections.json`, sectionInventory);
    writeBoth(`${modelDir}/provider-request-structure.json`, providerRequestStructure);
    writeBoth(`${modelDir}/semantic-duplicate-scan.json`, semanticDup);
    writeBoth(`${modelDir}/system.sha256`, `${sha256(systemPrompt)}\n`);
    writeBoth(`${modelDir}/user-turn.sha256`, `${sha256(userTurn)}\n`);

    for (const fx of AUDIT_FIXTURES) {
      const fxBuilt = buildContext(buildFixtureInput(modelId, fx));
      const fxUser =
        fxBuilt.history[fxBuilt.history.length - 1]?.content ?? "";
      const fxHist = fxBuilt.history.slice(0, -1);
      writeBoth(`fixtures/${fx.id}/${modelId}/user-turn.txt`, fxUser);
      writeBoth(`fixtures/${fx.id}/${modelId}/meta.json`, {
        fixtureId: fx.id,
        modelId,
        systemSha256: sha256(fxBuilt.systemPrompt),
        userSha256: sha256(fxUser),
        systemTokensEst: estimateTokens(fxBuilt.systemPrompt),
        userTokensEst: estimateTokens(fxUser),
        historyTokensEst: estimateTokens(fxHist.map((m) => m.content).join("\n")),
        totalAssembledEst:
          estimateTokens(fxBuilt.systemPrompt) +
          estimateTokens(fxHist.map((m) => m.content).join("\n")) +
          estimateTokens(fxUser),
      });
    }

    const row = {
      modelId,
      displayName: option.label,
      provider: option.provider,
      tier: option.tier,
      hint: option.hint,
      recommended: Boolean("recommended" in option && option.recommended),
      userSelectable: true,
      runtimeActive: true,
      selectedProseRoute: routeName,
      sharedNovelV2Env: process.env.SHARED_NOVEL_PROSE_V2_ENABLED ?? "(unset=OFF)",
      proseVNextEnv: process.env.PROSE_VNEXT_ENABLED ?? "(unset=OFF)",
      deepSeekMainRpFamily: deepSeekFamily,
      deepSeekV4Pro: isCheaperInferenceDeepSeekV4ProModel(modelId),
      deepSeekV41Flash: isCheaperInferenceDeepSeekV41FlashModel(modelId),
      gemini31Pro: isGemini31ProModel(modelId),
      modelSpecificAdapters: {
        deepSeekXmlStructure: deepSeekFamily && hasXmlPersona,
        deepSeekStyleOnlyReminder: deepSeekFamily && hasStyleReminder,
        deepSeekAppearanceVariationRule: deepSeekFamily && hasAppearanceRule,
        deepSeekLengthAdapterEnv: lengthAdapter ? "INJECTED" : "OFF(default)",
        gemini31UserAgencySupplement: geminiAgency,
        gemini31SystemLayoutRecency: layoutRecency,
      },
      userTailLengthOwner: hasUserTail,
      terminalReminder: deepSeekFamily
        ? "DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY + USER_TAIL_LENGTH_OWNER_SENTENCE"
        : "USER_TAIL_LENGTH_OWNER_SENTENCE (+ layout line)",
      tokenInventory: {
        actualAssembledSystemEst: estimateTokens(systemPrompt),
        actualAssembledSystemChars: systemPrompt.length,
        promptAuditSystemRules:
          audit?.breakdown.systemRules ?? categoryTokens.systemRules,
        promptAuditCharacterSetting:
          audit?.breakdown.characterSetting ?? categoryTokens.characterSetting,
        promptAuditWorldLore:
          audit?.breakdown.worldLore ?? categoryTokens.worldLore,
        promptAuditMemory: audit?.breakdown.memory ?? categoryTokens.memory,
        promptAuditPersona: audit?.breakdown.persona ?? categoryTokens.persona,
        promptAuditUserNote: audit?.breakdown.userNote ?? categoryTokens.userNote,
        promptAuditDialogueExamples:
          audit?.breakdown.dialogueExamples ?? categoryTokens.dialogueExamples,
        promptAuditRecentConversation: audit?.breakdown.recentConversation ?? 0,
        totalAssembledEst: audit?.totalAssembledTokens ?? null,
        currentUserTurnEst: estimateTokens(userTurn),
        historyEst: estimateTokens(history.map((m) => m.content).join("\n")),
        systemRuleBuckets,
        proseStyleSectionEst: proseTokens,
        xmlTags: {
          PERSONA: hasXmlPersona,
          WORLD_LORE: hasXmlWorld,
          LONG_TERM_MEMORY: hasXmlLtm,
        },
      },
      sectionCount: sections.length,
      systemSha256: sha256(systemPrompt),
      userSha256: sha256(userTurn),
      semanticDuplicateScan: semanticDup,
    };

    inventoryRows.push(row);
    modelSummaries.push({
      modelId,
      displayName: option.label,
      systemTokensEst: estimateTokens(systemPrompt),
      proseStyleEst: proseTokens,
      systemRulesEst: categoryTokens.systemRules,
      characterWorldPersonaMemoryEst:
        categoryTokens.characterSetting +
        categoryTokens.worldLore +
        categoryTokens.persona +
        categoryTokens.memory +
        categoryTokens.userNote +
        categoryTokens.dialogueExamples,
      userTurnEst: estimateTokens(userTurn),
      adapters: row.modelSpecificAdapters,
      proseRoute: routeName,
    });

    console.log(
      `[inventory] ${modelId}: system≈${estimateTokens(systemPrompt)} tok, user≈${estimateTokens(userTurn)} tok, route=${routeName}`
    );
  }

  const receiptTruth = {
    method: "estimated_section_allocation",
    meaning:
      "Admin receipt '시스템 프롬프트: ~N 입력 토큰 추정 배분' is NOT a direct tokenize of the system string. It is proportional: round((sysRulesEst / sum(sectionEsts)) * provider_prompt_tokens).",
    formula: {
      A_provider_actual_input:
        "primaryStage.input / provider prompt_tokens (canonical billable)",
      B_receipt_system_row:
        "alloc(sysRulesEst) where sysRulesEst = promptAudit.breakdown.systemRules (local estimateTokens on category=systemRules sections), then scaled to A",
      C_actual_assembled_system_estimate:
        "estimateTokens(final systemPrompt string) — diet baseline",
      D_systemRules_category_estimate:
        "sum estimateTokens(section.text) for category systemRules",
      E_prose_style_section_estimate:
        "subset of systemRules matching prose/style/IMMERSIVE/NARRATION REGISTER sections",
      F_remaining_sections_estimate:
        "characterSetting + worldLore + memory + persona + userNote + dialogueExamples (+ history outside system)",
    },
    sourceFiles: [
      "src/lib/billingReceiptSectionBreakdown.ts",
      "src/app/api/chat/route.ts (sectionEsts + draftInput)",
      "src/services/promptAudit.ts",
      "src/lib/promptTokenAccounting.ts",
    ],
    warning:
      "Do not treat receipt system row as exact provider per-section measurement. Diet decisions use actual assembled inventory (C/D/E/F).",
  };

  writeBoth("ACTIVE_MODEL_INVENTORY.json", inventoryRows);
  writeBoth("MODEL_TOKEN_SUMMARY.json", modelSummaries);
  writeBoth("RECEIPT_TOKEN_TRUTH.json", receiptTruth);
  writeBoth("FIXTURES.json", AUDIT_FIXTURES);
  writeBoth("META.json", {
    exactMain: MAIN_SHA,
    generatedAt: new Date().toISOString(),
    fixtureCount: AUDIT_FIXTURES.length,
    modelCount: MAIN_RP_USER_SELECTABLE_OPTIONS.length,
    productionPromptMutated: false,
    proseGatesDefault: {
      PROSE_VNEXT_ENABLED: process.env.PROSE_VNEXT_ENABLED ?? null,
      SHARED_NOVEL_PROSE_V2_ENABLED: process.env.SHARED_NOVEL_PROSE_V2_ENABLED ?? null,
      SNPV2_DEEPSEEK_LENGTH_ARM: process.env.SNPV2_DEEPSEEK_LENGTH_ARM ?? null,
      GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY:
        process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY ?? null,
    },
  });

  console.log(`Wrote inventory to ${OUT_DOCS} and ${OUT_ART}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
