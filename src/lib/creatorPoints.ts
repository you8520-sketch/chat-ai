import { getDb } from "./db";
import { creditPoints, getPointBalance } from "./points";
import { LISTABLE_USER_CHAR } from "./characterVisibility";
import {
  CREATOR_PARTNER_MIN_CHARACTERS,
  CREATOR_PARTNER_MIN_MONTHLY_SPENT,
  CREATOR_PARTNER_RENEWAL_MAINTENANCE_RATE,
  CREATOR_PARTNER_TERM_MONTHS,
  CREATOR_PLUS_MIN_CHARACTERS,
  CREATOR_PLUS_MIN_TOTAL_CHATS,
  CREATOR_PRO_MIN_CHARACTERS,
  CREATOR_PRO_MIN_MONTHLY_SPENT,
  CREATOR_PRO_MIN_TOTAL_CHATS,
  CREATOR_REWARD_RATE,
  CREATOR_REWARD_RATE_EXCLUSIVE,
  CREATOR_REWARD_RATE_PARTNER,
  CREATOR_REWARD_RATE_PLUS,
  CREATOR_REWARD_RATE_PRO,
  CREATOR_STANDARD_MIN_CHARACTERS,
  WITHDRAWAL_MIN_CP,
  calcWithdrawalBreakdown,
  maskCreatorAccountNumber,
  roundCreatorAmount,
  type AccountInfo,
  type CreatorCharacterStat,
  type CreatorDashboard,
  type CreatorEarningRow,
  type CreatorTierInfo,
  type CreatorTierLevel,
  type WithdrawalRequestRow,
} from "./creatorShared";
import { getWithdrawalEligibility, personNamesMatch } from "./withdrawalEligibility";
import {
  CREATOR_PARTNER_RENEWAL_MIN_MONTHLY_SPENT,
  hasPartnerTierBenefit,
  syncPartnerTierStatus,
} from "./partnerTier";

export {
  CREATOR_PARTNER_MIN_CHARACTERS,
  CREATOR_PARTNER_MIN_MONTHLY_SPENT,
  CREATOR_PARTNER_RENEWAL_MAINTENANCE_RATE,
  CREATOR_PARTNER_TERM_MONTHS,
  CREATOR_PLUS_MIN_CHARACTERS,
  CREATOR_PLUS_MIN_TOTAL_CHATS,
  CREATOR_PRO_MIN_CHARACTERS,
  CREATOR_PRO_MIN_MONTHLY_SPENT,
  CREATOR_PRO_MIN_TOTAL_CHATS,
  CREATOR_REWARD_RATE,
  CREATOR_REWARD_RATE_EXCLUSIVE,
  CREATOR_REWARD_RATE_PARTNER,
  CREATOR_REWARD_RATE_PLUS,
  CREATOR_REWARD_RATE_PRO,
  CREATOR_STANDARD_MIN_CHARACTERS,
  CREATOR_TIER_LABELS,
  WITHDRAWAL_MIN_CP,
  WITHDRAWAL_TAX_RATE,
  WITHDRAWAL_PLATFORM_FEE_RATE,
  WITHDRAWAL_TOTAL_DEDUCTION_RATE,
  calcWithdrawalBreakdown,
  formatAccountInfoLabel,
  parseAccountInfo,
  type AccountInfo,
  type CreatorCharacterStat,
  type CreatorDashboard,
  type CreatorEarningRow,
  type CreatorTierInfo,
  type CreatorTierLevel,
  type CreatorWithdrawalRow,
  type WithdrawalBreakdown,
  type WithdrawalRequestRow,
  type WithdrawalStatus,
  type WithdrawalEligibility,
} from "./creatorShared";
export { CREATOR_PARTNER_RENEWAL_MIN_MONTHLY_SPENT } from "./partnerTier";

const roundAmount = roundCreatorAmount;

/** 전속 20% · 파트너 15% · 프로 12% · 플러스 10% · 기본 8% (상위 등급 우선 적용) */
export function getCreatorTierInfo(creatorId: number): CreatorTierInfo {
  const db = getDb();

  const userRow = db
    .prepare("SELECT creator_exclusive FROM users WHERE id = ?")
    .get(creatorId) as { creator_exclusive: number } | undefined;
  const isExclusive = userRow?.creator_exclusive === 1;

  const charRow = db
    .prepare(
      `SELECT COUNT(*) AS character_count,
              COALESCE(SUM(chats_count), 0) AS total_chats
       FROM characters
       WHERE creator_id = ? AND official = 0`
    )
    .get(creatorId) as { character_count: number; total_chats: number };

  const publicCharRow = db
    .prepare(
      `SELECT COUNT(*) AS public_character_count
       FROM characters
       WHERE creator_id = ? AND official = 0 AND ${LISTABLE_USER_CHAR}`
    )
    .get(creatorId) as { public_character_count: number };

  const monthlyRow = db
    .prepare(
      `SELECT COALESCE(SUM(points_spent), 0) AS monthly_spent
       FROM creator_earnings
       WHERE creator_id = ? AND reversed = 0
         AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`
    )
    .get(creatorId) as { monthly_spent: number };

  const characterCount = Number(charRow?.character_count ?? 0);
  const publicCharacterCount = Number(publicCharRow?.public_character_count ?? 0);
  const totalChats = Number(charRow?.total_chats ?? 0);
  const monthlySpentOnChars = roundAmount(Number(monthlyRow?.monthly_spent ?? 0));

  const partnerSync = syncPartnerTierStatus(db, creatorId, {
    publicCharacterCount,
    monthlySpentOnChars,
  });
  const qualifiesPartner = hasPartnerTierBenefit(
    partnerSync,
    publicCharacterCount,
    monthlySpentOnChars
  );
  const hasExclusiveContract = isExclusive;

  let tierLevel: CreatorTierLevel = "standard";
  let rewardRate = CREATOR_REWARD_RATE;

  if (hasExclusiveContract && qualifiesPartner) {
    tierLevel = "exclusive";
    rewardRate = CREATOR_REWARD_RATE_EXCLUSIVE;
  } else if (qualifiesPartner) {
    tierLevel = "partner";
    rewardRate = CREATOR_REWARD_RATE_PARTNER;
  } else if (
    publicCharacterCount >= CREATOR_PRO_MIN_CHARACTERS &&
    monthlySpentOnChars >= CREATOR_PRO_MIN_MONTHLY_SPENT
  ) {
    tierLevel = "pro";
    rewardRate = CREATOR_REWARD_RATE_PRO;
  } else if (
    characterCount >= CREATOR_PLUS_MIN_CHARACTERS &&
    totalChats >= CREATOR_PLUS_MIN_TOTAL_CHATS
  ) {
    tierLevel = "plus";
    rewardRate = CREATOR_REWARD_RATE_PLUS;
  }

  return {
    characterCount,
    publicCharacterCount,
    monthlySpentOnChars,
    totalChats,
    rewardRate,
    tierLevel,
    isExclusive: hasExclusiveContract && qualifiesPartner,
    isPro: tierLevel === "pro" || tierLevel === "partner" || tierLevel === "exclusive",
    partnerTerm: partnerSync.partnerTerm,
  };
}

export function resolveCreatorRewardRate(creatorId: number): number {
  return getCreatorTierInfo(creatorId).rewardRate;
}

export function getCreatorPointsBalance(userId: number): number {
  const row = getDb()
    .prepare("SELECT creator_points FROM users WHERE id=?")
    .get(userId) as { creator_points: number } | undefined;
  return roundAmount(Number(row?.creator_points ?? 0));
}

export function getCreatorDashboard(userId: number): CreatorDashboard {
  const db = getDb();
  const creatorPoints = getCreatorPointsBalance(userId);

  const characters = db
    .prepare(
      `SELECT c.id, c.name, c.emoji, c.hue, c.assets, c.images, c.chats_count, c.total_turns, c.likes,
              COALESCE(SUM(CASE WHEN ce.reversed=0 THEN ce.points_spent ELSE 0 END), 0) AS total_spent,
              COALESCE(SUM(CASE WHEN ce.reversed=0 THEN ce.reward_amount ELSE 0 END), 0) AS total_reward
       FROM characters c
       LEFT JOIN creator_earnings ce ON ce.character_id = c.id AND ce.creator_id = c.creator_id
       WHERE c.creator_id = ?
       GROUP BY c.id
       ORDER BY total_reward DESC, c.created_at DESC`
    )
    .all(userId) as CreatorCharacterStat[];

  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN reversed=0 THEN reward_amount ELSE 0 END), 0) AS total_reward,
              COALESCE(SUM(CASE WHEN reversed=0 THEN points_spent ELSE 0 END), 0) AS total_spent
       FROM creator_earnings WHERE creator_id=?`
    )
    .get(userId) as { total_reward: number; total_spent: number };

  const recentEarnings = db
    .prepare(
      `SELECT ce.id, ch.name AS character_name, ce.points_spent, ce.reward_amount, ce.reversed, ce.created_at
       FROM creator_earnings ce
       JOIN characters ch ON ch.id = ce.character_id
       WHERE ce.creator_id=?
       ORDER BY ce.created_at DESC, ce.id DESC
       LIMIT 30`
    )
    .all(userId) as CreatorEarningRow[];

  const recentLogs = db
    .prepare(
      `SELECT delta, reason, created_at FROM creator_point_logs
       WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 20`
    )
    .all(userId) as { delta: number; reason: string; created_at: string }[];

  const recentWithdrawals = listWithdrawalRequests(userId, 15);
  const pending = db
    .prepare(
      "SELECT COUNT(*) AS c FROM withdrawal_requests WHERE user_id=? AND status='PENDING'"
    )
    .get(userId) as { c: number };

  const profileRow = db
    .prepare("SELECT creator_comments_enabled, creator_profile_html, creator_notice_html FROM users WHERE id=?")
    .get(userId) as
    | { creator_comments_enabled: number; creator_profile_html: string; creator_notice_html: string }
    | undefined;

  return {
    creatorPoints,
    totalReward: roundAmount(Number(totals.total_reward)),
    totalSpentOnChars: roundAmount(Number(totals.total_spent)),
    tier: getCreatorTierInfo(userId),
    characters,
    recentEarnings,
    recentLogs,
    recentWithdrawals,
    hasPendingWithdrawal: Number(pending.c) > 0,
    withdrawal: getWithdrawalEligibility(userId),
    creatorCommentsEnabled: (profileRow?.creator_comments_enabled ?? 1) !== 0,
    creatorProfileHtml: profileRow?.creator_profile_html ?? "",
    creatorNoticeHtml: profileRow?.creator_notice_html ?? "",
  };
}

export function listWithdrawalRequests(userId: number, limit = 20): WithdrawalRequestRow[] {
  return getDb()
    .prepare(
      `SELECT id, requested_cp, tax_amount, platform_fee, payout_amount, account_info, status, created_at, processed_at
       FROM withdrawal_requests
       WHERE user_id=?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(userId, limit) as WithdrawalRequestRow[];
}

/** @deprecated use listWithdrawalRequests */
export const listCreatorWithdrawals = listWithdrawalRequests;

export function requestCreatorWithdrawal(
  userId: number,
  cpAmount: number,
  bank: { bankName: string; accountNumber: string; accountHolder: string },
  taxInfo: {
    residentNumberEncrypted: string;
    taxConsent: boolean;
    verifiedRealName: string;
  }
) {
  const requestedCp = roundAmount(cpAmount);
  if (requestedCp < WITHDRAWAL_MIN_CP) {
    throw new Error(`${WITHDRAWAL_MIN_CP.toLocaleString()} CP 이상부터 출금 신청이 가능합니다.`);
  }

  const eligibility = getWithdrawalEligibility(userId);
  if (!eligibility.canWithdraw) {
    throw new Error(eligibility.blockReason ?? "출금 신청 조건을 충족하지 않습니다.");
  }

  if (!taxInfo.taxConsent) {
    throw new Error("원천징수 신고를 위한 주민등록번호 수집·이용에 동의해 주세요.");
  }
  if (!taxInfo.residentNumberEncrypted) {
    throw new Error("주민등록번호를 입력해 주세요.");
  }

  if (!personNamesMatch(bank.accountHolder, taxInfo.verifiedRealName)) {
    throw new Error("본인 명의 계좌만 출금할 수 있습니다. 예금주는 본인인증 실명과 동일해야 합니다.");
  }
  if (!personNamesMatch(taxInfo.verifiedRealName, eligibility.verifiedRealName)) {
    throw new Error("본인인증 실명 정보가 일치하지 않습니다.");
  }

  const bankName = bank.bankName.trim();
  const accountDigits = bank.accountNumber.replace(/\D/g, "");
  const accountHolder = eligibility.verifiedRealName;
  if (!bankName || !accountDigits || !accountHolder) {
    throw new Error("은행명, 계좌번호, 예금주를 모두 입력하세요.");
  }
  if (accountDigits.length < 10 || accountDigits.length > 20) {
    throw new Error("계좌번호 형식을 확인해 주세요.");
  }

  const balance = getCreatorPointsBalance(userId);
  if (balance < requestedCp) {
    throw new Error(`보유 CP(${balance.toLocaleString()})보다 많은 금액은 출금할 수 없습니다.`);
  }

  const db = getDb();
  const pending = db
    .prepare("SELECT id FROM withdrawal_requests WHERE user_id=? AND status='PENDING' LIMIT 1")
    .get(userId);
  if (pending) {
    throw new Error("처리 대기 중인 출금 신청이 있습니다. 완료 후 다시 신청해 주세요.");
  }

  const { taxAmount, platformFee, payoutAmount } = calcWithdrawalBreakdown(requestedCp);
  const accountInfo: AccountInfo = {
    bankName,
    accountNumber: accountDigits,
    accountHolder,
    accountMasked: maskCreatorAccountNumber(accountDigits),
  };
  const accountInfoJson = JSON.stringify(accountInfo);

  const withdrawalId = db.transaction(() => {
    const updated = db
      .prepare(
        "UPDATE users SET creator_points = ROUND(creator_points - ?, 1) WHERE id=? AND creator_points >= ?"
      )
      .run(requestedCp, userId, requestedCp);
    if (updated.changes === 0) {
      throw new Error("크리에이터 포인트가 부족합니다.");
    }

    const info = db
      .prepare(
        `INSERT INTO withdrawal_requests
          (user_id, requested_cp, tax_amount, platform_fee, payout_amount, account_info, status,
           resident_number, id_card_url, bankbook_url)
         VALUES (?,?,?,?,?,?,'PENDING',?,?,?)`
      )
      .run(
        userId,
        requestedCp,
        taxAmount,
        platformFee,
        payoutAmount,
        accountInfoJson,
        taxInfo.residentNumberEncrypted,
        "",
        ""
      );

    db.prepare("INSERT INTO creator_point_logs (user_id, delta, reason) VALUES (?,?,?)").run(
      userId,
      -requestedCp,
      `출금 신청 #${info.lastInsertRowid} (실수령 ₩${payoutAmount.toLocaleString()} 예정 · 세금 ${taxAmount}CP · 수수료 ${platformFee}CP)`
    );

    return Number(info.lastInsertRowid);
  })();

  return {
    withdrawalId,
    requestedCp,
    taxAmount,
    platformFee,
    payoutAmount,
    creatorPoints: getCreatorPointsBalance(userId),
  };
}

/** 채팅 포인트 차감 후 크리에이터 적립 (기본 8% · 플러스 10% · 프로 12% · 파트너 15% · 전속 20%) */
export function maybeCreditCreatorReward(opts: {
  creatorId: number | null | undefined;
  official: number;
  characterId: number;
  messageId: number;
  consumerUserId: number;
  pointsSpent: number;
}): number {
  const spent = roundAmount(opts.pointsSpent);
  if (spent <= 0) return 0;
  if (!opts.creatorId) return 0;
  if (opts.official === 1) return 0;
  if (opts.creatorId === opts.consumerUserId) return 0;

  const rate = resolveCreatorRewardRate(opts.creatorId);
  const reward = roundAmount(spent * rate);
  if (reward <= 0) return 0;

  const pct = Math.round(rate * 100);

  const db = getDb();

  const existing = db
    .prepare("SELECT id FROM creator_earnings WHERE message_id=? LIMIT 1")
    .get(opts.messageId) as { id: number } | undefined;
  if (existing) return 0;

  db.transaction(() => {
    db.prepare(
      `INSERT INTO creator_earnings
        (creator_id, character_id, message_id, consumer_user_id, points_spent, reward_amount)
       VALUES (?,?,?,?,?,?)`
    ).run(opts.creatorId, opts.characterId, opts.messageId, opts.consumerUserId, spent, reward);

    db.prepare("UPDATE users SET creator_points = ROUND(creator_points + ?, 1) WHERE id=?").run(
      reward,
      opts.creatorId
    );

    db.prepare("INSERT INTO creator_point_logs (user_id, delta, reason) VALUES (?,?,?)").run(
      opts.creatorId,
      reward,
      `캐릭터 이용 수익 ${pct}% (메시지 #${opts.messageId})`
    );
  })();

  return reward;
}

/** 환불 시 크리에이터 적립 회수 */
export function reverseCreatorRewardForMessage(messageId: number): void {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id, creator_id, reward_amount FROM creator_earnings WHERE message_id=? AND reversed=0"
    )
    .get(messageId) as { id: number; creator_id: number; reward_amount: number } | undefined;
  if (!row) return;

  const reward = roundAmount(row.reward_amount);
  if (reward <= 0) return;

  db.transaction(() => {
    db.prepare("UPDATE creator_earnings SET reversed=1 WHERE id=?").run(row.id);
    db.prepare(
      "UPDATE users SET creator_points = MAX(0, ROUND(creator_points - ?, 1)) WHERE id=?"
    ).run(reward, row.creator_id);
    db.prepare("INSERT INTO creator_point_logs (user_id, delta, reason) VALUES (?,?,?)").run(
      row.creator_id,
      -reward,
      `환불로 인한 수익 회수 (메시지 #${messageId})`
    );
  })();
}

/** 크리에이터 포인트 → 유료 포인트 1:1 교환 */
export function exchangeCreatorPoints(userId: number, amount: number) {
  const need = roundAmount(amount);
  if (need <= 0) throw new Error("교환할 포인트를 입력하세요.");

  const db = getDb();
  const balance = getCreatorPointsBalance(userId);
  if (balance < need) {
    throw new Error(`크리에이터 포인트가 부족합니다. (보유: ${balance.toLocaleString()}CP)`);
  }

  db.transaction(() => {
    const updated = db
      .prepare(
        "UPDATE users SET creator_points = ROUND(creator_points - ?, 1) WHERE id=? AND creator_points >= ?"
      )
      .run(need, userId, need);
    if (updated.changes === 0) {
      throw new Error("크리에이터 포인트가 부족합니다.");
    }
    db.prepare("INSERT INTO creator_point_logs (user_id, delta, reason) VALUES (?,?,?)").run(
      userId,
      -need,
      `유료 포인트 ${need.toLocaleString()}P 교환`
    );
  })();

  creditPoints(userId, need, "PAID", `크리에이터 포인트 → 유료 포인트 교환 (${need.toLocaleString()}P)`);

  return {
    creatorPoints: getCreatorPointsBalance(userId),
    balance: getPointBalance(userId),
    exchanged: need,
  };
}
