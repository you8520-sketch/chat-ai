"use client";

import {
  personaImageBaseUrl,
  personaImageRenderStyle,
} from "@/lib/userPersonasClient";

type Props = {
  name?: string;
  imageUrl?: string | null;
  focusX?: number | null;
  focusY?: number | null;
  className?: string;
  sizeClassName?: string;
};

export default function PersonaAvatar({
  name = "",
  imageUrl,
  focusX,
  focusY,
  className = "",
  sizeClassName = "h-9 w-9",
}: Props) {
  const url = personaImageBaseUrl(imageUrl);
  const initial = (name.trim()[0] || "?").toUpperCase();

  if (!url) {
    return (
      <span
        className={`${sizeClassName} inline-flex shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[11px] font-bold text-violet-200 ${className}`}
        aria-hidden
      >
        {initial}
      </span>
    );
  }

  return (
    <span
      className={`${sizeClassName} relative inline-block shrink-0 overflow-hidden rounded-full bg-[#1a1a1a] ${className}`}
    >
      <img
        src={url}
        alt=""
        className="h-full w-full select-none object-cover"
        style={personaImageRenderStyle(imageUrl, focusX, focusY)}
        draggable={false}
      />
    </span>
  );
}
