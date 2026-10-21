FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG SITE_URL=https://huaoblog.cn
ENV SITE_URL=$SITE_URL
RUN npm run build:node

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321 APP_DATA_DIR=/data
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir /data && chown node:node /data
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/worker ./worker
USER node
VOLUME /data
EXPOSE 4321
CMD ["node", "dist/server/entry.mjs"]
