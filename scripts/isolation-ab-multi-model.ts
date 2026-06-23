/**
 * A vs B isolation across production models (fresh process per run).
 * Usage: npx.cmd tsx scripts/isolation-ab-multi-model.ts
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();

const MODELS = ["qwen/qwen3.7-max", "deepseek/deepseek-v4-pro"] as const;
const ROOT = process.cwd();
const FILES = {
  writingStyle: path.join(ROOT, "src/lib/writingStylePreset.ts"),
  userPersona: path.join(ROOT, "src/lib/userPersonaNarrationRules.ts"),
  corePrompt: path.join(ROOT, "src/lib/corePrompt.ts"),
};

function read(p: string) {
  return fs.readFileSync(p, "utf8");
}
function write(p: string, content: string) {
  fs.writeFileSync(p, content, "utf8");
}

const TRIMMED_SNAPSHOT = {
  writingStyle: read(FILES.writingStyle),
  userPersona: read(FILES.userPersona),
  corePrompt: read(FILES.corePrompt),
};

function applyA() {
  let ws = TRIMMED_SNAPSHOT.writingStyle;
  ws = ws.replace(
    `- Dialogue-heavy scenes: prefer **narration blocks** (2–8 sentences) before/after speech — NOT a thin 1–2 sentence bridge between every quote pair.
- Forbid noun-fragment lines`,
    `- Dialogue-heavy scenes: prefer **narration blocks** (2–8 sentences) before/after speech — NOT a thin 1–2 sentence bridge between every quote pair.
- Forbid ping-pong layout: "…" / short narration / "…" repeated. If narration sits between two quotes, minimum **3 sentences** (action + gaze/sense + relationship tension or environment).
- Consecutive complete utterances may appear back-to-back (2–3 quotes) without a bridge when the exchange carries the beat.
- Forbid noun-fragment lines`
  );
  ws = ws.replace(
    `export const SHOW_OVER_TELL_DEFAULT_DIRECTION = \`[SHOW OVER TELL] 감정은 행동·환경으로 보여줄 것 — 서술자가 직접 설명하지 말 것 (절대 금지 3조항 1번과 동일 원칙).\`;`,
    `export const SHOW_OVER_TELL_DEFAULT_DIRECTION = \`[SHOW OVER TELL — DEFAULT DIRECTION]
- Default toward observable action and environment over emotional narration.
- When emotion needs expression, show it through physical action, environmental detail, or dialogue subtext — not direct narrator commentary.
- Rotate descriptive focus between body language AND environment/objects — do not rely on body cues alone.
- This is the default baseline. Emotional scenes may lean more introspective per the rule above, but should still avoid direct narrator emotional labeling.\`;`
  );
  write(FILES.writingStyle, ws);

  let up = TRIMMED_SNAPSHOT.userPersona;
  up = up.replace(
    `export function buildSmartUserPersonaNarrationRules(
  _charName: string,
  _personaName: string
): string {
  return \`[USER PERSONA NARRATION] [USER AGENCY & SENSORY FEEDBACK RULE] BOUNDARY 그대로 적용. [B]는 awareness용 — 조종 권한 아님.\`;
}`,
    `export function buildSmartUserPersonaNarrationRules(
  charName: string,
  personaName: string
): string {
  const { char, persona } = label(charName, personaName);
  return \`[USER PERSONA NARRATION RULES]
(Supplements [USER AGENCY & SENSORY FEEDBACK RULE] — NPC "\${char}" · User Persona "\${persona}")

When "\${char}" acts, weave [B] physiological cues per BOUNDARY — never [B] emotions, desires, or thoughts.
User keeps dialogue/voluntary action; AI focuses on "\${char}" plus permitted [B] body responses to "\${char}".
[USER_PERSONA] = awareness only — not a license to puppet "\${persona}"'s will.\`;
}`
  );
  write(FILES.userPersona, up);

  let cp = TRIMMED_SNAPSHOT.corePrompt;
  cp = cp.replace(
    `Dialogue: \${bilingual.primaryDisplay} in double quotes + Korean gloss in ( ) on every speech line (creator bilingual setting).
Exception:`,
    `Dialogue: \${bilingual.primaryDisplay} in double quotes + Korean gloss in ( ) on every speech line (creator bilingual setting).
UI/Meta: FORBIDDEN. NO html, json, markdown tables, status UI, or <<<STATUS_VALUES>>> markers. (Handled by server/Flash).
Exception:`
  );
  cp = cp.replace(
    `Language: 100% Korean Web-novel prose.
Exception:`,
    `Language: 100% Korean Web-novel prose.
UI/Meta: FORBIDDEN. NO html, json, markdown tables, status UI, or <<<STATUS_VALUES>>> markers. (Handled by server/Flash).
Exception:`
  );
  write(FILES.corePrompt, cp);
}

function applyB() {
  write(FILES.writingStyle, TRIMMED_SNAPSHOT.writingStyle);
  write(FILES.userPersona, TRIMMED_SNAPSHOT.userPersona);
  write(FILES.corePrompt, TRIMMED_SNAPSHOT.corePrompt);
}

type Row = { model: string; condition: "A" | "B"; turn: number; output_chars: number };

function runProbe(condition: "A" | "B", model: string): Row[] {
  const env = { ...process.env, MOCK_MODE: "false", NODE_ENV: "development" };
  const out = execSync(
    `npx.cmd tsx scripts/isolation-3turn-probe.ts ${condition} --model=${model}`,
    { cwd: ROOT, env, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 }
  );
  const rows: Row[] = [];
  const re = /completedTurns: (\d+), output_chars: (\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) !== null) {
    rows.push({
      model,
      condition,
      turn: Number(m[1]),
      output_chars: Number(m[2]),
    });
  }
  if (rows.length !== 3) {
    console.error(out);
    throw new Error(`Expected 3 rows for ${condition} ${model}, got ${rows.length}`);
  }
  return rows;
}

function main() {
  const all: Row[] = [];
  try {
    for (const condition of ["A", "B"] as const) {
      if (condition === "A") applyA();
      else applyB();
      for (const model of MODELS) {
        console.log(`\n>>> Running ${condition} · ${model}`);
        all.push(...runProbe(condition, model));
      }
    }
  } finally {
    applyB();
  }

  console.log("\n=== SUMMARY ===");
  for (const model of MODELS) {
    const a = all.filter((r) => r.model === model && r.condition === "A");
    const b = all.filter((r) => r.model === model && r.condition === "B");
    const fmt = (rows: Row[]) =>
      Object.fromEntries(rows.sort((x, y) => x.turn - y.turn).map((r) => [`t${r.turn}`, r.output_chars]));
    console.log(
      JSON.stringify({
        model,
        A: fmt(a),
        B: fmt(b),
        A_avg: Math.round(a.reduce((s, r) => s + r.output_chars, 0) / a.length),
        B_avg: Math.round(b.reduce((s, r) => s + r.output_chars, 0) / b.length),
      })
    );
  }
}

main();
