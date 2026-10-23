import Module from "module";
const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;
import { it } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { isRollingSummaryGroundedInDialogue } from "./memory-summary-integrity";
import { formatSelectedPersonaIdentityForBackground } from "@/lib/userPersonas";

const DIR = "/opt/cursor/artifacts/gate4";
it("replay real Luna summaries through guard", () => {
  const seal = JSON.parse(readFileSync(`${DIR}/seal-A.json`, "utf8")) as Record<string, any>;
  const labelled = formatSelectedPersonaIdentityForBackground("렌", "male")!;
  const rows: any[] = [];
  for (const [id, v] of Object.entries(seal)) {
    const dialogue = (v.promptUserContent as string).split("[1~5턴 원본 대화]\n")[1]!.split("\n\n[요약 대상 RP source 턴]")[0]!;
    const summary = v.persisted as string;
    const bare = isRollingSummaryGroundedInDialogue(summary, dialogue, "렌", "라이크");
    const lab = isRollingSummaryGroundedInDialogue(summary, dialogue, labelled, "라이크");
    rows.push({ id, kind: v.kind, bare, labelled: lab });
  }
  writeFileSync(`${process.env.OUTF ?? "/tmp/replay.json"}`, JSON.stringify(rows, null, 2));
  for (const r of rows) console.log(r.id, "bare", r.bare, "labelled", r.labelled);
});
