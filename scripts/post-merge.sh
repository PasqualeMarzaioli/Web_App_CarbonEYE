#!/bin/bash
# scripts/post-merge.sh — Git post-merge hook that installs dependencies and runs database migrations after pulls or merges.
# Author: Pasquale Marzaioli
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
