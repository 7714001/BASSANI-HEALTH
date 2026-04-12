# ── Build React frontend ──────────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install --silent
COPY frontend/ ./
# Create a simple build if react-scripts not available
RUN npm run build 2>/dev/null || (mkdir -p build && cp -r public/* build/)

# ── Backend ───────────────────────────────────────────────────────
FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl gcc \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=frontend-build /app/frontend/build ./static

EXPOSE $PORT

CMD uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1
