"use client";

import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";
import {
  cn,
  studioInputClass,
  studioSelectClass,
  studioTextareaClass,
  studioType,
} from "@/lib/studioDesign";

type FieldProps = {
  label?: string;
  helper?: string;
  counter?: { now: number; max: number };
  className?: string;
  inputClassName?: string;
};

export function StudioField({
  label,
  helper,
  counter,
  children,
}: {
  label?: string;
  helper?: string;
  counter?: { now: number; max: number };
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      {(label || counter) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {label ? <label className={cn(studioType.label, "mb-0")}>{label}</label> : <span />}
          {counter ? (
            <span className={studioType.counter}>
              {counter.now.toLocaleString()} / {counter.max.toLocaleString()}
            </span>
          ) : null}
        </div>
      )}
      {helper ? <p className={cn(studioType.helper, "mb-2")}>{helper}</p> : null}
      {children}
    </div>
  );
}

export function StudioInput({
  label,
  helper,
  counter,
  className,
  inputClassName,
  ...props
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <StudioField label={label} helper={helper} counter={counter}>
      <input className={cn(studioInputClass, inputClassName, className)} {...props} />
    </StudioField>
  );
}

export function StudioTextarea({
  label,
  helper,
  counter,
  className,
  inputClassName,
  ...props
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <StudioField label={label} helper={helper} counter={counter}>
      <textarea className={cn(studioTextareaClass, inputClassName, className)} {...props} />
    </StudioField>
  );
}

export function StudioSelect({
  label,
  helper,
  className,
  inputClassName,
  children,
  ...props
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <StudioField label={label} helper={helper}>
      <select className={cn(studioSelectClass, "w-full", inputClassName, className)} {...props}>
        {children}
      </select>
    </StudioField>
  );
}

/** Raw class for places that still need a string (e.g. TagChipInput). */
export { studioInputClass, studioSelectClass, studioTextareaClass };
