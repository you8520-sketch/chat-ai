import type { WithdrawalStatus } from "@/lib/creatorShared";

export type AdminPayoutApplicationRow = {
  id: number;
  userId: number;
  nickname: string;
  email: string;
  creatorName: string;
  requestedCp: number;
  taxAmount: number;
  platformFee: number;
  payoutAmount: number;
  bankName: string;
  accountMasked: string;
  accountHolder: string;
  accountLabel: string;
  status: WithdrawalStatus;
  failureReason: string;
  createdAt: string;
  processedAt: string | null;
};

export type AdminPayoutCounts = {
  all: number;
  pending: number;
  approved: number;
  failed: number;
  rejected: number;
};

export type AdminPayoutTaxPreview = {
  year: number;
  month: number;
  count: number;
  grossAmount: number;
  nationalTax: number;
  localTax: number;
  netPayout: number;
};

export type AdminPayoutAutomation = {
  enabled: boolean;
  scheduleLabel: string;
  timezone: string;
};
