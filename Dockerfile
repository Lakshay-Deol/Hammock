FROM node:22-slim AS builder

WORKDIR /app

# Install pnpm and build essentials for better-sqlite3
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:22-slim AS runner

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.15.1 --activate

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/fixtures ./fixtures
COPY --from=builder /app/.hammock.yml ./.hammock.yml
COPY --from=builder /app/hammock.db ./hammock.db

ENV NODE_ENV=production
ENV PORT=3000
ENV HAMMOCK_REPLAY=1

EXPOSE 3000

CMD ["node", "dist/cli.js", "dashboard"]
