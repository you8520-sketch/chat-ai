/** 백그라운드 전담 상태창 — 기본 줄글 · HTML/마크다운은 유저 명시 시만 (메인 RP 프롬프트용 최소 블록) */
export const STATE_WINDOW_POLICY_BLOCK = `[STATUS UI — SERVER HANDLED]
Main model: Korean RP prose only. Status/HTML/JSON UI is background GPT-5.6 Luna — do not output status fields, pipe tables, \`\`\`html, or \`\`\`json.`;

/** 제작자 상태창 위젯 ON — GPT-5.6 Luna가 필드 값 추출, 메인 모델은 RP만 */
export const STATUS_WIDGET_STATE_POLICY_BLOCK = `[STATUS UI — CREATOR WIDGET (SERVER-RENDERED)]

- Main model: Korean RP prose and dialogue ONLY in the visible body.
- Do NOT embed status lines, widget field values, pipe tables, \`\`\`json fences, or <<<STATUS_VALUES>>> markers.
- GPT-5.6 Luna (background) extracts widget field values from this turn's prose after generation.`;
