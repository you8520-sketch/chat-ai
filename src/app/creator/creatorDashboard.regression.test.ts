import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as React from "react";
import type { ReactElement, ReactNode } from "react";

import {
  CharacterEarningShareChart,
  EARNING_SHARE_VISIBLE_ROWS,
  RecentEarningsList,
  TierLadder,
  WithdrawalGateBanner,
} from "@/components/creator/CreatorDashboardParts";
import {
  allTierConditions,
  creatorNextActions,
  earningSharePercent,
  withdrawalGate,
} from "@/lib/creatorDashboardView";
import {
  CREATOR_REWARD_RATE,
  CREATOR_REWARD_RATE_PRO,
  CREATOR_REWARD_RATE_SPROUT,
  WITHDRAWAL_MIN_CP,
  type CreatorCharacterEarningShare,
  type CreatorDashboard,
  type CreatorEarningRow,
} from "@/lib/creatorShared";

// tsx compiles tsconfig `jsx: preserve` with the classic factory, so the parts need a global React.
(globalThis as { React?: typeof React }).React = React;

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const client = read("./CreatorClient.tsx");
const withdrawalForm = read("../../components/WithdrawalForm.tsx");

type AnyElement = ReactElement<{ children?: ReactNode } & Record<string, unknown>>;

function walk(node: ReactNode, visit: (element: AnyElement) => void): void {
  if (node == null || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  if (typeof node !== "object") return;
  const element = node as AnyElement;
  if (typeof element.type === "function") {
    walk((element.type as (props: unknown) => ReactNode)(element.props), visit);
    return;
  }
  visit(element);
  walk(element.props.children, visit);
}

function textOf(node: ReactNode): string {
  const out: string[] = [];
  const collect = (value: ReactNode): void => {
    if (value == null || typeof value === "boolean") return;
    if (typeof value === "string" || typeof value === "number") {
      out.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    const element = value as AnyElement;
    if (typeof element.type === "function") {
      collect((element.type as (props: unknown) => ReactNode)(element.props));
      return;
    }
    collect(element.props.children);
  };
  collect(node);
  return out.join("");
}

function tier(overrides: Partial<CreatorDashboard["tier"]> = {}): CreatorDashboard["tier"] {
  return {
    characterCount: 0,
    publicCharacterCount: 0,
    monthlySpentOnChars: 0,
    totalChats: 0,
    rewardRate: 0,
    tierLevel: "sprout",
    isPro: false,
    ...overrides,
  } as CreatorDashboard["tier"];
}

function dashboard(overrides: Partial<CreatorDashboard> = {}): CreatorDashboard {
  return {
    creatorPoints: 0,
    totalReward: 0,
    totalSpentOnChars: 0,
    tier: tier(),
    characters: [],
    characterEarningShares: { day: [], week: [], month: [] },
    recentEarnings: [],
    recentLogs: [],
    recentWithdrawals: [],
    hasPendingWithdrawal: false,
    withdrawal: { canWithdraw: true, verifiedRealName: "가상 사용자", blockReason: null },
    creatorCommentsEnabled: true,
    notifyCharacterLikes: true,
    notifyProfileComments: true,
    creatorProfileHtml: "",
    creatorNoticeHtml: "",
    creatorNotices: [],
    ...overrides,
  } as CreatorDashboard;
}

function share(id: number, name: string, reward: number, ratio: number): CreatorCharacterEarningShare {
  return { id, name, emoji: "🙂", hue: 200, assets: "[]", images: "[]", period_spent: reward * 10, period_reward: reward, share_ratio: ratio };
}

describe("creator dashboard: tier rows keep the canonical conditions", () => {
  const pcts = [
    Math.round(CREATOR_REWARD_RATE_SPROUT * 100),
    Math.round(CREATOR_REWARD_RATE * 100),
    Math.round(CREATOR_REWARD_RATE_PRO * 100),
  ] as const;

  it("shows below-threshold creators as no tier at all (not 'confirmed')", () => {
    const rows = allTierConditions(tier({ characterCount: 1 }), ...pcts);
    assert.deepEqual(rows.map((r) => [r.key, r.met, r.isCurrent]), [
      ["sprout", false, false],
      ["standard", false, false],
      ["pro", false, false],
    ]);
    assert.deepEqual(rows.map((r) => r.ratePct), [4, 8, 12]);
  });

  it("marks only the server-resolved tier as current", () => {
    const rows = allTierConditions(
      tier({ characterCount: 4, publicCharacterCount: 4, totalChats: 6000, rewardRate: 0.08, tierLevel: "standard" }),
      ...pcts,
    );
    assert.deepEqual(rows.map((r) => [r.key, r.met, r.isCurrent]), [
      ["sprout", true, false],
      ["standard", true, true],
      ["pro", false, false],
    ]);
    assert.equal(rows[1].condition, "캐릭터 2개 이상 공개유지 · 통합 대화 5,000회+");
  });

  it("derives requirement progress only from the payload and constants", () => {
    const rows = allTierConditions(tier({ characterCount: 3, publicCharacterCount: 1, totalChats: 4200 }), ...pcts);
    assert.deepEqual(rows[1].requirements, [
      { label: "공개 캐릭터", current: 1, target: 2, unit: "개" },
      { label: "통합 대화", current: 4200, target: 5000, unit: "회" },
    ]);
    const html = textOf(React.createElement(TierLadder, { rows }));
    assert.match(html, /1 \/ 2개미충족/);
    assert.match(html, /4,200 \/ 5,000회미충족/);
  });

  it("never claims a met condition is the confirmed tier", () => {
    const rows = allTierConditions(tier({ characterCount: 2, publicCharacterCount: 2, totalChats: 9000, rewardRate: 0.04 }), ...pcts);
    const text = textOf(React.createElement(TierLadder, { rows }));
    assert.match(text, /서버가 판정/);
    assert.doesNotMatch(text, /등급 확정|승급 완료/);
  });
});

describe("creator dashboard: per-character share is readable as text", () => {
  const noop = () => undefined;

  it("keeps the existing percent rounding and zero-total behaviour", () => {
    assert.equal(earningSharePercent(1000, 0.12345), 12.3);
    assert.equal(earningSharePercent(1000, 0.0004), 0);
    assert.equal(earningSharePercent(0, 0.5), 0);
  });

  it("renders name, percent and CP as always-visible text instead of hover-only labels", () => {
    const rows = [share(1, "아주 긴 이름의 캐릭터가 한 줄을 넘어가서 두 줄 이상으로 이어지는 경우", 600, 0.6), share(2, "둘째", 400, 0.4)];
    const tree = CharacterEarningShareChart({ rows, period: "week", selectedId: null, onPeriodChange: noop, onSelect: noop });
    const text = textOf(tree);
    assert.match(text, /아주 긴 이름의 캐릭터가 한 줄을 넘어가서 두 줄 이상으로 이어지는 경우/);
    assert.match(text, /60%/);
    assert.match(text, /600CP/);
    assert.match(text, /40%/);
    let hoverOnly = 0;
    let truncated = 0;
    walk(tree, (el) => {
      const cls = String(el.props.className ?? "");
      if (/opacity-0|group-hover:opacity-100/.test(cls)) hoverOnly += 1;
      if (/\btruncate\b/.test(cls)) truncated += 1;
    });
    assert.equal(hoverOnly, 0);
    assert.equal(truncated, 0);
  });

  it("exposes the period choice and row selection as pressed state", () => {
    const rows = [share(1, "하나", 10, 1)];
    const tree = CharacterEarningShareChart({ rows, period: "day", selectedId: 1, onPeriodChange: noop, onSelect: noop });
    const pressed: Array<[string, unknown]> = [];
    walk(tree, (el) => {
      if (el.type === "button") pressed.push([textOf(el.props.children as ReactNode), el.props["aria-pressed"]]);
    });
    assert.deepEqual(pressed.slice(0, 3), [
      ["하루", true],
      ["일주일", false],
      ["한달", false],
    ]);
    assert.equal(pressed[3][1], true);
  });

  it("keeps every row but folds the tail of long lists", () => {
    const rows = Array.from({ length: 12 }, (_, i) => share(i + 1, `캐릭터 ${i + 1}번`, 12 - i, (12 - i) / 78));
    const tree = CharacterEarningShareChart({ rows, period: "month", selectedId: null, onPeriodChange: noop, onSelect: noop });
    const text = textOf(tree);
    assert.match(text, new RegExp(`나머지 캐릭터 ${12 - EARNING_SHARE_VISIBLE_ROWS}개 더 보기`));
    for (let i = 1; i <= 12; i += 1) assert.match(text, new RegExp(`캐릭터 ${i}번`));
  });

  it("explains an empty period instead of rendering silent zero bars", () => {
    const rows = [share(1, "하나", 0, 0)];
    const text = textOf(
      CharacterEarningShareChart({ rows, period: "day", selectedId: null, onPeriodChange: noop, onSelect: noop }),
    );
    assert.match(text, /이 기간에는 적립된 CP가 없어요/);
    assert.match(text, /0%/);
  });
});

describe("creator dashboard: withdrawal gate explains why", () => {
  const base = { creatorPoints: 45_000, hasPendingWithdrawal: false, withdrawal: dashboard().withdrawal };

  it("separates blocked, pending, short and ready", () => {
    assert.equal(
      withdrawalGate({ ...base, withdrawal: { canWithdraw: false, verifiedRealName: "", blockReason: "성인인증이 필요합니다." } }).state,
      "blocked",
    );
    assert.equal(withdrawalGate({ ...base, hasPendingWithdrawal: true }).state, "pending");
    assert.equal(withdrawalGate({ ...base, creatorPoints: WITHDRAWAL_MIN_CP - 1 }).state, "short");
    assert.equal(withdrawalGate(base).state, "ready");
  });

  it("states the real shortfall from the owner's minimum", () => {
    const gate = withdrawalGate({ ...base, creatorPoints: 1_250.5 });
    assert.match(gate.detail, /30,000CP/);
    assert.match(gate.detail, /28,749\.5CP가 더 필요/);
  });

  it("surfaces the owner's block reason verbatim", () => {
    const gate = withdrawalGate({
      ...base,
      withdrawal: { canWithdraw: false, verifiedRealName: "", blockReason: "성인·실명 인증이 필요합니다." },
    });
    assert.equal(gate.detail, "성인·실명 인증이 필요합니다.");
    assert.match(textOf(React.createElement(WithdrawalGateBanner, { gate })), /신청 불가/);
  });
});

describe("creator dashboard: next actions", () => {
  it("points a brand-new creator to the studio and shows no payout call-to-action", () => {
    const actions = creatorNextActions(dashboard());
    assert.equal(actions[0].key, "first-character");
    assert.equal(actions[0].href, "/studio");
    assert.ok(!actions.some((a) => a.key.startsWith("withdraw")));
  });

  it("counts the real remaining characters for the first tier", () => {
    const actions = creatorNextActions(dashboard({ characters: [{} as CreatorDashboard["characters"][number]], tier: tier({ characterCount: 1 }) }));
    assert.equal(actions[0].key, "reach-sprout");
    assert.match(actions[0].text, /1개 더/);
  });

  it("offers withdrawal only when the gate is ready", () => {
    const ready = creatorNextActions(dashboard({ creatorPoints: 50_000, tier: tier({ rewardRate: 0.08, tierLevel: "standard", characterCount: 3 }), characters: [{} as CreatorDashboard["characters"][number]] }));
    assert.ok(ready.some((a) => a.key === "withdraw-ready"));
    const short = creatorNextActions(dashboard({ creatorPoints: 500, tier: tier({ rewardRate: 0.08, tierLevel: "standard", characterCount: 3 }), characters: [{} as CreatorDashboard["characters"][number]] }));
    assert.ok(!short.some((a) => a.key === "withdraw-ready"));
  });
});

describe("creator dashboard: reversed earnings are not colour-only", () => {
  it("labels reversed rows as cancelled and strikes the amount", () => {
    const rows: CreatorEarningRow[] = [
      { id: 1, character_name: "취소된 적립", points_spent: 1000, reward_amount: 80, reversed: 1, created_at: "2026-10-01 10:00:00" },
      { id: 2, character_name: "정상 적립", points_spent: 1000, reward_amount: 80, reversed: 0, created_at: "2026-10-01 11:00:00" },
    ];
    const text = textOf(React.createElement(RecentEarningsList, { rows }));
    assert.equal((text.match(/적립 취소/g) ?? []).length, 1);
    assert.match(text, /10-01 10:00/);
  });
});

describe("creator dashboard: owners and contracts are untouched", () => {
  it("keeps the exchange/withdraw/notice/profile endpoints and payload shapes", () => {
    assert.match(client, /fetch\("\/api\/creator", \{\s*method: "POST",[\s\S]*?JSON\.stringify\(\{ amount \}\)/);
    assert.match(client, /fetch\("\/api\/creator", \{\s*method: "PATCH"[\s\S]*?creator_profile_html: profileHtml/);
    assert.match(client, /fetch\("\/api\/creator\/notices", \{\s*method: "POST"[\s\S]*?\{ title: noticeTitle, content: noticeContent \}/);
    assert.match(client, /method: "DELETE"[\s\S]*?JSON\.stringify\(\{ id \}\)/);
    assert.match(withdrawalForm, /fetch\("\/api\/creator\/withdraw"/);
    assert.match(withdrawalForm, /amount: amountNum,\s*bankName,\s*accountNumber,\s*residentNumber,\s*taxConsent: true/);
  });

  it("keeps the confirmation prompts before exchange, delete and withdrawal", () => {
    assert.match(client, /유료 포인트 \$\{fmt\(amount\)\}P로 1:1 교환할까요\?/);
    assert.match(client, /confirm\("이 공지를 삭제할까요\?"\)/);
    assert.match(withdrawalForm, /"출금을 신청할까요\?"/);
    assert.match(withdrawalForm, /실수령 예정: ₩\$\{breakdown\.payoutAmount\.toLocaleString\(\)\}/);
  });

  it("derives rates, fees and minimums from creatorShared instead of screen literals", () => {
    for (const source of [client, withdrawalForm, read("../../components/creator/CreatorDashboardParts.tsx"), read("../../lib/creatorDashboardView.ts")]) {
      assert.doesNotMatch(source, /(?<![\[\w.])0\.(04|08|12|033|2)\b(?!\])/);
      assert.doesNotMatch(source, /\b30_?000\b(?!CP)/);
    }
    assert.match(withdrawalForm, /calcWithdrawalBreakdown\(amountNum\)/);
    assert.match(withdrawalForm, /amountNum >= WITHDRAWAL_MIN_CP/);
    assert.match(withdrawalForm, /amountNum <= creatorPoints/);
  });

  it("keeps the bio sanitizer in the preview path", () => {
    assert.match(client, /sanitizeCreatorHtml\(profileHtml\)/);
    assert.match(client, /dangerouslySetInnerHTML=\{\{ __html: profilePreviewHtml \}\}/);
    assert.doesNotMatch(client, /dangerouslySetInnerHTML=\{\{ __html: profileHtml \}\}/);
  });

  it("recovers the busy state when the network drops mid-request", () => {
    assert.match(client, /\} finally \{\s*setBusy\(false\);/);
    assert.match(withdrawalForm, /\} finally \{\s*setBusy\(false\);/);
  });

  it("exposes tabs, fields and results to assistive tech", () => {
    assert.match(client, /role="tablist"/);
    assert.match(client, /role="tab"/);
    assert.match(client, /role="tabpanel"/);
    assert.match(client, /htmlFor="creator-profile-html"/);
    assert.match(client, /htmlFor="creator-notice-title"/);
    assert.match(withdrawalForm, /htmlFor=\{ids\.amount\}/);
    assert.match(withdrawalForm, /ScopedNotice/);
  });
});
