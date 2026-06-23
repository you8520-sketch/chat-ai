"use client";



import { buildBillingReceipt } from "@/lib/billingDisplay";

import type { Usage } from "@/lib/chatUsage";

import BillingReceiptTooltip from "./BillingReceiptTooltip";



export default function MessagePointActions({

  usage,

  messageId,

  chatId,

}: {

  usage: Usage;

  messageId?: number;

  chatId: number | null;

  content: string;

  isRefunded?: boolean;

  onToast: (msg: string) => void;

  onRefunded?: () => void;

}) {

  const receipt = buildBillingReceipt(usage);



  if (!receipt || !messageId || !chatId) return null;



  return (

    <div className="relative mt-2 flex items-center justify-end gap-1">

      <BillingReceiptTooltip usage={usage} />

    </div>

  );

}


