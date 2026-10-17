FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache python3 make g++ sqlite

# Install production dependencies
COPY package.json package-lock.json* ./
COPY packages/shared/ packages/shared/
COPY apps/backend/ apps/backend/

RUN npm install --workspace=@haven/shared --workspace=@haven/backend --omit=dev
RUN npm run --workspace=@haven/shared build
RUN npm run --workspace=@haven/backend build

EXPOSE 3001
ENV PORT=3001 HOST=0.0.0.0 NODE_ENV=production DATA_DIR=/data SERVE_STATIC=false
VOLUME ["/data"]

WORKDIR /app/apps/backend
CMD ["node", "build/index.js"]
