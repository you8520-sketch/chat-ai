import type { Metadata } from "next";
import { privatePageMetadata } from "@/lib/siteSeo";
import { SITE_DISPLAY_NAME } from "@/lib/siteBrand";

export const metadata: Metadata = privatePageMetadata({
  title: `이메일 인증 · ${SITE_DISPLAY_NAME}`,
  description: "회원가입 이메일 인증",
});

export default function SignupVerifyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
