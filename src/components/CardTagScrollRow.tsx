"use client";

import type { ReactNode } from "react";

/**
 * Blink leaves a focused link where it is when it is only partly visible inside an
 * overflow-x row, so its focus ring would stay cut off by the card edge.
 */
export default function CardTagScrollRow({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div
      className={className}
      onFocus={(e) => e.target.scrollIntoView({ inline: "nearest", block: "nearest" })}
    >
      {children}
    </div>
  );
}
