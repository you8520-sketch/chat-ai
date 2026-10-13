import { execSync } from "child_process";
import fs from "fs";

const BASE = process.argv[2] ?? "56c9085ee585c75c367d3821c1de701a9384830e";
const show = (path) => execSync(`git show ${BASE}:${path}`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
const cur = (path) => fs.readFileSync(path, "utf8");
const read = (path, which) => {
  try { return which === "before" ? show(path) : cur(path); } catch { return ""; }
};
const bundle = (which) => ({
  client: read("src/app/creator/CreatorClient.tsx", which),
  form: read("src/components/WithdrawalForm.tsx", which),
  parts: read("src/components/creator/CreatorDashboardParts.tsx", which) + read("src/components/creator/CreatorActionParts.tsx", which),
  comments: read("src/components/CommentsEnabledToggle.tsx", which),
  notif: read("src/components/CreatorNotificationPrefs.tsx", which),
});
const checks = [
  ["share chart hides amount/percent until hover (opacity-0 group-hover)", (b) => /opacity-0[\s\S]{0,80}group-hover:opacity-100/.test(b.client + b.parts), false],
  ["share chart truncates character names (truncate)", (b) => /truncate/.test((b.client + b.parts).match(/function CharacterEarningShareChart[\s\S]*?\n}\n/)?.[0] ?? ""), false],
  ["period toggle exposes aria-pressed", (b) => /aria-pressed=\{period === id\}/.test(b.client + b.parts), true],
  ["tabs expose role=tablist/tab/tabpanel", (b) => /role="tablist"/.test(b.client) && /role="tab"/.test(b.client) && /role="tabpanel"/.test(b.client), true],
  ["exchange input has a programmatic label (htmlFor)", (b) => /htmlFor="creator-exchange-amount"/.test(b.client + b.parts), true],
  ["withdraw inputs have programmatic labels (htmlFor)", (b) => /htmlFor=\{ids\.amount\}/.test(b.form), true],
  ["profile textarea has a programmatic label (htmlFor)", (b) => /htmlFor="creator-profile-html"/.test(b.client), true],
  ["exchange request recovers busy state on network failure (finally)", (b) => /finally \{\s*setBusy\(false\)/.test(b.client), true],
  ["withdraw request recovers busy state on network failure (finally)", (b) => /finally \{\s*setBusy\(false\)/.test(b.form), true],
  ["profile save result is rendered inside the profile tab", (b) => /<ScopedNotice notice=\{profileNotice\}/.test(b.client), true],
  ["reversed earnings carry a text label, not only strike-through", (b) => /적립 취소/.test(b.client + b.parts), true],
  ["withdrawal ineligibility/short/pending reasons share one gate banner", (b) => /WithdrawalGateBanner/.test(b.form), true],
  ["error paragraphs announce via role=alert (toggle + prefs)", (b) => /role="alert"/.test(b.comments) && /role="alert"/.test(b.notif), true],
  ["notice delete button names the notice for assistive tech", (b) => /aria-label=\{`공지 삭제: \$\{notice\.title\}`\}/.test(b.client), true],
  ["public creator page is linked from the dashboard", (b) => /\/creator\/\$\{creatorId\}/.test(b.client), true],
  ["unit legend explains CP / P / ₩", (b) => /UnitLegend/.test(b.client) && /출금 실수령 금액/.test(b.parts), true],
  // invariants: must hold both before and after
  ["INVARIANT exchange POST body is { amount }", (b) => /JSON\.stringify\(\{ amount \}\)/.test(b.client), true],
  ["INVARIANT withdraw POST body keys", (b) => /amount: amountNum,\s*bankName,\s*accountNumber,\s*residentNumber,\s*taxConsent: true/.test(b.form), true],
  ["INVARIANT withdraw uses calcWithdrawalBreakdown(amountNum)", (b) => /calcWithdrawalBreakdown\(amountNum\)/.test(b.form), true],
  ["INVARIANT withdraw gate = canSubmit conditions incl. WITHDRAWAL_MIN_CP & balance", (b) => /amountNum >= WITHDRAWAL_MIN_CP/.test(b.form) && /amountNum <= creatorPoints/.test(b.form), true],
  ["INVARIANT bio preview sanitized", (b) => /sanitizeCreatorHtml\(profileHtml\)/.test(b.client), true],
  ["INVARIANT notice delete confirm", (b) => /confirm\("이 공지를 삭제할까요\?"\)/.test(b.client), true],
];
const rows = checks.map(([name, fn, want]) => {
  const before = fn(bundle("before"));
  const after = fn(bundle("after"));
  return { name, before, after, want, ok: after === want };
});
const pad = (s, n) => s + " ".repeat(Math.max(0, n - [...s].length));
console.log(`base ${BASE}`);
for (const r of rows) console.log(`${r.ok ? "PASS" : "FAIL"}  before=${pad(String(r.before), 5)} after=${pad(String(r.after), 5)}  ${r.name}`);
const changed = rows.filter((r) => r.before !== r.after && !r.name.startsWith("INVARIANT")).length;
const inv = rows.filter((r) => r.name.startsWith("INVARIANT"));
console.log(`\nimproved: ${changed}/${rows.length - inv.length}; invariants held: ${inv.filter((r) => r.before === r.after && r.ok).length}/${inv.length}; all-after-ok: ${rows.every((r) => r.ok)}`);
process.exit(rows.every((r) => r.ok) ? 0 : 1);
