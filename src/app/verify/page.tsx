import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canAccessAdultContent } from "@/lib/adultVerification";
import { isDemoEnv } from "@/lib/demo";
import VerifyClient from "./VerifyClient";

export const dynamic = "force-dynamic";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const user = await getSessionUser();
  const { redirect: redirectParam } = await searchParams;
  const redirectTo = redirectParam?.startsWith("/") ? redirectParam : "/";

  if (!user) {
    redirect(
      `/login?redirect=${encodeURIComponent(`/verify?redirect=${encodeURIComponent(redirectTo)}`)}`
    );
  }

  // Stored is_adult is untrusted until a real provider exists. Auto-leave only
  // when the same owner already grants adult VIEW (existing admin).
  if (canAccessAdultContent(user)) {
    redirect(redirectTo);
  }

  return <VerifyClient redirectTo={redirectTo} showDemo={isDemoEnv()} providerPending={!isDemoEnv()} />;
}
