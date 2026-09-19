# One container serves both the API and the built frontend (see app/backend/server.js).
# Build context is the repository root. Cloud Run sets PORT (8080) itself.

# ---- 1. build the frontend ----
FROM node:22-slim AS frontend
WORKDIR /src/app/frontend
COPY app/frontend/package.json app/frontend/package-lock.json ./
RUN npm ci
COPY app/frontend/ ./
# VITE_API_BASE_URL is deliberately unset so the app calls the same origin at /api
RUN npm run build

# ---- 2. the runtime image ----
FROM node:22-slim
WORKDIR /src/app/backend
ENV NODE_ENV=production
COPY app/backend/package.json app/backend/package-lock.json ./
RUN npm ci --omit=dev
COPY app/backend/ ./
COPY --from=frontend /src/app/frontend/dist /src/app/frontend/dist
EXPOSE 8080
CMD ["node", "server.js"]
