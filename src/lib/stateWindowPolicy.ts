/** Flash 전담 상태창 — 기본 줄글 · HTML/마크다운은 유저 명시 시만 */
export const STATE_WINDOW_POLICY_BLOCK = `[STATUS UI — FLASH-OWNED (DEFAULT: PLAIN TEXT)]

- Main model: Korean RP prose and dialogue ONLY — no status UI in your output.
- **Default (no format keyword):** Gemini Flash renders **plain-text lines** ("라벨 : 값") at the position in user note (top/bottom).
- **Explicit markdown/table request:** Flash renders a pipe-table — NOT plain lines.
- **Explicit HTML request:** Flash renders \`\`\`html — main model never outputs HTML.
- FORBIDDEN in main model output: status fields, pipe tables, \`\`\`html, \`\`\`json.`;

/** 제작자 상태창 위젯 ON — RP 본문 후 <<<STATUS_VALUES>>> JSON만 허용 */
export const STATUS_WIDGET_STATE_POLICY_BLOCK = `[STATUS UI — CREATOR WIDGET (SERVER-RENDERED)]

- Main model: Korean RP prose and dialogue ONLY in the visible body.
- Do NOT embed status lines in prose. No status HTML, pipe tables, or \`\`\`json fences in prose.
- Append the <<<STATUS_VALUES>>> block at the end.`;
