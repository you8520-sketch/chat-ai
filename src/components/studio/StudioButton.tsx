"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/studioDesign";

export type StudioButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type StudioButtonSize = "md" | "sm" | "lg";

const variantClass: Record<StudioButtonVariant, string> = {
  primary:
    "bg-violet-600 text-white hover:bg-violet-500 shadow-sm shadow-black/20 disabled:hover:bg-violet-600",
  secondary:
    "border border-white/10 bg-transparent text-zinc-200 hover:bg-white/[0.06] disabled:hover:bg-transparent",
  danger:
    "bg-rose-600/90 text-white hover:bg-rose-500 disabled:hover:bg-rose-600/90",
  ghost: "bg-transparent text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200",
};

const sizeClass: Record<StudioButtonSize, string> = {
  sm: "min-h-11 px-3 text-sm font-semibold",
  md: "min-h-11 px-4 text-sm font-semibold",
  lg: "min-h-12 px-5 text-sm font-semibold",
};

type Common = {
  variant?: StudioButtonVariant;
  size?: StudioButtonSize;
  className?: string;
  children: ReactNode;
};

type AsButton = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className"> & {
    href?: undefined;
  };

type AsLink = Common & {
  href: string;
  disabled?: boolean;
};

export type StudioButtonProps = AsButton | AsLink;

export default function StudioButton(props: StudioButtonProps) {
  if ("href" in props && props.href) {
    const {
      href,
      disabled,
      variant = "primary",
      size = "md",
      className,
      children,
    } = props;
    const classes = cn(
      "inline-flex items-center justify-center gap-2 rounded-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40",
      variantClass[variant],
      sizeClass[size],
      className,
    );
    if (disabled) {
      return (
        <span className={cn(classes, "pointer-events-none opacity-50")} aria-disabled>
          {children}
        </span>
      );
    }
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  const {
    variant = "primary",
    size = "md",
    className,
    children,
    type = "button",
    ...rest
  } = props as AsButton;

  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 disabled:cursor-not-allowed disabled:opacity-50",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
