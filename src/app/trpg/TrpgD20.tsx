"use client";

import { useId } from "react";
import { trpgD20ViewModel, type TrpgD20Tone } from "@/lib/trpg/actionCardUi";
import { icosahedronFrontFace, projectIcosahedronSvgFaces } from "@/lib/trpg/d20IcosahedronSvg";
import { TRPG_D20_NAT1_CRIMSON, TRPG_D20_NAT20_GOLD, TRPG_D20_NUMERAL } from "@/lib/trpg/diceVisual";

const TONE_STYLE: Record<
  TrpgD20Tone,
  { body: string; highlight: string; shadow: string; edge: string; glow: string; number: string }
> = {
  success: {
    body: "#1a1d24",
    highlight: "#2c313c",
    shadow: "#0b0c10",
    edge: "#6d7380",
    glow: "rgba(15,17,22,0.35)",
    number: TRPG_D20_NUMERAL,
  },
  fail: {
    body: "#1a1d24",
    highlight: "#2c313c",
    shadow: "#0b0c10",
    edge: "#6d7380",
    glow: "rgba(15,17,22,0.35)",
    number: TRPG_D20_NUMERAL,
  },
  nat20: {
    body: "#241c10",
    highlight: "#3d3118",
    shadow: "#100c08",
    edge: TRPG_D20_NAT20_GOLD,
    glow: "rgba(232,197,106,0.22)",
    number: "#ffe7a3",
  },
  nat1: {
    body: "#1c1014",
    highlight: "#3a1c22",
    shadow: "#0c0608",
    edge: TRPG_D20_NAT1_CRIMSON,
    glow: "rgba(138,36,48,0.24)",
    number: "#ffd4d6",
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
  const glowId = `trpg-d20-glow-${rawId}`;
  const view = trpgD20ViewModel(value, tone);
  const style = TONE_STYLE[view.tone];
  const faces = projectIcosahedronSvgFaces({
    body: style.body,
    highlight: style.highlight,
    shadow: style.shadow,
    edge: style.edge,
  });
  const front = icosahedronFrontFace(faces);
  const px = size === "mobile" ? 52 : 76;
  const fontSize = view.face >= 10 ? 18 : 22;

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 80 80"
      role="img"
      aria-hidden="true"
      data-trpg-d20
      data-trpg-d20-value={view.face}
      data-trpg-d20-tone={tone}
      data-trpg-d20-silhouette="icosahedron"
      className="block shrink-0"
    >
      <defs>
        <radialGradient id={glowId} cx="40" cy="44" r="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={style.glow} />
          <stop offset="1" stopColor="transparent" />
        </radialGradient>
      </defs>
      <ellipse cx="40" cy="58" rx="18" ry="5" fill="rgba(0,0,0,0.35)" />
      <circle cx="40" cy="40" r="30" fill={`url(#${glowId})`} />
      {faces.map((face, index) => (
        <polygon
          key={`${face.points}-${index}`}
          points={face.points}
          fill={face.fill}
          stroke={face.stroke}
          strokeWidth={index === faces.length - 1 ? 1.15 : 0.55}
          strokeLinejoin="round"
        />
      ))}
      <text
        x={front.cx}
        y={front.cy + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={style.number}
        fontSize={fontSize}
        fontWeight="700"
        fontFamily='"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif'
        letterSpacing={view.face >= 10 ? "-0.04em" : "0"}
      >
        {view.faceText}
      </text>
    </svg>
  );
}
