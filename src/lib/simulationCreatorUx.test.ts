import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { SIMULATION_CAST_EXAMPLE } from "@/lib/simulationMode";

const creatorSource = readFileSync(
  new URL("../components/CreateCharacter.tsx", import.meta.url),
  "utf8"
);
const assetGridSource = readFileSync(
  new URL("../components/AssetManagerGrid.tsx", import.meta.url),
  "utf8"
);

describe("simulation creator simplified UX", () => {
  it("uses one character settings field with visible appearance guidance", () => {
    assert.match(creatorSource, />캐릭터 설정 \*<\/label>/);
    assert.match(creatorSource, /이름, 외형, 성격, 말투, 관계,/);
    assert.match(creatorSource, /배경\(과거\)/);
    assert.match(creatorSource, /외형:&apos; \/ &apos;외모:&apos; \//);
    assert.doesNotMatch(creatorSource, /이미지 외형 설정/);
    assert.doesNotMatch(creatorSource, /SimulationVisualSubjectEditor/);
  });

  it("keeps one canonical example with appearance near the top", () => {
    assert.match(SIMULATION_CAST_EXAMPLE, /^\[김태환\]\n외형:/);
    assert.match(SIMULATION_CAST_EXAMPLE, /\n성격:/);
    assert.match(SIMULATION_CAST_EXAMPLE, /\n말투:/);
    assert.match(SIMULATION_CAST_EXAMPLE, /\n관계:/);
    assert.match(SIMULATION_CAST_EXAMPLE, /\n배경:/);
    assert.equal(
      creatorSource.match(/placeholder=\{SIMULATION_CAST_EXAMPLE\}/g)?.length,
      1
    );
  });

  it("demotes rules without changing their form state owner", () => {
    assert.match(creatorSource, /<details className=\{sectionMuted\}>/);
    assert.match(creatorSource, />고급 진행 규칙</);
    assert.match(creatorSource, /보통은 비워도 됩니다/);
    assert.match(creatorSource, /value=\{form\.simulation_rules\}/);
  });

  it("uses AssetManagerGrid as the only simulation assignment gallery", () => {
    assert.match(creatorSource, /visualSubjects=\{/);
    assert.match(assetGridSource, /선택 이미지 일괄 지정/);
    assert.match(assetGridSource, /이미지 인물/);
    assert.match(assetGridSource, /assignAssetsToVisualSubject/);
    assert.match(assetGridSource, /unassignVisualAssets/);
  });
});
