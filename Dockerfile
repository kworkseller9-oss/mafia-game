# Сборка клиента
FROM node:20-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install --no-audit --no-fund
COPY client/ ./
RUN npm run build

# Рантайм: сервер + готовая статика клиента
FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev --no-audit --no-fund
COPY server/ ./server/
COPY --from=client /app/client/dist ./client/dist
ENV PORT=3001 DATA_FILE=/data/users.json
VOLUME /data
EXPOSE 3001
CMD ["node", "server/src/index.js"]
