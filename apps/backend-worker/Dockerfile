FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /app

# Copy only manifests first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/*/package.json ./apps/
COPY packages/*/package.json ./packages/

RUN pnpm install --frozen-lockfile

# Now copy full workspace
COPY . .

WORKDIR /app/apps/backend-worker

EXPOSE 65000

CMD ["pnpm", "dev"]
