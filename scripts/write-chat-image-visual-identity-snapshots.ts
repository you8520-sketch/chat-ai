import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  syntheticCoupleStampPlan,
  syntheticDuoGiftAlternateImageOnly,
  syntheticDuoGiftPrimary,
  syntheticEmoticonPlan,
  syntheticLdDuoPlan,
  syntheticLdPartyAllReferencesAbsent,
  syntheticLdPartyCast,
  syntheticLdPartyMixedVisualStates,
  syntheticNoPhotoNoSavedSubject,
  syntheticNoPhotoSavedSubject,
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
      const hasRef = subject.referenceIndex != null;
      const useSaved =
        subject.appearanceMode === "image_plus_saved" &&
        Boolean(String(subject.savedAppearance ?? "").trim());
      const renderedMode =
        hasRef && useSaved
          ? "IMAGE_PLUS_SAVED"
          : hasRef
            ? "IMAGE_ONLY"
            : useSaved
              ? "IMAGE_PLUS_SAVED"
              : "NO_VISUAL_REFERENCE";
      return `Subject ${letter} (${subject.name}): ${renderedMode} · ref ${subject.referenceIndex ?? "none"}`;
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
  const noPhotoSaved = syntheticNoPhotoSavedSubject();
  const noPhotoNoSaved = syntheticNoPhotoNoSavedSubject();
  const mixedParty = syntheticLdPartyMixedVisualStates();
  const allAbsent = syntheticLdPartyAllReferencesAbsent();

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
    section("7. NO PHOTO + SAVED APPEARANCE", {
      prompt: noPhotoSaved.prompt,
      referenceUrls: noPhotoSaved.referenceUrls,
      subjects: [noPhotoSaved.subject],
    }),
    section("8. NO PHOTO + NO SAVED APPEARANCE", {
      prompt: noPhotoNoSaved.prompt,
      referenceUrls: noPhotoNoSaved.referenceUrls,
      subjects: [noPhotoNoSaved.subject],
    }),
    section("9. TRPG party mixed visual states", {
      prompt: mixedParty.prompt,
      referenceUrls: mixedParty.referenceUrls,
      subjects: mixedParty.subjects,
    }),
    section("10. ALL PARTY REFERENCES ABSENT — provider-bound REFERENCE ORDER", {
      prompt: [
        `canGenerate: ${String(allAbsent.canGenerate)}`,
        `hiddenIdentityFallback: ${String(allAbsent.hiddenIdentityFallback)}`,
        `contextFallbackUrls (must not be sent): ${allAbsent.contextFallbackUrls.join(", ")}`,
        "",
        allAbsent.prompt,
      ].join("\n"),
      referenceUrls: allAbsent.referenceUrls,
      subjects: allAbsent.subjects,
    }),
  ].join("\n");

  const outDir = path.join(process.cwd(), "docs/audits/chat-image-visual-identity");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "PROMPT-SNAPSHOTS.md");
  await writeFile(outPath, `${body}\n`, "utf8");
  console.log(`wrote ${outPath}`);
}

void main();
