#!/bin/bash
# usage: e43l-build.sh <dist-suffix> <cwd>
cd $2 && SESSION_SECRET=0123456789abcdef0123456789abcdef0123 NODE_ENV=production DATA_DIR=/tmp/e43l-data NEXT_DIST_DIR=.next-$1 npx next build > /tmp/e43l-build-$1.log 2>&1; tail -2 /tmp/e43l-build-$1.log; git checkout -q -- tsconfig.json
