#!/bin/bash
cd /workspace && DATA_DIR=/tmp/e43l-data SESSION_SECRET=0123456789abcdef0123456789abcdef0123 node --conditions=react-server --import tsx scripts/e43l-seed.ts > /tmp/e43l-seed.log 2>&1; tail -2 /tmp/e43l-seed.log
