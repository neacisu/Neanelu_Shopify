FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

WORKDIR /app

# Copy workspace (deps are installed at runtime; token is provided via env, not baked)
COPY . .

# pnpm can request confirmation for node_modules cleanup; containers have no TTY.
ENV CI=true

EXPOSE 65000

CMD ["sh", "-lc", "pnpm install && cd /app/apps/backend-worker && pnpm dev"]
