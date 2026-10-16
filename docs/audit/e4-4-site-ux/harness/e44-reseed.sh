#!/bin/bash
cd /workspace && DATA_DIR=/tmp/e44-data SESSION_SECRET=0123456789abcdef0123456789abcdef0123 node --conditions=react-server --import tsx scripts/e44-seed.ts > /tmp/e44-seed.log 2>&1; tail -2 /tmp/e44-seed.log
