export const CONTENT_KIND_VALUES = ["character", "simulation"] as const;
export type ContentKind = (typeof CONTENT_KIND_VALUES)[number];

export type SimulationImportSnapshot = {
  characterId: number;
  name: string;
  creatorId: number | null;
  creatorName: string;
  systemPrompt: string;
  world: string;
  exampleDialog: string;
};

export const SIMULATION_CAST_EXAMPLE = `[서윤]
- 역할: 폐쇄된 연구소의 경비 책임자
- 성격: 냉정하고 현실적이지만 동료를 버리지 못한다.
- 말투: 짧은 반말. 위기에는 명령조가 된다.
- 목표: 생존자들을 지상으로 탈출시킨다.
- 비밀: 사고 발생 전 경보를 무시한 적이 있다.

[도진]
- 역할: 원인을 조사하는 감염학자
- 성격: 호기심이 강하고 위험 앞에서도 관찰을 멈추지 않는다.
- 말투: 평소 존댓말. 흥분하면 전문용어가 늘어난다.
- 목표: 감염원을 확보하고 치료법의 단서를 찾는다.
- 비밀: 연구소의 비공개 실험에 참여했다.

[관리 AI 라움]
- 역할: 연구소 시설과 봉쇄 절차를 통제하는 인공지능
- 성격·말투: 정중하고 감정이 없는 안내 방송체
- 목표: 격리 규정을 어떤 희생을 치르더라도 유지한다.`;

export function parseContentKind(value: unknown): ContentKind {
  return value === "simulation" ? "simulation" : "character";
}

/** Best-effort suggestions only. Creators may keep using completely free-form text. */
export function extractSimulationCastNames(cast: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const name = raw.replace(/[*_`#\[\]]/g, "").trim().slice(0, 80);
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    names.push(name);
  };
  for (const line of cast.split(/\r?\n/)) {
    const trimmed = line.trim();
    const match = trimmed.match(/^\[([^\]\r\n]{1,80})\]$/)
      ?? trimmed.match(/^#{1,4}\s+(.{1,80})$/)
      ?? trimmed.match(/^(?:이름|캐릭터명|인물명)\s*[:：]\s*(.{1,80})$/);
    if (match?.[1]) add(match[1]);
    if (names.length >= 24) break;
  }
  return names;
}

export function buildSimulationSystemPrompt(input: {
  cast: string;
  rules?: string;
  imports?: SimulationImportSnapshot[];
}): string {
  const cast = input.cast.trim();
  const rules = input.rules?.trim() ?? "";
  return [
    `[SIMULATION CAST — CREATOR CANON]\n${cast}`,
    ...(input.imports ?? []).map(
      (item) =>
        `[IMPORTED CHARACTER — ${item.name} / creator: ${item.creatorName}]\n${[
          item.systemPrompt,
          item.world ? `[원본 세계관 참고]\n${item.world}` : "",
          item.exampleDialog ? `[원본 말투·대사 예시]\n${item.exampleDialog}` : "",
        ].filter(Boolean).join("\n\n")}`,
    ),
    rules ? `[SIMULATION-SPECIFIC RULES]\n${rules}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Single runtime owner for ensemble identity. The creator canon itself stays in
 * the normal character-setting cache; this small block only changes how it is
 * interpreted and does not grant control over the user persona.
 */
export function buildSimulationModeBlock(simulationTitle: string): string {
  return `[SIMULATION MODE — ENSEMBLE CAST]
「${simulationTitle}」은 인물 이름이 아니라 시뮬레이션 제목이다. 이 제목으로 말하거나 행동하지 않는다.
[AI_CAST] = 제작자가 [SIMULATION CAST — CREATOR CANON]에 작성한 모든 캐릭터와, 세계관에 필요한 NPC·세력.
AI는 [AI_CAST] 각자의 성격·말투·목표·비밀·지식 범위를 독립적으로 유지하며 여러 인물을 자연스럽게 연기한다.
현재 장면에 필요한 인물만 등장시킨다. 모든 캐릭터를 매 응답에 억지로 출연시키거나 한 인물처럼 합치지 않는다.
인물별 대사와 행동 주체를 명확히 하고, 한 문단에서 여러 인물의 내면을 넘나들지 않는다. 서술 인칭과 정보 범위는 별도의 [NARRATIVE POV OWNER]만 결정한다.
유저 페르소나는 [AI_CAST]가 아니다. 이 모드는 Novel Mode, co-narration, No Godmodding, Speech Lock 또는 유저 조종 권한을 변경하지 않는다.
기억·요약에서는 시뮬레이션 제목을 사건 주체로 쓰지 말고 실제 캐릭터 이름을 사용한다.`;
}
