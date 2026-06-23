/**
 * 로어북 파이프라인 데모 (DB 미사용 · 순수 함수 + 압축 호출)
 *
 * 실행: npx.cmd tsx scripts/demo-lorebook-pipeline.ts
 *
 * 1) 용량 내 히스토리 누적 → 무압축 append 확인
 * 2) 용량 초과 → AI 압축(→ 사건 흐름) 트리거, 결과 길이/형식 확인
 *    (GEMINI_API_KEY 없으면 로컬 클램프 폴백으로 동작 확인만)
 */
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* .env.local 없으면 폴백 경로로 진행 */
}

import { appendCurrentMemory, compactCurrentMemory } from "../src/lib/memory/memory-rolling-summary";

const CAPACITY = 2000;

function makeHistory(i: number): string {
  const events = [
    `제이는 ${i}번째 임무 브리핑에서 새 목표 지점을 전달받았다`,
    `7은 제이의 판단을 의심하면서도 결국 동행을 결정했다`,
    `두 사람은 검문소를 우회하다 순찰대와 마주쳐 교전 직전까지 갔다`,
    `제이는 7에게 과거 부대 시절의 비밀 하나를 털어놓았다`,
    `7은 처음으로 제이에게 자신의 식별 번호가 아닌 이름을 알려주겠다고 약속했다`,
  ];
  return `[${i * 7 - 6}~${i * 7}턴] ` + events.join(" → ") + `. (${i}차 기록)`;
}

async function main() {
  let lorebook = "";

  console.log(`=== 1) 용량(${CAPACITY}자) 내 누적: 무압축 append ===`);
  let i = 0;
  while (true) {
    i++;
    const block = makeHistory(i);
    const next = appendCurrentMemory(lorebook, block);
    if (next.length > CAPACITY) {
      console.log(`\n${i}번째 히스토리에서 용량 초과 예정 (${next.length} > ${CAPACITY}) → 압축 단계로`);
      lorebook = next;
      break;
    }
    lorebook = next;
    console.log(`  append #${i}: ${lorebook.length}/${CAPACITY}자 (압축 없음, 원문 보존: ${lorebook.includes(`(${i}차 기록)`)})`);
  }

  console.log(`\n=== 2) 용량 초과 → AI 압축 (→ 사건 흐름) ===`);
  const before = lorebook.length;
  const compressed = await compactCurrentMemory(lorebook, CAPACITY);
  console.log(`  압축 전: ${before}자 → 압축 후: ${compressed.length}자 (용량 내: ${compressed.length <= CAPACITY})`);
  console.log(`  → 화살표 연결 사용: ${compressed.includes("→")}`);
  console.log(`\n--- 압축 결과 미리보기 ---\n${compressed.slice(0, 600)}${compressed.length > 600 ? "…" : ""}`);

  console.log(`\n=== 3) 압축 후 새 히스토리 계속 누적 ===`);
  const after = appendCurrentMemory(compressed, makeHistory(i + 1));
  console.log(`  append #${i + 1}: ${after.length}자 (새 기록 원문 보존: ${after.includes(`(${i + 1}차 기록)`)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
