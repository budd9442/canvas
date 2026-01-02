# Build Stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build
RUN npm prune --production

# Runtime Stage
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# Copy env file if needed, or expect it to be mounted/passed at runtime.
# For simplicity in local dev, we might copy it, but best practice is env vars.
# COPY .env .env 

EXPOSE 3000

CMD ["node", "dist/index.js"]
