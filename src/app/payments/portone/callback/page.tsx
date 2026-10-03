"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  completePortOneCheckout,
  PORTONE_REVIEWER_TEST_CONFIRMED_MESSAGE,
} from "@/lib/portoneBrowser";

function PortOneCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [testConfirmed, setTestConfirmed] = useState(false);

  useEffect(() => {
    const paymentId = searchParams.get("paymentId")?.trim() ?? "";
    const code = searchParams.get("code")?.trim();
    const message = searchParams.get("message")?.trim();
    const txId = searchParams.get("txId")?.trim() ?? searchParams.get("transactionId")?.trim();

    if (code) {
      setError(message || code || "결제가 취소되었습니다.");
      return;
    }
    if (!paymentId) {
      setError("결제 ID가 없습니다.");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const completed = await completePortOneCheckout(paymentId, txId || undefined);
        if (cancelled) return;
        const reviewerTest =
          completed.checkoutKind === "reviewer_kg_test" || completed.credited === false;
        setTestConfirmed(reviewerTest);
        setDone(true);
        router.replace(reviewerTest ? "/points?reviewerTest=1" : "/points?charged=1");
        router.refresh();
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message || "결제 확인에 실패했습니다.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  if (error) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center">
        <p className="text-sm text-rose-200">{error}</p>
        <Link href="/points" className="mt-4 inline-block text-sm font-semibold text-violet-400 hover:underline">
          포인트 페이지로
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-white/10 bg-[#131626] p-8 text-center">
      <p className="text-sm text-gray-300">
        {done
          ? testConfirmed
            ? PORTONE_REVIEWER_TEST_CONFIRMED_MESSAGE
            : "충전 완료!"
          : "결제 확인 중…"}
      </p>
    </div>
  );
}

export default function PortOneCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto mt-16 max-w-md p-8 text-center text-sm text-gray-400">로딩 중…</div>
      }
    >
      <PortOneCallbackInner />
    </Suspense>
  );
}
