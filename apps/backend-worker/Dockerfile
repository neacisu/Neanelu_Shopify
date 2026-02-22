# syntax=docker/dockerfile:1.6
FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app

# Install deps at build time (avoid pnpm install at runtime).
# Token is provided at build time and written to a temporary user-level .npmrc.
COPY . .

ENV CI=true
RUN --mount=type=secret,id=npm_token \
  set -eu; \
  token="$(cat /run/secrets/npm_token)"; \
  test -n "$token"; \
  printf '%s\n' \
    '@taskforcesh:registry=https://npm.taskforce.sh/' \
    "//npm.taskforce.sh/:_authToken=$token" \
    'always-auth=true' \
    > /root/.npmrc; \
  pnpm install --frozen-lockfile; \
  rm -f /root/.npmrc

# Playwright runtime dependency for PR-064 scraper fallback.
# Keep Chromium in runtime stage for prod multi-stage builds.
# Chromium adds roughly ~300MB, install only this browser.
ENV PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=600000
RUN for attempt in 1 2 3; do \
      npx playwright-core install --with-deps chromium && break; \
      echo "playwright install attempt $attempt failed, retrying..."; \
      sleep 10; \
    done

EXPOSE 65000

CMD ["sh", "-lc", "pnpm --filter @app/backend-worker dev"]
