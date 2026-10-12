FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER node
CMD ["npx", "tsx", "src/server.ts"]
