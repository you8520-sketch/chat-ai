import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  canUseAdultSceneHandoffAdminCanary,
  resolveAdultSceneHandoffCanaryConfig,
  resolveAdultSceneRoutingEnabledForRequest,
} from "./adultSceneHandoffCanary";
import { evaluateAdminHandoffParity } from "./adminHandoffParity";
import {
  canCaptureAdminHandoffAudit,
  resolveAdminHandoffAuditCaptureConfig,
} from "./adminHandoffAuditCapture";

const srcRoot = dirname(fileURLToPath(import.meta.url));

describe("admin handoff parity", () => {
  it("fails closed because admin chat has special routing paths", () => {
    const report = evaluateAdminHandoffParity();
    assert.equal(report.ADMIN_PARITY_PROVEN, false);
    assert.equal(report.LIVE_ADMIN_CAPTURE_ALLOWED, false);
    assert.equal(report.DEEPSEEK_CALLS, 0);
    assert.equal(report.MODEL_CALLS_GENERATING_USER_TURNS, 0);
    assert.equal(report.reason, "admin_special_routing_path");
    assert.ok(report.blockers.includes("admin_handoff_canary_routing_enablement"));
    assert.ok(report.blockers.includes("admin_forced_adult_flag"));
    assert.ok(report.promptLoaders.every((loader) => loader.sameCodePath));
  });

  it("keeps prompt loaders on the shared production path", () => {
    const contextBuilder = readFileSync(
      join(srcRoot, "../services/contextBuilder.ts"),
      "utf8"
    );
    assert.equal(contextBuilder.includes("isAdmin"), false);
    assert.equal(contextBuilder.includes("adminCanary"), false);
    const auth = readFileSync(join(srcRoot, "auth.ts"), "utf8");
    assert.match(auth, /is_adult:\s*1/);
    assert.match(auth, /isAdminUser/);
  });

  it("documents that admin canary can enable adult routing when general is off", () => {
    const config = resolveAdultSceneHandoffCanaryConfig({
      ADULT_SCENE_HANDOFF_ADMIN_CANARY: "true",
      ADULT_SCENE_HANDOFF_GENERAL_ENABLED: "false",
      ADULT_SCENE_HANDOFF_ADMIN_USER_IDS: "7",
      ADULT_SCENE_HANDOFF_ADMIN_CHAT_IDS: "315",
    });
    assert.equal(
      canUseAdultSceneHandoffAdminCanary({
        config,
        isAdmin: true,
        userId: 7,
        chatId: 315,
      }),
      true
    );
    assert.equal(
      resolveAdultSceneRoutingEnabledForRequest({
        generalEnabled: false,
        adminCanaryAccess: true,
      }),
      true
    );
    assert.equal(
      resolveAdultSceneRoutingEnabledForRequest({
        generalEnabled: false,
        adminCanaryAccess: false,
      }),
      false
    );
    const route = readFileSync(join(srcRoot, "../app/api/chat/route.ts"), "utf8");
    assert.match(route, /adminCanaryAccess: adultHandoffCanaryAccess/);
    assert.match(route, /glmHardFailureFallbackEnabled: true/);
    assert.equal(route.includes("adminHandoffAuditCapture"), false);
    assert.equal(route.includes("adminHandoffParity"), false);
  });
});

describe("admin handoff audit capture policy", () => {
  it("stays off by default and never captures ordinary user chats", () => {
    const defaults = resolveAdminHandoffAuditCaptureConfig({});
    assert.equal(defaults.enabled, false);
    assert.equal(
      canCaptureAdminHandoffAudit({
        config: {
          enabled: true,
          allowedAdminUserIds: new Set([7]),
          allowedChatIds: new Set([315]),
        },
        isAdmin: true,
        userId: 7,
        chatId: 315,
        ordinaryUserChat: true,
      }),
      false
    );
    assert.equal(
      canCaptureAdminHandoffAudit({
        config: {
          enabled: true,
          allowedAdminUserIds: new Set([7]),
          allowedChatIds: new Set([315]),
        },
        isAdmin: true,
        userId: 7,
        chatId: 315,
        ordinaryUserChat: false,
      }),
      true
    );
  });
});
