// Offline only: canonical owners with captured responses; no live transport or DB writes.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { generateOfficialCharacterBible, reviseOfficialCharacterVoice, type OfficialAuthorTransport } from "@/lib/officialSupply/author";
import { loadRelationStartCandidates, compileRelationStartDraft } from "@/lib/officialSupply/relationStartCandidates";
import { composeOfficialCreatorComment } from "@/lib/officialSupply/publicProfileText";
import { buildOfficialCharacterFormBody, composeOfficialSystemPrompt, computeTextLockHash, officialRpSettingOverflowChars } from "@/lib/officialSupply/characterText";
import { evaluateRelationBibleContract } from "@/lib/officialSupply/bible";
import { composeExampleDialog, parseSpeechCreatorFromBody } from "@/lib/speechCreatorFields";
import { estimateTokens } from "@/lib/tokenEstimate";
import { findAdultTermsInText } from "@/lib/characterAdultText";

async function main() {
const output = path.resolve(process.argv[2] ?? "docs/official-supply/reviews/g2-2026-10-28");
fs.mkdirSync(output, { recursive: true });
const rows = [];
for (const candidate of loadRelationStartCandidates()) {
  const draft = compileRelationStartDraft(candidate);
  const authored = { ...candidate.bible, publicProfile: { ...candidate.bible.publicProfile, detailedDescription: draft.description, creatorComment: composeOfficialCreatorComment(draft) } };
  const calls: { task: string; chars: number; estimatedTokens: number }[] = [];
  const transport: OfficialAuthorTransport = { label: "OFFLINE_ONLY", async completeJson(input) {
    const text = `${input.system}\n${input.user}`;
    calls.push({ task: input.task, chars: text.length, estimatedTokens: estimateTokens(text) });
    return { text: JSON.stringify(authored), model: "OFFLINE_ONLY", inputTokens: 0, outputTokens: 0, costUsd: 0, providerRequestId: null };
  } };
  const voice = { name: candidate.brief.name, age: candidate.brief.age, adultCandidate: false, speechDirection: candidate.brief.speechDirection, npcDemand: "없음" };
  await generateOfficialCharacterBible({ transport,
    part1: { brief: candidate.brief, worldName: "에테르노스", worldContext: candidate.bible.situation.worldContext, siblingSketches: [] },
    voice, bonds: { ...voice, rpHook: candidate.brief.rpHook, castList: [] },
  });
  const baseCalls = [...calls]; calls.length = 0;
  await reviseOfficialCharacterVoice({ transport, bible: authored, voice, fields: ["publicDescription"], reasons: ["offline comparison"] });
  rows.push({ fixture: candidate.key, baseCalls, optionalRevision: calls, baseEstimatedInputTokens: baseCalls.reduce((n, c) => n + c.estimatedTokens, 0) });
}
fs.writeFileSync(path.join(output, "input-metrics.json"), JSON.stringify({ kind: "offline estimate, identical fixtures; not billed provider tokens", physicalProviderCalls: 0, normalStages: 3, optionalVoiceRevisionsMax: 2, rows }, null, 2) + "\n");

const originals = path.resolve("docs/official-supply/reviews/g2-2026-10-28/g1-original");
if (fs.existsSync(originals)) {
  const first = JSON.parse(fs.readFileSync(path.join(originals, "first-generation.json"), "utf8"));
  const automatic = JSON.parse(fs.readFileSync(path.join(originals, "automatic-final-reconstructed.json"), "utf8"));
  const candidate = { key: "g2-theo-review", brief: first.brief, bible: first.bible };
  const firstForm = buildOfficialCharacterFormBody({ draft: first.draft, appearanceBlock: "", assets: [] });
  fs.writeFileSync(path.join(output, "preview-first-example-dialog.txt"), composeExampleDialog(parseSpeechCreatorFromBody(firstForm)));
  const v1 = compileRelationStartDraft(candidate);
  const v2 = compileRelationStartDraft({ ...candidate, bible: { ...first.bible, promptStandard: "compact_rp_v2" } });
  fs.writeFileSync(path.join(output, "preview-first-form.json"), JSON.stringify(buildOfficialCharacterFormBody({ draft: first.draft, appearanceBlock: "", assets: [] }), null, 2) + "\n");
  fs.writeFileSync(path.join(output, "preview-automatic-form.json"), JSON.stringify(buildOfficialCharacterFormBody({ draft: automatic.draft, appearanceBlock: "", assets: [] }), null, 2) + "\n");
  fs.writeFileSync(path.join(output, "compiled-v2-review.txt"), composeOfficialSystemPrompt(v2) + "\n");
  fs.writeFileSync(path.join(output, "g1-comparison.json"), JSON.stringify({
    first: { status: "original, never persisted in production", pitchChars: first.bible.publicProfile.description.length, adultTermHits: findAdultTermsInText(first.draft.description), relationQa: evaluateRelationBibleContract(first.bible) },
    automatic: { status: automatic.status, pitchChars: automatic.bible.publicProfile.description.length, repairs: automatic.repairs },
    v2CompileOnly: { status: "compiler comparison only; no literary approval or role metadata rewrite", v1Hash: computeTextLockHash(v1), v2Hash: computeTextLockHash(v2), beforeEstimatedTokens: estimateTokens(composeOfficialSystemPrompt(v1)), afterEstimatedTokens: estimateTokens(composeOfficialSystemPrompt(v2)), overflowChars: officialRpSettingOverflowChars(v2, ""), greetingPreserved: v2.greeting === first.bible.greeting, worldPreserved: v2.sections.worldAndSituation === v1.sections.worldAndSituation, appearanceSource: "14 fields remain in unchanged bible; full image geometry belongs to Appearance Lock, which G1 never generated" },
  }, null, 2) + "\n");
  const manifest: Record<string, string> = {};
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else manifest[path.relative(originals, file)] = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    }
  }
  walk(originals);
  fs.writeFileSync(path.join(output, "g1-original-sha256.json"), JSON.stringify({ sourceCommit: "22b798b5704d7ed2b19b92cd2c4b56692bf2993c", files: manifest }, null, 2) + "\n");
}

}
main().catch(error => { console.error(error); process.exitCode = 1; });
