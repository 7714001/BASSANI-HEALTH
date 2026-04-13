FROM python:3.11-slim
WORKDIR /app

ARG CACHEBUST=2
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl gcc nodejs npm \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY frontend/package.json /app/frontend/package.json
RUN cd /app/frontend && npm install --silent

COPY frontend/ /app/frontend/
RUN cd /app/frontend && npm run build 2>/dev/null || true
RUN mkdir -p /app/static && cp -r /app/frontend/build/* /app/static/ 2>/dev/null || true

COPY backend/ ./

EXPOSE 8000

CMD uvicorn server:app --host 0.0.0.0 --port 8000
