"use client";

import Link from "next/link";
import { useId, useState } from "react";
import {
  IconSidebarStudio,
  IconStudioLorebook,
  IconStudioWorld,
} from "@/components/SidebarNavIcons";

const CREATE_ITEMS = [
  {
    href: "/world/create",
    Icon: IconStudioWorld,
    label: "세계관 제작",
    description:
      "시대·배경·세력·규칙 등을 정리합니다. 캐릭터 제작 시 「세계관 / 배경」란에 자동으로 채워집니다.",
    buttonClass:
      "border-cyan-500/35 bg-cyan-500/15 text-cyan-50 hover:border-cyan-400/50 hover:bg-cyan-500/25",
    iconClass: "text-cyan-300",
  },
  {
    href: "/create",
    Icon: IconSidebarStudio,
    label: "캐릭터 제작",
    description:
      "성격·말투·첫 메시지·감정 이미지를 설정해 AI 채팅 캐릭터를 만듭니다. 완성 후 홈에 등록할 수 있습니다.",
    buttonClass:
      "border-violet-500/40 bg-violet-600/20 text-violet-50 hover:border-violet-400/55 hover:bg-violet-600/30",
    iconClass: "text-violet-300",
  },
  {
    href: "/lorebook/create",
    Icon: IconStudioLorebook,
    label: "로어북 제작",
    description:
      "키워드가 유저 입력에 포함되면 해당 설정을 프롬프트에 번역 없이 그대로 주입합니다. 캐릭터에 연결해 사용합니다.",
    buttonClass:
      "border-amber-500/35 bg-amber-500/14 text-amber-50 hover:border-amber-400/50 hover:bg-amber-500/24",
    iconClass: "text-amber-300",
  },
] as const;

const linkBaseClassName =
  "flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-semibold shadow-sm shadow-black/20 transition sm:flex-none sm:px-4";

function StudioCreateLink({
  href,
  Icon,
  label,
  description,
  buttonClass,
  iconClass,
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
        className={`${linkBaseClassName} ${buttonClass}`}
        aria-describedby={open ? tooltipId : undefined}
      >
        <Icon className={`h-[18px] w-[18px] shrink-0 ${iconClass}`} />
        <span className="truncate">{label}</span>
      </Link>
      {open && (
        <div
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-50 mt-1.5 max-w-[15rem] rounded-lg border border-white/10 bg-[#1a1a1a]/95 px-2.5 py-2 text-[11px] leading-snug text-zinc-300 shadow-lg shadow-black/40 backdrop-blur-sm sm:max-w-[17rem]"
        >
          {description}
        </div>
      )}
    </div>
  );
}

export default function StudioCreateNav() {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="제작 메뉴">
      {CREATE_ITEMS.map((item) => (
        <StudioCreateLink key={item.href} {...item} />
      ))}
    </nav>
  );
}
