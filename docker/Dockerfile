FROM ghcr.io/openclaw/openclaw:2026.10.3-browser@sha256:c84c4c37e7b9dc02dd869c9699ba0c4fb20ff821febe4b789bb2f8f4bfd9c8a3

USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN mv /home/node/.cache/ms-playwright /opt/ms-playwright \
    && node --input-type=module -e "import { symlinkSync } from 'node:fs'; import { chromium } from 'playwright-core'; symlinkSync(chromium.executablePath(), '/usr/local/bin/chromium');"
RUN mkdir -p /home/node/.openclaw/workspace /etc/assessment \
    && chown -R node:node /home/node/.openclaw
COPY docker/openclaw.json /etc/assessment/openclaw.json
COPY docker/gateway-entrypoint.sh /usr/local/bin/gateway-entrypoint
USER node
WORKDIR /app
ENTRYPOINT ["bash", "/usr/local/bin/gateway-entrypoint"]
