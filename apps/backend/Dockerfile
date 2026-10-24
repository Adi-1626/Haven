FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY packages/shared/ packages/shared/
COPY apps/backend/ apps/backend/
# TypeScript is a build dependency. Keep it in this stage only.
RUN npm ci --workspace=@haven/shared --workspace=@haven/backend --include-workspace-root=false
RUN npm run --workspace=@haven/shared build && npm run --workspace=@haven/backend build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache python3 make g++ sqlite
COPY package.json package-lock.json ./
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist/ packages/shared/dist/
COPY --from=build /app/apps/backend/package.json apps/backend/package.json
COPY --from=build /app/apps/backend/build/ apps/backend/build/
COPY --from=build /app/apps/backend/certs/ apps/backend/certs/
RUN npm ci --workspace=@haven/shared --workspace=@haven/backend --include-workspace-root=false --omit=dev
EXPOSE 3001
ENV PORT=3001 HOST=0.0.0.0 NODE_ENV=production HAVEN_MODE=hosted DATA_DIR=/data SERVE_STATIC=false
VOLUME ["/data"]
WORKDIR /app/apps/backend
CMD ["node", "build/index.js"]
