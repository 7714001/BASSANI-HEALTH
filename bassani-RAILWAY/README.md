# Bassani Health — Internal ERP System v2.0

Full-stack internal ERP integrating with Odoo via XML-RPC.
Covers Products, Customers, Orders, Resellers, Commission Matrix, Reports and Healthcare Onboarding.

---

## Tech Stack

| Layer      | Technology                        |
|------------|-----------------------------------|
| Backend    | FastAPI (Python 3.11)             |
| Database   | MongoDB (via Motor async driver)  |
| ERP        | Odoo XML-RPC (all versions 8+)    |
| Frontend   | React 18 + Tailwind CSS           |
| Auth       | JWT (bcrypt + PyJWT)              |
| Email      | Resend API                        |
| Push       | VAPID Web Push                    |
| Deployment | Docker + Docker Compose           |

---

## Project Structure

```
bassani-health/
├── backend/
│   ├── server.py              ← FastAPI app entry point
│   ├── config.py              ← Settings (env vars)
│   ├── database.py            ← MongoDB singleton
│   ├── auth.py                ← JWT + bcrypt helpers
│   ├── odoo_client.py         ← Odoo XML-RPC connector
│   ├── requirements.txt
│   ├── .env.example
│   ├── routes/
│   │   ├── auth_routes.py
│   │   ├── product_routes.py
│   │   ├── customer_routes.py
│   │   ├── order_routes.py
│   │   ├── stock_routes.py
│   │   ├── invoice_routes.py
│   │   ├── reseller_routes.py
│   │   ├── commission_routes.py
│   │   ├── report_routes.py
│   │   ├── healthcare_routes.py
│   │   └── notification_routes.py
│   └── services/
│       └── notification_service.py
├── frontend/
│   ├── src/
│   │   ├── App.js             ← Router + layout
│   │   ├── AuthContext.js     ← Global auth state
│   │   ├── api.js             ← Axios + JWT interceptor
│   │   ├── components/
│   │   │   └── UI.js          ← All shared components
│   │   └── views/
│   │       ├── Login.js
│   │       ├── Dashboard.js
│   │       ├── Products.js
│   │       ├── Customers.js
│   │       ├── Orders.js
│   │       ├── Resellers.js
│   │       ├── Commission.js
│   │       ├── Reports.js
│   │       └── Healthcare.js
│   ├── public/
│   │   ├── index.html
│   │   └── manifest.json
│   ├── package.json
│   ├── tailwind.config.js
│   └── .env.example
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## Quick Start

### 1. Configure environment

```bash
# Backend
cp backend/.env.example backend/.env
nano backend/.env
```

Fill in your values:

```env
MONGO_URL=mongodb://mongo:27017        # Uses docker-compose service name
DB_NAME=bassani_internal
JWT_SECRET=<run: openssl rand -base64 32>

ODOO_URL=https://your-odoo.com
ODOO_DB=your_database
ODOO_USERNAME=admin@yourdomain.com
ODOO_PASSWORD=your_odoo_password

RESEND_API_KEY=re_your_key             # Optional — emails work as mock without this
SENDER_EMAIL=noreply@bassanihealth.com
HEALTHCARE_EMAIL=healthcare@bassanihealth.com
```

```bash
# Frontend
cp frontend/.env.example frontend/.env
# For local dev: REACT_APP_BACKEND_URL=http://localhost:8000
# For production: REACT_APP_BACKEND_URL=https://your-domain.com
```

### 2. Run with Docker (recommended)

```bash
docker compose up --build
```

- **Frontend + API:** http://localhost:8000
- **API docs:**       http://localhost:8000/docs
- **Health check:**   http://localhost:8000/health

### 3. Run locally (without Docker)

**Backend:**
```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```

**Frontend (separate terminal):**
```bash
cd frontend
npm install
npm start                        # Runs on http://localhost:3000
```

---

## Default Credentials

| Role     | Username | Password     |
|----------|----------|--------------|
| Admin    | admin    | admin123     |
| Reseller | joe2025  | reseller123  |

> ⚠️ Change these immediately in production via the users collection.

---

## MongoDB Collections

| Collection                | Owner   | Purpose                                    |
|---------------------------|---------|--------------------------------------------|
| `users`                   | MongoDB | Login credentials and roles                |
| `resellers`               | MongoDB | Reseller master data + commission rates    |
| `commission_matrix`       | MongoDB | Per-product per-reseller rate overrides    |
| `order_commissions`       | MongoDB | Commission data linked to Odoo order IDs  |
| `healthcare_professionals`| MongoDB | Public website onboarding submissions      |
| `push_subscriptions`      | MongoDB | Browser push notification subscriptions    |
| `notification_logs`       | MongoDB | Push notification send history             |
| `settings`                | MongoDB | System config (commission limits etc.)     |

**Everything else (products, customers, orders, invoices, stock) lives in Odoo.**

---

## API Endpoints

### Auth
```
POST /api/auth/login    → Login, returns JWT
GET  /api/auth/me       → Current user
```

### Products (Odoo)
```
GET    /api/products/           → List products
GET    /api/products/{id}       → Single product
GET    /api/products/low-stock  → Low stock alert list
POST   /api/products/           → Create (admin)
PUT    /api/products/{id}       → Update (admin)
DELETE /api/products/{id}       → Archive (admin)
```

### Customers (Odoo)
```
GET  /api/customers/        → List customers
GET  /api/customers/{id}    → Single customer
GET  /api/customers/{id}/orders → Customer order history
POST /api/customers/        → Create (admin)
PUT  /api/customers/{id}    → Update (admin)
```

### Orders (Odoo + MongoDB commission overlay)
```
GET  /api/orders/               → List orders
GET  /api/orders/{id}           → Order detail with commission
POST /api/orders/               → Create order (writes to Odoo + commission to MongoDB)
PUT  /api/orders/{id}/confirm   → Confirm (admin)
PUT  /api/orders/{id}/cancel    → Cancel (admin)
GET  /api/orders/stats/summary  → Dashboard stats
```

### Resellers (MongoDB)
```
GET    /api/resellers/              → List all
GET    /api/resellers/by-code/{code}→ Lookup by seller code
GET    /api/resellers/{id}          → Single reseller
POST   /api/resellers/              → Create (admin)
PUT    /api/resellers/{id}          → Update (admin)
DELETE /api/resellers/{id}          → Deactivate (admin)
GET    /api/resellers/{id}/stats    → Commission stats
```

### Commission Matrix (MongoDB)
```
GET  /api/commission/{id}/matrix                      → Full matrix with effective rates
PUT  /api/commission/{id}/matrix/{product_id}         → Update single rate
PUT  /api/commission/{id}/matrix/{product_id}/block   → Block product
PUT  /api/commission/{id}/matrix/{product_id}/unblock → Unblock product
POST /api/commission/{id}/matrix/upload               → Bulk Excel/CSV upload
GET  /api/commission/limits                           → System min/max limits
PUT  /api/commission/limits                           → Update limits (admin)
```

### Reports (Odoo + MongoDB)
```
GET /api/reports/dashboard           → Master dashboard stats
GET /api/reports/monthly-turnover    → Revenue split + 6-month trend
GET /api/reports/best-sellers        → Top products by revenue
GET /api/reports/best-customers      → Top customers by spend
GET /api/reports/dead-stock          → Slow/non-moving stock
GET /api/reports/category-performance→ Revenue by category
GET /api/reports/commissions         → Commission breakdown by reseller
```

### Healthcare (MongoDB + Resend email)
```
POST /api/healthcare/onboarding                         → Public submission form
GET  /api/healthcare/submissions                        → List (admin)
GET  /api/healthcare/submissions/{id}                   → Detail (admin)
PUT  /api/healthcare/submissions/{id}/status            → Update status (admin)
DELETE /api/healthcare/submissions/{id}                 → Hard delete (POPIA)
```

### Notifications (MongoDB + VAPID)
```
GET  /api/notifications/vapid-key   → VAPID public key for browser
POST /api/notifications/subscribe   → Register push subscription
DELETE /api/notifications/unsubscribe → Remove subscription
PUT  /api/notifications/preferences → Update preferences
POST /api/notifications/broadcast   → Send to all users (admin)
GET  /api/notifications/logs        → Broadcast history (admin)
```

---

## Commission Logic

Three-tier resolution (highest priority first):

```
1. Product-specific rate in commission_matrix   → "custom"
2. Reseller category default rate               → "category_default"
3. System default (10%)                         → "system_default"
```

Blocked products return a rate of 0% and the reseller cannot order them.
Commission range is enforced: **10% minimum, 50% maximum**.

---

## Production Deployment

### Server (Ubuntu/Debian)

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Clone project
git clone <your-repo> bassani-health && cd bassani-health

# Configure
cp backend/.env.example backend/.env
nano backend/.env                      # Fill in production values

# Generate secure JWT secret
openssl rand -base64 32                # Paste into JWT_SECRET

# Build frontend
cd frontend && npm install && npm run build && cd ..

# Start
docker compose up -d
```

### Nginx (HTTPS)

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Security hardening checklist

- [ ] Change `JWT_SECRET` to a random 32+ character string
- [ ] Set `CORS_ORIGINS` to your specific domain(s)
- [ ] Change default admin password in MongoDB users collection
- [ ] Enable MongoDB authentication
- [ ] Set up SSL/HTTPS via Let's Encrypt (Certbot)
- [ ] Restrict `RESEND_API_KEY` to production domain
- [ ] Set up regular MongoDB backups

---

## Adding SAGE Integration (Future)

When ready to add SAGE:

1. Add SAGE credentials to `.env`:
```env
SAGE_URL=https://api.sage.com
SAGE_CLIENT_ID=your_client_id
SAGE_CLIENT_SECRET=your_secret
```

2. Create `backend/routes/sage_routes.py`
3. Import and register in `server.py`
4. The rest of the architecture remains unchanged — SAGE sits alongside Odoo and MongoDB, not replacing either.

---

*Built with ❤️ by Claude for Bassani Health*
