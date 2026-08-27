import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { isPersonaSecretS4LiveProducerEnabled } from "./personaSecretS4LiveProducerPolicy";

const ENV_KEY = "PERSONA_SECRET_S4_LIVE_PRODUCER_ENABLED";
const originalValue = process.env[ENV_KEY];

afterEach(() => {
  if (originalValue === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = originalValue;
});

describe("persona secret S4 live producer rollout policy", () => {
  it("A — missing flag defaults OFF", () => {
    delete process.env[ENV_KEY];
    assert.equal(isPersonaSecretS4LiveProducerEnabled(), false);
  });

  it("B — flag=0 is OFF", () => {
    process.env[ENV_KEY] = "0";
    assert.equal(isPersonaSecretS4LiveProducerEnabled(), false);
  });

  it("C — only exact flag=1 is ON", () => {
    process.env[ENV_KEY] = "1";
    assert.equal(isPersonaSecretS4LiveProducerEnabled(), true);
    process.env[ENV_KEY] = "true";
    assert.equal(isPersonaSecretS4LiveProducerEnabled(), false);
  });
});
