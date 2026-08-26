import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SYNTHETIC_CHARACTER_A_APPEARANCE,
  SYNTHETIC_CHARACTER_B_APPEARANCE,
  SYNTHETIC_PRIVATE_CHARACTER_PROMPT,
  SYNTHETIC_PRIVATE_PERSONA_DESCRIPTION,
  syntheticCoupleStampPlan,
  syntheticDuoGiftAlternateImageOnly,
  syntheticDuoGiftPlacementSwap,
  syntheticDuoGiftPrimary,
  syntheticEmoticonPlan,
  syntheticLdDuoPlan,
  syntheticLdPartyAllReferencesAbsent,
  syntheticLdPartyCast,
  syntheticLdPartyMixedVisualStates,
  syntheticNoPhotoNoSavedSubject,
  syntheticNoPhotoSavedSubject,
} from "./chatImageVisualIdentity.fixtures";
import {
  buildChatImageCharacterAppearanceClientView,
  buildPartyIllustrationReferencePlan,
  canRevealChatImageAppearancePreview,
  defaultAppearanceMode,
  extractVisualAppearance,
  isPrimarySelectableImage,
  previewVisualAppearance,
  resolveCharacterSavedAppearance,
  resolveChatImageAppearanceControlProduct,
  resolveEffectiveAppearanceMode,
  resolvePersonaSavedAppearance,
  resolveRequestAppearanceModes,
  shouldShowChatImageAppearanceModeControl,
} from "./chatImageVisualIdentity";
import { extractPersonaAppearance } from "./chatPersonaImageGeneration";

function subjectBlock(prompt: string, letter: string): string {
  const start = prompt.indexOf(`[SUBJECT ${letter}`);
  assert.ok(start >= 0, `missing SUBJECT ${letter}`);
  const next = prompt.indexOf("[SUBJECT ", start + 1);
  const contract = prompt.indexOf("IDENTITY OWNERSHIP IS STRICT", start);
  const end = Math.min(
    next === -1 ? prompt.length : next,
    contract === -1 ? prompt.length : contract
  );
  return prompt.slice(start, end);
}

describe("chat image visual identity", () => {
  it("extracts visual-only segments and keeps negation", () => {
    const extracted = extractVisualAppearance(
      [
        "차분한 성격이다.",
        "검은 머리, 비대칭 앞머리. 5:5 가르마가 아니다. 머리를 묶지 않는다.",
        "검은 동공과 붉은 홍채. 붉은 눈이 아니다.",
        "왕국에서 자랐다.",
        "NOT center-parted / NOT 5:5.",
      ].join("\n")
    );
    assert.match(extracted, /비대칭 앞머리/);
    assert.match(extracted, /5:5 가르마가 아니다/);
    assert.match(extracted, /머리를 묶지 않는다/);
    assert.match(extracted, /붉은 홍채/);
    assert.match(extracted, /붉은 눈이 아니다/);
    assert.match(extracted, /NOT center-parted \/ NOT 5:5/);
    assert.doesNotMatch(extracted, /왕국/);
    assert.doesNotMatch(extracted, /차분한 성격/);
  });

  it("does not invert negative visual rules into positive traits", () => {
    const extracted = extractVisualAppearance("이 사람은 5:5 가르마가 아니다.");
    assert.match(extracted, /5:5 가르마가 아니다/);
    assert.doesNotMatch(extracted, /중심 가르마를 한다/);
    assert.doesNotMatch(extracted, /is center-parted/);
  });

  it("uses one extractor for persona and character sources", () => {
    const fromPersona = extractPersonaAppearance(SYNTHETIC_PRIVATE_PERSONA_DESCRIPTION);
    const fromResolver = resolvePersonaSavedAppearance(SYNTHETIC_PRIVATE_PERSONA_DESCRIPTION);
    assert.equal(fromPersona, fromResolver);
    assert.match(fromPersona, /짧은 갈색 머리/);
    assert.doesNotMatch(fromPersona, /비밀 메모/);
    assert.doesNotMatch(fromPersona, /차분한 성격/);

    const fromCharacter = resolveCharacterSavedAppearance({
      appearanceRaw: "",
      appearanceSection: "검은 머리, 비대칭 앞머리, 검은 동공과 붉은 홍채, 흰 셔츠, 검은 하네스.",
    });
    assert.match(fromCharacter, /붉은 홍채/);
    assert.doesNotMatch(fromCharacter, /비밀을 절대/);
    assert.doesNotMatch(fromCharacter, /왕국 음모/);
    assert.doesNotMatch(fromCharacter, /사용자를 시험/);
  });

  it("does not forward a full system prompt or persona description", () => {
    const appearance = resolveCharacterSavedAppearance({
      appearanceRaw: "",
      appearanceSection: "검은 머리, 비대칭 앞머리, 검은 동공과 붉은 홍채, 흰 셔츠, 검은 하네스.",
    });
    assert.notEqual(appearance, SYNTHETIC_PRIVATE_CHARACTER_PROMPT);
    assert.ok(appearance.length < SYNTHETIC_PRIVATE_CHARACTER_PROMPT.length);

    const persona = resolvePersonaSavedAppearance(SYNTHETIC_PRIVATE_PERSONA_DESCRIPTION);
    assert.notEqual(persona, SYNTHETIC_PRIVATE_PERSONA_DESCRIPTION);
  });

  it("defaults primary images to IMAGE_PLUS_SAVED and alternates to IMAGE_ONLY", () => {
    assert.equal(
      defaultAppearanceMode({
        sourceKind: "main_character",
        isPrimaryImage: true,
        hasOwnSavedAppearance: true,
        hasOwnReference: true,
      }),
      "image_plus_saved"
    );
    assert.equal(
      defaultAppearanceMode({
        sourceKind: "main_character",
        isPrimaryImage: false,
        hasOwnSavedAppearance: true,
        hasOwnReference: true,
      }),
      "image_only"
    );
    assert.equal(
      defaultAppearanceMode({
        sourceKind: "persona",
        isPrimaryImage: true,
        hasOwnSavedAppearance: true,
        hasOwnReference: true,
      }),
      "image_plus_saved"
    );
    assert.equal(
      defaultAppearanceMode({
        sourceKind: "cast_member",
        isPrimaryImage: false,
        hasOwnSavedAppearance: true,
        hasOwnReference: true,
      }),
      "image_only"
    );
    assert.equal(
      defaultAppearanceMode({
        sourceKind: "cast_member",
        isPrimaryImage: true,
        hasOwnSavedAppearance: true,
        hasOwnReference: false,
      }),
      "image_plus_saved"
    );
    assert.equal(
      defaultAppearanceMode({
        sourceKind: "unknown",
        isPrimaryImage: true,
        hasOwnSavedAppearance: true,
        hasOwnReference: true,
      }),
      "image_only"
    );
    assert.equal(
      defaultAppearanceMode({
        sourceKind: "main_character",
        isPrimaryImage: true,
        hasOwnSavedAppearance: false,
        hasOwnReference: true,
      }),
      "image_only"
    );
    assert.equal(
      resolveEffectiveAppearanceMode({
        sourceKind: "main_character",
        isPrimaryImage: true,
        hasOwnSavedAppearance: false,
        hasOwnReference: true,
        override: "image_plus_saved",
      }),
      "image_only"
    );
  });

  it("keeps an explicit appearance toggle until the caller clears the override", () => {
    const images = [{ url: "/primary.webp" }, { url: "/alt.webp" }];
    assert.equal(isPrimarySelectableImage(images, "/primary.webp"), true);
    assert.equal(isPrimarySelectableImage(images, "/alt.webp"), false);

    const primaryDefault = resolveEffectiveAppearanceMode({
      sourceKind: "main_character",
      isPrimaryImage: true,
      hasOwnSavedAppearance: true,
      hasOwnReference: true,
      override: null,
    });
    assert.equal(primaryDefault, "image_plus_saved");

    const explicitOnly = resolveEffectiveAppearanceMode({
      sourceKind: "main_character",
      isPrimaryImage: true,
      hasOwnSavedAppearance: true,
      hasOwnReference: true,
      override: "image_only",
    });
    assert.equal(explicitOnly, "image_only");

    const backToPrimaryDefault = resolveEffectiveAppearanceMode({
      sourceKind: "main_character",
      isPrimaryImage: true,
      hasOwnSavedAppearance: true,
      hasOwnReference: true,
      override: null,
    });
    assert.equal(backToPrimaryDefault, "image_plus_saved");

    const modes = resolveRequestAppearanceModes({
      characterImages: images,
      selectedCharacterImageUrl: "/alt.webp",
      characterSavedAppearance: SYNTHETIC_CHARACTER_A_APPEARANCE,
      personaSavedAppearance: SYNTHETIC_CHARACTER_B_APPEARANCE,
    });
    assert.equal(modes.characterAppearanceMode, "image_only");
    assert.equal(modes.personaAppearanceMode, "image_plus_saved");
    assert.equal(modes.isPrimaryCharacterImage, false);
  });

  it("previews extracted appearance without dumping the source document", () => {
    const preview = previewVisualAppearance("a".repeat(200), 40);
    assert.equal(preview.truncated, true);
    assert.ok(preview.preview.endsWith("…"));
    assert.ok(preview.preview.length <= 41);
    assert.equal(preview.full.length, 200);
  });

  it("keeps iris/pupil/hair-part/clothing ownership inside subject A only", () => {
    const { prompt, referenceUrls, subjects } = syntheticDuoGiftPrimary();
    const blockA = subjectBlock(prompt, "A");
    const blockB = subjectBlock(prompt, "B");

    assert.match(blockA, /CharacterA/);
    assert.match(blockA, /red irises/);
    assert.match(blockA, /black pupils/);
    assert.match(blockA, /NOT center-parted \/ NOT 5:5/);
    assert.match(blockA, /white shirt/);
    assert.match(blockA, /black harness/);
    assert.doesNotMatch(blockA, /dark gray irises/);
    assert.doesNotMatch(blockA, /center-parted hair/);
    assert.doesNotMatch(blockA, /black suit/);

    assert.match(blockB, /CharacterB/);
    assert.match(blockB, /dark gray irises/);
    assert.match(blockB, /center-parted hair/);
    assert.match(blockB, /black suit/);
    assert.doesNotMatch(blockB, /red irises/);
    assert.doesNotMatch(blockB, /black pupils/);
    assert.doesNotMatch(blockB, /NOT center-parted/);
    assert.doesNotMatch(blockB, /white shirt/);
    assert.doesNotMatch(blockB, /black harness/);

    assert.match(prompt, /IDENTITY OWNERSHIP IS STRICT/);
    assert.match(prompt, /NEVER transfer between subjects/);
    assert.match(prompt, /NEVER a character identity source/);
    assert.match(prompt, /Unify art style, not identity/);
    assert.match(prompt, /GENDER LOCK/);
    assert.deepEqual(referenceUrls, [
      "/image-templates/sd-gift-box-duo-hq.webp",
      "/synthetic/character-a-primary.webp",
      "/synthetic/character-b-primary.webp",
    ]);
    assert.equal(subjects[0]?.referenceIndex, 2);
    assert.equal(subjects[1]?.referenceIndex, 3);
    assert.match(prompt, /Image 2 belongs ONLY to CharacterA/);
    assert.match(prompt, /Image 3 belongs ONLY to CharacterB/);
  });

  it("does not leak saved appearance in IMAGE_ONLY mode", () => {
    const { prompt } = syntheticDuoGiftAlternateImageOnly();
    const blockA = subjectBlock(prompt, "A");
    assert.match(blockA, /IMAGE_ONLY/);
    assert.match(blockA, /Use this selected reference as the authoritative visual identity/);
    assert.doesNotMatch(blockA, /red irises/);
    assert.doesNotMatch(blockA, /white shirt/);
    assert.doesNotMatch(blockA, /black harness/);
    assert.match(subjectBlock(prompt, "B"), /dark gray irises/);
    assert.match(subjectBlock(prompt, "B"), /IMAGE_PLUS_SAVED/);
  });

  it("moves placement, names, appearance, and reference images together", () => {
    const { prompt, referenceUrls, subjects } = syntheticDuoGiftPlacementSwap();
    assert.deepEqual(referenceUrls, [
      "/image-templates/sd-gift-box-duo-hq.webp",
      "/synthetic/character-b-primary.webp",
      "/synthetic/character-a-primary.webp",
    ]);
    assert.equal(subjects[0]?.name, "CharacterB");
    assert.equal(subjects[0]?.referenceIndex, 2);
    assert.equal(subjects[1]?.name, "CharacterA");
    assert.equal(subjects[1]?.referenceIndex, 3);
    assert.match(prompt, /TOP person is CharacterB/);
    assert.match(prompt, /BOTTOM person is CharacterA/);
    assert.match(subjectBlock(prompt, "A"), /Image 2 belongs ONLY to CharacterB/);
    assert.match(subjectBlock(prompt, "A"), /dark gray irises/);
    assert.match(subjectBlock(prompt, "B"), /Image 3 belongs ONLY to CharacterA/);
    assert.match(subjectBlock(prompt, "B"), /red irises/);
  });

  it("applies the same identity contract to emoticon and couple-stamp plans", () => {
    const emoticon = syntheticEmoticonPlan();
    const stamp = syntheticCoupleStampPlan();
    for (const plan of [emoticon, stamp]) {
      assert.match(plan.prompt, /IDENTITY OWNERSHIP IS STRICT/);
      assert.match(subjectBlock(plan.prompt, "A"), /red irises/);
      assert.doesNotMatch(subjectBlock(plan.prompt, "B"), /red irises/);
      assert.equal(plan.referenceUrls[0]?.startsWith("/image-templates/"), true);
      assert.equal(plan.referenceUrls[1], "/synthetic/character-a-primary.webp");
      assert.equal(plan.referenceUrls[2], "/synthetic/character-b-primary.webp");
      assert.match(plan.prompt, /Image 2 belongs ONLY to CharacterA/);
      assert.match(plan.prompt, /Image 3 belongs ONLY to CharacterB/);
    }
    assert.match(emoticon.prompt, /exactly nine equal panels/i);
    assert.match(stamp.prompt, /four circular badges/i);
  });

  it("grounds standard LD duo subjects without a template identity source", () => {
    const plan = syntheticLdDuoPlan();
    assert.deepEqual(plan.referenceUrls, [
      "/synthetic/character-a-primary.webp",
      "/synthetic/character-b-primary.webp",
    ]);
    assert.match(plan.prompt, /Image 1 belongs ONLY to CharacterA/);
    assert.match(plan.prompt, /Image 2 belongs ONLY to CharacterB/);
    assert.doesNotMatch(plan.prompt, /REFERENCE 1 is the layout/);
    assert.match(subjectBlock(plan.prompt, "A"), /red irises/);
    assert.doesNotMatch(subjectBlock(plan.prompt, "B"), /red irises/);
    assert.match(plan.prompt, /GENDER LOCK/);
    assert.equal(plan.prompt.includes(SYNTHETIC_PRIVATE_CHARACTER_PROMPT), false);
  });

  it("isolates multi-cast LD members and does not inject a global main character", () => {
    const party = syntheticLdPartyCast();
    assert.deepEqual(party.referenceUrls, [
      "/synthetic/character-a-primary.webp",
      "/synthetic/character-b-primary.webp",
      "/synthetic/character-c-alt.webp",
    ]);
    assert.match(party.prompt, /Image 1 belongs ONLY to CharacterA/);
    assert.match(party.prompt, /Image 2 belongs ONLY to CharacterB/);
    assert.match(party.prompt, /Image 3 belongs ONLY to CharacterC/);
    assert.match(party.prompt, /No photo for CharacterD/);
    assert.match(subjectBlock(party.prompt, "A"), /red irises/);
    assert.doesNotMatch(subjectBlock(party.prompt, "B"), /red irises/);
    assert.doesNotMatch(subjectBlock(party.prompt, "C"), /red irises/);
    assert.doesNotMatch(subjectBlock(party.prompt, "C"), /this should not appear/);
    assert.match(subjectBlock(party.prompt, "C"), /IMAGE_ONLY/);
    assert.match(subjectBlock(party.prompt, "D"), /short black hair, glasses/);
    assert.doesNotMatch(party.prompt, /IgnoredMain/);
    assert.doesNotMatch(party.identity, /IgnoredMain/);
    assert.match(party.prompt, /identity photo for CharacterA only/);
  });

  it("does not extract Korean non-appearance substrings (NONVISUAL_CLAUSE_LEAK_TEST)", () => {
    assert.equal(extractVisualAppearance("귀족 가문의 비밀을 알고 있다."), "");
    assert.equal(extractVisualAppearance("눈앞의 상황을 지켜본다."), "");
    assert.equal(extractVisualAppearance("점점 마음을 열었다."), "");
    assert.equal(extractVisualAppearance("시점과 장점을 이야기한다."), "");

    const hairIris = extractVisualAppearance("검은 머리, 붉은 홍채.");
    assert.match(hairIris, /검은 머리/);
    assert.match(hairIris, /붉은 홍채/);

    const earTail = extractVisualAppearance("긴 귀, 검은 꼬리.");
    assert.match(earTail, /긴 귀/);
    assert.match(earTail, /검은 꼬리/);

    const mixed = extractVisualAppearance("검은 머리이며 비밀 조직의 수장이다.");
    assert.match(mixed, /검은 머리/);
    assert.doesNotMatch(mixed, /비밀 조직/);
    assert.doesNotMatch(mixed, /수장/);
  });

  it("keeps party provider references 1:1 with numbered prompt owners", () => {
    const three = syntheticLdPartyCast();
    assert.equal(three.referenceUrls.length, 3);
    assert.equal(three.canGenerate, true);
    assert.equal(three.hiddenIdentityFallback, false);
    assert.deepEqual(
      three.subjects
        .filter((subject) => subject.referenceIndex != null)
        .map((subject) => subject.referenceImageUrl),
      three.referenceUrls
    );
    assert.match(three.prompt, /Image 1 belongs ONLY to CharacterA/);
    assert.match(three.prompt, /Image 2 belongs ONLY to CharacterB/);
    assert.match(three.prompt, /Image 3 belongs ONLY to CharacterC/);
    assert.doesNotMatch(three.prompt, /Image 4 belongs/);

    const mixed = syntheticLdPartyMixedVisualStates();
    assert.deepEqual(mixed.referenceUrls, [
      "/synthetic/character-a-primary.webp",
      "/synthetic/character-c-alt.webp",
    ]);
    assert.equal(mixed.subjects[0]?.referenceIndex, 1);
    assert.equal(mixed.subjects[1]?.referenceIndex, 2);
    assert.equal(mixed.subjects[2]?.referenceIndex, null);
    assert.equal(mixed.subjects[3]?.referenceIndex, null);
    assert.match(mixed.prompt, /Image 1 belongs ONLY to CharacterA/);
    assert.match(mixed.prompt, /Image 2 belongs ONLY to CharacterC/);
    assert.match(mixed.prompt, /No photo for CharacterD/);
    assert.match(mixed.prompt, /No photo for CharacterE/);
    assert.match(subjectBlock(mixed.prompt, "A"), /IMAGE_PLUS_SAVED/);
    assert.match(subjectBlock(mixed.prompt, "B"), /IMAGE_ONLY/);
    assert.doesNotMatch(subjectBlock(mixed.prompt, "B"), /red irises/);
    assert.match(subjectBlock(mixed.prompt, "C"), /IMAGE_PLUS_SAVED/);
    assert.doesNotMatch(subjectBlock(mixed.prompt, "C"), /prefer this subject's selected reference/);
    assert.match(subjectBlock(mixed.prompt, "D"), /NO_VISUAL_REFERENCE/);
    assert.doesNotMatch(subjectBlock(mixed.prompt, "D"), /selected reference/);
    assert.doesNotMatch(subjectBlock(mixed.prompt, "D"), /own reference is authoritative/);

    const stale = buildPartyIllustrationReferencePlan([
      {
        name: "CharacterA",
        gender: "male",
        role: "companion character",
        referenceIndex: 1,
        imageUrl: "/synthetic/character-a-primary.webp",
        appearanceNote: SYNTHETIC_CHARACTER_A_APPEARANCE,
      },
      {
        name: "CharacterB",
        gender: "female",
        role: "player",
        referenceIndex: null,
        imageUrl: null,
        appearanceNote: "",
      },
      {
        name: "CharacterC",
        gender: "other",
        role: "companion character",
        referenceIndex: 9,
        imageUrl: "/synthetic/character-c-alt.webp",
        appearanceNote: "",
        isPrimaryImage: false,
      },
    ]);
    assert.deepEqual(stale.referenceUrls, [
      "/synthetic/character-a-primary.webp",
      "/synthetic/character-c-alt.webp",
    ]);
    assert.equal(stale.subjects[2]?.referenceIndex, 2);
    assert.equal(stale.hiddenIdentityFallback, false);
  });

  it("fails closed when every party cast member has no photo", () => {
    const absent = syntheticLdPartyAllReferencesAbsent();
    assert.deepEqual(absent.referenceUrls, []);
    assert.equal(absent.canGenerate, false);
    assert.equal(absent.hiddenIdentityFallback, false);
    assert.deepEqual(absent.referenceOrder, []);
    for (const url of absent.contextFallbackUrls) {
      assert.equal(absent.referenceUrls.includes(url), false);
    }
    assert.doesNotMatch(absent.prompt, /Image \d+ belongs ONLY/);
    assert.match(absent.prompt, /No photo for CharacterA/);
    assert.match(absent.prompt, /No photo for CharacterB/);
    assert.doesNotMatch(absent.prompt, /chat-main-character/);
    assert.doesNotMatch(absent.prompt, /user-persona/);
  });

  it("renders no-photo manifests without selected-reference language", () => {
    const saved = syntheticNoPhotoSavedSubject();
    assert.match(saved.prompt, /IMAGE_PLUS_SAVED/);
    assert.match(saved.prompt, /No photo for CharacterA/);
    assert.match(saved.prompt, /red irises/);
    assert.doesNotMatch(saved.prompt, /prefer this subject's selected reference/);
    assert.doesNotMatch(saved.prompt, /Use this selected reference/);
    assert.doesNotMatch(saved.prompt, /own reference is authoritative/);

    const empty = syntheticNoPhotoNoSavedSubject();
    assert.match(empty.prompt, /NO_VISUAL_REFERENCE/);
    assert.match(empty.prompt, /No visual reference or saved appearance is available/);
    assert.match(empty.prompt, /Use only the subject's name, gender lock and scene role/);
    assert.match(empty.prompt, /Never borrow another subject's face or visual traits/);
    assert.doesNotMatch(empty.prompt, /IMAGE_ONLY/);
    assert.doesNotMatch(empty.prompt, /selected reference/);
    assert.doesNotMatch(empty.prompt, /own reference is authoritative/);
    assert.doesNotMatch(empty.prompt, /No supplemental saved appearance/);
  });

  it("shows appearance radios only for products that honor the request mode", () => {
    assert.equal(
      resolveChatImageAppearanceControlProduct({
        surface: "sd",
        sdProduct: "gift",
      }),
      "gift"
    );
    assert.equal(
      resolveChatImageAppearanceControlProduct({
        surface: "sd",
        sdProduct: "emoticon",
      }),
      "emoticon"
    );
    assert.equal(
      resolveChatImageAppearanceControlProduct({
        surface: "sd",
        sdProduct: "coupleStamp",
      }),
      "couple_stamp"
    );
    assert.equal(
      resolveChatImageAppearanceControlProduct({
        surface: "ld",
        ldProduct: "illustration",
        isTrpgParty: false,
      }),
      "ld_duo"
    );
    assert.equal(
      resolveChatImageAppearanceControlProduct({
        surface: "ld",
        ldProduct: "illustration",
        isTrpgParty: true,
      }),
      "ld_party"
    );
    assert.equal(
      resolveChatImageAppearanceControlProduct({
        surface: "ld",
        ldProduct: "comic",
      }),
      "comic"
    );
    assert.equal(
      resolveChatImageAppearanceControlProduct({
        surface: "ld",
        ldProduct: "persona",
      }),
      "persona"
    );

    assert.equal(
      shouldShowChatImageAppearanceModeControl({
        product: "gift",
        hasSavedAppearance: true,
      }),
      true
    );
    assert.equal(
      shouldShowChatImageAppearanceModeControl({
        product: "emoticon",
        hasSavedAppearance: true,
      }),
      true
    );
    assert.equal(
      shouldShowChatImageAppearanceModeControl({
        product: "couple_stamp",
        hasSavedAppearance: true,
      }),
      true
    );
    assert.equal(
      shouldShowChatImageAppearanceModeControl({
        product: "ld_duo",
        hasSavedAppearance: true,
      }),
      true
    );
    assert.equal(
      shouldShowChatImageAppearanceModeControl({
        product: "ld_party",
        hasSavedAppearance: true,
      }),
      false
    );
    assert.equal(
      shouldShowChatImageAppearanceModeControl({
        product: "comic",
        hasSavedAppearance: true,
      }),
      false
    );
    assert.equal(
      shouldShowChatImageAppearanceModeControl({
        product: "persona",
        hasSavedAppearance: true,
      }),
      false
    );
    assert.equal(
      shouldShowChatImageAppearanceModeControl({
        product: "gift",
        hasSavedAppearance: false,
      }),
      false
    );
    assert.equal(
      shouldShowChatImageAppearanceModeControl({
        product: "ld_duo",
        hasSavedAppearance: false,
      }),
      false
    );
  });

  it("keeps server grounding while hiding system_prompt appearance from non-owners", () => {
    const systemPrompt = [
      "[외형]",
      "검은 머리, 붉은 홍채, 숨겨진 용 문신",
      "[비밀]",
      "절대 외부에 알리지 말 것.",
    ].join("\n");
    const serverAppearance = resolveCharacterSavedAppearance({
      appearanceRaw: "",
      appearanceSection: "검은 머리, 붉은 홍채, 숨겨진 용 문신",
    });
    assert.match(serverAppearance, /검은 머리/);
    assert.match(serverAppearance, /붉은 홍채/);
    assert.match(serverAppearance, /숨겨진 용 문신/);
    assert.doesNotMatch(serverAppearance, /절대 외부에/);
    assert.notEqual(serverAppearance, systemPrompt);

    const nonOwner = buildChatImageCharacterAppearanceClientView({
      savedAppearance: serverAppearance,
      characterCreatorId: 100,
      viewerUserId: 200,
    });
    assert.equal(canRevealChatImageAppearancePreview({
      characterCreatorId: 100,
      viewerUserId: 200,
    }), false);
    assert.equal(nonOwner.hasSavedAppearance, true);
    assert.equal(nonOwner.appearancePreview, "");
    assert.equal(nonOwner.appearancePreviewShort, "");
    const clientJson = JSON.stringify(nonOwner);
    assert.doesNotMatch(clientJson, /숨겨진 용 문신/);
    assert.doesNotMatch(clientJson, /검은 머리/);
    assert.doesNotMatch(clientJson, /system_prompt/);
    assert.doesNotMatch(clientJson, /절대 외부에/);
    assert.equal(clientJson.includes(systemPrompt), false);

    const owner = buildChatImageCharacterAppearanceClientView({
      savedAppearance: serverAppearance,
      characterCreatorId: 100,
      viewerUserId: 100,
    });
    assert.equal(canRevealChatImageAppearancePreview({
      characterCreatorId: 100,
      viewerUserId: 100,
    }), true);
    assert.equal(owner.hasSavedAppearance, true);
    assert.match(owner.appearancePreview, /붉은 홍채/);
    assert.match(owner.appearancePreview, /숨겨진 용 문신/);
    assert.doesNotMatch(owner.appearancePreview, /절대 외부에/);

    const privateNonOwner = buildChatImageCharacterAppearanceClientView({
      savedAppearance: serverAppearance,
      characterCreatorId: 100,
      viewerUserId: 200,
    });
    assert.equal(privateNonOwner.appearancePreview, "");
    assert.equal(privateNonOwner.hasSavedAppearance, true);

    const modes = resolveRequestAppearanceModes({
      characterImages: [{ url: "/synthetic/character-a-primary.webp" }],
      selectedCharacterImageUrl: "/synthetic/character-a-primary.webp",
      characterSavedAppearance: serverAppearance,
      personaSavedAppearance: "",
    });
    assert.equal(modes.characterAppearanceMode, "image_plus_saved");
    assert.equal(
      resolveEffectiveAppearanceMode({
        sourceKind: "main_character",
        isPrimaryImage: false,
        hasOwnSavedAppearance: nonOwner.hasSavedAppearance,
        hasOwnReference: true,
      }),
      "image_only"
    );
    assert.equal(
      resolveEffectiveAppearanceMode({
        sourceKind: "main_character",
        isPrimaryImage: true,
        hasOwnSavedAppearance: nonOwner.hasSavedAppearance,
        hasOwnReference: true,
        override: "image_plus_saved",
      }),
      "image_plus_saved"
    );
    assert.equal(
      shouldShowChatImageAppearanceModeControl({
        product: "gift",
        hasSavedAppearance: nonOwner.hasSavedAppearance,
      }),
      true
    );
  });

  it("uses compiled appearance only when raw and section are empty", () => {
    const compiled = JSON.stringify({
      compiled_text: "짧은 은발, 녹색 눈",
      body: "",
      hair: "짧은 은발",
      eyes: "녹색 눈",
      face: "",
      lips_makeup: "",
      clothing: "",
      impression: "",
    });
    const fromCompiled = resolveCharacterSavedAppearance({
      appearanceRaw: "",
      appearanceSection: "",
      appearanceCompiled: compiled,
    });
    assert.match(fromCompiled, /짧은 은발/);
    assert.match(fromCompiled, /녹색 눈/);

    const rawWins = resolveCharacterSavedAppearance({
      appearanceRaw: "검은 머리, 붉은 홍채",
      appearanceSection: "",
      appearanceCompiled: compiled,
    });
    assert.match(rawWins, /검은 머리/);
    assert.doesNotMatch(rawWins, /은발/);
    assert.doesNotMatch(rawWins, /녹색 눈/);
  });
});
