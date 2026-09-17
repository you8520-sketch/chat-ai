import { SCENE_POLICY_BENCHMARK_FIXTURES } from "../src/lib/scenePolicyBenchmarkDataset";
import { runBenchmarkCase } from "../src/lib/scenePolicyBenchmarkHarness";

let ok = 0;
let bad = 0;
for (const f of SCENE_POLICY_BENCHMARK_FIXTURES) {
  const result = runBenchmarkCase(f);
  if (result.parityValid) ok += 1;
  else {
    bad += 1;
    console.log(f.id, result.parityDiffs.join("; "));
  }
}
console.log("summary", ok, "ok", bad, "bad");
