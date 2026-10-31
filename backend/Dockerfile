# syntax=docker/dockerfile:1.7
# Một Dockerfile cho cả monorepo; chọn app bằng target: api | worker | collab.
#   docker build --target api -t luna-api .

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install -g pnpm@9.15.0
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/collab/package.json apps/collab/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/editor/package.json packages/editor/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY scripts/package.json scripts/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm turbo run build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm deploy --filter @luna/api --prod /out/api && \
    pnpm deploy --filter @luna/worker --prod /out/worker && \
    pnpm deploy --filter @luna/collab --prod /out/collab

FROM build AS migrate
WORKDIR /repo
USER node
CMD ["sh", "-c", "pnpm --filter @luna/db exec prisma migrate deploy && pnpm --filter @luna/scripts db:app-login && pnpm --filter @luna/scripts infra:init"]

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
USER node

FROM runtime AS api
COPY --from=build --chown=node:node /out/api /app
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

FROM runtime AS worker
# FFmpeg cho transcode video (Phase 4). GPU NVIDIA: chạy với NVIDIA Container Toolkit, VIDEO_ENCODER=h264_nvenc.
USER root
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /var/tmp/luna && chown node:node /var/tmp/luna
USER node
COPY --from=build --chown=node:node /out/worker /app
HEALTHCHECK --interval=15s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_METRICS_PORT||9464)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

FROM runtime AS collab
COPY --from=build --chown=node:node /out/collab /app
EXPOSE 4001
HEALTHCHECK --interval=15s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.COLLAB_PORT||4001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
