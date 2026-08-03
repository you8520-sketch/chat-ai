import { writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { TERRA_PROMPT_CANARY_GREETING_NEUTRAL } from "../src/lib/terraPromptCanary";

writeFileSync("/tmp/neutral-greeting.txt", TERRA_PROMPT_CANARY_GREETING_NEUTRAL, "utf8");
const db = new Database("data/app.db");
db.prepare("UPDATE characters SET greeting=? WHERE id=11").run(
  TERRA_PROMPT_CANARY_GREETING_NEUTRAL
);
const row = db
  .prepare(
    "SELECT length(greeting) AS l, instr(greeting, ?) AS staff, instr(greeting, ?) AS gap FROM characters WHERE id=11"
  )
  .get("보고서만 제출", "서류를 정리하는 틈");
console.log({ written: TERRA_PROMPT_CANARY_GREETING_NEUTRAL.length, row });
db.close();
