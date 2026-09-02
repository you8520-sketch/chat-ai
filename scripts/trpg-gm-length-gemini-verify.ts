/**
 * Real Gemini 3.7 Flash GM length verification — one call per fixture, retry=0.
 * Prefer scripts/trpg-gm-length-forensic.ts for raw envelope artifacts.
 * Run: node --conditions=react-server --import tsx scripts/trpg-gm-length-gemini-verify.ts
 */
import { execSync } from "node:child_process";

const label = process.env.GEMINI_VERIFY_LABEL ?? "pr833-patched";

execSync(`node --conditions=react-server --import tsx scripts/trpg-gm-length-forensic.ts --label ${label}`, {
  cwd: process.cwd(),
  stdio: "inherit",
  env: {
    ...process.env,
    TRPG_PROMPT_ROOT: process.env.TRPG_PROMPT_ROOT ?? process.cwd(),
    TRPG_FORENSIC_OUT_DIR:
      process.env.TRPG_FORENSIC_OUT_DIR ?? `/opt/cursor/artifacts/trpg-gm-length-forensic/${label}`,
  },
});
