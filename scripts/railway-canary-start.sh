#!/usr/bin/env bash
# Temporary production canary bootstrap for allowlisted Terra main-home tests.
# Fail-closed for everyone except TERRA_PROMPT_CANARY_USER_IDS.
# Remove this startCommand override after canary experiments conclude.
set -euo pipefail

export TERRA_PROMPT_CANARY_ENABLED="${TERRA_PROMPT_CANARY_ENABLED:-true}"
export TERRA_PROMPT_CANARY_USER_IDS="${TERRA_PROMPT_CANARY_USER_IDS:-25}"
export TERRA_PROMPT_CANARY_VARIANT="${TERRA_PROMPT_CANARY_VARIANT:-greeting_neutral_relationship_axis}"
export TERRA_PROMPT_CANARY_DEBUG="${TERRA_PROMPT_CANARY_DEBUG:-true}"
# Experiment temperature — override via Railway env or edit default for redeploy.
export TERRA_PROMPT_CANARY_TEMPERATURE="${TERRA_PROMPT_CANARY_TEMPERATURE:-0.7}"

exec npm run start
