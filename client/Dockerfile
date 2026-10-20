FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY client/ ./client/

ENV NODE_ENV=production
ENV SERVICE_URL=http://metering-service:3000

CMD ["npx", "ts-node", "client/demo.ts"]
