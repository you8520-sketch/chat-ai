import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { EMAIL_VERIFY_COOKIE_NAME } from "@/lib/sessionCookie";
import { inspectEmailSignupToken } from "@/lib/emailSignupVerification";
import StudioButton from "@/components/studio/StudioButton";
import { studioSurface, studioType } from "@/lib/studioDesign";

export const dynamic = "force-dynamic";

export default async function SignupVerifyPage() {
  const token = (await cookies()).get(EMAIL_VERIFY_COOKIE_NAME)?.value ?? "";
  const inspected = inspectEmailSignupToken(token);
  if (!inspected.ok) {
    redirect("/login?verify=failed");
  }

  return (
    <div className={`mx-auto mt-20 max-w-sm p-8 ${studioSurface.card}`}>
      <h1 className={studioType.heading}>이메일 인증</h1>
      <p className={`mt-3 ${studioType.body}`}>
        메일 링크를 확인했습니다. 아래 버튼을 눌러 가입을 완료해 주세요. 버튼을 누르기 전에는 계정이
        만들어지지 않습니다.
      </p>
      <form action="/api/auth/verify-email" method="post" className="mt-6">
        <StudioButton type="submit" className="w-full">
          인증 완료
        </StudioButton>
      </form>
      <p className={`mt-4 text-center ${studioType.body} text-zinc-500`}>
        <Link href="/login" className="text-violet-400 hover:underline">
          로그인으로
        </Link>
      </p>
    </div>
  );
}
