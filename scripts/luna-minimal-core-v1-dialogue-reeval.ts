/**
 * Deterministic dialogue-block re-eval for frozen Luna Minimal Core V1 outputs.
 * apiCallsExecuted=0 — no generation, harness parser only.
 */
import { readFileSync, writeFileSync } from "fs";
import { countHarnessDialogueBlocks, extractHarnessDialogueBlocks } from "./lib/lunaHarnessDialogueBlocks";

type Target = {
  reviewPath: string;
  sections: Array<{ header: string; label: string }>;
};

const TARGETS: Target[] = [
  {
    reviewPath: "data/luna-minimal-core-v1-review.txt",
    sections: [
      { header: "## Q1 — MINIMAL_CORE_V1", label: "Q1" },
      { header: "## S1 — MINIMAL_CORE_V1", label: "S1" },
      { header: "## M1 — MINIMAL_CORE_V1", label: "M1" },
      { header: "## U1 — MINIMAL_CORE_V1", label: "U1" },
    ],
  },
  {
    reviewPath: "data/luna-minimal-core-v1-agency-a1-review.txt",
    sections: [
      { header: "## U1-A1", label: "U1-A1" },
      { header: "## Q1-A1", label: "Q1-A1" },
    ],
  },
];

function extractProseSection(text: string, header: string): string | null {
  const start = text.indexOf(header);
  if (start < 0) return null;
  const proseStart = text.indexOf("--- FULL PROSE ---", start);
  if (proseStart < 0) return null;
  const proseBodyStart = text.indexOf("\n", proseStart) + 1;
  const proseEnd = text.indexOf("\n--- ", proseBodyStart);
  if (proseEnd < 0) return null;
  return text.slice(proseBodyStart, proseEnd).trim();
}

function replaceDialogueBlockCount(section: string, count: number, blocks: string[]): string {
  let out = section.replace(/dialogueBlockCount=\d+/g, `dialogueBlockCount=${count}`);
  if (!out.includes("dialogueBlockList=")) {
    const marker = out.indexOf("dialogueFragmentationStatus=");
    if (marker >= 0) {
      const lineEnd = out.indexOf("\n", marker);
      const insertAt = lineEnd >= 0 ? lineEnd + 1 : out.length;
      const listLine = `dialogueBlockList=${blocks.map((b) => b.slice(0, 40)).join(" | ") || "none"}\n`;
      out = out.slice(0, insertAt) + listLine + out.slice(insertAt);
    }
  } else {
    out = out.replace(
      /dialogueBlockList=.*/,
      `dialogueBlockList=${blocks.map((b) => b.slice(0, 40)).join(" | ") || "none"}`
    );
  }
  return out;
}

function main() {
  const summary: string[] = [
    "# Luna Minimal Core V1 — dialogue block re-eval",
    `generatedAt=${new Date().toISOString()}`,
    "apiCallsExecuted=0",
    "runtimePromptChanged=false",
    "productionCodeChanged=false",
    "",
  ];

  for (const target of TARGETS) {
    let text = readFileSync(target.reviewPath, "utf8");
    summary.push(`## ${target.reviewPath}`);

    for (const { header, label } of target.sections) {
      const prose = extractProseSection(text, header);
      if (!prose) {
        summary.push(`${label}=MISSING_PROSE`);
        continue;
      }
      const blocks = extractHarnessDialogueBlocks(prose);
      const count = blocks.length;
      summary.push(`${label} dialogueBlockCount=${count}`);

      const sectionStart = text.indexOf(header);
      const nextHeader = text.indexOf("\n## ", sectionStart + header.length);
      const sectionEnd = nextHeader >= 0 ? nextHeader : text.length;
      const section = text.slice(sectionStart, sectionEnd);
      const updated = replaceDialogueBlockCount(
        section,
        count,
        blocks.map((b) => b.text)
      );
      text = text.slice(0, sectionStart) + updated + text.slice(sectionEnd);
    }

    writeFileSync(target.reviewPath, text, "utf8");
    summary.push("");
  }

  writeFileSync("data/luna-minimal-core-v1-dialogue-reeval.txt", summary.join("\n"), "utf8");
  console.log(summary.join("\n"));
}

main();
