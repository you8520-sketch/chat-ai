import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildAdvancedProseNsfwGuidelines } from "@/lib/advancedProseNsfwGuidelines";

const outDir = join(process.cwd(), "output");
mkdirSync(outDir, { recursive: true });
const label = process.argv[2] ?? "after";
const block = buildAdvancedProseNsfwGuidelines({
  nsfwEnabled: label.includes("nsfw") || label === "before" || label === "after",
});
const path = join(outDir, `prose-bundle-${label}.txt`);
writeFileSync(path, block, "utf8");
console.log(`Wrote ${path} (${block.length} chars)`);
