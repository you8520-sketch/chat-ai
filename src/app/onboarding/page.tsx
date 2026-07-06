import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import OnboardingClient from "./OnboardingClient";

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/onboarding");

  const row = getDb()
    .prepare("SELECT onboarding_completed_at FROM users WHERE id = ?")
    .get(user.id) as { onboarding_completed_at: string | null } | undefined;

  if (row?.onboarding_completed_at) redirect("/");

  return <OnboardingClient />;
}
