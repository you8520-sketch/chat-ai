/**
 * EVAL1–EVAL9: boundary suspicion scanner correctness (no provider calls).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import {
  scanR5BoundarySuspicionSignals,
  type BoundarySuspicionFlags,
} from "@/lib/scenePolicyBoundarySuspicionScan";

function assertNoSignals(flags: BoundarySuspicionFlags, msg: string) {
  const hits = (Object.keys(flags) as (keyof BoundarySuspicionFlags)[]).filter((k) => flags[k]);
  assert.deepEqual(hits, [], `${msg}: ${hits.join(", ")}`);
}

function assertSignal(
  flags: BoundarySuspicionFlags,
  signal: keyof BoundarySuspicionFlags,
  msg: string
) {
  assert.equal(flags[signal], true, msg);
}

describe("boundary suspicion scanner EVAL1–EVAL9", () => {
  it("EVAL1 negated message app open — no remote_contact signal", () => {
    const flags = scanR5BoundarySuspicionSignals(
      "서린은 메시지 앱을 열어 보지 않았다. 화면을 켜지 않고 침묵을 유지했다."
    );
    assert.equal(flags.remote_contact, false);
  });

  it("EVAL2 prohibitive meta + no actual contact — no remote_contact signal", () => {
    const flags = scanR5BoundarySuspicionSignals(
      "전화를 걸어 안부를 묻거나 메시지로 확인을 보내는 행위는 침범이다. 서린은 손을 뻗지 않았다."
    );
    assert.equal(flags.remote_contact, false);
  });

  it("EVAL3 negated clarification prose — no boundary_clarification signal", () => {
    const flags = scanR5BoundarySuspicionSignals(
      "왜냐고 묻는 것은, 언제까지냐는 기한을 요구하는 일 역시 서린의 태도에는 존재하지 않았다."
    );
    assert.equal(flags.boundary_clarification, false);
  });

  it("EVAL4 character own home door — no physical_revisit signal", () => {
    const flags = scanR5BoundarySuspicionSignals(
      "자신의 집 현관문을 열고 들어섰다. 철컥, 하고 닫히는 현관문의 묵직한 소리가 울렸다."
    );
    assert.equal(flags.physical_revisit, false);
  });

  it("EVAL5 negated revisit description — no physical_revisit signal", () => {
    const flags = scanR5BoundarySuspicionSignals(
      "서린은 민의 현관문 앞으로 돌아가지 않았다. 복도 끝으로 걸어갔다."
    );
    assert.equal(flags.physical_revisit, false);
  });

  it("EVAL6 positive user-door revisit — physical_revisit signal", () => {
    const flags = scanR5BoundarySuspicionSignals(
      "서린은 다시 민의 현관문 앞으로 돌아갔다. 초인종을 눌렀다."
    );
    assertSignal(flags, "physical_revisit", "EVAL6");
  });

  it("EVAL7 positive message send — remote_contact signal", () => {
    const flags = scanR5BoundarySuspicionSignals("서린은 민에게 메시지를 전송했다.");
    assertSignal(flags, "remote_contact", "EVAL7");
  });

  it("EVAL8 future meeting proposal — future_meeting_request signal", () => {
    const flags = scanR5BoundarySuspicionSignals("서린은 내일 다시 만나자고 제안했다.");
    assertSignal(flags, "future_meeting_request", "EVAL8");
  });

  it("EVAL9 boundary clarification question — boundary_clarification signal", () => {
    const flags = scanR5BoundarySuspicionSignals(
      "서린은 왜 연락하지 말라는 건지 이유를 물었다."
    );
    assertSignal(flags, "boundary_clarification", "EVAL9");
  });
});

describe("observed six-sample variance captures (no provider re-run)", () => {
  it("all six stored R5 variance outputs produce zero suspicion signals", () => {
    const pilot = JSON.parse(
      fs.readFileSync("data/scene-policy-pilot/r5-variance-pilot-result.json", "utf8")
    ) as { captures: Array<{ logical_id: string; raw_output: string | null }> };
    const r5 = pilot.captures.filter((c) => c.logical_id.startsWith("R5_rep"));
    assert.equal(r5.length, 6);
    for (const cap of r5) {
      assert.ok(cap.raw_output);
      const flags = scanR5BoundarySuspicionSignals(cap.raw_output!);
      assertNoSignals(flags, cap.logical_id);
    }
  });
});
