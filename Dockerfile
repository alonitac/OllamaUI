# 1️⃣ Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy only package manifests first (better caching)
COPY package.json package-lock.json ./

# Install all dependencies for build
RUN npm ci

# Set build-time env
ARG OLLAMA_URL=http://127.0.0.1:11434
ENV OLLAMA_URL=${OLLAMA_URL}

# Copy source code
COPY . .

# Build Next.js
RUN npm run build

# 2️⃣ Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Copy only package.json and lock file
COPY package.json package-lock.json ./

# Install only production deps
RUN npm ci --omit=dev && npm cache clean --force

# Copy build output & assets
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

# Optional: copy next.config.js if used at runtime
# COPY --from=builder /app/next.config.js ./ 

ENV NODE_ENV=production
ENV OLLAMA_URL=http://127.0.0.1:11434
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
