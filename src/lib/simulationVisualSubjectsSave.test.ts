import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCharacterFormBody } from "@/lib/characterFormSave";
import {
  emptySimulationVisualSubjectsDocument,
  materializeSimulationVisualSubjectsForEditor,
  parseSimulationVisualSubjectsJson,
  serializeSimulationVisualSubjectsJson,
} from "@/lib/simulationVisualSubjects";

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
      {
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
        assets,
        simulation_visual_subjects: materialized,
      },
      { id: 1, nickname: "creator", is_adult: 1 }
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
});
