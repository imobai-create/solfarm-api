FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci && npm cache clean --force

COPY . .
RUN npx prisma generate

EXPOSE 3333

CMD ["sh", "-c", "npx prisma db push --skip-generate && node ./node_modules/.bin/tsx src/server.ts"]
