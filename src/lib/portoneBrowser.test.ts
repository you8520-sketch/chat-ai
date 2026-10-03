import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { PaymentRequest } from "@portone/browser-sdk/v2";
import {
  PORTONE_CHARGE_IN_FLIGHT_MESSAGE,
  PORTONE_KG_INICIS_OFFICIAL_TEST_CUSTOMER,
  buildPortOneCardPaymentRequest,
  describePortOneCheckoutFailure,
  isPortOneCheckoutSafeEmail,
  isServerPreparedReviewerKgTestCheckout,
  resetPortOneChargeInFlightForTests,
  resolvePortOneCheckoutCustomer,
  runPortOnePointCharge,
  type PortOneChargePrepareResponse,
} from "@/lib/portoneBrowser";
import { hasClientPortoneCheckoutOverride } from "@/lib/portoneCheckout";
import {
  PORTONE_REVIEWER_DEFAULT_EMAIL,
  PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY,
  PORTONE_REVIEWER_KG_TEST_CHECKOUT_KIND,
  PORTONE_REVIEWER_KG_TEST_STORE_ID,
  PORTONE_REVIEWER_NICKNAME,
} from "@/lib/portoneReviewerAccount";
import {
  PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY as SHARED_REVIEWER_KG_TEST_CHANNEL_KEY,
  PORTONE_REVIEWER_KG_TEST_CHECKOUT_KIND as SHARED_REVIEWER_KG_TEST_CHECKOUT_KIND,
  PORTONE_REVIEWER_KG_TEST_STORE_ID as SHARED_REVIEWER_KG_TEST_STORE_ID,
} from "@/lib/portoneReviewerKgTestIds";

const reviewerPrepared: PortOneChargePrepareResponse = {
  paymentId: "pt-110-1791035041829-01fb47fa",
  orderName: "5,000P",
  totalAmount: 5000,
  packageId: "p5000",
  storeId: PORTONE_REVIEWER_KG_TEST_STORE_ID,
  channelKey: PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY,
  checkoutKind: PORTONE_REVIEWER_KG_TEST_CHECKOUT_KIND,
  payMethod: "CARD",
};

const memberPrepared: PortOneChargePrepareResponse = {
  paymentId: "pt-9-member-5000",
  orderName: "5,000P",
  totalAmount: 5000,
  packageId: "p5000",
  storeId: "store-standard-live",
  channelKey: "channel-key-standard-live",
  checkoutKind: "standard",
  payMethod: "CARD",
};

describe("portone browser SDK request contract", () => {
  afterEach(() => {
    resetPortOneChargeInFlightForTests();
  });

  it("rejects reserved and malformed emails that KG checkout cannot use", () => {
    assert.equal(isPortOneCheckoutSafeEmail(PORTONE_REVIEWER_DEFAULT_EMAIL), false);
    assert.equal(isPortOneCheckoutSafeEmail("user@hav.internal"), false);
    assert.equal(isPortOneCheckoutSafeEmail("not-an-email"), false);
    assert.equal(isPortOneCheckoutSafeEmail("test@portone.io"), true);
  });

  it("re-exports the same confirmed KG test IDs from the shared module", () => {
    assert.equal(PORTONE_REVIEWER_KG_TEST_STORE_ID, SHARED_REVIEWER_KG_TEST_STORE_ID);
    assert.equal(PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY, SHARED_REVIEWER_KG_TEST_CHANNEL_KEY);
    assert.equal(PORTONE_REVIEWER_KG_TEST_CHECKOUT_KIND, SHARED_REVIEWER_KG_TEST_CHECKOUT_KIND);
  });

  it("uses official test customer only when prepare returns reviewer kind and confirmed channel", () => {
    assert.equal(isServerPreparedReviewerKgTestCheckout(reviewerPrepared), true);
    assert.equal(isServerPreparedReviewerKgTestCheckout(memberPrepared), false);
    assert.equal(
      isServerPreparedReviewerKgTestCheckout({
        ...reviewerPrepared,
        checkoutKind: "standard",
      }),
      false
    );
    assert.equal(
      isServerPreparedReviewerKgTestCheckout({
        ...memberPrepared,
        checkoutKind: PORTONE_REVIEWER_KG_TEST_CHECKOUT_KIND,
      }),
      false
    );
    assert.equal(
      isServerPreparedReviewerKgTestCheckout({
        ...reviewerPrepared,
        storeId: "store-standard-live",
      }),
      false
    );
    assert.equal(
      isServerPreparedReviewerKgTestCheckout({
        ...reviewerPrepared,
        channelKey: "channel-key-standard-live",
      }),
      false
    );
  });

  it("before-fix reviewer payload omitted the official KG PC phone and used an unsafe email", () => {
    const broken = resolvePortOneCheckoutCustomer(memberPrepared, {
      customerEmail: PORTONE_REVIEWER_DEFAULT_EMAIL,
      customerName: PORTONE_REVIEWER_NICKNAME,
    });
    assert.equal(broken?.phoneNumber, undefined);
    assert.equal(broken?.email, undefined);
    assert.equal(broken?.fullName, PORTONE_REVIEWER_NICKNAME);
  });

  it("reviewer KG request uses official test customer from the prepare response, not a client flag", () => {
    const request = buildPortOneCardPaymentRequest(reviewerPrepared, {
      customerEmail: PORTONE_REVIEWER_DEFAULT_EMAIL,
      customerName: PORTONE_REVIEWER_NICKNAME,
      redirectUrl: "https://hav.chat/payments/portone/callback",
    });

    assert.equal(request.storeId, PORTONE_REVIEWER_KG_TEST_STORE_ID);
    assert.equal(request.channelKey, PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY);
    assert.equal(request.paymentId, reviewerPrepared.paymentId);
    assert.equal(request.totalAmount, 5000);
    assert.equal(request.currency, "KRW");
    assert.equal(request.payMethod, "CARD");
    assert.deepEqual(request.customer, {
      fullName: PORTONE_KG_INICIS_OFFICIAL_TEST_CUSTOMER.fullName,
      phoneNumber: PORTONE_KG_INICIS_OFFICIAL_TEST_CUSTOMER.phoneNumber,
      email: PORTONE_KG_INICIS_OFFICIAL_TEST_CUSTOMER.email,
    });
    assert.notEqual(request.customer?.email, PORTONE_REVIEWER_DEFAULT_EMAIL);
    assert.equal(request.redirectUrl, "https://hav.chat/payments/portone/callback");
  });

  it("member prepare never uses official test customer even if a client tries to forge reviewer intent", () => {
    const request = buildPortOneCardPaymentRequest(memberPrepared, {
      customerEmail: "member@example.com",
      customerName: "일반회원",
      ...({ reviewerKgTest: true, checkoutKind: PORTONE_REVIEWER_KG_TEST_CHECKOUT_KIND } as object),
    });
    assert.equal(request.storeId, "store-standard-live");
    assert.equal(request.channelKey, "channel-key-standard-live");
    assert.equal(request.customer?.phoneNumber, undefined);
    assert.equal(request.customer?.email, "member@example.com");
    assert.equal(request.customer?.fullName, "일반회원");
    assert.notEqual(request.customer?.email, PORTONE_KG_INICIS_OFFICIAL_TEST_CUSTOMER.email);
    assert.notEqual(request.storeId, PORTONE_REVIEWER_KG_TEST_STORE_ID);
  });

  it("does not apply official test customer when store or channel mismatches", () => {
    const mismatchedStore = buildPortOneCardPaymentRequest(
      {
        ...reviewerPrepared,
        storeId: "store-standard-live",
      },
      {
        customerEmail: "member@example.com",
        customerName: "일반회원",
      }
    );
    assert.equal(mismatchedStore.customer?.phoneNumber, undefined);
    assert.equal(mismatchedStore.customer?.email, "member@example.com");
    assert.notEqual(mismatchedStore.customer?.email, PORTONE_KG_INICIS_OFFICIAL_TEST_CUSTOMER.email);

    const mismatchedChannel = buildPortOneCardPaymentRequest(
      {
        ...reviewerPrepared,
        channelKey: "channel-key-standard-live",
      },
      {
        customerEmail: "member@example.com",
        customerName: "일반회원",
      }
    );
    assert.equal(mismatchedChannel.customer?.phoneNumber, undefined);
    assert.equal(mismatchedChannel.customer?.email, "member@example.com");
    assert.notEqual(
      mismatchedChannel.customer?.email,
      PORTONE_KG_INICIS_OFFICIAL_TEST_CUSTOMER.email
    );
  });

  it("maps a server prepare response to the SDK request without a browser reviewer flag", async () => {
    const seen: PaymentRequest[] = [];
    await assert.rejects(
      () =>
        runPortOnePointCharge(
          "p5000",
          {
            customerEmail: PORTONE_REVIEWER_DEFAULT_EMAIL,
            customerName: PORTONE_REVIEWER_NICKNAME,
          },
          {
            prepare: async () => reviewerPrepared,
            requestPayment: async (request) => {
              seen.push(request);
              return { code: "FAILURE_AND_CLOSE", message: "결제가 취소되었습니다." };
            },
            complete: async () => {
              throw new Error("complete must not run");
            },
          }
        ),
      /결제가 취소되었습니다/
    );
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0]?.customer, PORTONE_KG_INICIS_OFFICIAL_TEST_CUSTOMER);
  });

  it("keeps official test customer off a standard prepare in the prepare-to-SDK path", async () => {
    const seen: PaymentRequest[] = [];
    await assert.rejects(
      () =>
        runPortOnePointCharge(
          "p5000",
          {
            customerEmail: "member@example.com",
            customerName: "일반회원",
            ...({ reviewerKgTest: true } as object),
          },
          {
            prepare: async () => memberPrepared,
            requestPayment: async (request) => {
              seen.push(request);
              return { code: "FAILURE_AND_CLOSE", message: "결제가 취소되었습니다." };
            },
            complete: async () => {
              throw new Error("complete must not run");
            },
          }
        ),
      /결제가 취소되었습니다/
    );
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.customer?.phoneNumber, undefined);
    assert.equal(seen[0]?.customer?.email, "member@example.com");
    assert.notEqual(seen[0]?.customer?.email, PORTONE_KG_INICIS_OFFICIAL_TEST_CUSTOMER.email);
  });

  it("still rejects client checkoutKind overrides on prepare input", () => {
    assert.equal(hasClientPortoneCheckoutOverride({ packageId: "p5000" }), false);
    assert.equal(hasClientPortoneCheckoutOverride({ checkoutKind: "reviewer_kg_test" }), true);
    assert.equal(hasClientPortoneCheckoutOverride({ checkout_kind: "reviewer_kg_test" }), true);
  });

  it("surfaces checkout-service failure code without customer fields", () => {
    const text = describePortOneCheckoutFailure({
      code: "BadRequest",
      message: "파라미터는 필수 입력입니다.",
    });
    assert.match(text, /BadRequest/);
    assert.match(text, /파라미터는 필수 입력입니다/);
    assert.doesNotMatch(text, /010-0000-1234/);
    assert.doesNotMatch(text, /test@portone.io/);
    assert.doesNotMatch(text, /portone-reviewer/);
  });

  it("does not call complete after SDK cancel or checkout-service error", async () => {
    const calls: string[] = [];
    await assert.rejects(
      () =>
        runPortOnePointCharge(
          "p5000",
          {},
          {
            prepare: async () => {
              calls.push("prepare");
              return reviewerPrepared;
            },
            requestPayment: async (request: PaymentRequest) => {
              calls.push("requestPayment");
              assert.equal(request.customer?.phoneNumber, PORTONE_KG_INICIS_OFFICIAL_TEST_CUSTOMER.phoneNumber);
              return { code: "FAILURE_AND_CLOSE", message: "결제가 취소되었습니다." };
            },
            complete: async () => {
              calls.push("complete");
              return { ok: true, credited: false, checkoutKind: "reviewer_kg_test" };
            },
          }
        ),
      /결제가 취소되었습니다/
    );
    assert.deepEqual(calls, ["prepare", "requestPayment"]);
  });

  it("does not call complete when the SDK defers to redirect", async () => {
    const calls: string[] = [];
    const result = await runPortOnePointCharge(
      "p5000",
      {},
      {
        prepare: async () => {
          calls.push("prepare");
          return reviewerPrepared;
        },
        requestPayment: async () => {
          calls.push("requestPayment");
          return null;
        },
        complete: async () => {
          calls.push("complete");
          return { ok: true, credited: false };
        },
      }
    );
    assert.equal(result.completed, null);
    assert.deepEqual(calls, ["prepare", "requestPayment"]);
  });

  it("blocks a second in-flight prepare so pending rows do not accumulate", async () => {
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    let enteredPrepare!: () => void;
    const prepareEntered = new Promise<void>((resolve) => {
      enteredPrepare = resolve;
    });
    const first = runPortOnePointCharge(
      "p5000",
      {},
      {
        prepare: async () => {
          enteredPrepare();
          await started;
          return reviewerPrepared;
        },
        requestPayment: async () => ({ paymentId: reviewerPrepared.paymentId, txId: "tx-1" }),
        complete: async () => ({ ok: true, credited: false, checkoutKind: "reviewer_kg_test" }),
      }
    );
    await prepareEntered;
    await assert.rejects(
      () =>
        runPortOnePointCharge(
          "p5000",
          {},
          {
            prepare: async () => {
              throw new Error("second prepare must not run");
            },
          }
        ),
      new RegExp(PORTONE_CHARGE_IN_FLIGHT_MESSAGE)
    );
    release();
    const done = await first;
    assert.equal(done.completed?.ok, true);
  });
});
