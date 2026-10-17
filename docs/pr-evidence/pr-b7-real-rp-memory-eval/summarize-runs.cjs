// Per evaluated question: exact final memory block cut from the prompt dump
// (the dump itself carries production character canon and stays out of git),
// MEMORY_HEALTH selection counts from the server log, event-key presence per
// section, output length and cost.
// Usage: node summarize-runs.cjs <out_dir> <run_root> <evidence_dir>
const fs = require("node:fs");
const path = require("node:path");

const [outDir, runRoot, evidenceDir] = process.argv.slice(2);
fs.mkdirSync(path.join(evidenceDir, "memory-blocks"), { recursive: true });
fs.mkdirSync(path.join(evidenceDir, "outputs"), { recursive: true });

const KEYS = {
  E1_clue_stone: ["G-117", "균열석"],
  E2_npc_betrayal: ["서윤", "근신"],
  E3_relationship_break_and_repair: ["배정받은 가이드", "옥상", "페어"],
  E4_loss_and_comfort: ["지환"],
  E5_npc_help: ["민호", "재보정", "오차"],
  E6_injury_treatment_recovery: ["옆구리", "봉합", "완치", "열네 바늘", "14바늘"],
  E7_promise_cancelled: ["야시장", "탕후루"],
  E8_repeated_strawberry_milk: ["딸기우유"],
};

function exactSystemText(dump) {
  const parts = [];
  const re = /<<<BEGIN EXACT TEXT>>>\n([\s\S]*?)<<<END EXACT TEXT>>>/g;
  let m;
  while ((m = re.exec(dump))) parts.push(m[1]);
  return parts;
}

function memoryBlock(dump) {
  const system = exactSystemText(dump).join("\n");
  const start = system.indexOf("[Memory]\n");
  if (start < 0) return "";
  const end = system.indexOf("[RUNTIME STYLE]", start);
  return system.slice(start, end < 0 ? undefined : end).trimEnd();
}

function section(block, header, nextHeaders) {
  const i = block.indexOf(header);
  if (i < 0) return "";
  let end = block.length;
  for (const h of nextHeaders) {
    const j = block.indexOf(h, i + header.length);
    if (j >= 0 && j < end) end = j;
  }
  return block.slice(i, end);
}

function rawHistory(dump) {
  const parts = exactSystemText(dump);
  return parts.slice(1).join("\n");
}

function memoryHealth(serverLog) {
  const m = serverLog.match(/MEMORY_HEALTH \{([\s\S]*?)\n\}/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^\s*(\w+): (.*?),?$/);
    if (kv) out[kv[1]] = kv[2].replace(/^'|'$/g, "");
  }
  return out;
}

const rows = [];
for (const file of fs.readdirSync(outDir).filter((f) => f.endsWith(".usage.json")).sort()) {
  const qid = file.replace(/\.usage\.json$/, "");
  const usage = JSON.parse(fs.readFileSync(path.join(outDir, file), "utf8"));
  const dumpPath = path.join(outDir, `${qid}.prompt_dump.txt`);
  const dump = fs.existsSync(dumpPath) ? fs.readFileSync(dumpPath, "utf8") : "";
  const serverLogPath = path.join(runRoot, qid, "server.log");
  const serverLog = fs.existsSync(serverLogPath) ? fs.readFileSync(serverLogPath, "utf8") : "";
  const output = fs.readFileSync(path.join(outDir, `${qid}.output.txt`), "utf8");

  const block = memoryBlock(dump);
  const headers = ["[현재기억]", "[최근 기억 · T", "[EPISODIC MEMORY - RETRIEVED FACTS]", "[Memory — 참고"];
  const sections = {
    global: section(block, "[현재기억]", headers.filter((h) => h !== "[현재기억]")),
    medium: section(block, "[최근 기억 · T", ["[EPISODIC MEMORY - RETRIEVED FACTS]", "[Memory — 참고"]),
    episodic: section(block, "[EPISODIC MEMORY - RETRIEVED FACTS]", ["[Memory — 참고"]),
    relationship: section(block, "[Memory — 참고", []),
    raw_history: rawHistory(dump),
  };
  const mediumRanges = [...block.matchAll(/\[최근 기억 · T(\d+)–(\d+)\]/g)].map((m) => `T${m[1]}-${m[2]}`);
  const episodicLines = sections.episodic.split("\n").filter((l) => /^- \[T\d+\]/.test(l));

  const presence = {};
  for (const [event, keys] of Object.entries(KEYS)) {
    presence[event] = Object.fromEntries(
      [...Object.entries(sections), ["output", output]].map(([name, text]) => [name, keys.filter((k) => text.includes(k))])
    );
  }

  fs.writeFileSync(path.join(evidenceDir, "memory-blocks", `${qid}.memory-block.txt`), block + "\n");
  fs.copyFileSync(path.join(outDir, `${qid}.output.txt`), path.join(evidenceDir, "outputs", `${qid}.output.txt`));

  rows.push({
    qid,
    model: usage.model,
    generation_status: usage.generation_status,
    chars: usage.chars,
    chars_no_space: usage.chars_no_space,
    main_rp_krw: usage.main_rp.reduce((n, r) => n + r.krw, 0),
    main_rp_input_tokens: usage.main_rp[0]?.input_tokens ?? null,
    main_rp_output_tokens: usage.main_rp[0]?.output_tokens ?? null,
    run_total_krw: usage.run_total_krw,
    memory_health: memoryHealth(serverLog),
    memory_block_chars: block.length,
    global_chars: sections.global.length,
    medium_ranges: mediumRanges,
    episodic_injected: episodicLines,
    presence,
  });
}

fs.writeFileSync(path.join(evidenceDir, "runs-summary.json"), JSON.stringify(rows, null, 1));
for (const r of rows) {
  console.log(
    `${r.qid}\tchars=${r.chars}/${r.chars_no_space}\tkrw=${r.run_total_krw}\tglobal=${r.global_chars}\tmedium=${r.medium_ranges.length}\tepisodic=${r.episodic_injected.length}\tcand=${r.memory_health?.episodic_candidate_count ?? "?"}`
  );
}
console.log(`total_krw=${Math.round(rows.reduce((n, r) => n + r.run_total_krw, 0) * 100) / 100}`);
