import type { User } from "@/lib/auth-types";
import { isSubscribed } from "@/lib/auth-types";

export type SubscriptionMemoryCapability = {
  focusMaxChars: number;
  userLorebookActiveEntryMax: number;
  userLorebookActiveContentMaxChars: number;
  userLorebookTurnInjectMaxChars: number;
};

const FREE_CAPABILITY: SubscriptionMemoryCapability = {
  focusMaxChars: 1_000,
  userLorebookActiveEntryMax: 10,
  userLorebookActiveContentMaxChars: 5_000,
  userLorebookTurnInjectMaxChars: 2_500,
};

const SUBSCRIBED_CAPABILITY: SubscriptionMemoryCapability = {
  focusMaxChars: 2_000,
  userLorebookActiveEntryMax: 50,
  userLorebookActiveContentMaxChars: 20_000,
  userLorebookTurnInjectMaxChars: 4_000,
};

const VALID_SUBSCRIPTION_PLANS = new Set(["basic", "pro"]);

export function hasValidSubscriptionPlan(
  user: Pick<User, "sub_plan"> | null | undefined
): boolean {
  const plan = user?.sub_plan?.trim().toLowerCase() ?? "";
  return VALID_SUBSCRIPTION_PLANS.has(plan);
}

/** Canonical subscription memory capability — do not scatter tier checks elsewhere. */
export function resolveSubscriptionMemoryCapability(
  user: Pick<User, "sub_until" | "sub_plan"> | null | undefined
): SubscriptionMemoryCapability {
  if (user && isSubscribed(user as User) && hasValidSubscriptionPlan(user)) {
    return SUBSCRIBED_CAPABILITY;
  }
  return FREE_CAPABILITY;
}

export { FREE_CAPABILITY, SUBSCRIBED_CAPABILITY };
