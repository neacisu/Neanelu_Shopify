FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

WORKDIR /app

# Copy workspace (deps are installed at runtime; keeps dev image simple and avoids baking env)
COPY . .

ENV DOCKER=1

# pnpm can request confirmation for node_modules cleanup; containers have no TTY.
ENV CI=true

EXPOSE 65001

CMD ["sh", "-lc", "pnpm install && cd /app/apps/web-admin && pnpm dev --host 0.0.0.0 --port ${FRONTEND_PORT:-65001} --strictPort"]
