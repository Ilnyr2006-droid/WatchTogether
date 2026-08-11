FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_WEBRTC_DEBUG=false
ENV NEXT_PUBLIC_WEBRTC_DEBUG=$NEXT_PUBLIC_WEBRTC_DEBUG
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV WATCHTOGETHER_PORT=47821
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/server ./server
COPY --from=builder /app/types ./types
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
EXPOSE 47821
CMD ["npm", "run", "start"]
