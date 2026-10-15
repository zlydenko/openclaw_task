#!/usr/bin/env bash
set -euo pipefail
umask 077

# OpenClaw requires private file ownership and permissions for file SecretRefs.
for name in openrouter_api_key gateway_token; do
  if [[ ! -s "/run/secrets/$name" ]]; then
    printf 'Missing or empty secret file: %s\n' "$name" >&2
    exit 1
  fi
  cp "/run/secrets/$name" "/run/openclaw-secrets/$name"
  chmod 600 "/run/openclaw-secrets/$name"
done

# Seed once. Keep existing configuration and conversation history on later starts.
if [[ ! -e /home/node/.openclaw/openclaw.json ]]; then
  cp /etc/assessment/openclaw.json /home/node/.openclaw/openclaw.json
  chmod 600 /home/node/.openclaw/openclaw.json
fi

node /etc/assessment/configure-concurrency.mjs

exec node dist/index.js "$@"
