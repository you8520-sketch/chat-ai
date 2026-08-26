import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  syntheticCoupleStampPlan,
  syntheticDuoGiftAlternateImageOnly,
  syntheticDuoGiftPrimary,
  syntheticEmoticonPlan,
  syntheticLdDuoPlan,
  syntheticLdPartyCast,
} from "../src/lib/chatImageVisualIdentity.fixtures";

function section(title: string, plan: {
  prompt: string;
  referenceUrls: string[];
  subjects: Array<{
    name: string;
    appearanceMode: string;
    referenceIndex: number | null;
  }>;
}) {
  const refs = plan.referenceUrls
    .map((url, index) => `Image ${index + 1}: ${url}`)
    .join("\n");
  const modes = plan.subjects
    .map((subject, index) => {
      const letter = String.fromCharCode(65 + index);
      return `Subject ${letter} (${subject.name}): ${subject.appearanceMode.toUpperCase()} · ref ${subject.referenceIndex ?? "none"}`;
    })
    .join("\n");
  return [
    `## ${title}`,
    "",
    "REFERENCE ORDER:",
    refs,
    "",
    "APPEARANCE MODE:",
    modes,
    "",
    "PROMPT:",
    "```",
    plan.prompt.trim(),
    "```",
    "",
  ].join("\n");
}

async function main() {
  const giftPrimary = syntheticDuoGiftPrimary();
  const giftAlt = syntheticDuoGiftAlternateImageOnly();
  const emoticon = syntheticEmoticonPlan();
  const stamp = syntheticCoupleStampPlan();
  const ldDuo = syntheticLdDuoPlan();
  const party = syntheticLdPartyCast();

  const body = [
    "# Chat image visual-identity prompt snapshots",
    "",
    "Synthetic fixtures only. No production character or persona data.",
    "Provider image APIs were not called. ChatGPT should review these prompts directly.",
    "",
    section("1. Gift box — primary character + persona", giftPrimary),
    section("2. Gift box — alternate / IMAGE_ONLY character", giftAlt),
    section("3. 9 emoticons", emoticon),
    section("4. Couple stamps", stamp),
    section("5. Standard LD duo", ldDuo),
    section("6. 3+ person LD/TRPG cast", {
      prompt: party.prompt,
      referenceUrls: party.referenceUrls,
      subjects: party.subjects,
    }),
  ].join("\n");

  const outDir = path.join(process.cwd(), "docs/audits/chat-image-visual-identity");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "PROMPT-SNAPSHOTS.md");
  await writeFile(outPath, `${body}\n`, "utf8");
  console.log(`wrote ${outPath}`);
}

void main();
