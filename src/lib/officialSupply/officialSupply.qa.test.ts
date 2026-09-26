import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CHAT_IMAGE_GENERATION_DEFAULT_MODEL,
  resolveChatImageGenerationModel,
} from "@/lib/chatImageGeneration";
import { CHAT_LD_ILLUSTRATION_OUTPUT_SIZE } from "@/lib/chatLdIllustrationGeneration";
import { CHAT_COMIC_IMAGE_OUTPUT_SIZE } from "@/lib/chatComicGenerationConstants";
import {
  findAssetByTagStable,
  getDefaultChatAsset,
  isWideInlineAsset,
  normalizeCharacterAssets,
} from "@/lib/characterAssets";
import {
  evaluateOfficialImageDimensions,
  officialImageProfileForSlot,
  OFFICIAL_REPRESENTATIVE_IMAGE_PROFILE,
  OFFICIAL_RP_IMAGE_PROFILE,
  resolveOfficialAssetImageModel,
} from "@/lib/officialSupply/imageProfile";
import { buildOfficialAssetPrompts } from "@/lib/officialSupply/imagePrompt";
import { evaluateAssetPlan, OFFICIAL_ASSET_TOTAL } from "@/lib/officialSupply/assetPlan";
import { evaluateAppearanceLock } from "@/lib/officialSupply/appearance";
import {
  evaluateAgeAndAdultConsistency,
  evaluateOfficialTextLength,
  evaluateSupportingNpcs,
  formatSupportingNpcLine,
  SUPPORTING_NPC_LINE_HARD_MAX,
} from "@/lib/officialSupply/characterText";
import {
  evaluateOriginality,
  evaluateSharedLorebook,
  evaluateWorldDiversity,
  evaluateWorldTermCollisions,
} from "@/lib/officialSupply/worldQa";
import {
  evaluatePortfolioBalance,
  resolveCollectionMethod,
  validateResearchSnapshot,
  type ResearchSnapshot,
} from "@/lib/officialSupply/research";
import { validateStyleProposal, validateStyleSeedForApproval } from "@/lib/officialSupply/style";
import {
  HWANG_VOCAB,
  KNIGHT_VOCAB,
  MAGE_VOCAB,
  prose,
  testAppearance,
  testAssetPlan,
  testDraft,
  testNpc,
  testStyleCandidate,
} from "@/lib/officialSupply/officialSupply.fixtures";
import { BASE_IMAGE_SAFE_DEPICTION, ADULT_GROUNDED_NON_EXPLICIT_ALLOWANCE } from "@/lib/chatImageIllustrationSanitizer";

const hwang = () => testDraft({ draftKey: "hwang", name: "레온하르트", vocabulary: HWANG_VOCAB });

describe("official image format profiles", () => {
  it("representative is native 2:3 portrait matching the card aspect owner", () => {
    const card = fs.readFileSync(path.join(process.cwd(), "src/components/CharacterCard.tsx"), "utf8");
    assert.match(card, /export const CHARACTER_THUMB_ASPECT = "aspect-\[2\/3\]"/);
    const p = OFFICIAL_REPRESENTATIVE_IMAGE_PROFILE;
    assert.equal(p.width / p.height, 2 / 3);
    assert.equal(p.orientation, "portrait");
    assert.equal(officialImageProfileForSlot("representative"), p);
  });

  it("every RP slot (signature/emotion/scene) is native 3:2 landscape", () => {
    for (const kind of ["signature", "emotion", "scene"] as const) {
      const p = officialImageProfileForSlot(kind);
      assert.equal(p, OFFICIAL_RP_IMAGE_PROFILE);
      assert.equal(p.width / p.height, 3 / 2);
    }
  });

  it("existing chat LD / comic output owners are unchanged", () => {
    assert.equal(CHAT_LD_ILLUSTRATION_OUTPUT_SIZE, "800x1200");
    assert.equal(CHAT_COMIC_IMAGE_OUTPUT_SIZE, "1008x1408");
  });

  it("3:2 assets are inline in chat while the 2:3 representative stays the portrait/default", () => {
    const assets = normalizeCharacterAssets([
      { url: "/uploads/rep.webp", tag: "대표", width: 1024, height: 1536 },
      { url: "/uploads/shy1.webp", tag: "부끄러움", width: 1536, height: 1024 },
      { url: "/uploads/shy2.webp", tag: "부끄러움", width: 1536, height: 1024 },
      { url: "/uploads/ballroom.webp", tag: "무도회장", width: 1536, height: 1024 },
    ]);
    assert.equal(isWideInlineAsset(assets[0]!), false);
    assert.ok(assets.slice(1).every((a) => isWideInlineAsset(a)));
    assert.equal(getDefaultChatAsset(assets)?.url, "/uploads/rep.webp");
    assert.equal(findAssetByTagStable(assets, "무도회장", "k", "inline")?.url, "/uploads/ballroom.webp");
    const shy = new Set(["a", "b", "c", "d", "e", "f"].map((k) => findAssetByTagStable(assets, "부끄러움", k, "inline")?.url));
    assert.ok([...shy].every((url) => url === "/uploads/shy1.webp" || url === "/uploads/shy2.webp"));
    assert.equal(findAssetByTagStable(assets, "대표", "k", "inline"), null);
  });

  it("dimension contract: exact, near-ratio normalize, wrong orientation rejected (never cropped)", () => {
    assert.equal(evaluateOfficialImageDimensions(OFFICIAL_RP_IMAGE_PROFILE, 1536, 1024), "exact");
    assert.equal(evaluateOfficialImageDimensions(OFFICIAL_RP_IMAGE_PROFILE, 1530, 1024), "normalize");
    assert.equal(evaluateOfficialImageDimensions(OFFICIAL_RP_IMAGE_PROFILE, 1024, 1536), "reject");
    assert.equal(evaluateOfficialImageDimensions(OFFICIAL_RP_IMAGE_PROFILE, 1024, 1024), "reject");
    assert.equal(evaluateOfficialImageDimensions(OFFICIAL_REPRESENTATIVE_IMAGE_PROFILE, 1536, 1024), "reject");
    assert.equal(evaluateOfficialImageDimensions(OFFICIAL_REPRESENTATIVE_IMAGE_PROFILE, 0, 0), "reject");
  });
});

describe("official image model resolver reuse", () => {
  it("delegates to the canonical chat image resolver (env override wins)", () => {
    const env = { OPENAI_IMAGE_MODEL: "gpt-image-2.5-sunburst" } as NodeJS.ProcessEnv;
    assert.equal(resolveOfficialAssetImageModel(env), "gpt-image-2.5-sunburst");
    assert.equal(resolveOfficialAssetImageModel({} as NodeJS.ProcessEnv), resolveChatImageGenerationModel({} as NodeJS.ProcessEnv));
    assert.equal(resolveOfficialAssetImageModel({} as NodeJS.ProcessEnv), CHAT_IMAGE_GENERATION_DEFAULT_MODEL);
  });

  it("no official supply source hardcodes a model id or its own env var", () => {
    const dir = path.join(process.cwd(), "src/lib/officialSupply");
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith(".test.ts")) continue;
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      assert.doesNotMatch(source, /gpt-image|dall-e|CHAT_IMAGE_GENERATION_DEFAULT_MODEL|process\.env\.[A-Z_]*IMAGE_MODEL/, file);
    }
  });
});

describe("official asset prompts", () => {
  const draft = hwang();
  const plan = testAssetPlan();
  const style = testStyleCandidate("c1").dna;
  const appearance = testAppearance();

  it("uses canonical gender lock + base safety; scene demands the character on screen", () => {
    const scene = plan.slots.find((s) => s.slotKey === "scene1")!;
    const { primaryPrompt, strictFallbackPrompt } = buildOfficialAssetPrompts({ draft, appearance, style, slot: scene });
    assert.match(primaryPrompt, /GENDER LOCK/);
    assert.match(primaryPrompt, /confirmed MALE/);
    assert.ok(primaryPrompt.includes(BASE_IMAGE_SAFE_DEPICTION));
    assert.ok(!primaryPrompt.includes(ADULT_GROUNDED_NON_EXPLICIT_ALLOWANCE));
    assert.match(primaryPrompt, /MUST appear prominently/);
    assert.match(primaryPrompt, /3:2/);
    assert.match(strictFallbackPrompt, /must be visible/);
  });

  it("representative prompt is 2:3 card framing with a style-only reference", () => {
    const rep = plan.slots.find((s) => s.kind === "representative")!;
    const { primaryPrompt } = buildOfficialAssetPrompts({ draft, appearance, style, slot: rep });
    assert.match(primaryPrompt, /vertical 2:3/);
    assert.match(primaryPrompt, /style reference only/);
  });

  it("nsfw metadata alone never widens depiction; adult allowance needs a confirmed-adult slot opt-in", () => {
    const adultDraft = testDraft({ draftKey: "a", name: "이안", vocabulary: MAGE_VOCAB, nsfw: true });
    const standardScene = testAssetPlan().slots.find((s) => s.slotKey === "scene2")!;
    const standard = buildOfficialAssetPrompts({ draft: adultDraft, appearance, style, slot: standardScene });
    assert.ok(!standard.primaryPrompt.includes(ADULT_GROUNDED_NON_EXPLICIT_ALLOWANCE));
    const optIn = testAssetPlan({ adultScene: true }).slots.find((s) => s.slotKey === "scene2")!;
    const adult = buildOfficialAssetPrompts({ draft: adultDraft, appearance, style, slot: optIn });
    assert.ok(adult.primaryPrompt.includes(ADULT_GROUNDED_NON_EXPLICIT_ALLOWANCE));
    assert.ok(!adult.strictFallbackPrompt.includes(ADULT_GROUNDED_NON_EXPLICIT_ALLOWANCE));
    const sfwOptIn = buildOfficialAssetPrompts({ draft, appearance, style, slot: optIn });
    assert.ok(!sfwOptIn.primaryPrompt.includes(ADULT_GROUNDED_NON_EXPLICIT_ALLOWANCE));
  });
});

describe("visual asset plan", () => {
  it("accepts 1 representative + 4 signature + 6 emotion + 3 scene with duplicate emotion tags", () => {
    const qa = evaluateAssetPlan(hwang(), testAssetPlan());
    assert.deepEqual(qa.errors, []);
    assert.equal(OFFICIAL_ASSET_TOTAL, 14);
    const tags = testAssetPlan().slots.map((s) => s.tag);
    assert.equal(tags.filter((t) => t === "부끄러움").length, 2);
  });

  it("rejects wrong slot counts", () => {
    const plan = testAssetPlan();
    plan.slots = plan.slots.filter((s) => s.slotKey !== "scene3");
    assert.ok(evaluateAssetPlan(hwang(), plan).errors.some((e) => e.code === "slot_count"));
  });

  it("rejects background-only scenes and scenes without location", () => {
    const plan = testAssetPlan();
    plan.slots[11] = { ...plan.slots[11]!, situation: "인물 없이 빈 무도회장 배경만" };
    plan.slots[12] = { ...plan.slots[12]!, location: null };
    const codes = evaluateAssetPlan(hwang(), plan).errors.map((e) => e.code);
    assert.ok(codes.includes("scene_background_only"));
    assert.ok(codes.includes("scene_location_missing"));
  });

  it("representative tag must be unique; adult depiction needs a confirmed adult sheet and never on the card", () => {
    const plan = testAssetPlan({ adultScene: true });
    plan.slots[1] = { ...plan.slots[1]!, tag: "대표" };
    plan.slots[0] = { ...plan.slots[0]!, depiction: "adult_grounded_non_explicit" };
    const codes = evaluateAssetPlan(hwang(), plan).errors.map((e) => e.code);
    assert.ok(codes.includes("representative_tag_shared"));
    assert.ok(codes.includes("adult_depiction_not_allowed"));
    assert.ok(codes.includes("representative_adult_depiction"));
    const adult = testDraft({ draftKey: "a", name: "이안", vocabulary: MAGE_VOCAB, nsfw: true });
    assert.deepEqual(evaluateAssetPlan(adult, testAssetPlan({ adultScene: true })).errors, []);
  });

  it("tags must survive the canonical asset tag normalizer", () => {
    const plan = testAssetPlan();
    plan.slots[3] = { ...plan.slots[3]!, tag: "[태그]" };
    assert.ok(evaluateAssetPlan(hwang(), plan).errors.some((e) => e.code === "slot_tag_not_canonical"));
  });
});

describe("character text QA", () => {
  it("6K-8K is a soft band: in-band has no warnings, short-but-valid only warns", () => {
    assert.deepEqual(evaluateOfficialTextLength(hwang()), { ok: true, errors: [], warnings: [] });
    const short = hwang();
    short.sections.worldAndSituation = prose(HWANG_VOCAB, 900);
    short.sections.characterCore = `레온하르트, 27세. ${prose(HWANG_VOCAB, 1700)}`;
    const qa = evaluateOfficialTextLength(short);
    assert.equal(qa.ok, true);
    assert.ok(qa.warnings.some((w) => w.code === "length_total"));
  });

  it("hard limits: too thin, and canonical 10k ceiling incl. appearance reserve", () => {
    const thin = hwang();
    thin.sections.worldAndSituation = prose(HWANG_VOCAB, 300);
    thin.sections.characterCore = `27세 ${prose(HWANG_VOCAB, 500)}`;
    thin.sections.relationshipsAndDrives = prose(HWANG_VOCAB, 200);
    assert.ok(evaluateOfficialTextLength(thin).errors.some((e) => e.code === "text_too_thin"));
    const huge = hwang();
    huge.sections.characterCore = `27세 ${prose(HWANG_VOCAB, 6000)}`;
    assert.ok(evaluateOfficialTextLength(huge).errors.some((e) => e.code === "text_exceeds_canonical_ceiling"));
  });

  it("supporting NPCs: 0, 1 and 3 accepted; 4 rejected; keyword-dense line bound", () => {
    for (const count of [0, 1, 3]) {
      const draft = testDraft({
        draftKey: "n",
        name: "레온",
        vocabulary: HWANG_VOCAB,
        npcs: Array.from({ length: count }, (_, i) => testNpc(`보좌관${i}`, 29 + i)),
      });
      assert.equal(evaluateSupportingNpcs(draft).ok, true, `count ${count}`);
    }
    const four = testDraft({
      draftKey: "n",
      name: "레온",
      vocabulary: HWANG_VOCAB,
      npcs: Array.from({ length: 4 }, (_, i) => testNpc(`보좌관${i}`, 29)),
    });
    assert.ok(evaluateSupportingNpcs(four).errors.some((e) => e.code === "npc_count"));
    const line = formatSupportingNpcLine(testNpc("이도현", 29));
    assert.equal(line, "이도현 · 29세 · 184cm · 흑발/회안 · 냉정·충성 · 직속 보좌관 · {{char}}와 8년째 함께 일함 · 존댓말");
    const long = testNpc("이도현", 29);
    long.appearance = "가".repeat(SUPPORTING_NPC_LINE_HARD_MAX);
    const draft = testDraft({ draftKey: "n", name: "레온", vocabulary: HWANG_VOCAB, npcs: [long] });
    assert.ok(evaluateSupportingNpcs(draft).errors.some((e) => e.code === "npc_line_too_long"));
  });

  it("main age must be stated in the character core", () => {
    const draft = hwang();
    draft.sections.characterCore = draft.sections.characterCore.replace("27세", "");
    assert.ok(evaluateAgeAndAdultConsistency(draft).errors.some((e) => e.code === "main_age_not_stated"));
  });
});

describe("adult (19+) character QA", () => {
  const adult = (overrides: Parameters<typeof testDraft>[0]["npcs"] = []) =>
    testDraft({ draftKey: "adult", name: "이안", vocabulary: MAGE_VOCAB, nsfw: true, npcs: overrides });

  it("valid adult sheet passes and SFW sheet with adult terms in public text fails", () => {
    assert.equal(evaluateAgeAndAdultConsistency(adult()).ok, true);
    const sfw = hwang();
    sfw.tagline = "섹스 어필";
    assert.ok(evaluateAgeAndAdultConsistency(sfw).errors.some((e) => e.code === "sfw_public_text_has_adult_terms"));
  });

  it("canonical contract: missing / under-19 participantMinAge rejected", () => {
    const missing = adult();
    if (missing.adult.nsfw) (missing.adult as { participantMinAge: number | null }).participantMinAge = null;
    assert.ok(evaluateAgeAndAdultConsistency(missing).errors.some((e) => e.code === "adult_age_contract"));
    const young = testDraft({ draftKey: "y", name: "이안", vocabulary: MAGE_VOCAB, nsfw: true, age: 18 });
    const codes = evaluateAgeAndAdultConsistency(young).errors.map((e) => e.code);
    assert.ok(codes.includes("adult_age_contract"));
    assert.ok(codes.includes("adult_main_under_19"));
  });

  it("adult NPCs need explicit 19+ ages and participantMinAge must match the youngest adult participant", () => {
    const qa = evaluateAgeAndAdultConsistency(adult([testNpc("서도윤", null)]));
    assert.ok(qa.errors.some((e) => e.code === "adult_npc_age_missing"));
    const minorNpc = evaluateAgeAndAdultConsistency(adult([testNpc("서도윤", 17)]));
    assert.ok(minorNpc.errors.some((e) => e.code === "adult_npc_under_19"));
    const eligible = adult([testNpc("서도윤", 22, true)]);
    assert.equal(eligible.adult.nsfw && eligible.adult.participantMinAge, 22);
    assert.equal(evaluateAgeAndAdultConsistency(eligible).ok, true);
    if (eligible.adult.nsfw) eligible.adult.participantMinAge = 27;
    assert.ok(evaluateAgeAndAdultConsistency(eligible).errors.some((e) => e.code === "participant_min_age_mismatch"));
  });

  it("minor-status wording conflicts with structured adult age; backstory and youthful looks do not hard-fail", () => {
    const minor = adult();
    minor.sections.characterCore += " 그는 현재 고등학생이다.";
    assert.ok(evaluateAgeAndAdultConsistency(minor).errors.some((e) => e.code === "adult_minor_wording"));
    const unknown = adult();
    unknown.sections.extraCanon = "나이 불명의 존재.";
    assert.ok(evaluateAgeAndAdultConsistency(unknown).errors.some((e) => e.code === "adult_minor_wording"));
    const presentAge = adult();
    presentAge.sections.relationshipsAndDrives += " 올해 17살이 되었다.";
    assert.ok(evaluateAgeAndAdultConsistency(presentAge).errors.some((e) => e.code === "adult_under_19_age_mention"));
    const backstory = adult();
    backstory.sections.relationshipsAndDrives += " 12살 때 스승을 만났고 고등학생 시절 첫 연구를 했다. 동안이라 어려 보인다는 말을 듣는다.";
    const qa = evaluateAgeAndAdultConsistency(backstory);
    assert.equal(qa.ok, true);
    assert.ok(qa.warnings.some((w) => w.code === "adult_youthful_wording"));
  });

  it("adult canon cannot replace the character", () => {
    const draft = adult();
    if (draft.adult.nsfw) draft.adult.adultHookSummary = "성인 ".repeat(1200);
    assert.ok(evaluateAgeAndAdultConsistency(draft).errors.some((e) => e.code === "adult_dominates_sheet"));
  });

  it("adult appearance cannot be minor-coded", () => {
    const qa = evaluateAppearanceLock(adult(), testAppearance({ build: "교복 차림의 작은 체구" }));
    assert.ok(qa.errors.some((e) => e.code === "appearance_minor_coded"));
    assert.equal(evaluateAppearanceLock(adult(), testAppearance({ build: "작고 가녀린 성인 체형" })).ok, true);
  });
});

describe("world diversity, originality and lorebook boundary", () => {
  const knight = testDraft({ draftKey: "knight", name: "세라핀", vocabulary: KNIGHT_VOCAB, gender: "female", hook: { archetype: "강철 기사", occupation: "기사단장", relationshipTrope: "호위" } });
  const mage = testDraft({ draftKey: "mage", name: "이안", vocabulary: MAGE_VOCAB, hook: { archetype: "괴짜 천재", occupation: "궁정 마법사", relationshipTrope: "사제" } });

  it("distinct same-world characters pass", () => {
    assert.deepEqual(evaluateWorldDiversity([hwang(), knight, mage]).errors, []);
  });

  it("clones (same hook, near-duplicate name/greeting/core) are rejected", () => {
    const clone = testDraft({ draftKey: "clone", name: "레온하르츠", vocabulary: HWANG_VOCAB });
    const codes = evaluateWorldDiversity([hwang(), clone]).errors.map((e) => e.code);
    for (const code of ["near_duplicate_name", "near_duplicate_greeting", "clone_character_core", "clone_hook"]) {
      assert.ok(codes.includes(code), code);
    }
  });

  it("originality guard blocks distinctive competitor expressions, not generic tropes", () => {
    const draft = hwang();
    assert.equal(evaluateOriginality(draft, [{ source: "x", tagline: "계약 결혼 로맨스" }]).ok, true);
    const qa = evaluateOriginality(draft, [
      { source: "x", name: "레온하르트", greeting: draft.greeting, terms: ["에르셀 성력"] },
    ], ["에르셀 성력"]);
    const codes = qa.errors.map((e) => e.code);
    assert.ok(codes.includes("competitor_name"));
    assert.ok(codes.includes("competitor_greeting"));
    assert.ok(codes.includes("competitor_world_term"));
    assert.equal(evaluateWorldTermCollisions([{ worldKey: "a", terms: ["성력"] }, { worldKey: "b", terms: ["성력"] }]).ok, false);
  });

  it("shared lorebook allows public facts and blocks secrets / hidden knowledge", () => {
    const drafts = [hwang(), knight];
    const ok = evaluateSharedLorebook(
      [{ entryKey: "leon", name: "레온하르트", keywords: ["레온하르트", "황태자"], content: "제국의 황태자. 흑발 금안, 냉정한 인상. 기사단과 원로원을 총괄한다." }],
      drafts
    );
    assert.deepEqual(ok.errors, []);
    const leak = evaluateSharedLorebook(
      [{ entryKey: "leon", name: "레온하르트", keywords: ["레온하르트"], content: "레온하르트는 선황의 사생아이다. 궁정은 모른다." }],
      drafts
    );
    assert.ok(leak.errors.some((e) => e.code === "lorebook_secret_leak"));
    const hidden = evaluateSharedLorebook(
      [{ entryKey: "k", name: "세라핀", keywords: ["세라핀"], content: "세라핀의 진짜 정체는 적국의 공주다." }],
      drafts
    );
    assert.ok(hidden.errors.some((e) => e.code === "lorebook_hidden_knowledge"));
  });
});

describe("style candidates and research snapshot", () => {
  it("3-5 candidates per canonical genre with structured DNA", () => {
    const candidates = ["c1", "c2", "c3"].map(testStyleCandidate);
    assert.equal(validateStyleProposal({ styleKey: "romance_fantasy_v1", genre: "로맨스 판타지", candidates }).ok, true);
    const codes = validateStyleProposal({ styleKey: "RomFan", genre: "로판" as never, candidates: candidates.slice(0, 2) }).errors.map((e) => e.code);
    assert.ok(codes.includes("style_key_invalid"));
    assert.ok(codes.includes("genre_not_canonical"));
    assert.ok(codes.includes("candidate_count"));
  });

  it("artist/work copy targets are rejected; only owned/licensed seeds may reach the provider", () => {
    const copy = testStyleCandidate("c1");
    copy.dna.atmosphere = "in the style of famous artist";
    const qa = validateStyleProposal({ styleKey: "romance_fantasy_v1", genre: "로맨스 판타지", candidates: [copy, testStyleCandidate("c2"), testStyleCandidate("c3")] });
    assert.ok(qa.errors.some((e) => e.code === "style_copy_target"));
    assert.ok(validateStyleSeedForApproval({ url: "https://x/y.png", provenance: "external_public_observation", note: "" }));
    assert.equal(validateStyleSeedForApproval({ url: "/uploads/seed.webp", provenance: "platform_owned", note: "" }), null);
  });

  it("research snapshot never stores prompts/greetings and automation needs an explicit allow", () => {
    assert.equal(resolveCollectionMethod("unclear"), "manual_curated");
    assert.equal(resolveCollectionMethod("restricts_automation"), "manual_curated");
    const snapshot: ResearchSnapshot = {
      observedAt: "2026-09-26",
      platforms: [{ name: "p", region: "KR", url: "https://p", automationPolicy: "unclear", collectionMethod: "automated", notes: "" }],
      signals: [
        {
          source: "p", sourceUrl: "https://p/a", region: "KR", genre: "로판", audience: "female_oriented",
          relationshipTrope: "계약 결혼", archetype: null, worldMechanic: null, scenarioHook: "회귀한 악녀",
          visualDirection: null, popularitySignal: "niche", adultDemand: false, seasonal: null,
          greeting: "copied",
        } as never,
      ],
    };
    const codes = validateResearchSnapshot(snapshot).errors.map((e) => e.code);
    assert.ok(codes.includes("collection_method_not_allowed"));
    assert.ok(codes.includes("forbidden_signal_field"));
  });

  it("the committed curated snapshot passes the research schema (manual curated, trope-level, niche included)", () => {
    const file = path.join(process.cwd(), "docs/official-supply/market-research-snapshot-2026-09.json");
    const snapshot = JSON.parse(fs.readFileSync(file, "utf8")) as ResearchSnapshot;
    const qa = validateResearchSnapshot(snapshot);
    assert.deepEqual(qa.errors, []);
    assert.deepEqual(qa.warnings, []);
    assert.ok(snapshot.platforms.every((p) => p.collectionMethod === "manual_curated"));
    assert.ok(snapshot.signals.some((s) => s.adultDemand) && snapshot.signals.some((s) => !s.adultDemand));
  });

  it("portfolio balance is policy-driven (no hardcoded adult ratio)", () => {
    const entries = [
      { draftKey: "a", primaryGenre: "로맨스" as const, nsfw: true },
      { draftKey: "b", primaryGenre: "로맨스" as const, nsfw: true },
      { draftKey: "c", primaryGenre: "판타지" as const, nsfw: false },
    ];
    const policy = { adultShareMin: 0.2, adultShareMax: 0.5, maxGenreShare: 0.6, minDistinctGenres: 2 };
    const codes = evaluatePortfolioBalance(entries, policy).errors.map((e) => e.code);
    assert.ok(codes.includes("portfolio_adult_share"));
    assert.ok(codes.includes("portfolio_genre_share"));
    assert.equal(evaluatePortfolioBalance(entries, { ...policy, adultShareMax: 0.7, maxGenreShare: 0.7 }).ok, true);
  });
});
