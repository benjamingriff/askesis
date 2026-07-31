FROM arigaio/atlas:1.2.3 AS atlas

FROM node:24-alpine AS pnpm
RUN npm install --global pnpm@11.18.0

FROM pnpm AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
RUN pnpm --filter @askesis/api build

FROM pnpm AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN pnpm install --frozen-lockfile --prod --filter @askesis/api...

COPY --from=atlas /atlas /usr/local/bin/atlas
COPY --from=build /app/apps/api/dist apps/api/dist
COPY database/atlas.hcl database/atlas.hcl
COPY database/migrations database/migrations

USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@askesis/api", "start"]
