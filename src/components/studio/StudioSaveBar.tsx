"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import StudioButton from "@/components/studio/StudioButton";
import { cn } from "@/lib/studioDesign";

type Props = {
  /** Primary save / submit */
  onSave?: () => void;
  saveLabel: string;
  saveDisabled?: boolean;
  saveType?: "button" | "submit";
  formId?: string;
  /** Optional secondary (e.g. draft) */
  secondary?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    flash?: boolean;
    hint?: string;
  };
  error?: string | null;
  className?: string;
  children?: ReactNode;
};

/**
 * Sticky bottom save bar — visible on every create tab.
 * Docks directly above the mobile bottom nav (--mobile-nav-offset) and above the
 * on-screen keyboard (--keyboard-inset) so the save/cancel buttons stay reachable, and
 * publishes its height as --studio-save-bar-h so the page footer can reserve room for it.
 * On short landscape screens with the keyboard open it flows with the page (see globals.css).
 */
export default function StudioSaveBar({
  onSave,
  saveLabel,
  saveDisabled,
  saveType = "button",
  formId,
  secondary,
  error,
  className,
  children,
}: Props) {
  const barRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const publish = () => {
      const height = `${Math.ceil(bar.getBoundingClientRect().height)}px`;
      root.style.setProperty("--studio-save-bar-h", height);
      root.style.setProperty(
        "scroll-padding-bottom",
        `calc(${height} + var(--mobile-nav-offset, 0px) + var(--keyboard-inset, 0px) + 1rem)`,
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--studio-save-bar-h");
      root.style.removeProperty("scroll-padding-bottom");
    };
  }, []);

  return (
    <div
      ref={barRef}
      data-testid="studio-save-bar"
      className={cn(
        "studio-save-bar fixed inset-x-0 bottom-[calc(var(--mobile-nav-offset)+var(--keyboard-inset))] z-40 border-t border-white/10 bg-[#0b0d14]/95 backdrop-blur-md",
        "pb-0 min-[576px]:pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          {error ? (
            <p role="alert" className="text-sm font-medium text-rose-300">
              {error}
            </p>
          ) : null}
          {children}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {secondary ? (
            <StudioButton
              type="button"
              variant={secondary.flash ? "primary" : "secondary"}
              onClick={secondary.onClick}
              disabled={secondary.disabled}
              className={
                secondary.flash
                  ? "bg-violet-500 hover:bg-violet-400"
                  : undefined
              }
              title={secondary.hint}
            >
              <span className="flex flex-col items-start leading-tight">
                <span>{secondary.label}</span>
                {secondary.hint && !secondary.flash ? (
                  <span className="text-[10px] font-normal text-zinc-400">
                    {secondary.hint}
                  </span>
                ) : null}
              </span>
            </StudioButton>
          ) : null}
          <StudioButton
            type={saveType}
            form={formId}
            onClick={saveType === "button" ? onSave : undefined}
            disabled={saveDisabled}
            className="min-w-[8.5rem]"
          >
            {saveLabel}
          </StudioButton>
        </div>
      </div>
    </div>
  );
}
