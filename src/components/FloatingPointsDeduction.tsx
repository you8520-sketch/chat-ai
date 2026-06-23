"use client";

import { useEffect, useRef, useState } from "react";
import { formatPoints } from "@/lib/billingDisplay";

type FloatItem = { id: number; amount: number };

export default function FloatingPointsDeduction({
  amount,
  trigger,
}: {
  amount: number;
  trigger: number;
}) {
  const [items, setItems] = useState<FloatItem[]>([]);
  const lastProcessedTriggerRef = useRef(0);

  useEffect(() => {
    if (trigger <= 0 || amount <= 0) return;
    if (lastProcessedTriggerRef.current === trigger) return;
    lastProcessedTriggerRef.current = trigger;
    const item: FloatItem = { id: trigger, amount };
    setItems((prev) => [...prev, item]);
    const timer = window.setTimeout(() => {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [trigger, amount]);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-full z-20 mb-3 flex justify-center">
      {items.map((item) => (
        <span
          key={item.id}
          className="animate-float-points-up text-base font-black tracking-wide text-red-400 sm:text-lg"
        >
          - {formatPoints(item.amount)} P
        </span>
      ))}
    </div>
  );
}
