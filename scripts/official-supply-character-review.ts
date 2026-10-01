import fs from "node:fs";
import path from "node:path";

import {
  LUCIAN_REVIEW_RELATIVE_PATH,
  buildOfficialCharacterReviewReport,
} from "@/lib/officialSupply/characterReview";

const draftKey = process.argv[2]?.trim() || process.env.OFFICIAL_REVIEW_DRAFT_KEY?.trim() || "pilot-rf-03";
const outputPath =
  process.argv[3]?.trim() ||
  process.env.OFFICIAL_REVIEW_OUTPUT_PATH?.trim() ||
  LUCIAN_REVIEW_RELATIVE_PATH;

const report = buildOfficialCharacterReviewReport(draftKey);
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, report, "utf8");
  console.log(outputPath);
} else {
  process.stdout.write(report);
}
