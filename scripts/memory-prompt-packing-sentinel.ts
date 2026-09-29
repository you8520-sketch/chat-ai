import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildMemoryPromptPackingAudit,
  renderMemoryPromptPackingAuditMarkdown,
} from "@/lib/memoryResearch/promptPackingAudit";

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const out = resolve(arg("out") ?? "memory-research-out/prompt-packing");
mkdirSync(out, { recursive: true });

const audit = buildMemoryPromptPackingAudit();
const failed = audit.invariants.filter((i) => !i.ok);

writeFileSync(resolve(out, "report.json"), `${JSON.stringify(audit, null, 2)}\n`);
writeFileSync(resolve(out, "REPORT.md"), renderMemoryPromptPackingAuditMarkdown(audit));

console.log(renderMemoryPromptPackingAuditMarkdown(audit));
if (failed.length > 0) {
  throw new Error(
    `memory prompt-packing invariant drift: ${failed.map((i) => i.id).join(", ")}`
  );
}
