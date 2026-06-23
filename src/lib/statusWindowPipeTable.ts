const PIPE_ROW_RE = /^\s*\|.+\|\s*$/;
const PIPE_ROW_LOOSE_RE = /^\s*\|[^|\n]+(\|[^|\n]*)+\|?\s*$/;

export function isPipeTableLine(line: string): boolean {
  const trimmed = line.trim();
  return PIPE_ROW_RE.test(trimmed) || PIPE_ROW_LOOSE_RE.test(trimmed);
}

const STATUS_WINDOW_TOPIC =
  /상태창|状态창|状態창|status\s*window|스탯\s*창|스텟\s*창|status\s*panel|stat\s*window/i;

const STATUS_WINDOW_OUTPUT_INTENT =
  /(?:표기|표시|출력|보여|적(?:어|용)|넣(?:어|을)|하단|상단|맨\s*아래|맨\s*위|매\s*턴|every\s*turn|each\s*turn|본문\s*하단|본문\s*상단|turn\s*end|append|bottom|top)/i;

/** 연속 pipe-table 줄 추출 (파서 유효성과 무관) */
export function extractPipeTableLines(text: string): string | null {
  const lines = text.split("\n");
  let best: string[] = [];
  let run: string[] = [];

  const flush = () => {
    if (run.length > best.length) best = [...run];
    run = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (isPipeTableLine(trimmed)) {
      run.push(line.trimEnd());
    } else if (trimmed) {
      flush();
    }
  }
  flush();

  return best.length >= 1 ? best.join("\n") : null;
}

/** 유저노트·페르소나에 |...| 상태창 템플릿이 있으면 마크다운 pipe-table 의도로 간주 */
export function sourcesHavePipeTableStatusTemplate(sources: {
  userNote?: string;
  userPersona?: string;
  userMessage?: string;
}): boolean {
  for (const raw of [sources.userNote, sources.userPersona, sources.userMessage]) {
    const text = raw?.trim() ?? "";
    if (!text || !extractPipeTableLines(text)) continue;
    if (STATUS_WINDOW_TOPIC.test(text) && STATUS_WINDOW_OUTPUT_INTENT.test(text)) {
      return true;
    }
  }
  return false;
}
