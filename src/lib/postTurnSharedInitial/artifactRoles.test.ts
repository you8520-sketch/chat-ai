import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  artifactRolesToEpisodicFacts,
  hasArtifactLifecycleCandidate,
  mergeArtifactRolesIntoEpisodic,
  parseArtifactRolesSection,
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

const ROLES = [
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
    const facts = artifactRolesToEpisodicFacts(ROLES);
    assert.equal(facts.length, 2);
    assert.deepEqual(
      facts.map((f) => f.attribute),
      ["created_item", "took_item"]
    );
    assert.equal(facts[0]?.subject, "oscar");
    assert.equal(facts[0]?.value, "silver_ring");
    assert.equal(facts[0]?.evidence?.source_quote, "은빛 반지를 만들었다.");
    assert.match(facts[1]?.fact_text ?? "", /같은 물건인지는 확인되지 않는다/);
  });

  it("puts role facts first and caps the merged episodic section at five", () => {
    const episodic = {
      present: true,
      valid: true,
      facts: [
        {
          category: "relationship" as const,
          subject: "jay_oscar",
          attribute: "proposal",
          value: "accepted",
          importance: "important" as const,
          fact_text: "오스카가 프러포즈했고 제이가 수락했다.",
          evidence_type: "explicit_scene_event" as const,
          evidence: { source_role: "assistant" as const, source_quote: "제이가 수락했다." },
        },
      ],
    };
    const merged = mergeArtifactRolesIntoEpisodic(episodic, {
      present: true,
      valid: true,
      roles: ROLES,
    });
    assert.ok(merged);
    assert.equal(merged.facts.length, 3);
    assert.equal(merged.facts[0]?.attribute, "created_item");
    assert.equal(merged.facts[1]?.attribute, "took_item");
    assert.equal(merged.facts[2]?.attribute, "proposal");
  });

  it("can persist role facts even when the free-form episodic section failed", () => {
    const merged = mergeArtifactRolesIntoEpisodic(
      { present: true, valid: false, facts: [] },
      { present: true, valid: true, roles: ROLES }
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
