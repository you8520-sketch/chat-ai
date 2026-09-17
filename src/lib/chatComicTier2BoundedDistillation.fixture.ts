import type { ScenePlan } from "@/lib/chatImageScenePlan";

/**
 * Sanitized REAL_FAIL_001 / Y1C-shaped scene — no raw user RP, URLs, or real identities.
 * Multi-event bedroom close-contact arc with repeated safe intimacy semantics.
 */
export function realFailLikeSanitizedScenePlan(): ScenePlan {
  const events = [
    {
      id: "e1",
      order: 1,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "environment" as const,
      actor: "environment" as const,
      text: "프라이빗 침실과 넓은 침대, 은은한 조명",
      segmentKind: "narration" as const,
    },
    {
      id: "e2",
      order: 2,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "action" as const,
      actor: "character" as const,
      text: "캐릭터A가 침대 가장자리에 앉아 상의를 벗어 어깨가 드러난다",
      segmentKind: "narration" as const,
    },
    {
      id: "e3",
      order: 3,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "action" as const,
      actor: "persona" as const,
      text: "캐릭터B가 조심스럽게 가까이 다가와 볼에 손을 대며 수줍게 홍조를 띤다",
      segmentKind: "narration" as const,
    },
    {
      id: "e4",
      order: 4,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "dialogue" as const,
      actor: "persona" as const,
      text: "…괜찮아?",
      segmentKind: "dialogue" as const,
      speakerName: "캐릭터B",
    },
    {
      id: "e5",
      order: 5,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "action" as const,
      actor: "character" as const,
      text: "캐릭터A가 손을 잡아당기며 가까이 마주본다",
      segmentKind: "narration" as const,
    },
    {
      id: "e6",
      order: 6,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "dialogue" as const,
      actor: "character" as const,
      text: "여기 있어.",
      segmentKind: "dialogue" as const,
      speakerName: "캐릭터A",
    },
    {
      id: "e7",
      order: 7,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "action" as const,
        actor: "character" as const,
      text: "둘이 침대 위에서 서로를 껴안고 이마를 맞댄다",
      segmentKind: "narration" as const,
    },
    {
      id: "e8",
      order: 8,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "dialogue" as const,
      actor: "persona" as const,
      text: "…따뜻해.",
      segmentKind: "dialogue" as const,
      speakerName: "캐릭터B",
    },
    {
      id: "e9",
      order: 9,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "action" as const,
      actor: "character" as const,
      text: "캐릭터A가 볼에 가까이 다가와 짧게 키스한다",
      segmentKind: "narration" as const,
    },
    {
      id: "e10",
      order: 10,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "dialogue" as const,
      actor: "character" as const,
      text: "좋아.",
      segmentKind: "dialogue" as const,
      speakerName: "캐릭터A",
    },
    {
      id: "e11",
      order: 11,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "action" as const,
      actor: "persona" as const,
      text: "캐릭터B가 수줍게 눈을 내리깔며 손을 잡는다",
      segmentKind: "narration" as const,
    },
    {
      id: "e12",
      order: 12,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "dialogue" as const,
      actor: "persona" as const,
      text: "…고마워.",
      segmentKind: "dialogue" as const,
      speakerName: "캐릭터B",
    },
    {
      id: "e13",
      order: 13,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "action" as const,
        actor: "character" as const,
      text: "둘이 침대에 기대어 가까이 마주보며 속삭인다",
      segmentKind: "narration" as const,
    },
    {
      id: "e14",
      order: 14,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "dialogue" as const,
      actor: "character" as const,
      text: "잠깐만.",
      segmentKind: "dialogue" as const,
      speakerName: "캐릭터A",
    },
    {
      id: "e15",
      order: 15,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "action" as const,
      actor: "character" as const,
      text: "캐릭터A가 어깨를 감싸 안으며 밀착한다",
      segmentKind: "narration" as const,
    },
    {
      id: "e16",
      order: 16,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "dialogue" as const,
      actor: "persona" as const,
      text: "…응.",
      segmentKind: "dialogue" as const,
      speakerName: "캐릭터B",
    },
    {
      id: "e17",
      order: 17,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "action" as const,
        actor: "character" as const,
      text: "둘이 침대에서 몸을 맞대고 조용히 숨을 고른다",
      segmentKind: "narration" as const,
    },
    {
      id: "e18",
      order: 18,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "dialogue" as const,
      actor: "character" as const,
      text: "…",
      segmentKind: "dialogue" as const,
      speakerName: "캐릭터A",
    },
    {
      id: "e19",
      order: 19,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "action" as const,
      actor: "persona" as const,
      text: "캐릭터B가 뺨을 살짝 기대며 눈을 감는다",
      segmentKind: "narration" as const,
    },
    {
      id: "e20",
      order: 20,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "environment" as const,
      actor: "environment" as const,
      text: "침실 공기가 따뜻하고 애틋하게 가라앉는다",
      segmentKind: "narration" as const,
    },
  ];

  return {
    sceneBackground: "프라이빗 침실",
    atmosphere: "은은하고 애틋한 분위기",
    events,
    castMentions: [],
    heroEventIds: ["e1", "e7", "e9", "e20"],
    heroScene: "침실 침대에서 가까이 마주보는 두 성인",
    panels: [
      {
        index: 1,
        sourceEventIds: ["e1", "e2", "e3", "e4"],
        situation: "침실 침대 가장자리",
        characterAction: "상의를 벗어 어깨가 드러난 채 앉아 있다",
        personaAction: "수줍게 가까이 다가와 볼에 손을 대며 홍조를 띤다",
        dialogue: [
          { speaker: "persona", text: "…괜찮아?", provenance: "source", speakerName: "캐릭터B" },
          { speaker: "character", text: "여기 있어.", provenance: "source", speakerName: "캐릭터A" },
        ],
      },
      {
        index: 2,
        sourceEventIds: ["e5", "e6", "e7", "e8"],
        situation: "침대 위에서 가까이 마주본다",
        characterAction: "손을 잡아당기며 가까이 마주본다",
        personaAction: "따뜻하게 손을 맞잡는다",
        dialogue: [
          { speaker: "persona", text: "…따뜻해.", provenance: "source", speakerName: "캐릭터B" },
          { speaker: "character", text: "좋아.", provenance: "source", speakerName: "캐릭터A" },
        ],
      },
      {
        index: 3,
        sourceEventIds: ["e9", "e10", "e11", "e12", "e13"],
        situation: "침대에서 껴안고 이마를 맞댄다",
        characterAction: "볼에 가까이 다가와 짧게 키스한다",
        personaAction: "수줍게 눈을 내리깔며 손을 잡는다",
        dialogue: [
          { speaker: "persona", text: "…고마워.", provenance: "source", speakerName: "캐릭터B" },
          { speaker: "character", text: "잠깐만.", provenance: "source", speakerName: "캐릭터A" },
        ],
      },
      {
        index: 4,
        sourceEventIds: ["e14", "e15", "e16", "e17", "e18", "e19", "e20"],
        situation: "침대에서 몸을 맞대고 조용히 숨을 고른다",
        characterAction: "어깨를 감싸 안으며 밀착한다",
        personaAction: "뺨을 살짝 기대며 눈을 감는다",
        dialogue: [
          { speaker: "persona", text: "…응.", provenance: "source", speakerName: "캐릭터B" },
          { speaker: "character", text: "…", provenance: "source", speakerName: "캐릭터A" },
        ],
      },
    ],
    recommendedPanelCount: 4,
  };
}

/** P1 — bedroom + bed + close affectionate proximity (no explicit). */
export function p1BedroomCloseProximityPlan(): ScenePlan {
  return {
    sceneBackground: "침실",
    atmosphere: "따뜻한 조명",
    events: [],
    castMentions: [],
    heroEventIds: [],
    heroScene: "침실 침대",
    panels: [
      {
        index: 1,
        sourceEventIds: [],
        situation: "침실 침대",
        personaAction: "침대에 앉아 상대를 바라본다",
        characterAction: "가까이 다가와 애틋하게 마주본다",
        dialogue: [],
      },
      {
        index: 2,
        sourceEventIds: [],
        situation: "침대에서 가까이",
        dialogue: [],
      },
    ],
    recommendedPanelCount: 2,
  };
}

/** P2 — shirtless adult male + bed + coverage. */
export function p2ShirtlessBedCoveragePlan(): ScenePlan {
  return {
    sceneBackground: "침실",
    events: [],
    castMentions: [],
    heroEventIds: [],
    heroScene: "침실 침대",
    panels: [
      {
        index: 1,
        sourceEventIds: [],
        situation: "침대",
        characterAction: "상의를 벗어 어깨가 드러나 있고 이불로 아래를 가린다",
        dialogue: [],
      },
      {
        index: 2,
        sourceEventIds: [],
        situation: "침실",
        dialogue: [],
      },
    ],
    recommendedPanelCount: 2,
  };
}

/** E1 — explicit-origin source projected to safe scene. */
export function e1ExplicitOriginSafePlan(): ScenePlan {
  return {
    sceneBackground: "침실",
    events: [
      {
        id: "x1",
        order: 1,
        sourceMessageId: 1,
        sourceRole: "assistant",
        kind: "action",
        actor: "character",
        text: "둘이 침대에서 겹치며 성관계를 한다",
        segmentKind: "narration",
      },
    ],
    castMentions: [],
    heroEventIds: ["x1"],
    heroScene: "침실 침대",
    panels: [
      {
        index: 1,
        sourceEventIds: ["x1"],
        situation: "침실 침대",
        dialogue: [],
      },
      {
        index: 2,
        sourceEventIds: ["x1"],
        situation: "침대에 누운 자세",
        dialogue: [],
      },
    ],
    recommendedPanelCount: 2,
  };
}

/** Same close-contact category with alternate structured wording (no shared regex vocabulary). */
export function closeContactWordingVariantPlan(): ScenePlan {
  return {
    sceneBackground: "침실",
    atmosphere: "은은한 조명",
    events: [],
    castMentions: [],
    heroEventIds: [],
    heroScene: "침실",
    panels: [
      {
        index: 1,
        sourceEventIds: [],
        situation: "침실",
        personaAction: "상대와 밀착하며 이마를 맞댄다",
        dialogue: [],
      },
      {
        index: 2,
        sourceEventIds: [],
        situation: "침실",
        characterAction: "어깨를 감싸 안는다",
        dialogue: [],
      },
      {
        index: 3,
        sourceEventIds: [],
        situation: "침실",
        personaAction: "손을 맞잡는다",
        dialogue: [],
      },
      {
        index: 4,
        sourceEventIds: [],
        situation: "침실",
        dialogue: [],
      },
    ],
    recommendedPanelCount: 4,
  };
}

/** Shy/tense atmosphere — continuity must not inject contradictory calm mood. */
export function shyTenseAtmospherePlan(): ScenePlan {
  return {
    sceneBackground: "침실",
    atmosphere: "수줍고 긴장된 분위기",
    events: [],
    castMentions: [],
    heroEventIds: [],
    heroScene: "침실 침대",
    panels: [
      {
        index: 1,
        sourceEventIds: [],
        situation: "침실 침대",
        personaAction: "수줍게 시선을 피한다",
        dialogue: [],
      },
      {
        index: 2,
        sourceEventIds: [],
        situation: "침실 침대",
        characterAction: "밀착하며 손을 잡는다",
        dialogue: [],
      },
    ],
    recommendedPanelCount: 2,
  };
}

/** Dialogue filler vs meaningful line — representative selection. */
export function dialogueRepresentativePlan(): ScenePlan {
  return {
    sceneBackground: "카페",
    events: [],
    castMentions: [],
    heroEventIds: [],
    heroScene: "카페",
    panels: [
      {
        index: 1,
        sourceEventIds: [],
        situation: "창가",
        dialogue: [
          { speaker: "persona", text: "…", provenance: "source" },
          { speaker: "character", text: "여기 있어.", provenance: "source" },
        ],
      },
      {
        index: 2,
        sourceEventIds: [],
        situation: "카페",
        dialogue: [],
      },
    ],
    recommendedPanelCount: 2,
  };
}

/** P3 — brief affectionate kiss. */
export function p3BriefKissPlan(): ScenePlan {
  return {
    sceneBackground: "거실",
    events: [],
    castMentions: [],
    heroEventIds: [],
    heroScene: "거실 소파",
    panels: [
      {
        index: 1,
        sourceEventIds: [],
        situation: "소파",
        characterAction: "뺨에 짧게 키스한다",
        dialogue: [],
      },
      {
        index: 2,
        sourceEventIds: [],
        situation: "거실",
        dialogue: [],
      },
    ],
    recommendedPanelCount: 2,
  };
}
