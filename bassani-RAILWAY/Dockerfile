FROM python:3.11-slim
WORKDIR /app

ARG CACHEBUST=3

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl gcc nodejs npm \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY frontend/package.json /app/frontend/package.json
RUN cd /app/frontend && npm install --silent

COPY frontend/ /app/frontend/
# GENERATE_SOURCEMAP=false: react-scripts emits full .js.map files by default,
# which get copied into /app/static below and served publicly by server.py's
# static mount — anyone with DevTools open can reconstruct the entire original
# source tree (see CLAUDE.md's Security Hardening notes). No sourcemap upload
# pipeline exists yet (would need frontend Sentry wired in first), so disable
# them outright rather than ship them unprotected.
RUN cd /app/frontend && GENERATE_SOURCEMAP=false npm run build
RUN mkdir -p /app/static
RUN cp -r /app/frontend/build/* /app/static/
RUN ls -la /app/static/

COPY backend/ ./

EXPOSE 8000

CMD uvicorn server:app --host 0.0.0.0 --port 8000
