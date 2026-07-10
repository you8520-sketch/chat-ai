"use client";

import Link from "next/link";
import { useId, useState } from "react";
import {
  IconSidebarStudio,
  IconStudioLorebook,
  IconStudioWorld,
} from "@/components/SidebarNavIcons";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

const CREATE_ITEMS = [
  {
    href: "/world/create",
    Icon: IconStudioWorld,
    label: "세계관 제작",
    description:
      "시대·배경·세력·규칙 등을 정리합니다. 캐릭터 제작 시 「세계관 / 배경」란에 자동으로 채워집니다.",
  },
  {
    href: "/create",
    Icon: IconSidebarStudio,
    label: "캐릭터 제작",
    description:
      "성격·말투·첫 메시지·감정 이미지를 설정해 AI 채팅 캐릭터를 만듭니다. 완성 후 홈에 등록할 수 있습니다.",
  },
  {
    href: "/lorebook/create",
    Icon: IconStudioLorebook,
    label: "로어북 제작",
    description:
      "키워드가 유저 입력에 포함되면 해당 설정을 프롬프트에 번역 없이 그대로 주입합니다. 캐릭터에 연결해 사용합니다.",
  },
] as const;

function StudioCreateLink({
  href,
  Icon,
  label,
  description,
}: (typeof CREATE_ITEMS)[number]) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  return (
    <div
      className="relative min-w-0 flex-1 sm:flex-none"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Link
        href={href}
        className={cn(
          "flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-white/10 bg-[#131626] px-3 text-sm font-semibold text-zinc-100 transition hover:border-white/20 hover:bg-white/[0.04] sm:flex-none sm:px-4",
        )}
        aria-describedby={open ? tooltipId : undefined}
      >
        <Icon className="h-[18px] w-[18px] shrink-0 text-zinc-400" />
        <span className="truncate">{label}</span>
      </Link>
      {open && (
        <div
          id={tooltipId}
          role="tooltip"
          className={cn(
            studioSurface.card,
            "pointer-events-none absolute left-0 top-full z-50 mt-1.5 max-w-[15rem] px-2.5 py-2 shadow-lg shadow-black/40 sm:max-w-[17rem]",
            studioType.helper,
          )}
        >
          {description}
        </div>
      )}
    </div>
  );
}

export default function StudioCreateNav() {
  return (
    <nav aria-label="제작 바로가기" className="flex flex-wrap gap-2">
      {CREATE_ITEMS.map((item) => (
        <StudioCreateLink key={item.href} {...item} />
      ))}
    </nav>
  );
}
