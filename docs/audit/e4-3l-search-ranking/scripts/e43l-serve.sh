#!/bin/bash
# usage: e43l-serve.sh <dist-suffix> <port> <cwd>
cd ${3:-/workspace}
env PORTONE_CHARGE_ENABLED=0 PLAYWRIGHT_PROD_SERVER=1 NODE_ENV=production DATA_DIR=/tmp/e43l-data SESSION_SECRET=0123456789abcdef0123456789abcdef0123 NEXT_DIST_DIR=.next-$1 PORT=$2 setsid nohup npx tsx server.js > /tmp/e43l-serve-$1.log 2>&1 &
