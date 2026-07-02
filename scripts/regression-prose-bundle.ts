/**
 * Regression checklist for prose bundle responsibility refactor.
 */
import assert from "node:assert/strict";
import { buildAdvancedProseNsfwGuidelines } from "@/lib/advancedProseNsfwGuidelines";
import { WEBNOVEL_OUTPUT_FORMAT_BLOCK } from "@/lib/webnovelOutputFormat";

const sfw = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false });
const nsfw = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true });

const checks: { name: string; pass: boolean; detail: string }[] = [];

function check(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
}

// □ 해체 유지
check(
  "해체 유지",
  /해체\(-다/.test(sfw) && !/해체체/.test(WEBNOVEL_OUTPUT_FORMAT_BLOCK),
  "PROSE [REGISTER]; removed from WEBNOVEL FORMAT only"
);

// □ Show don't tell 유지
check(
  "Show don't tell 유지",
  /행동·호흡·속도/.test(sfw) &&
    !/\[SHOW BEFORE TELL\]/.test(sfw) &&
    !/슬프다·화났다/.test(sfw),
  "PROSE [EMOTION] — label examples removed Step 7"
);

// □ 감각 묘사 유지
check(
  "감각 묘사 유지",
  /\[SENSATION\]/.test(sfw) && /질감·공간·온도·소리·대비/.test(sfw),
  "PROSE [SENSATION] — touch owner + channel rewrite Step 7.5"
);

// □ 웹소설 호흡 유지
check(
  "웹소설 호흡 유지",
  /\[WEBNOVEL BREATH\]/.test(sfw) && /여운/.test(sfw),
  "PROSE [WEBNOVEL BREATH]"
);

// □ 대사 구조 유지
check(
  "대사 구조 유지",
  /\[DIALOGUE & NARRATION\]/.test(sfw) && /하나의 인용문/.test(sfw),
  "DIALOGUE & NARRATION unchanged"
);

// □ NSFW 표현력 유지
check(
  "NSFW 표현력 유지",
  /해부학적 명칭/.test(nsfw) &&
    /기계적 피스톤/.test(nsfw) &&
    /관계 단계·대사 말투/.test(nsfw) &&
    !/슬로 모션 — 한 동작을 마찰/.test(nsfw),
  "NSFW register/terms; craft slomo removed Step 7"
);

// □ 출력 포맷 유지
check(
  "출력 포맷 유지",
  /Never wrap narration or actions in markdown/.test(WEBNOVEL_OUTPUT_FORMAT_BLOCK) &&
    !/screenplay style/.test(WEBNOVEL_OUTPUT_FORMAT_BLOCK) &&
    !/Write like a Korean webnovel/.test(WEBNOVEL_OUTPUT_FORMAT_BLOCK),
  "WEBNOVEL FORMAT markers only"
);

check(
  "CROSS-TURN removed Step 7",
  !/\[CROSS-TURN VARIATION\]/.test(sfw),
  "RHYTHM covers within-turn variation"
);

check(
  "NO ABSTRACT removed Step 7",
  !/순간을 요약하지 마라/.test(sfw),
  "M2M + DENSITY cover flow"
);

console.log("=== Regression Checklist ===");
let fail = 0;
for (const c of checks) {
  const mark = c.pass ? "PASS" : "FAIL";
  if (!c.pass) fail++;
  console.log(`${mark}  ${c.name} — ${c.detail}`);
}
if (fail > 0) {
  console.error(`\n${fail} regression(s) failed`);
  process.exit(1);
}
