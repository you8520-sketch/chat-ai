/**
 * Issue #1321 evidence-only assembler.
 * Uses existing compile / visibility / S2 / policy owners. No new runtime path.
 * Does not call paid providers.
 */
import { MAIN_RP_USER_SELECTABLE_OPTIONS } from "@/lib/chatModels";
import {
  isLayeredCanonActive,
  resolveCanonInjectionPolicy,
} from "@/lib/canonInjectionPolicy";
import { compileCanonPlanV1 } from "@/lib/canonPlan/compiler";
import { renderCoreCanonBlock } from "@/lib/canonPlan/coreRenderer";
import { renderPrivateCharacterSecretBlock } from "@/lib/canonPlan/privateCharacterSecretRenderer";
import { selectActiveCanonChunks } from "@/lib/canonPlan/activeSelector";

export const CHARACTER_SECRET_AUDIT_RELATIVE_PATH =
  "docs/audits/character-secret-delivery-1321/README.md";
export const CHARACTER_SECRET_AUDIT_REPRODUCE =
  "node --conditions=react-server --import tsx --import ./src/lib/test/regularTestEgressPolicy.ts --test src/lib/canonPlan/characterSecretDelivery.audit.test.ts";

export const SECRET_AUDIT_IDENTITY = "레온은 28세 귀족이다. 말투는 짧고 차갑다.";

export const SECRET_AUDIT_CASES = {
  known_marked: {
    id: "A_character_knows_hides",
    label: "캐릭터가 알고 숨기는 비밀 — 명시 마커",
    systemPrompt: `${SECRET_AUDIT_IDENTITY}\n\n[비밀 — 캐릭터는 앎]\nTOKEN_KNOWN_LEDGER 레온은 길드 장부를 따로 숨겨 두고 있다. 상대가 먼저 장부를 꺼내기 전에는 그 존재를 말하지 않는다.`,
  },
  unknown_marked: {
    id: "B_character_does_not_know",
    label: "캐릭터가 모르는 비밀 — 명시 마커",
    systemPrompt: `${SECRET_AUDIT_IDENTITY}\n\n[비밀 — 캐릭터도 모름]\nTOKEN_UNKNOWN_PARENT 레온의 아버지는 아직 살아 있다. 레온은 이 사실을 모른다.`,
  },
  user_only: {
    id: "C_user_only_secret",
    label: "유저만 아는 비밀",
    systemPrompt: `${SECRET_AUDIT_IDENTITY}\n\n[플레이어만 아는 설정]\nTOKEN_USER_ONLY 사용자는 레온을 감시하는 밀정이다. 레온은 이 정체를 모른다.`,
  },
  unlabeled_freeform: {
    id: "F_unlabeled_korean_prose",
    label: "자유로운 한국어 줄글 — 마커 없음",
    systemPrompt: `${SECRET_AUDIT_IDENTITY}\n\n레온은 겉으로는 태연하다. TOKEN_UNLABELED_FREEFORM 그는 지난 겨울 거래 상대를 배신했고 대화가 돈 이야기로 흐르면 화제를 바꾼다.`,
  },
  hidden_regex_sentence: {
    id: "F2_hidden_knowledge_regex",
    label: "숨김 정규식에 걸리는 문장",
    systemPrompt: `${SECRET_AUDIT_IDENTITY}\n\n이 비밀은 레온만 알고 있으며 그는 절대 숨긴다. TOKEN_HIDDEN_REGEX`,
  },
  long_marked: {
    id: "E_long_s2_body",
    label: "S2 본문 한도 초과",
    systemPrompt: `${SECRET_AUDIT_IDENTITY}\n\n[비밀 — 캐릭터는 앎]\nTOKEN_LONG_SECRET ${"가".repeat(1300)}`,
  },
} as const;

export type SecretAuditCaseId = keyof typeof SECRET_AUDIT_CASES;

function compileCase(systemPrompt: string) {
  const compiled = compileCanonPlanV1({
    creatorRawDescription: systemPrompt,
    compilerDescription: systemPrompt,
  });
  if (!compiled.ok) {
    return { ok: false as const, error: compiled.error };
  }
  const core = renderCoreCanonBlock(compiled.plan, { charName: "레온" });
  const s2 = renderPrivateCharacterSecretBlock(compiled.plan);
  const active = selectActiveCanonChunks({
    plan: compiled.plan,
    userMessage: "장부를 보여 주세요",
    recentTurns: [],
  });
  return {
    ok: true as const,
    chunks: compiled.plan.chunks.map((chunk) => ({
      id: chunk.id,
      visibility: chunk.visibility,
      bucket: chunk.bucket,
      sectionTitle: chunk.sectionTitle,
      salience: chunk.salience,
      text: chunk.text,
    })),
    coreText: core,
    s2Block: s2.block,
    s2IncludedCount: s2.s2IncludedCount,
    s2OmittedCount: s2.s2OmittedCount,
    s2BodyChars: s2.s2BodyChars,
    activeTexts: active.activeChunks.map((chunk) => chunk.text),
  };
}

function tokenPresence(token: string, ...haystacks: Array<string | null | undefined>) {
  return haystacks.some((text) => Boolean(text && text.includes(token)));
}

export function buildCharacterSecretDeliveryEvidence() {
  const models = MAIN_RP_USER_SELECTABLE_OPTIONS.map((option) => {
    const policy = resolveCanonInjectionPolicy(option.id);
    return {
      modelId: option.id,
      label: option.label,
      actualCanonMode: policy.actualCanonMode,
      layeredActive: isLayeredCanonActive(policy),
      injectionEnabled: policy.injectionEnabled,
      shadowOnly: policy.shadowOnly,
      defaultPath: isLayeredCanonActive(policy)
        ? "LAYERED: CORE public + S2 LOCKED_SECRET"
        : "FULL_LEGACY: buildCharacterCanonBlock(public_canon) with no S2 concealment header",
    };
  });

  const cases = Object.entries(SECRET_AUDIT_CASES).map(([key, spec]) => {
    const compiled = compileCase(spec.systemPrompt);
    const tokens = [...spec.systemPrompt.matchAll(/TOKEN_[A-Z0-9_]+/g)].map((match) => match[0]);
    return {
      key,
      ...spec,
      compiled,
      tokenRouting: tokens.map((token) => ({
        token,
        inCore: compiled.ok ? tokenPresence(token, compiled.coreText) : false,
        inS2: compiled.ok ? tokenPresence(token, compiled.s2Block) : false,
        inActive: compiled.ok ? compiled.activeTexts.some((text) => text.includes(token)) : false,
        inAnyChunk: compiled.ok ? compiled.chunks.some((chunk) => chunk.text.includes(token)) : false,
        chunkVisibilities: compiled.ok
          ? compiled.chunks.filter((chunk) => chunk.text.includes(token)).map((chunk) => chunk.visibility)
          : [],
        chunkBuckets: compiled.ok
          ? compiled.chunks.filter((chunk) => chunk.text.includes(token)).map((chunk) => chunk.bucket)
          : [],
      })),
    };
  });

  return {
    mainShaNote: "Recheck origin/main before review. This audit was assembled from current checkout owners.",
    paidProviderCalls: 0,
    models,
    cases,
  };
}

export function buildCharacterSecretDeliveryReport(): string {
  const evidence = buildCharacterSecretDeliveryEvidence();
  const lines: string[] = [
    "# Character-secret delivery audit — Issue #1321",
    "",
    "## REPRODUCTION",
    "This file is generated by existing compile/visibility/S2/policy owners. Do not hand-edit.",
    "",
    "```",
    CHARACTER_SECRET_AUDIT_REPRODUCE,
    "```",
    "",
    "Generator:",
    "```",
    "npx tsx --conditions=react-server scripts/character-secret-delivery-audit.ts",
    "```",
    "",
    "## SCOPE",
    "- Evidence only. No paid provider calls.",
    "- No subjective model-quality score.",
    "- LAYERED rows are the eligible DeepSeek D2/canary path, not a claim about live Railway cohort values.",
    "- Chat `buildContext` prompt slices for default FULL_LEGACY vs forced LAYERED are in the accompanying test output, not a live model transcript.",
    "",
    "## OWNER MAP",
    "- Save/compile: `characterFormSave.buildCompiledCreatorDescriptionForSave` → `compileCreatorDescriptionTriggers` → `compileCanonPlanV1`",
    "- Visibility: `canonVisibility.resolveChunkVisibility` (`LOCKED_SECRET` only for `[비밀 — 캐릭터는 앎]`)",
    "- FULL_LEGACY prompt: `contextBuilder` → `buildCharacterCanonBlock(effectiveCharacterSettingText)`",
    "- LAYERED prompt: `renderCoreCanonBlock` + `selectActiveCanonChunks` + `renderPrivateCharacterSecretBlock`",
    "- Policy: `resolveCanonInjectionPolicy(modelId)`",
    "- Lorebook is a different owner (`creatorLorebook`) and is not S2.",
    "",
    "## ACTIVE MODEL DEFAULT PATHS",
    ...evidence.models.flatMap((model) => [
      `### ${model.label} (\`${model.modelId}\`)`,
      `- actualCanonMode: ${model.actualCanonMode}`,
      `- layeredActive: ${model.layeredActive}`,
      `- injectionEnabled: ${model.injectionEnabled}`,
      `- shadowOnly: ${model.shadowOnly}`,
      `- defaultPath: ${model.defaultPath}`,
      "",
    ]),
    "## CLASSIFICATION RESULTS",
  ];

  for (const item of evidence.cases) {
    lines.push(`### ${item.id} — ${item.label}`);
    lines.push("");
    lines.push("Authoring source:");
    lines.push("```");
    lines.push(item.systemPrompt);
    lines.push("```");
    if (!item.compiled.ok) {
      lines.push(`Compile failed: ${item.compiled.error}`);
      lines.push("");
      continue;
    }
    lines.push("Chunks:");
    for (const chunk of item.compiled.chunks) {
      lines.push(
        `- visibility=${chunk.visibility} bucket=${chunk.bucket} salience=${chunk.salience} title=${JSON.stringify(chunk.sectionTitle)} text=${JSON.stringify(chunk.text)}`
      );
    }
    lines.push("");
    lines.push(`S2 included=${item.compiled.s2IncludedCount} omitted=${item.compiled.s2OmittedCount} bodyChars=${item.compiled.s2BodyChars}`);
    lines.push("");
    lines.push("Token routing:");
    for (const token of item.tokenRouting) {
      lines.push(
        `- ${token.token}: core=${token.inCore} s2=${token.inS2} active=${token.inActive} visibilities=${token.chunkVisibilities.join("|") || "(none)"} buckets=${token.chunkBuckets.join("|") || "(none)"}`
      );
    }
    lines.push("");
    lines.push("CORE render:");
    lines.push("```");
    lines.push(item.compiled.coreText || "(empty)");
    lines.push("```");
    lines.push("");
    lines.push("S2 render:");
    lines.push("```");
    lines.push(item.compiled.s2Block || "(empty)");
    lines.push("```");
    lines.push("");
  }

  lines.push("## FULL_LEGACY vs LAYERED ASSEMBLY");
  lines.push("- Default env: every current Main RP model is FULL_LEGACY (`layeredActive=false`). Marked `[비밀 — 캐릭터는 앎]` text is compiled, but S2 concealment header is not injected.");
  lines.push("- Eligible LAYERED path: S2 receives only `character` + `LOCKED_SECRET` chunks. CORE/ACTIVE drop those chunks.");
  lines.push("- Unlabeled freeform Korean prose is PUBLIC. It is not S2. On default FULL_LEGACY it rides in the character canon string. On forced LAYERED this audit's `buildContext` slice did not include TOKEN_UNLABELED_FREEFORM, because it was not CORE and S2 rejected it.");
  lines.push("- Regen/continue flags do not change visibility owners; they add other system directives. See the accompanying test.");
  lines.push("");
  lines.push("## SHOULD THE EXISTING OWNER BE CHANGED?");
  lines.push("- Do not add a second secret engine.");
  lines.push("- The current owner already honors explicit `[비밀 — 캐릭터는 앎]`. Auto-inferring unlabeled prose as LOCKED_SECRET would invent author intent.");
  lines.push("- A later minimal fix, if approved, should stay on `canonVisibility` / authoring preview — not a new trigger system.");
  lines.push("- This audit does not patch owners. Live model behavior is unproven because no provider call was authorized.");
  lines.push("");
  lines.push("## VERDICT");
  lines.push("- DETERMINISTIC_ASSEMBLY_GAP: unlabeled freeform secrets do not enter S2.");
  lines.push("- DEFAULT_PRODUCTION_PATH: FULL_LEGACY for all six current Main RP models in unset env.");
  lines.push("- ROOT_CAUSE_UNCONFIRMED for model-output concealment/action quality (no live calls).");
  lines.push("- OWNER_CHANGE_NOT_APPLIED.");
  lines.push("");
  return lines.join("\n");
}
