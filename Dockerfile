# ---- PayrollPro API image ----
FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies separately for better layer caching
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy source
COPY . .

ENV NODE_ENV=production
EXPOSE 4000

# Run migrations then start. (In real deploys, run migrations as a separate job.)
CMD ["sh", "-c", "node src/db.js migrate && node src/server.js"]
