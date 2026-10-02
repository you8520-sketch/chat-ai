import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
  TRANSACTIONAL_EMAIL_UNCONFIGURED_MESSAGE,
  buildEmailVerificationUrl,
  isTransactionalEmailConfigured,
  resolveVerifiedMailOrigin,
  sendTransactionalEmail,
} from "@/lib/transactionalEmail";

const KEYS = ["RESEND_API_KEY", "EMAIL_FROM", "RESEND_FROM", "APP_URL", "NEXTAUTH_URL", "GOOGLE_OAUTH_ORIGIN", "NODE_ENV"] as const;
const previous: Record<string, string | undefined> = {};
for (const key of KEYS) previous[key] = process.env[key];

after(() => {
  for (const key of KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});

describe("transactional email", () => {
  it("is fail-closed without API key or from address", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.RESEND_FROM;
    assert.equal(isTransactionalEmailConfigured(), false);
    const sent = await sendTransactionalEmail({
      to: "a@example.com",
      subject: "x",
      text: "x",
      html: "<p>x</p>",
    });
    assert.equal(sent.ok, false);
    if (sent.ok) return;
    assert.equal(sent.error, TRANSACTIONAL_EMAIL_UNCONFIGURED_MESSAGE);
  });

  it("builds verify URLs on the configured origin only", () => {
    process.env.APP_URL = "https://hav.chat";
    delete process.env.NEXTAUTH_URL;
    delete process.env.GOOGLE_OAUTH_ORIGIN;
    const req = new Request("http://evil.example/api/auth/signup", {
      headers: { host: "evil.example", "x-forwarded-host": "evil.example" },
    });
    assert.equal(resolveVerifiedMailOrigin(req), "https://hav.chat");
    assert.equal(
      buildEmailVerificationUrl("https://hav.chat", "abc"),
      "https://hav.chat/api/auth/verify-email?token=abc"
    );
  });

  it("refuses unverified production origins", () => {
    delete process.env.APP_URL;
    delete process.env.NEXTAUTH_URL;
    delete process.env.GOOGLE_OAUTH_ORIGIN;
    const previousNode = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const req = new Request("http://localhost:3000/api/auth/signup", {
        headers: { host: "localhost:3000" },
      });
      assert.equal(resolveVerifiedMailOrigin(req), null);
    } finally {
      process.env.NODE_ENV = previousNode;
    }
  });
});
