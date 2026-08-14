import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRetryableRemoteSchemaError } from "./libsqlErrors.ts";

describe("remote schema error classification", () => {
  it("retries concurrent schema and masked rollback conflicts", () => {
    assert.equal(
      isRetryableRemoteSchemaError(new Error("SQLite error: duplicate column name: request_id")),
      true
    );
    assert.equal(
      isRetryableRemoteSchemaError(
        new Error('Hrana(Api("SQLite error: cannot rollback - no transaction is active"))')
      ),
      true
    );
  });

  it("does not retry configuration or authentication failures", () => {
    assert.equal(isRetryableRemoteSchemaError(new Error("Unauthorized")), false);
    assert.equal(isRetryableRemoteSchemaError(new Error("Invalid database URL")), false);
  });
});
