#!/bin/bash
# usage: e43k-serve.sh <dist-suffix> <port> <cwd> <on|off>
cd ${3:-/workspace}
if [ "$4" = "on" ]; then
  EXTRA="PORTONE_CHARGE_ENABLED=1 PORTONE_STORE_ID=store-e43k-fake PORTONE_CHANNEL_KEY=channel-key-e43k-fake PORTONE_API_SECRET=e43k-fake-secret PORTONE_REVIEWER_KG_TEST_CHECKOUT_ENABLED=1"
else
  EXTRA="PORTONE_CHARGE_ENABLED=0"
fi
env $EXTRA E43K_SHIFT_DAYS=3 NODE_OPTIONS="--require /workspace/scripts/e43k-fakedate.cjs" PLAYWRIGHT_PROD_SERVER=1 NODE_ENV=production DATA_DIR=/tmp/e43k-data SESSION_SECRET=0123456789abcdef0123456789abcdef0123 NEXT_DIST_DIR=.next-$1 PORT=$2 setsid nohup npx tsx server.js > /tmp/e43k-serve-$1-$4.log 2>&1 &
