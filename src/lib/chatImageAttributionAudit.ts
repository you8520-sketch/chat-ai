import { compileChatComicPanelSpec, renderChatComicPanelSpecSection } from "@/lib/chatComicPanelSpec";
import { COMIC_PANEL_BENCHMARK_FIXTURES, scenePlanForFixture } from "@/lib/chatComicPanelSpec.fixtures";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  isMalformedAttributionText,
  type ScenePlan,
} from "@/lib/chatImageScenePlan";

export type AttributionAuditField = {
  fixtureId: string;
  field: string;
  text: string;
};

export function collectMalformedAttributionFields(
  plan: ScenePlan,
  opts: {
    fixtureId: string;
    personaName: string;
    characterName: string;
  }
): AttributionAuditField[] {
  const hits: AttributionAuditField[] = [];
  const pushIfMalformed = (field: string, text: string | undefined) => {
    const value = String(text ?? "").trim();
    if (!value) return;
    if (isMalformedAttributionText(value)) {
      hits.push({ fixtureId: opts.fixtureId, field, text: value });
    }
  };

  pushIfMalformed("heroScene", plan.heroScene);
  for (const panel of plan.panels) {
    pushIfMalformed(`panel${panel.index}.situation`, panel.situation);
    pushIfMalformed(`panel${panel.index}.personaAction`, panel.personaAction);
    pushIfMalformed(`panel${panel.index}.characterAction`, panel.characterAction);
  }

  const spec = compileChatComicPanelSpec({
    plan,
    personaName: opts.personaName,
    characterName: opts.characterName,
  });
  const rendered = renderChatComicPanelSpecSection(spec);
  for (const line of rendered.split("\n")) {
    const actionMatch = line.match(/^A action:\s*(.+)$/);
    const bActionMatch = line.match(/^B action:\s*(.+)$/);
    const actingMatch = line.match(/^Acting:\s*(.+)$/);
    const expressionsMatch = line.match(/^Expressions:\s*(.+)$/);
    if (actionMatch) pushIfMalformed("compiler.AAction", actionMatch[1]);
    if (bActionMatch) pushIfMalformed("compiler.BAction", bActionMatch[1]);
    if (actingMatch) pushIfMalformed("compiler.Acting", actingMatch[1]);
    if (expressionsMatch) pushIfMalformed("compiler.Expressions", expressionsMatch[1]);
  }

  return hits;
}

export function countMalformedAttributionAcrossFixtures(
  fixtures: ReadonlyArray<{
    id: string;
    messages: ReturnType<typeof buildSceneSourceMessages>;
    panelCount: 2 | 3 | 4;
    personaName: string;
    characterName: string;
  }>
): number {
  let count = 0;
  for (const fixture of fixtures) {
    const plan = buildDeterministicScenePlan(fixture.messages, fixture.panelCount);
    count += collectMalformedAttributionFields(plan, {
      fixtureId: fixture.id,
      personaName: fixture.personaName,
      characterName: fixture.characterName,
    }).length;
  }
  return count;
}

export function countMalformedAttributionBenchmarkCorpus(): number {
  return countMalformedAttributionAcrossFixtures(
    COMIC_PANEL_BENCHMARK_FIXTURES.map((fixture) => ({
      id: fixture.id,
      messages: fixture.messages,
      panelCount: fixture.panelCount,
      personaName: fixture.expectedCast.persona,
      characterName: fixture.expectedCast.character,
    }))
  );
}

export function countMalformedAttributionLdFixtures(): number {
  const ATTRIBUTION_MATRIX = [
    {
      id: "ATTR-A",
      content: '태현이 렌의 손목을 붙잡고 "가지 마."라고 말했다.',
      personaName: "렌",
      characterName: "태현",
    },
    {
      id: "ATTR-B",
      content: '지훈이 눈을 크게 뜨며 "진짜?"라고 되물었다.',
      personaName: "유저",
      characterName: "지훈",
    },
    {
      id: "ATTR-C",
      content: '도윤이 작게 "…고마워."라고 말한다.',
      personaName: "유저",
      characterName: "도윤",
    },
    {
      id: "ATTR-D",
      content: '현우가 황급히 돌아서며 "아, 미안!"이라고 외친다.',
      personaName: "유저",
      characterName: "현우",
    },
    {
      id: "ATTR-E",
      content: '그가 고개를 숙이며 "미안해."라고 속삭였다.',
      personaName: "유저",
      characterName: "캐릭터",
    },
    {
      id: "ATTR-F",
      content: '그녀는 "왜?"라고 물었다.',
      personaName: "유저",
      characterName: "캐릭터",
    },
    {
      id: "ATTR-G",
      content: '"괜찮아."라고 답했다.',
      personaName: "유저",
      characterName: "캐릭터",
    },
    {
      id: "ATTR-H",
      content: '"알았어."라고 말하며 손을 뻗었다.',
      personaName: "유저",
      characterName: "캐릭터",
    },
    {
      id: "ATTR-I",
      content: '"알았어."라고 말했다. 그는 문을 닫았다.',
      personaName: "유저",
      characterName: "캐릭터",
    },
    {
      id: "ATTR-J",
      content: '그는 "첫째."라고 말하고 잠시 멈췄다가 "둘째."라고 덧붙였다.',
      personaName: "유저",
      characterName: "캐릭터",
    },
  ];

  return countMalformedAttributionAcrossFixtures(
    ATTRIBUTION_MATRIX.map((fixture) => ({
      id: fixture.id,
      messages: buildSceneSourceMessages([{ id: 1, role: "assistant", content: fixture.content }]),
      panelCount: 2 as const,
      personaName: fixture.personaName,
      characterName: fixture.characterName,
    }))
  );
}

export function scenePlanForFixtureId(fixtureId: string): ScenePlan {
  const fixture = COMIC_PANEL_BENCHMARK_FIXTURES.find((row) => row.id === fixtureId);
  if (!fixture) throw new Error(`fixture ${fixtureId} missing`);
  return scenePlanForFixture(fixture);
}
