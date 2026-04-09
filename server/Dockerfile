FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci 2>/dev/null || npm install

COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src

RUN npx prisma generate && npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
EXPOSE 3001

CMD ["node", "dist/index.js"]
