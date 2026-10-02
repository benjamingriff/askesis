FROM node:24-alpine AS pnpm
RUN npm install --global pnpm@11.18.0
FROM pnpm AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/agent/package.json apps/agent/package.json
RUN pnpm install --frozen-lockfile --filter @askesis/agent...
COPY apps/agent apps/agent
RUN pnpm --filter @askesis/agent build
FROM pnpm AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agent/package.json apps/agent/package.json
RUN pnpm install --frozen-lockfile --prod --filter @askesis/agent...
COPY --from=build /app/apps/agent/dist apps/agent/dist
USER node
CMD ["node", "apps/agent/dist/server.js"]
