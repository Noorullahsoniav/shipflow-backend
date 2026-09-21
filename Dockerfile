# ShipFlow Manager backend — Hugging Face Spaces (Docker SDK)
# HF Spaces requires the container to listen on port 7860.
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --include=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=7860

EXPOSE 7860

CMD ["npx", "tsx", "server.ts"]
