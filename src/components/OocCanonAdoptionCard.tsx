"use client";

import { OOC_CANON_ADOPTION_COPY } from "@/lib/oocSceneRender";

export default function OocCanonAdoptionCard({
  adopted,
  stale = false,
  busy = false,
  onKeepNoncanonical,
  onAdopt,
}: {
  adopted: boolean;
  stale?: boolean;
  busy?: boolean;
  onKeepNoncanonical: () => void;
  onAdopt: () => void;
}) {
  if (adopted) {
    return (
      <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-3 py-2 text-xs text-emerald-200">
        ✓ {OOC_CANON_ADOPTION_COPY.adoptedBadge}
      </div>
    );
  }

  if (stale) {
    return (
      <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
        {OOC_CANON_ADOPTION_COPY.stale}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
      <p className="text-sm font-medium text-zinc-100">{OOC_CANON_ADOPTION_COPY.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
        {OOC_CANON_ADOPTION_COPY.description}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onKeepNoncanonical}
          className="rounded-lg border border-white/12 bg-[#1a1a1a] px-3 py-1.5 text-xs text-zinc-200 transition hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {OOC_CANON_ADOPTION_COPY.keepNoncanonical}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onAdopt}
          className="rounded-lg border border-orange-500/40 bg-orange-500/15 px-3 py-1.5 text-xs text-orange-100 transition hover:border-orange-400/70 hover:bg-orange-500/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {OOC_CANON_ADOPTION_COPY.adopt}
        </button>
      </div>
    </div>
  );
}
