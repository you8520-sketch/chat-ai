import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countPublicDescriptionVisibleChars,
  publicDescriptionVisibleText,
  truncatePublicDescriptionHtmlByVisibleChars,
} from "@/lib/publicDescriptionText";

describe("publicDescriptionText", () => {
  it("counts visible Korean text without counting formatting html", () => {
    const visible = "가".repeat(3000);
    const html = `<div><span style="font-size:1.5rem;color:#fda4af"><strong>${visible}</strong></span></div>`;

    assert.ok(html.length > 3000);
    assert.equal(countPublicDescriptionVisibleChars(html), 3000);
  });

  it("truncates rich html by visible text length while preserving wrappers", () => {
    const html = '<div><span style="color:#fda4af"><strong>가나다라마바사</strong></span></div>';
    const truncated = truncatePublicDescriptionHtmlByVisibleChars(html, 3);

    assert.equal(publicDescriptionVisibleText(truncated), "가나다");
    assert.match(truncated, /<\/strong><\/span><\/div>$/);
  });
});
