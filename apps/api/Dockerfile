FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN npm ci

COPY apps/api apps/api
RUN npm run build --workspace @askesis/api

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN npm ci --omit=dev --workspace @askesis/api --include-workspace-root

COPY --from=build /app/apps/api/dist apps/api/dist

USER node
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "@askesis/api"]
