/**
 * 진단: user 4 × character 14 채팅의 영수증 "컨텍스트 분해" vs 실제 프롬프트 구성 비교.
 * 실행: npx.cmd tsx scripts/diagnose-receipt-breakdown.ts
 */
import Database from "better-sqlite3";
import { buildContext } from "@/services/contextBuilder";
import { loadCharacterChunks } from "@/lib/characterChunks";
import { formatSelectedPersonaForPrompt } from "@/lib/userPersonas";
import { formatUserNoteForPrompt } from "@/lib/persona";
import { estimateTokens } from "@/lib/tokenEstimate";
import { resolveCharacterGender } from "@/lib/characterGender";

const db = new Database("data/app.db", { readonly: true });

const chat = db
  .prepare(
    `SELECT * FROM chats WHERE user_id=4 AND character_id=14 ORDER BY id DESC LIMIT 1`
  )
  .get() as any;
if (!chat) throw new Error("no chat for user 4 character 14");
console.log(`chat id=${chat.id} title=${JSON.stringify(chat.title)}`);

const ch = db.prepare(`SELECT * FROM characters WHERE id=14`).get() as any;
const user = db.prepare(`SELECT * FROM users WHERE id=4`).get() as any;

// 최근 영수증(usage) 확인
const lastUsageRow = db
  .prepare(
    `SELECT id, usage FROM messages WHERE chat_id=? AND role='assistant' AND usage IS NOT NULL ORDER BY id DESC LIMIT 1`
  )
  .get(chat.id) as any;
if (lastUsageRow?.usage) {
  const u = JSON.parse(lastUsageRow.usage);
  console.log(`\n=== 저장된 최근 영수증 (msg ${lastUsageRow.id}) ===`);
  console.log(`model=${u.model} input=${u.input} output=${u.output} cost=${u.cost}`);
  for (const b of u.breakdown ?? []) console.log(`  - ${b.label}: ${b.tokens} tokens (${b.pct}%)`);
}

// ---- 원본 소스 길이 ----
console.log(`\n=== 캐릭터 원본 필드 길이 (chars) ===`);
console.log(`system_prompt: ${(ch.system_prompt ?? "").length}`);
console.log(`world:         ${(ch.world ?? "").length}`);
console.log(`example_dialog:${(ch.example_dialog ?? "").length}`);
console.log(`setting_chunks(serialized): ${(ch.setting_chunks ?? "").length}`);

const chunks = loadCharacterChunks({
  id: ch.id, name: ch.name, gender: ch.gender,
  system_prompt: ch.system_prompt, world: ch.world, example_dialog: ch.example_dialog,
  setting_chunks: ch.setting_chunks, speech_profile: ch.speech_profile,
});
const chunkChars = chunks.reduce((s, c) => s + (c.content?.length ?? 0), 0);
console.log(`chunks: n=${chunks.length} totalChars=${chunkChars}`);
for (const c of chunks) {
  console.log(`  [${c.importance}/${c.category}] ${c.content.length} chars`);
}

// route.ts 방식 charPromptChars (이중계상 검증)
const charPromptChars =
  chunkChars + (ch.world?.length ?? 0) + (ch.example_dialog?.length ?? 0);
console.log(`route.ts charPromptChars (chunks + world + example_dialog 재합산) = ${charPromptChars}`);

// ---- 페르소나 ----
const personaRow = db
  .prepare(`SELECT * FROM user_personas WHERE id=?`)
  .get(chat.selected_persona_id) as any;
const personaDisplayName = personaRow?.name?.trim() || user.nickname;
const userPersonaPrompt = formatSelectedPersonaForPrompt(
  personaDisplayName,
  personaRow?.gender ?? "other",
  personaRow?.description ?? ""
);
console.log(`\n=== 페르소나 ===`);
console.log(`raw description: ${(personaRow?.description ?? "").length} chars`);
console.log(`formatSelectedPersonaForPrompt 결과: ${(userPersonaPrompt ?? "").length} chars`);

const effectiveUserNote = (chat.user_note ?? "").trim();
const userNotePrompt = formatUserNoteForPrompt(effectiveUserNote);

// ---- 히스토리 ----
const msgRows = db
  .prepare(`SELECT role, content FROM messages WHERE chat_id=? ORDER BY id ASC`)
  .all(chat.id) as { role: "user" | "assistant"; content: string }[];
const history = msgRows
  .filter((m) => m.role === "user" || m.role === "assistant")
  .map((m) => ({ role: m.role, content: m.content }));
const lastUser = [...history].reverse().find((m) => m.role === "user");
const currentUserMessage = lastUser?.content ?? "안녕";
const shortTermHistory = history.slice(0, -1).slice(-40);

// ---- 메모리 ----
const memRow = db
  .prepare(`SELECT * FROM chat_memories WHERE chat_id=?`)
  .get(chat.id) as any;
const longTermMemory = (memRow?.recent_summary ?? chat.current_summary ?? chat.memory ?? "").trim();
console.log(`\n장기기억: ${longTermMemory.length} chars`);

// ---- buildContext 실제 호출 ----
const assetTags: string[] = (() => {
  try {
    const assets = JSON.parse(ch.assets ?? "[]");
    return [...new Set(assets.map((a: any) => a.tag).filter(Boolean))] as string[];
  } catch { return []; }
})();

const built = buildContext({
  charName: ch.name,
  chunks,
  userNickname: user.nickname,
  userPersona: userPersonaPrompt ?? undefined,
  userNote: userNotePrompt ?? undefined,
  longTermMemory,
  shortTermHistory,
  currentUserMessage,
  nsfw: true,
  gender: resolveCharacterGender(ch.gender),
  assetTags: assetTags.length ? assetTags : undefined,
  memoryMeta: undefined,
  modelId: "gemini-3-flash-preview",
  userImpersonation: false,
  personaDisplayName,
  completedTurns: Math.floor(history.length / 2),
  userPersonaGender: personaRow?.gender ?? "other",
  provider: "gemini",
  genres: [],
});

console.log(`\n=== 실제 조립된 system prompt 섹션별 (estimateTokens=chars*0.9) ===`);
let sysTotal = 0;
for (const s of built.meta.trackedSections ?? []) {
  const t = estimateTokens(s.text);
  sysTotal += t;
  console.log(`  ${s.category.padEnd(16)} ${String(t).padStart(6)} tok  ${s.text.length} chars  ${s.label}`);
}
console.log(`  system 합계: ${sysTotal} tok (${built.systemPrompt.length} chars)`);
const histTokens = built.history.reduce((s, m) => s + estimateTokens(m.content), 0);
console.log(`  history(+현재 턴): ${histTokens} tok`);
console.log(`  총 추정 입력: ${sysTotal + histTokens} tok`);

const audit = built.meta.promptAudit;
if (audit) {
  console.log(`\n=== promptAudit breakdown ===`);
  for (const [k, v] of Object.entries(audit.breakdown)) console.log(`  ${k}: ${v}`);
  console.log(`  systemPromptTokens=${audit.systemPromptTokens} historyTokens=${audit.historyTokens} current=${audit.currentUserTurnTokens} total=${audit.totalAssembledTokens}`);
}

// ---- 현재 영수증 로직 재현 ----
const draftInput = audit?.totalAssembledTokens ?? 0;
const shortTermChars = built.history.slice(0, -1).reduce((s, m) => s + m.content.length, 0);
const assetTagBlock = assetTags.length > 0 ? `[감정 에셋 태그] ${assetTags.join(", ")}`.length : 0;
const sections = [
  { label: "최근 대화 (토큰 트림)", chars: shortTermChars },
  { label: "장기 기억", chars: longTermMemory.length },
  { label: "캐릭터 프롬프트", chars: charPromptChars },
  { label: "선택 페르소나", chars: (userPersonaPrompt ?? "").length },
  { label: "유저 노트", chars: (userNotePrompt ?? "").length },
  { label: "에셋 태그", chars: assetTagBlock },
  { label: "호칭·메타", chars: 0 },
];
const totalChars = Math.max(1, sections.reduce((s, x) => s + x.chars, 0));
console.log(`\n=== (구) 영수증 로직 재현 (raw chars 비례 배분, draftInput=${draftInput}) ===`);
for (const s of sections) {
  const tok = Math.round((s.chars / totalChars) * draftInput);
  const pct = Math.round((s.chars / totalChars) * 100);
  if (tok > 0) console.log(`  - ${s.label}: ${tok} tokens (${pct}%) [raw ${s.chars} chars]`);
}
console.log(`  (시스템 규칙은 분모에 없음 → 모든 버킷이 부풀려짐)`);

// ---- 신규 영수증 로직 (route.ts 수정본과 동일) ----
let sysRulesEst = 0, charPromptEst = 0, personaEst = 0, userNoteEst = 0, memoryEst = 0, assetTagEst = 0, memoryMetaEst = 0;
for (const s of built.meta.trackedSections ?? []) {
  const t = estimateTokens(s.text);
  if (s.id === "rule-asset-tags") assetTagEst += t;
  else if (s.id === "memory-meta") memoryMetaEst += t;
  else if (s.category === "persona") personaEst += t;
  else if (s.category === "userNote") userNoteEst += t;
  else if (s.category === "memory") memoryEst += t;
  else if (s.category === "systemRules") sysRulesEst += t;
  else charPromptEst += t;
}
const historyEst = built.history.reduce((s, m) => s + estimateTokens(m.content ?? ""), 0);
const newSections = [
  { label: "최근 대화 (토큰 트림)", est: historyEst },
  { label: "캐릭터 프롬프트", est: charPromptEst },
  { label: "시스템 프롬프트 (고정 규칙)", est: sysRulesEst },
  { label: "장기 기억", est: memoryEst },
  { label: "선택 페르소나", est: personaEst },
  { label: "유저 노트", est: userNoteEst },
  { label: "에셋 태그", est: assetTagEst },
  { label: "호칭·메타", est: memoryMetaEst },
];
const totalEst = Math.max(1, newSections.reduce((s, x) => s + x.est, 0));
console.log(`\n=== (신) 영수증 로직 — 실제 주입 섹션 기준 (draftInput=${draftInput}) ===`);
for (const s of newSections) {
  const tok = Math.round((s.est / totalEst) * draftInput);
  const pct = Math.round((s.est / totalEst) * 100);
  if (tok > 0) console.log(`  - ${s.label}: ${tok} tokens (${pct}%)`);
}
