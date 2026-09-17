import { SCENE_POLICY_BENCHMARK_FIXTURES } from "../src/lib/scenePolicyBenchmarkDataset";
import { runBenchmarkCase } from "../src/lib/scenePolicyBenchmarkHarness";

let ok = 0;
let bad = 0;
for (const f of SCENE_POLICY_BENCHMARK_FIXTURES) {
  const r = runBenchmarkCase(f);
  if (r.parityValid) ok += 1;
  else {
    bad += 1;
    console.log(f.id, r.parityDiffs.join("; "));
  }
}
console.log("summary", ok, "ok", bad, "bad");
