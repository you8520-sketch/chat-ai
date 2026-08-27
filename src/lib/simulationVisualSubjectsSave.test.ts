import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCharacterFormBody } from "@/lib/characterFormSave";
import {
  createSimulationVisualSubjectKey,
  emptySimulationVisualSubjectsDocument,
  materializeSimulationVisualSubjectsForEditor,
  parseSimulationVisualSubjectsJson,
  serializeSimulationVisualSubjectsJson,
} from "@/lib/simulationVisualSubjects";

const adultCreator = { id: 1, nickname: "creator", is_adult: 1 as const };

function simulationBody(overrides: Record<string, unknown> = {}) {
  return {
    content_kind: "simulation",
    name: "생존 시뮬레이션",
    tagline: "테스트 시뮬레이션",
    description: "설명",
    greeting: "시작합니다.",
    simulation_cast: `[이현]\n- 역할: 생존자\n${"상황 설정 ".repeat(80)}`,
    simulation_rules: "일관된 규칙을 유지한다.",
    world: "폐허가 된 도시의 생존 세계관. ".repeat(100),
    genres: ["시뮬레이션"],
    nsfw: false,
    participant_min_age: 20,
    ...overrides,
  };
}

describe("simulation visual subjects save boundary", () => {
  it("persists a materialized grouped-upload subject without appearance edits", () => {
    const materialized = materializeSimulationVisualSubjectsForEditor({
      configuredNames: ["이현"],
      document: emptySimulationVisualSubjectsDocument(),
    });
    const key = materialized.subjects[0]!.subjectKey;
    const assets = [
      { url: "/uploads/a.webp", tag: "표정 A", visualSubjectKey: key },
      { url: "/uploads/b.webp", tag: "표정 B", visualSubjectKey: key },
    ];

    const parsed = parseCharacterFormBody(
      simulationBody({
        assets,
        simulation_visual_subjects: materialized,
      }),
      adultCreator
    );

    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
    if (!parsed.ok) throw new Error(parsed.error);
    const saved = parseSimulationVisualSubjectsJson(parsed.data.simulationVisualSubjectsJson);
    assert.equal(saved.subjects[0]?.subjectKey, key);
    assert.equal(saved.subjects[0]?.savedAppearance, "");
    assert.equal(saved.subjects[0]?.representativeAssetUrl, null);
    assert.equal(parsed.data.assets.length, 2);
    assert.equal(
      parsed.data.assets.every((asset) => asset.visualSubjectKey === key),
      true
    );

    const reloaded = parseSimulationVisualSubjectsJson(
      serializeSimulationVisualSubjectsJson(saved)
    );
    assert.deepEqual(reloaded, saved);
  });

  it("uses trusted options for existing key authority and ignores body stored fields", () => {
    const storedKey = createSimulationVisualSubjectKey();
    const forgedKey = createSimulationVisualSubjectKey();
    const stored = {
      version: 1 as const,
      subjects: [
        {
          subjectKey: storedKey,
          name: "이현",
          savedAppearance: "검은 머리",
          representativeAssetUrl: null,
          sourceCharacterId: null,
        },
      ],
    };
    const forged = {
      version: 1 as const,
      subjects: [
        {
          subjectKey: forgedKey,
          name: "이현",
          savedAppearance: "회색 눈",
          representativeAssetUrl: null,
          sourceCharacterId: null,
        },
      ],
    };
    const parsed = parseCharacterFormBody(
      simulationBody({
        assets: [{ url: "/uploads/a.webp", tag: "표정" }],
        simulation_visual_subjects: forged,
        _stored_simulation_visual_subjects_json:
          serializeSimulationVisualSubjectsJson(forged),
        stored_simulation_visual_subjects_json:
          serializeSimulationVisualSubjectsJson(forged),
      }),
      adultCreator,
      {
        requireStructuredAge: false,
        trustedStoredSimulationVisualSubjectsJson:
          serializeSimulationVisualSubjectsJson(stored),
      }
    );

    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
    if (!parsed.ok) throw new Error(parsed.error);
    const saved = parseSimulationVisualSubjectsJson(parsed.data.simulationVisualSubjectsJson);
    assert.equal(saved.subjects[0]?.subjectKey, storedKey);
    assert.equal(saved.subjects[0]?.savedAppearance, "회색 눈");
  });

  it("ignores fake stored orphan fields on create", () => {
    const activeKey = createSimulationVisualSubjectKey();
    const fakeStored = {
      version: 1 as const,
      subjects: [
        {
          subjectKey: createSimulationVisualSubjectKey(),
          name: "생존 시뮬레이션",
          savedAppearance: "가짜 제목",
          representativeAssetUrl: null,
          sourceCharacterId: null,
        },
        {
          subjectKey: createSimulationVisualSubjectKey(),
          name: "가짜인물",
          savedAppearance: "가짜 외형",
          representativeAssetUrl: null,
          sourceCharacterId: null,
        },
      ],
    };
    const submitted = {
      version: 1 as const,
      subjects: [
        {
          subjectKey: activeKey,
          name: "이현",
          savedAppearance: "",
          representativeAssetUrl: null,
          sourceCharacterId: null,
        },
      ],
    };
    const parsed = parseCharacterFormBody(
      simulationBody({
        assets: [
          {
            url: "/uploads/a.webp",
            tag: "표정",
            visualSubjectKey: activeKey,
          },
        ],
        simulation_visual_subjects: submitted,
        _stored_simulation_visual_subjects_json:
          serializeSimulationVisualSubjectsJson(fakeStored),
        stored_simulation_visual_subjects_json:
          serializeSimulationVisualSubjectsJson(fakeStored),
      }),
      adultCreator
    );

    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
    if (!parsed.ok) throw new Error(parsed.error);
    const saved = parseSimulationVisualSubjectsJson(parsed.data.simulationVisualSubjectsJson);
    assert.deepEqual(saved.subjects.map((subject) => subject.name), ["이현"]);
    assert.equal(saved.subjects[0]?.subjectKey, activeKey);
  });
});
