FROM node:20-bookworm-slim AS build

WORKDIR /app

ENV CI=true

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json .npmrc ./
COPY artifacts ./artifacts
COPY lib ./lib
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile
RUN pnpm exec tsc --build --force \
  && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck
RUN pnpm --filter @workspace/carboneye run build
RUN pnpm --filter @workspace/api-server run build
RUN rm -rf artifacts/api-server/dist/static \
  && mkdir -p artifacts/api-server/dist/static \
  && cp -R artifacts/carboneye/dist/public/. artifacts/api-server/dist/static/
RUN pnpm --filter @workspace/api-server --prod deploy --legacy /deploy
RUN mkdir -p /deploy/dist/static \
  && cp -R artifacts/api-server/dist/static/. /deploy/dist/static/ \
  && test -f /deploy/dist/index.mjs \
  && test -f /deploy/dist/static/index.html

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=build /deploy ./

EXPOSE 3001

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
