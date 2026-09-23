import fs from "node:fs";
import { buildSuggestedRepliesDecisionQualityLogReport } from "../src/lib/suggestedReplies/decisionQualityLogReport";

const inputPath = process.argv[2] ?? "-";
const text =
  inputPath === "-"
    ? fs.readFileSync(0, "utf8")
    : fs.readFileSync(inputPath, "utf8");

const report = buildSuggestedRepliesDecisionQualityLogReport(text);
console.log(JSON.stringify(report, null, 2));
