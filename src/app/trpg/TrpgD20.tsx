"use client";

import { useId } from "react";
import { trpgD20ViewModel, type TrpgD20Tone } from "@/lib/trpg/actionCardUi";

const TONE_STYLE: Record<
  TrpgD20Tone,
  {
    bodyFrom: string;
    bodyTo: string;
    faceFrom: string;
    faceTo: string;
    edge: string;
    facet: string;
    glow: string;
    number: string;
  }
> = {
  success: {
    bodyFrom: "#3f4a55",
    bodyTo: "#1b222b",
    faceFrom: "#5b6774",
    faceTo: "#2a333d",
    edge: "#9aa6b4",
    facet: "rgba(226,232,240,0.22)",
    glow: "rgba(74,222,128,0.22)",
    number: "#f8fafc",
  },
  fail: {
    bodyFrom: "#3f4a55",
    bodyTo: "#1b222b",
    faceFrom: "#5b6774",
    faceTo: "#2a333d",
    edge: "#9aa6b4",
    facet: "rgba(226,232,240,0.22)",
    glow: "rgba(248,113,113,0.2)",
    number: "#f8fafc",
  },
  nat20: {
    bodyFrom: "#6b5724",
    bodyTo: "#2a2110",
    faceFrom: "#d4b45a",
    faceTo: "#8a7018",
    edge: "#f0d78c",
    facet: "rgba(255,236,179,0.28)",
    glow: "rgba(234,179,8,0.32)",
    number: "#fff8dc",
  },
  nat1: {
    bodyFrom: "#5a2a2e",
    bodyTo: "#1c1012",
    faceFrom: "#8f3a40",
    faceTo: "#4a1c20",
    edge: "#f0a8a8",
    facet: "rgba(254,202,202,0.22)",
    glow: "rgba(220,38,38,0.3)",
    number: "#fff1f2",
  },
};

export default function TrpgD20({
  value,
  tone,
  size = "desktop",
}: {
  value: number;
  tone: TrpgD20Tone;
  size?: "desktop" | "mobile";
}) {
  const rawId = useId().replace(/:/g, "");
  const bodyId = `trpg-d20-body-${rawId}`;
  const faceId = `trpg-d20-face-${rawId}`;
  const view = trpgD20ViewModel(value, tone);
  const style = TONE_STYLE[view.tone];
  const face = view.face;
  const fontSize = view.fontSize;
  const px = size === "mobile" ? 52 : 76;

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 80 80"
      role="img"
      aria-hidden="true"
      data-trpg-d20
      data-trpg-d20-value={face}
      data-trpg-d20-tone={tone}
      className="block shrink-0"
    >
      <defs>
        <linearGradient id={bodyId} x1="18" y1="6" x2="64" y2="74" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={style.bodyFrom} />
          <stop offset="1" stopColor={style.bodyTo} />
        </linearGradient>
        <linearGradient id={faceId} x1="32" y1="24" x2="50" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={style.faceFrom} />
          <stop offset="1" stopColor={style.faceTo} />
        </linearGradient>
      </defs>
      <ellipse cx="40" cy="42" rx="30" ry="31" fill={style.glow} />
      <polygon
        points="40,4 72,22 72,58 40,76 8,58 8,22"
        fill={`url(#${bodyId})`}
        stroke={style.edge}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <polygon points="40,4 72,22 40,28 8,22" fill={style.facet} />
      <polygon points="8,22 8,58 22,48 22,32" fill="rgba(15,23,42,0.28)" />
      <polygon points="72,22 72,58 58,48 58,32" fill="rgba(248,250,252,0.08)" />
      <polygon points="8,58 40,76 22,56" fill="rgba(15,23,42,0.34)" />
      <polygon points="72,58 40,76 58,56" fill="rgba(15,23,42,0.2)" />
      <line x1="40" y1="4" x2="40" y2="28" stroke={style.facet} strokeWidth="1" />
      <line x1="8" y1="22" x2="22" y2="32" stroke={style.facet} strokeWidth="1" />
      <line x1="72" y1="22" x2="58" y2="32" stroke={style.facet} strokeWidth="1" />
      <line x1="8" y1="58" x2="22" y2="48" stroke={style.facet} strokeWidth="1" />
      <line x1="72" y1="58" x2="58" y2="48" stroke={style.facet} strokeWidth="1" />
      <line x1="40" y1="76" x2="40" y2="60" stroke={style.facet} strokeWidth="1" />
      <polygon
        points="40,22 58,32 58,48 40,58 22,48 22,32"
        fill={`url(#${faceId})`}
        stroke={style.edge}
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
      <polygon points="40,22 58,32 40,28 22,32" fill="rgba(255,255,255,0.16)" />
      <text
        x="40"
        y="43"
        textAnchor="middle"
        dominantBaseline="middle"
        fill={style.number}
        fontSize={fontSize}
        fontWeight="800"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        letterSpacing={face >= 10 ? "-0.04em" : "0"}
      >
        {view.faceText}
      </text>
    </svg>
  );
}
