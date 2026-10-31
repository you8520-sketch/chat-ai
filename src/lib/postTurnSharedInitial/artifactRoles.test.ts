import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  artifactRolesToEpisodicFacts,
  hasArtifactLifecycleCandidate,
  mergeArtifactRolesIntoEpisodic,
  parseArtifactRolesSection,
  validateArtifactRoleQuote,
  type ArtifactRoleEntry,
} from "./artifactRoles";
import { buildPostTurnSharedInitialSystem } from "./prompt";
import { buildPostTurnSharedInitialJsonSchema } from "./schema";
import { parsePostTurnSharedInitialResponse } from "./parse";
import type { PostTurnSharedInitialInput } from "./types";

function artifactInput(overrides: Partial<PostTurnSharedInitialInput> = {}): PostTurnSharedInitialInput {
  return {
    mode: "relationship_only",
    charName: "오스카",
    personaName: "제이",
    userMessage: "[OOC: 새 에피소드]",
    assistantProse: "오스카는 수류탄 안전핀으로 반지를 만들었다.",
    primaryModelId: "gpt-6-luna",
    includeSuggestions: false,
    includeRelationship: false,
    includeEpisodic: true,
    includeArtifactRoles: true,
    activePromises: [],
    ...overrides,
  };
}

const SIMPLE_ROLES = [
  {
    role: "created" as const,
    actor: "오스카",
    actorKey: "oscar",
    item: "은빛 반지",
    itemKey: "silver_ring",
    quote: "은빛 반지를 만들었다.",
    sameObject: "not_applicable" as const,
  },
  {
    role: "took" as const,
    actor: "제이",
    actorKey: "jay",
    item: "은빛 반지",
    itemKey: "silver_ring",
    quote: "제이는 반지를 집어 들었다.",
    sameObject: "unconfirmed" as const,
  },
];

/**
 * T80-shaped prose. The presentation quote is a pronoun sentence ("그는"),
 * and the ring is revealed in the following sentence; both are required for a
 * correct presentation fact.
 */
const T80_PROSE = [
  "불꽃이 쏟아져 내리는 한가운데서, 오스카는 제이의 발치에 털썩 무릎을 꿇었다. 하얀 턱시도의 바짓단이 더러워지는 것 따위는 안중에도 없었다. 그는 품속에서 작은 벨벳 상자를 꺼내어 조심스럽게 열었다.",
  "상자 안에는 다이아몬드 반지 대신, 수류탄의 안전 핀을 정교하게 가공하여 만든 은빛 반지가 반짝이고 있었다.",
  "제이가 천천히 손을 뻗어, 오스카가 들고 있던 수류탄 핀 반지를 집어 들었다. 제이는 여유로운 동작으로 자신의 왼쪽 네 번째 손가락에 반지를 끼워 넣었다.",
  "다음 날 아침, 오스카의 손가락에는 그가 직접 만든 수류탄 핀 반지가 끼워져 있었다.",
].join("\n\n");

const T80_ROLES: ArtifactRoleEntry[] = [
  {
    role: "created",
    actor: "오스카 피츠로이",
    actorKey: "oscar_fitzroy",
    item: "수류탄 핀 반지",
    itemKey: "grenade_pin_ring",
    quote:
      "상자 안에는 다이아몬드 반지 대신, 수류탄의 안전 핀을 정교하게 가공하여 만든 은빛 반지가 반짝이고 있었다.",
    sameObject: "not_applicable",
  },
  {
    role: "presented",
    actor: "오스카 피츠로이",
    actorKey: "oscar_fitzroy",
    item: "수류탄 핀 반지",
    itemKey: "grenade_pin_ring",
    quote: "그는 품속에서 작은 벨벳 상자를 꺼내어 조심스럽게 열었다.",
    sameObject: "not_applicable",
  },
  {
    role: "took",
    actor: "제이",
    actorKey: "jay",
    item: "수류탄 핀 반지",
    itemKey: "grenade_pin_ring",
    quote: "제이가 천천히 손을 뻗어, 오스카가 들고 있던 수류탄 핀 반지를 집어 들었다.",
    sameObject: "not_applicable",
  },
  {
    role: "wore",
    actor: "제이",
    actorKey: "jay",
    item: "수류탄 핀 반지",
    itemKey: "grenade_pin_ring",
    quote: "제이는 여유로운 동작으로 자신의 왼쪽 네 번째 손가락에 반지를 끼워 넣었다.",
    sameObject: "not_applicable",
  },
  {
    role: "later_wore",
    actor: "오스카 피츠로이",
    actorKey: "oscar_fitzroy",
    item: "수류탄 핀 반지",
    itemKey: "grenade_pin_ring",
    quote: "다음 날 아침, 오스카의 손가락에는 그가 직접 만든 수류탄 핀 반지가 끼워져 있었다.",
    sameObject: "unconfirmed",
  },
];

function episodicFact(
  overrides: Partial<{
    category: string;
    subject: string;
    attribute: string;
    value: string;
    importance: string;
    fact_text: string;
    source_quote: string;
  }>
) {
  return {
    category: (overrides.category ?? "relationship") as never,
    subject: overrides.subject ?? "oscar_fitzroy_jay",
    attribute: overrides.attribute ?? "proposal",
    value: overrides.value ?? "public",
    importance: (overrides.importance ?? "important") as never,
    fact_text: overrides.fact_text ?? "오스카가 공개 프러포즈를 했다.",
    evidence_type: "explicit_scene_event" as never,
    evidence: {
      source_role: "assistant" as const,
      source_quote: overrides.source_quote ?? "Will you marry me, Master?",
    },
  };
}

describe("artifact role lifecycle", () => {
  it("locates only an artifact + role-action turn", () => {
    assert.equal(
      hasArtifactLifecycleCandidate("오스카는 수류탄 안전핀으로 반지를 만들었다."),
      true
    );
    assert.equal(hasArtifactLifecycleCandidate("오스카는 조용히 앉아 있었다."), false);
    assert.equal(hasArtifactLifecycleCandidate("상자가 책상 위에 있었다."), false);
  });

  it("parses valid roles and skips a malformed entry", () => {
    const parsed = parseArtifactRolesSection([
      {
        role: "created",
        actor: "오스카",
        actor_key: "oscar",
        item: "은빛 반지",
        item_key: "silver_ring",
        quote: "은빛 반지를 만들었다.",
        same_object: "not_applicable",
      },
      {
        role: "wore",
        actor: "제이",
        actor_key: "jay",
        item: "은빛 반지",
        item_key: "silver_ring",
        quote: "짧",
        same_object: "unconfirmed",
      },
    ]);
    assert.equal(parsed.present, true);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.roles.length, 1);
    assert.equal(parsed.roles[0]?.role, "created");
  });

  it("maps roles to canonical episodic facts with the quote and uncertainty", () => {
    const facts = artifactRolesToEpisodicFacts(SIMPLE_ROLES);
    assert.equal(facts.length, 2);
    assert.deepEqual(
      facts.map((f) => f.attribute),
      ["created_item", "took_item"]
    );
    assert.equal(facts[0]?.subject, "oscar");
    assert.equal(facts[0]?.value, "silver_ring");
    assert.equal(facts[0]?.evidence?.source_quote, "은빛 반지를 만들었다.");
    // Ambiguity belongs to a later-scene wearer, not to the earlier take.
    assert.doesNotMatch(facts[1]?.fact_text ?? "", /같은 물건인지는 확인되지 않는다/);
  });

  it("keeps all five T80 roles with the real quotes and uncertainty", () => {
    const facts = artifactRolesToEpisodicFacts(T80_ROLES, T80_PROSE);
    assert.deepEqual(
      facts.map((f) => f.attribute),
      ["created_item", "presented_item", "took_item", "wearing", "later_wearing"]
    );
    assert.deepEqual(
      facts.map((f) => f.value),
      [
        "grenade_pin_ring",
        "grenade_pin_ring",
        "grenade_pin_ring",
        "grenade_pin_ring",
        "grenade_pin_ring",
      ]
    );
    assert.match(
      facts[4]?.fact_text ?? "",
      /같은 물건인지는 확인되지 않는다/
    );
  });

  it("rejects a real quote attributed to the wrong actor", () => {
    const wrongActor: ArtifactRoleEntry = {
      ...T80_ROLES[2]!,
      actor: "오스카 피츠로이",
      actorKey: "oscar_fitzroy",
    };
    const verdict = validateArtifactRoleQuote(wrongActor, T80_PROSE, [
      "오스카 피츠로이",
      "오스카",
      "제이",
    ]);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "actor_mismatch");

    const wrongActorRoles = T80_ROLES.map((role) =>
      role.role === "took" ? wrongActor : role
    );
    const facts = artifactRolesToEpisodicFacts(wrongActorRoles, T80_PROSE);
    assert.equal(facts.length, 4);
    assert.ok(!facts.some((fact) => fact.attribute === "took_item"));
  });

  it("rejects a pronoun whose antecedent is ambiguous", () => {
    const prose = "오스카와 제이는 서로를 바라보았다. 그는 은빛 반지를 집어 들었다.";
    const entry: ArtifactRoleEntry = {
      role: "took",
      actor: "오스카",
      actorKey: "oscar",
      item: "은빛 반지",
      itemKey: "silver_ring",
      quote: "그는 은빛 반지를 집어 들었다.",
      sameObject: "not_applicable",
    };
    const verdict = validateArtifactRoleQuote(entry, prose, ["오스카", "제이"]);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "ambiguous_pronoun");
  });

  it("resolves the T80 presentation pronoun to the local subject", () => {
    const verdict = validateArtifactRoleQuote(T80_ROLES[1]!, T80_PROSE, [
      "오스카 피츠로이",
      "오스카",
      "제이",
    ]);
    assert.equal(verdict.ok, true);
  });

  it("accepts a two-sentence presentation quote across a paragraph break", () => {
    const entry: ArtifactRoleEntry = {
      ...T80_ROLES[1]!,
      quote: `${T80_ROLES[1]!.quote} ${T80_ROLES[0]!.quote}`,
    };
    const verdict = validateArtifactRoleQuote(entry, T80_PROSE, [
      "오스카 피츠로이",
      "오스카",
      "제이",
    ]);
    assert.equal(verdict.ok, true);
  });

  it("rejects a box opening that never reveals the artifact", () => {
    const prose = "오스카는 벨벳 상자를 열었다. 안에는 편지 한 장이 들어 있었다.";
    const entry: ArtifactRoleEntry = {
      role: "presented",
      actor: "오스카",
      actorKey: "oscar",
      item: "은빛 반지",
      itemKey: "silver_ring",
      quote: "오스카는 벨벳 상자를 열었다.",
      sameObject: "not_applicable",
    };
    const verdict = validateArtifactRoleQuote(entry, prose, ["오스카"]);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "item_missing");
  });

  it("rejects the box itself as the artifact", () => {
    const prose = "오스카는 벨벳 상자를 열었다. 안에는 은빛 반지가 반짝이고 있었다.";
    const entry: ArtifactRoleEntry = {
      role: "presented",
      actor: "오스카",
      actorKey: "oscar",
      item: "벨벳 상자",
      itemKey: "velvet_box",
      quote: "오스카는 벨벳 상자를 열었다.",
      sameObject: "not_applicable",
    };
    const verdict = validateArtifactRoleQuote(entry, prose, ["오스카"]);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "container_not_artifact");
  });

  it("preserves the five roles plus the proposal while dropping unsupported acceptance", () => {
    const episodic = {
      present: true,
      valid: true,
      facts: [
        episodicFact({
          category: "character",
          subject: "oscar_fitzroy",
          attribute: "proposal_target",
          value: "jay",
          fact_text: "오스카 피츠로이는 공개 프러포즈에서 제이에게 결혼해 달라고 청했다.",
          source_quote: "Will you do me the honor of owning me forever? Will you marry me, Master?",
        }),
        episodicFact({
          category: "item",
          subject: "grenade_pin_ring",
          attribute: "material_origin",
          value: "grenade_safety_pin",
          importance: "normal",
          fact_text: "오스카가 수류탄의 안전핀을 가공해 은빛 반지를 만들었다.",
          source_quote:
            "상자 안에는 다이아몬드 반지 대신, 수류탄의 안전 핀을 정교하게 가공하여 만든 은빛 반지가 반짝이고 있었다.",
        }),
        episodicFact({
          category: "relationship",
          attribute: "proposal_outcome",
          value: "accepted",
          fact_text: "제이는 오스카의 프러포즈를 받아들이고 반지를 손가락에 끼웠다.",
          source_quote:
            "제이는 여유로운 동작으로 자신의 왼쪽 네 번째 손가락에 반지를 끼워 넣었다.",
        }),
        episodicFact({
          category: "relationship",
          attribute: "engagement",
          value: "public_proposal",
          fact_text: "제이는 수락하며 오스카가 만든 반지를 손가락에 끼웠다.",
          source_quote:
            "제이는 여유로운 동작으로 자신의 왼쪽 네 번째 손가락에 반지를 끼워 넣었다.",
        }),
      ],
    };
    const merged = mergeArtifactRolesIntoEpisodic(
      episodic,
      { present: true, valid: true, roles: T80_ROLES },
      T80_PROSE
    );
    assert.ok(merged);
    assert.equal(merged.factLimit, 7);
    assert.equal(merged.facts.length, 6);
    assert.deepEqual(
      merged.facts.map((f) => f.attribute),
      [
        "created_item",
        "presented_item",
        "took_item",
        "wearing",
        "later_wearing",
        "proposal_target",
      ]
    );
    assert.ok(!merged.facts.some((f) => f.attribute === "proposal_outcome"));
    assert.ok(!merged.facts.some((f) => f.attribute === "material_origin"));
    assert.ok(!merged.facts.some((f) => f.attribute === "engagement"));
  });

  it("drops a proposal claim whose quote is only a venue description", () => {
    const prose =
      "오스카는 은빛 반지를 만들었다. 그곳은 평소의 삭막한 군사 시설이 아니었다.";
    const episodic = {
      present: true,
      valid: true,
      facts: [
        episodicFact({
          category: "setting",
          attribute: "proposal_venue",
          value: "oscar_public_proposal",
          fact_text: "오스카는 격납고에서 공개 프러포즈를 했다.",
          source_quote: "그곳은 평소의 삭막한 군사 시설이 아니었다.",
        }),
      ],
    };
    const merged = mergeArtifactRolesIntoEpisodic(
      episodic,
      {
        present: true,
        valid: true,
        roles: [
          {
            role: "created",
            actor: "오스카",
            actorKey: "oscar",
            item: "은빛 반지",
            itemKey: "silver_ring",
            quote: "은빛 반지를 만들었다.",
            sameObject: "not_applicable",
          },
        ],
      },
      prose,
      ["오스카"]
    );
    assert.ok(merged);
    assert.deepEqual(
      merged.facts.map((fact) => fact.attribute),
      ["created_item"]
    );
  });

  it("keeps an acceptance that the quote explicitly states", () => {
    const prose =
      "오스카는 은빛 반지를 만들었다. 제이는 프러포즈를 수락했다.";
    const episodic = {
      present: true,
      valid: true,
      facts: [
        episodicFact({
          attribute: "proposal_outcome",
          value: "accepted",
          fact_text: "제이는 오스카의 프러포즈를 수락했다.",
          source_quote: "제이는 프러포즈를 수락했다.",
        }),
      ],
    };
    const merged = mergeArtifactRolesIntoEpisodic(
      episodic,
      {
        present: true,
        valid: true,
        roles: [
          {
            role: "created",
            actor: "오스카",
            actorKey: "oscar",
            item: "은빛 반지",
            itemKey: "silver_ring",
            quote: "은빛 반지를 만들었다.",
            sameObject: "not_applicable",
          },
        ],
      },
      prose,
      ["오스카", "제이"]
    );
    assert.ok(merged);
    assert.deepEqual(
      merged.facts.map((fact) => fact.attribute),
      ["created_item", "proposal_outcome"]
    );
  });

  it("keeps two important free-form events after the five roles and caps at seven", () => {
    const episodic = {
      present: true,
      valid: true,
      facts: [
        episodicFact({
          attribute: "proposal_target",
          value: "jay",
          fact_text: "오스카가 제이에게 프러포즈했다.",
          source_quote: "Will you marry me?",
        }),
        episodicFact({
          attribute: "relationship_progress",
          value: "trust",
          fact_text: "두 사람은 서로를 신뢰하기로 했다.",
          source_quote: "서로를 믿기로 했다.",
        }),
        episodicFact({
          attribute: "minor_item_note",
          value: "glove",
          importance: "normal",
          category: "item",
          fact_text: "제이의 장갑이 찢어졌다.",
          source_quote: "장갑이 찢어졌다.",
        }),
        episodicFact({
          attribute: "minor_scene_note",
          value: "smoke",
          importance: "normal",
          category: "setting",
          fact_text: "격납고에 연기가 가득했다.",
          source_quote: "연기가 가득했다.",
        }),
      ],
    };
    const merged = mergeArtifactRolesIntoEpisodic(
      episodic,
      { present: true, valid: true, roles: T80_ROLES },
      T80_PROSE
    );
    assert.ok(merged);
    assert.equal(merged.facts.length, 7);
    assert.deepEqual(
      merged.facts.slice(5).map((f) => f.attribute),
      ["proposal_target", "relationship_progress"]
    );
  });

  it("puts role facts first and caps the merged episodic section at seven", () => {
    const episodic = {
      present: true,
      valid: true,
      facts: [
        episodicFact({
          attribute: "proposal",
          value: "accepted",
          fact_text: "오스카가 프러포즈했고 제이가 수락했다.",
          source_quote: "제이가 수락했다.",
        }),
      ],
    };
    const merged = mergeArtifactRolesIntoEpisodic(episodic, {
      present: true,
      valid: true,
      roles: SIMPLE_ROLES,
    });
    assert.ok(merged);
    assert.equal(merged.facts.length, 3);
    assert.equal(merged.facts[0]?.attribute, "created_item");
    assert.equal(merged.facts[1]?.attribute, "took_item");
    assert.equal(merged.facts[2]?.attribute, "proposal");
  });

  it("downgrades a later-wearer identity claim without an explicit same-object quote", () => {
    const facts = artifactRolesToEpisodicFacts([
      {
        role: "later_wore",
        actor: "오스카",
        actorKey: "oscar",
        item: "은빛 반지",
        itemKey: "silver_ring",
        quote: "다음 날 오스카는 반지를 끼고 있었다.",
        sameObject: "confirmed",
      },
    ]);
    assert.match(facts[0]?.fact_text ?? "", /같은 물건인지는 확인되지 않는다/);
  });

  it("can persist role facts even when the free-form episodic section failed", () => {
    const merged = mergeArtifactRolesIntoEpisodic(
      { present: true, valid: false, facts: [] },
      { present: true, valid: true, roles: SIMPLE_ROLES }
    );
    assert.ok(merged);
    assert.equal(merged.valid, true);
    assert.equal(merged.facts.length, 2);
  });

  it("requests the artifact section only when the flag is on", () => {
    const on = buildPostTurnSharedInitialJsonSchema(artifactInput());
    const off = buildPostTurnSharedInitialJsonSchema(artifactInput({ includeArtifactRoles: false }));
    assert.ok((on.required as string[]).includes("artifactRoles"));
    assert.ok((on.properties as Record<string, unknown>).artifactRoles);
    assert.ok(!(off.required as string[]).includes("artifactRoles"));
    assert.equal((off.properties as Record<string, unknown>).artifactRoles, undefined);
  });

  it("adds the artifact prompt rules only when requested", () => {
    assert.match(
      buildPostTurnSharedInitialSystem(artifactInput()),
      /ARTIFACT ROLES section/
    );
    assert.doesNotMatch(
      buildPostTurnSharedInitialSystem(artifactInput({ includeArtifactRoles: false })),
      /ARTIFACT ROLES section/
    );
  });

  it("parses the artifact section independently from episodic", () => {
    const parsed = parsePostTurnSharedInitialResponse(
      JSON.stringify({
        artifactRoles: [
          {
            role: "created",
            actor: "오스카",
            actor_key: "oscar",
            item: "은빛 반지",
            item_key: "silver_ring",
            quote: "은빛 반지를 만들었다.",
            same_object: "not_applicable",
          },
        ],
        episodic: { extracted_facts: [] },
      }),
      artifactInput()
    );
    assert.equal(parsed.artifactRoles.valid, true);
    assert.equal(parsed.artifactRoles.roles.length, 1);
    assert.equal(parsed.artifactRoles.roles[0]?.role, "created");
  });
});
