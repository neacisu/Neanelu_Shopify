# syntax=docker/dockerfile:1.6
FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app

# Install deps at build time (avoid pnpm install at runtime).
# Token is provided at build time and written to a temporary user-level .npmrc.
COPY . .

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
  rm -f /root/.npmrc; \
  pnpm --filter @app/web-admin... run build

FROM nginx:1.27-alpine

# Serve the built SPA on the same port expected by the infra (65001).
COPY apps/web-admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web-admin/dist /usr/share/nginx/html

EXPOSE 65001

CMD ["nginx", "-g", "daemon off;"]
