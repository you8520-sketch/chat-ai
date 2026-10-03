import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { PaymentRequest } from "@portone/browser-sdk/v2";
import {
  PORTONE_CHARGE_IN_FLIGHT_MESSAGE,
  PORTONE_KG_INICIS_OFFICIAL_TEST_CUSTOMER,
  buildPortOneCardPaymentRequest,
  describePortOneCheckoutFailure,
  isPortOneCheckoutSafeEmail,
  resetPortOneChargeInFlightForTests,
  resolvePortOneCheckoutCustomer,
  runPortOnePointCharge,
  type PortOneChargePrepareResponse,
} from "@/lib/portoneBrowser";
import {
  PORTONE_REVIEWER_DEFAULT_EMAIL,
  PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY,
  PORTONE_REVIEWER_KG_TEST_STORE_ID,
  PORTONE_REVIEWER_NICKNAME,
} from "@/lib/portoneReviewerAccount";

const reviewerPrepared: PortOneChargePrepareResponse = {
  paymentId: "pt-110-1791035041829-01fb47fa",
  orderName: "5,000P",
  totalAmount: 5000,
  packageId: "p5000",
  storeId: PORTONE_REVIEWER_KG_TEST_STORE_ID,
  channelKey: PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY,
  payMethod: "CARD",
};

const memberPrepared: PortOneChargePrepareResponse = {
  paymentId: "pt-9-member-5000",
  orderName: "5,000P",
  totalAmount: 5000,
  packageId: "p5000",
  storeId: "store-standard-live",
  channelKey: "channel-key-standard-live",
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

  it("before-fix reviewer payload omitted the official KG PC phone and used an unsafe email", () => {
    const broken = resolvePortOneCheckoutCustomer({
      customerEmail: PORTONE_REVIEWER_DEFAULT_EMAIL,
      customerName: PORTONE_REVIEWER_NICKNAME,
    });
    assert.equal(broken?.phoneNumber, undefined);
    assert.equal(broken?.email, undefined);
    assert.equal(broken?.fullName, PORTONE_REVIEWER_NICKNAME);
  });

  it("reviewer KG request uses official test customer, KRW, CARD, and server store/channel", () => {
    const request = buildPortOneCardPaymentRequest(reviewerPrepared, {
      customerEmail: PORTONE_REVIEWER_DEFAULT_EMAIL,
      customerName: PORTONE_REVIEWER_NICKNAME,
      reviewerKgTest: true,
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

  it("member request never invents a phone or official test email", () => {
    const request = buildPortOneCardPaymentRequest(memberPrepared, {
      customerEmail: "member@example.com",
      customerName: "일반회원",
      reviewerKgTest: false,
    });
    assert.equal(request.storeId, "store-standard-live");
    assert.equal(request.channelKey, "channel-key-standard-live");
    assert.equal(request.customer?.phoneNumber, undefined);
    assert.equal(request.customer?.email, "member@example.com");
    assert.equal(request.customer?.fullName, "일반회원");
    assert.notEqual(request.customer?.email, PORTONE_KG_INICIS_OFFICIAL_TEST_CUSTOMER.email);
    assert.notEqual(request.storeId, PORTONE_REVIEWER_KG_TEST_STORE_ID);
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
          { reviewerKgTest: true },
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
      { reviewerKgTest: true },
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
      { reviewerKgTest: true },
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
          { reviewerKgTest: true },
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
