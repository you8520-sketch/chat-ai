import Link from "next/link";
import DemoAdultSkip from "@/components/DemoAdultSkip";
import StudioButton from "@/components/studio/StudioButton";
import { IconSidebarVerify } from "@/components/SidebarNavIcons";
import { isDemoEnv } from "@/lib/demo";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

type Props = {
  message: string;
  redirectTo: string;
  demoLabel?: string;
};

/** Shared adult-verify gate — same chrome as Studio / auth cards. */
export default function AdultVerifyGate({ message, redirectTo, demoLabel }: Props) {
  return (
    <div className={cn(studioSurface.card, "mx-auto mt-20 max-w-sm p-8 text-center")}>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.04] text-zinc-400">
        <IconSidebarVerify className="h-6 w-6" />
      </div>
      <h1 className={cn(studioType.heading, "mt-4 text-xl")}>성인인증이 필요합니다</h1>
      <p className={cn(studioType.helper, "mt-2")}>{message}</p>
      <StudioButton href="/verify" className="mt-6 w-full">
        성인인증 하러 가기
      </StudioButton>
      {isDemoEnv() ? (
        <DemoAdultSkip
          redirectTo={redirectTo}
          label={demoLabel ?? "데모: 인증 없이 계속"}
        />
      ) : null}
    </div>
  );
}
