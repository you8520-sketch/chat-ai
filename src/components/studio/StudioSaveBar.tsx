"use client";

import type { ReactNode } from "react";
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
 * Sits above mobile bottom nav (pb safe).
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
  return (
    <div
      data-testid="studio-save-bar"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0b0d14]/95 backdrop-blur-md",
        "pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          {error ? <p className="text-sm text-rose-400">{error}</p> : null}
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
