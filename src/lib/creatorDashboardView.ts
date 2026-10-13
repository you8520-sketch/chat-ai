import {
  CREATOR_PRO_MIN_CHARACTERS,
  CREATOR_PRO_MIN_TOTAL_CHATS,
  CREATOR_REWARD_RATE_SPROUT,
  CREATOR_SPROUT_MIN_CHARACTERS,
  CREATOR_STANDARD_MIN_CHARACTERS,
  CREATOR_STANDARD_MIN_TOTAL_CHATS,
  WITHDRAWAL_MIN_CP,
  type CreatorDashboard,
} from "@/lib/creatorShared";
import { formatPoints } from "@/lib/billingDisplay";

/**
 * Display-only derivations for the creator dashboard. Every number comes from the dashboard
 * payload or the constants in `creatorShared`; nothing here decides tiers, accrual or payouts.
 */

export type TierRequirement = {
  label: string;
  current: number;
  target: number;
  unit: string;
};

export type TierConditionRow = {
  key: string;
  label: string;
  ratePct: number;
  condition: string;
  current?: string;
  requirements: TierRequirement[];
  met: boolean;
  isCurrent: boolean;
};

export function allTierConditions(
  t: CreatorDashboard["tier"],
  sproutPct: number,
  basePct: number,
  proPct: number,
): TierConditionRow[] {
  const sproutMet = t.characterCount >= CREATOR_SPROUT_MIN_CHARACTERS;
  const standardMet =
    t.publicCharacterCount >= CREATOR_STANDARD_MIN_CHARACTERS &&
    t.totalChats >= CREATOR_STANDARD_MIN_TOTAL_CHATS;
  // 월간 소비 및 3개월 유지 여부는 서버에서 판정하고, 안내 문구에는 "기타 조건"으로만 노출한다.
  const proMet = t.tierLevel === "pro";

  return [
    {
      key: "sprout",
      label: "새싹 크리에이터",
      ratePct: sproutPct,
      condition: `캐릭터 ${CREATOR_SPROUT_MIN_CHARACTERS}개 이상 제작`,
      current: `현재 ${t.characterCount}개`,
      requirements: [
        { label: "제작한 캐릭터", current: t.characterCount, target: CREATOR_SPROUT_MIN_CHARACTERS, unit: "개" },
      ],
      met: sproutMet,
      isCurrent: t.tierLevel === "sprout" && sproutMet,
    },
    {
      key: "standard",
      label: "일반 크리에이터",
      ratePct: basePct,
      condition: `캐릭터 ${CREATOR_STANDARD_MIN_CHARACTERS}개 이상 공개유지 · 통합 대화 ${CREATOR_STANDARD_MIN_TOTAL_CHATS.toLocaleString()}회+`,
      current: `현재 공개 ${t.publicCharacterCount}개 · ${t.totalChats.toLocaleString()}회`,
      requirements: [
        { label: "공개 캐릭터", current: t.publicCharacterCount, target: CREATOR_STANDARD_MIN_CHARACTERS, unit: "개" },
        { label: "통합 대화", current: t.totalChats, target: CREATOR_STANDARD_MIN_TOTAL_CHATS, unit: "회" },
      ],
      met: standardMet,
      isCurrent: t.tierLevel === "standard",
    },
    {
      key: "pro",
      label: "프로",
      ratePct: proPct,
      condition: `공개 캐릭터 ${CREATOR_PRO_MIN_CHARACTERS}개 이상 · 총 대화 수 ${CREATOR_PRO_MIN_TOTAL_CHATS.toLocaleString()}회 이상 · 기타 조건 충족 시 자동 등업`,
      current: `현재 공개 ${t.publicCharacterCount}개 · 총 대화 수 ${t.totalChats.toLocaleString()}회`,
      requirements: [
        { label: "공개 캐릭터", current: t.publicCharacterCount, target: CREATOR_PRO_MIN_CHARACTERS, unit: "개" },
        { label: "총 대화 수", current: t.totalChats, target: CREATOR_PRO_MIN_TOTAL_CHATS, unit: "회" },
      ],
      met: proMet,
      isCurrent: t.tierLevel === "pro",
    },
  ];
}

export function earningSharePercent(totalReward: number, shareRatio: number): number {
  return totalReward > 0 ? Math.round(shareRatio * 1000) / 10 : 0;
}

export type WithdrawalGate =
  | { state: "blocked"; title: string; detail: string }
  | { state: "pending"; title: string; detail: string }
  | { state: "short"; title: string; detail: string }
  | { state: "ready"; title: string; detail: string };

export function withdrawalGate(
  data: Pick<CreatorDashboard, "creatorPoints" | "hasPendingWithdrawal" | "withdrawal">,
): WithdrawalGate {
  if (!data.withdrawal.canWithdraw) {
    return {
      state: "blocked",
      title: "지금은 출금을 신청할 수 없어요",
      detail: data.withdrawal.blockReason ?? "출금 신청 조건을 충족하지 않습니다.",
    };
  }
  if (data.hasPendingWithdrawal) {
    return {
      state: "pending",
      title: "출금 신청이 처리 중이에요",
      detail: "지급 대기(PENDING) 중인 신청이 있어 새로 신청할 수 없습니다.",
    };
  }
  if (data.creatorPoints < WITHDRAWAL_MIN_CP) {
    return {
      state: "short",
      title: "아직 출금 최소 금액에 못 미쳐요",
      detail: `최소 ${WITHDRAWAL_MIN_CP.toLocaleString()}CP부터 신청할 수 있어요. ${formatPoints(WITHDRAWAL_MIN_CP - data.creatorPoints)}CP가 더 필요합니다.`,
    };
  }
  return {
    state: "ready",
    title: "출금을 신청할 수 있어요",
    detail: `보유 CP가 최소 ${WITHDRAWAL_MIN_CP.toLocaleString()}CP 이상이고 신청 조건을 충족했어요.`,
  };
}

export type CreatorNextAction = {
  key: string;
  text: string;
  href?: string;
  target?: "exchange" | "withdraw" | "profile";
};

export function creatorNextActions(data: CreatorDashboard): CreatorNextAction[] {
  const actions: CreatorNextAction[] = [];
  const sproutPct = Math.round(CREATOR_REWARD_RATE_SPROUT * 100);
  if (data.characters.length === 0) {
    actions.push({
      key: "first-character",
      text: "첫 캐릭터를 만들고 공개하면 수익·등급 조건이 집계돼요.",
      href: "/studio",
    });
  } else if (data.tier.rewardRate <= 0) {
    const remain = Math.max(0, CREATOR_SPROUT_MIN_CHARACTERS - data.tier.characterCount);
    actions.push({
      key: "reach-sprout",
      text: `캐릭터를 ${remain}개 더 만들면 새싹 등급(${sproutPct}%)이 시작돼요.`,
      href: "/studio",
    });
  }
  const gate = withdrawalGate(data);
  if (gate.state === "ready") {
    actions.push({ key: "withdraw-ready", text: "출금 신청이 가능해요.", target: "withdraw" });
  } else if (gate.state === "pending") {
    actions.push({ key: "withdraw-pending", text: "출금 신청이 처리 중이에요. 지급이 끝나면 새로 신청할 수 있어요.", target: "withdraw" });
  }
  if (data.creatorPoints > 0) {
    actions.push({ key: "exchange", text: "보유 CP는 1:1로 유료 포인트(P)로 교환할 수 있어요.", target: "exchange" });
  }
  if (!data.creatorProfileHtml.trim() && data.characters.length > 0) {
    actions.push({ key: "profile", text: "크리에이터 소개를 채우면 제작자 페이지가 더 풍성해져요.", target: "profile" });
  }
  return actions.slice(0, 3);
}
