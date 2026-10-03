import fs from "node:fs";
import path from "node:path";

import {
  CHARACTER_SECRET_AUDIT_RELATIVE_PATH,
  buildCharacterSecretDeliveryReport,
} from "@/lib/canonPlan/characterSecretDeliveryAudit";

const outputPath = process.argv[2]?.trim() || CHARACTER_SECRET_AUDIT_RELATIVE_PATH;
const report = buildCharacterSecretDeliveryReport();
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, report, "utf8");
console.log(outputPath);
