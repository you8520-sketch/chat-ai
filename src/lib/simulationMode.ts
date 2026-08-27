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

export const SIMULATION_CAST_EXAMPLE = `[김태환]
외형: 짧은 검은 머리, 붉은 눈, 큰 체격
성격: 무뚝뚝하고 거친 편
말투: 짧은 반말 위주
관계: 김성찬과 오래된 악연
배경: 과거 조직에서 실험을 당함

[김성찬]
외형: 갈색 장발, 회색 눈, 마른 체형
성격: 침착하지만 집요함
말투: 낮고 차분한 존댓말
관계: 김태환을 오래 추적해 옴
배경: 전직 수사관`;

export type SimulationCastEntry = {
  name: string;
  settings: string;
};

function simulationCastHeadingName(line: string): string | null {
  const match =
    line.match(/^\[([^\]\r\n]{1,80})\]$/) ??
    line.match(/^#{1,4}\s+(.{1,80})$/) ??
    line.match(/^(?:이름|캐릭터명|인물명)\s*[:：]\s*(.{1,80})$/);
  const name = match?.[1]?.replace(/[*_`#\[\]]/g, "").trim().slice(0, 80) ?? "";
  return name || null;
}

export function extractSimulationCastEntries(cast: string): SimulationCastEntry[] {
  const entries: SimulationCastEntry[] = [];
  const seen = new Set<string>();
  let current: SimulationCastEntry | null = null;
  for (const rawLine of cast.split(/\r?\n/)) {
    const headingName = simulationCastHeadingName(rawLine.trim());
    if (headingName) {
      const normalized = headingName.toLowerCase();
      if (seen.has(normalized) || entries.length >= 24) {
        current = null;
        continue;
      }
      seen.add(normalized);
      current = { name: headingName, settings: "" };
      entries.push(current);
      continue;
    }
    if (current) {
      current.settings = `${current.settings}${current.settings ? "\n" : ""}${rawLine}`;
    }
  }
  return entries.map((entry) => ({ ...entry, settings: entry.settings.trim() }));
}

export function parseContentKind(value: unknown): ContentKind {
  return value === "simulation" ? "simulation" : "character";
}

/** Best-effort suggestions only. Creators may keep using completely free-form text. */
export function extractSimulationCastNames(cast: string): string[] {
  return extractSimulationCastEntries(cast).map((entry) => entry.name);
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
