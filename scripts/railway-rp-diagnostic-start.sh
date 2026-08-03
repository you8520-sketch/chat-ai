#!/usr/bin/env bash
# Temporary production bootstrap for RP diagnostic canary (DeepSeek V4 Flash audit).
# Fail-closed — only RP_DIAGNOSTIC_CANARY_USER_IDS receive variant mutations.
# Restore railway.toml startCommand to "npm run start" after experiments conclude.
set -euo pipefail

export RP_DIAGNOSTIC_CANARY_ENABLED="${RP_DIAGNOSTIC_CANARY_ENABLED:-true}"
export RP_DIAGNOSTIC_CANARY_USER_IDS="${RP_DIAGNOSTIC_CANARY_USER_IDS:-34}"
export RP_DIAGNOSTIC_CANARY_MODEL_IDS="${RP_DIAGNOSTIC_CANARY_MODEL_IDS:-deepseek-v4-flash}"
export RP_DIAGNOSTIC_CANARY_VARIANT="${RP_DIAGNOSTIC_CANARY_VARIANT:-ds_postprocess_baseline}"
export RP_DIAGNOSTIC_CANARY_DEBUG="${RP_DIAGNOSTIC_CANARY_DEBUG:-true}"

exec npm run start
