#!/bin/bash
cd /workspace && DATA_DIR=/tmp/e43k-data SESSION_SECRET=0123456789abcdef0123456789abcdef0123 node --conditions=react-server --import tsx scripts/e43k-seed.ts > /tmp/e43k-seed.log 2>&1; tail -5 /tmp/e43k-seed.log
