#!/usr/bin/env bash
# Temporary production canary bootstrap for Terra dialogue-root final experiment.
# Fail-closed for everyone except TERRA_PROMPT_CANARY_USER_IDS.
# Restore railway.toml startCommand to "npm run start" after experiments conclude.
set -euo pipefail

export TERRA_PROMPT_CANARY_ENABLED="${TERRA_PROMPT_CANARY_ENABLED:-true}"
export TERRA_PROMPT_CANARY_USER_IDS="${TERRA_PROMPT_CANARY_USER_IDS:-25,34}"
export TERRA_PROMPT_CANARY_VARIANT="${TERRA_PROMPT_CANARY_VARIANT:-dialogue_root_baseline}"
export TERRA_PROMPT_CANARY_DEBUG="${TERRA_PROMPT_CANARY_DEBUG:-true}"
# Leave unset for production default 0.7; best_structure_temp_05/06 hardcode in code.
export TERRA_PROMPT_CANARY_TEMPERATURE="${TERRA_PROMPT_CANARY_TEMPERATURE:-}"

exec npm run start
