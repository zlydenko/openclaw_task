FROM ghcr.io/openclaw/openclaw:2026.10.3@sha256:70b8dbd23f8d27a206f43f9828fdebc87289e50d56dc55177354c9270d764026

USER root
RUN mkdir -p /home/node/.openclaw/workspace /etc/assessment \
    && chown -R node:node /home/node/.openclaw
COPY docker/openclaw.json /etc/assessment/openclaw.json
COPY docker/configure-concurrency.mjs /etc/assessment/configure-concurrency.mjs
COPY docker/gateway-entrypoint.sh /usr/local/bin/gateway-entrypoint
USER node
WORKDIR /app
ENTRYPOINT ["bash", "/usr/local/bin/gateway-entrypoint"]
