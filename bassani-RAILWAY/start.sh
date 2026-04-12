#!/bin/bash
# Bassani Health — startup with Odoo connection verification
# Usage: ./start.sh

set -e
cd "$(dirname "$0")"

echo ""
echo "═══════════════════════════════════════════"
echo "  Bassani Health Internal ERP"
echo "  Starting up..."
echo "═══════════════════════════════════════════"

# Check .env exists
if [ ! -f backend/.env ]; then
  echo "❌  backend/.env not found — copy from backend/.env.example"
  exit 1
fi

echo ""
echo "▶  Testing Odoo connection..."
cd backend
python3 test_odoo.py
cd ..

echo ""
echo "▶  Starting services..."
docker compose up --build -d

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅  Bassani Health is running"
echo ""
echo "  App:          http://localhost:8000"
echo "  API docs:     http://localhost:8000/docs"
echo "  Packing board:http://localhost:8000/packing-board.html"
echo "  Supervisor:   http://localhost:8000/supervisor.html"
echo "═══════════════════════════════════════════"
echo ""
