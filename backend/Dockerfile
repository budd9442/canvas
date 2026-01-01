# Build Stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Runtime Stage
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
# Install only production dependencies
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
# Copy env file if needed, or expect it to be mounted/passed at runtime.
# For simplicity in local dev, we might copy it, but best practice is env vars.
# COPY .env .env 

EXPOSE 3000

CMD ["node", "dist/index.js"]
