# TransactGo — Production-Grade Fintech API

A wallet and payments platform API built to senior engineering standards. Multi-currency wallets, idempotent transfers, config-driven fees, webhook processing, fraud detection, and full DevOps — all production-ready patterns, no shortcuts.

---

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Features](#features)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Key Engineering Decisions](#key-engineering-decisions)
- [Running Tests](#running-tests)
- [DevOps](#devops)
- [Monitoring](#monitoring)
- [Roadmap](#roadmap)

---

## Architecture

```
Client
  │
  ▼
API Gateway (NestJS + Express)
  │   JWT Auth Guard (global)
  │   Rate Limiting (ThrottlerGuard)
  │   Idempotency Interceptor
  │
  ├──▶ Auth Module          → JWT + Refresh Token Rotation
  ├──▶ Users / KYC Module   → Tiered verification (0→3)
  ├──▶ Wallets Module       → Multi-currency, Ledger-based
  ├──▶ Transfers Module     → Internal wallet-to-wallet
  ├──▶ Payments Module      → External deposit / withdrawal
  ├──▶ Fees Module          → DB-driven fee rules engine
  ├──▶ Fraud Module         → Rule-based fraud detection
  ├──▶ Webhooks Module      → Provider callbacks (HMAC verified)
  ├──▶ Reports Module       → Statements, analytics
  ├──▶ Exchange Rates       → Live mock rates, conversions
  ├──▶ Audit Module         → Immutable event log
  └──▶ Admin Module         → Ops panel (users, rules, alerts)
        │
        ├──▶ PostgreSQL (TypeORM)     — Transactional data
        ├──▶ Redis (BullMQ)           — Job queues
        └──▶ Redis (Cache)            — Fee rules, rate limits
```

**Request flow for a transfer:**

```
POST /api/v1/transfers/internal
  │
  ├─ IdempotencyInterceptor   → check/store X-Idempotency-Key
  ├─ JwtAuthGuard             → validate access token
  ├─ KycGuard                 → enforce minimum KYC tier
  ├─ FraudService.evaluate()  → run DB-driven fraud rules
  ├─ FeesService.calculate()  → fetch fee from fee_rules table
  ├─ QueryRunner.transaction()→ BEGIN
  │     ├─ WalletsService.debit()   → SELECT FOR UPDATE → debit source
  │     ├─ WalletsService.credit()  → credit destination
  │     └─ Transfer record saved
  ├─ QueryRunner.commit()
  ├─ AuditService.log()       → fire-and-forget audit entry
  └─ NotificationsService     → queue email/push via BullMQ
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20, TypeScript |
| Framework | NestJS 10 |
| Database | PostgreSQL 15 (TypeORM) |
| Queue | Redis 7 + BullMQ |
| Cache | Redis (cache-manager) |
| Auth | JWT (access 15m) + Refresh tokens (7d, rotated) |
| Validation | class-validator + class-transformer |
| Logging | Winston (structured JSON in production) |
| Security | Helmet, bcrypt (rounds=12), HMAC webhook verification |
| DevOps | Docker, GitHub Actions CI/CD |
| Monitoring | Prometheus + Grafana (optional profile) |
| Queue UI | Bull Board (`:3001`) |
| DB UI | pgAdmin (`:5050`, tools profile) |

---

## Features

### Financial Core
- **Ledger-based balances** — every balance change is an immutable `LedgerEntry`. Balance is a derived value, never directly mutated without a ledger record.
- **Pessimistic locking** — `SELECT FOR UPDATE` on all debit operations prevents race conditions on concurrent requests to the same wallet.
- **Multi-currency wallets** — NGN, USD, GHS, KES, ZAR, EUR, GBP. One wallet per currency per user. Cross-currency transfers go through the exchange rate service.
- **Integer money storage** — all amounts stored as `BIGINT` in the smallest currency unit (kobo, cents). Never floats.

### Idempotency
- Every mutating endpoint (`/transfers`, `/payments/deposit`, `/payments/withdraw`) requires an `X-Idempotency-Key` header.
- Duplicate requests within 24 hours return the exact cached response — no re-execution.
- In-flight lock prevents concurrent duplicate requests from both processing.
- Results stored in `idempotency_records` table (survives Redis restarts).

### Config-Driven Fees
- Fee rules live in the `fee_rules` database table — no hardcoded values anywhere.
- Supports flat, percentage, and tiered fee structures (e.g. Nigerian NIP transfer fees).
- Supports per-rule VAT/tax rates, floors, and caps.
- Ops teams update fees via the Admin API — zero redeployment needed.
- Rules cached in Redis for 5 minutes; cache invalidated immediately on update.

### KYC Tiers
| Tier | Requirement | Daily Limit | Withdrawals |
|---|---|---|---|
| 0 — Unverified | Registration only | None | ✗ |
| 1 — Basic | BVN / NIN submitted | ₦50,000 | ✗ |
| 2 — Standard | ID document verified | ₦500,000 | ✓ |
| 3 — Full | Address proof | Unlimited | ✓ |

Verification is processed asynchronously via a BullMQ job (simulates Smile Identity / Youverify).

### Fraud Detection
Rule-based engine evaluated on every transfer and deposit:
- **Velocity** — blocks > N transactions per rolling hour window
- **Daily limit** — flags when projected daily volume exceeds threshold
- **Large amount** — flags single transaction > 10× 30-day average
- **Unusual pattern** — z-score anomaly detection on transaction amounts

All rules configurable from the Admin API. Actions are `block` (reject transaction), `flag` (allow + alert ops), or `notify` (allow + log).

### Webhooks
- HMAC-SHA256 signature verification on every incoming webhook (Flutterwave, Stripe).
- Deduplication by `providerEventId` — providers that retry on timeout won't double-process.
- Respond `200 OK` immediately, process asynchronously via BullMQ.
- Up to 5 retry attempts with exponential backoff (3s, 6s, 12s, 24s, 48s).

### Auth Security
- Access tokens expire in 15 minutes.
- Refresh tokens are hashed with bcrypt before storage (treated like passwords).
- Token rotation on every refresh — old token immediately invalidated.
- Refresh token reuse detection: if an old token is presented, **all sessions are invalidated** and the user is forced to re-login.
- Account lockout after 5 failed login attempts (30-minute lock).
- Timing-safe password comparison (prevents user enumeration via response timing).

---

## Project Structure

```
src/
├── common/
│   ├── decorators/
│   │   ├── current-user.decorator.ts    # @CurrentUser() param decorator
│   │   └── public.decorator.ts          # @Public() — skips JWT guard
│   ├── guards/
│   │   ├── jwt-auth.guard.ts            # global — applied to all routes
│   │   └── kyc.guard.ts                 # @RequireKycTier(KycTier.TIER_1)
│   ├── interceptors/
│   │   └── idempotency.interceptor.ts   # X-Idempotency-Key enforcement
│   └── filters/
│       └── http-exception.filter.ts     # consistent error shape
│
└── modules/
    ├── auth/           JWT login, register, refresh, logout
    ├── users/          User entity, profile, CRUD
    ├── kyc/            Tiered verification, BullMQ processor
    ├── wallets/        Multi-currency wallets, ledger entries
    ├── transfers/      Internal transfers (wallet → wallet)
    ├── payments/       External deposits & withdrawals via providers
    ├── fees/           DB-driven fee rules engine
    ├── fraud/          Rule-based fraud detection + alert management
    ├── webhooks/       Flutterwave & Stripe callback handlers
    ├── exchange-rates/ Live rate fetching, currency conversion
    ├── reports/        Account statements, transaction analytics
    ├── notifications/  Email/SMS/push via BullMQ (pluggable)
    ├── audit/          Immutable append-only audit log (@Global)
    ├── admin/          Ops panel — users, rules, alerts, reports
    ├── queue/          BullMQ setup, cron jobs, scheduled tasks
    └── health/         /health, /health/live, /health/ready
```

---

## Getting Started

### Prerequisites

- Docker Desktop
- `jq` (for the test script): `brew install jq` / `apt install jq`

### Run with Docker

```bash
# Clone and enter the project
git clone https://github.com/yourname/transact-go.git
cd transact-go

# Copy environment file
cp .env.example .env

# Start all services (API + PostgreSQL + Redis + Bull Board)
cd docker
docker compose up --build

# With pgAdmin and monitoring stack
docker compose --profile tools --profile monitoring up --build
```

The API is ready when you see:
```
api-1 | Found 0 errors. Watching for file changes.
api-1 | [NestFactory] info: Starting Nest application...
api-1 | [App] info: TransactGo API running on http://localhost:3004/api/v1
```

### Service URLs

| Service | URL | Credentials |
|---|---|---|
| API | http://localhost:3004/api/v1 | — |
| Bull Board (queue UI) | http://localhost:3001 | — |
| pgAdmin | http://localhost:5050 | admin@transact_go.local / admin |
| Prometheus | http://localhost:9090 | — |
| Grafana | http://localhost:3002 | admin / admin |

### Run without Docker (local dev)

```bash
# Requires local PostgreSQL and Redis
npm install
cp .env.example .env    # edit DB_HOST=localhost, REDIS_HOST=localhost

npm run start:dev
```

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `NODE_ENV` | `development` \| `production` \| `test` | `development` |
| `PORT` | HTTP port | `3004` |
| `DB_HOST` | PostgreSQL host | `localhost` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_USERNAME` | DB username | `fintech` |
| `DB_PASSWORD` | DB password | — |
| `DB_NAME` | Database name | `fintech_db` |
| `DB_SYNC` | Auto-sync schema (dev only, never production) | `false` |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Redis password | — |
| `JWT_SECRET` | Access token signing key (min 32 chars) | — |
| `JWT_REFRESH_SECRET` | Refresh token signing key (min 32 chars) | — |
| `JWT_EXPIRES_IN` | Access token TTL | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token TTL | `7d` |
| `FLUTTERWAVE_SECRET_HASH` | Webhook HMAC verification key | — |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | — |

---

## API Reference

All endpoints are prefixed `/api/v1`. All protected endpoints require:
```
Authorization: Bearer <accessToken>
```

Mutating endpoints (`POST` transfers, deposits, withdrawals) also require:
```
X-Idempotency-Key: <uuid>   # generate client-side, reuse on retry
```

### Auth

```
POST   /auth/register          Create account
POST   /auth/login             Get access + refresh tokens
POST   /auth/refresh           Rotate refresh token (Bearer <refreshToken>)
POST   /auth/logout            Invalidate refresh token
```

### KYC

```
POST   /kyc/submit             Submit identity documents
GET    /kyc/submissions        List user's submissions and statuses
```

### Wallets

```
POST   /wallets                Create wallet (body: { currency: "NGN" })
GET    /wallets                List all user wallets
GET    /wallets/:id            Get wallet with current balance
GET    /wallets/:id/ledger     Paginated transaction history
```

### Transfers

```
POST   /transfers/internal     Wallet-to-wallet transfer (requires X-Idempotency-Key)
GET    /transfers              Paginated transfer history
GET    /transfers/:id          Get single transfer
```

**Transfer body:**
```json
{
  "sourceWalletId": "uuid",
  "destinationWalletId": "uuid",
  "amount": 1000000,
  "currency": "NGN",
  "narration": "Lunch money"
}
```

### Payments

```
POST   /payments/deposit       External deposit via provider (KYC Tier 1+)
POST   /payments/withdraw      External withdrawal via provider (KYC Tier 2+)
```

**Deposit body:**
```json
{
  "walletId": "uuid",
  "amount": 10000000,
  "currency": "NGN",
  "provider": "flutterwave"
}
```

### Exchange Rates

```
GET    /exchange-rates                     All current rates
GET    /exchange-rates/:from/:to           Single pair (e.g. /NGN/USD)
GET    /exchange-rates/convert?from=NGN&to=USD&amount=1000000
```

### Reports

```
GET    /reports/statement/:walletId?from=2024-01-01&to=2024-03-31
GET    /reports/summary?from=2024-01-01&to=2024-03-31
```

### Webhooks (public — verified by HMAC)

```
POST   /webhooks/flutterwave   Flutterwave payment callbacks
POST   /webhooks/stripe        Stripe payment callbacks
```

### Admin

```
GET    /admin/users                        List all users (paginated)
GET    /admin/users/:id                    User detail
PATCH  /admin/users/:id/suspend            Suspend user
PATCH  /admin/users/:id/activate           Activate / unlock user
PATCH  /admin/users/:id/kyc-tier           Override KYC tier
GET    /admin/wallets/:userId              User's wallets
PATCH  /admin/wallets/:id/freeze           Freeze wallet
GET    /admin/kyc/pending                  Pending KYC submissions
GET    /admin/fee-rules                    List all fee rules
POST   /admin/fee-rules                    Create fee rule
PATCH  /admin/fee-rules/:id               Update fee rule (cache auto-invalidated)
GET    /admin/fraud-rules                  List fraud rules
POST   /admin/fraud-rules                  Create fraud rule
PATCH  /admin/fraud-rules/:id             Update fraud rule
GET    /admin/fraud-alerts?reviewed=false  Unreviewed fraud alerts
PATCH  /admin/fraud-alerts/:id/review      Mark alert as reviewed
GET    /admin/reports/platform             Platform-wide analytics
GET    /admin/audit-logs                   Compliance audit trail
```

### Health

```
GET    /health         Full health check (DB + Redis latency)
GET    /health/live    Kubernetes liveness probe
GET    /health/ready   Kubernetes readiness probe
```

---

## Key Engineering Decisions

### Why ledger entries, not a balance column?

A wallet's balance is **derived** from its ledger, not stored independently. Every credit and debit creates an immutable `LedgerEntry` with a `balanceAfter` snapshot. This means:
- Full transaction auditability — you can reconstruct any historical state
- No balance corruption from bugs — the ledger is the source of truth
- Reconciliation is possible: `SUM(credits) - SUM(debits)` must equal `wallet.balance`

The `wallet.balance` column exists only as a performance cache. A nightly reconciliation job validates it.

### Why config-driven fees?

Fee rules are rows in the `fee_rules` table, not constants in code. A CBN policy change at midnight does not require a deployment. The ops team updates the rule via the Admin API; the cache invalidates within 5 minutes or immediately on update. This is how every production fintech works.

### Why idempotency at the API layer, not the DB layer?

A unique constraint on `(userId, amount, timestamp)` would prevent legitimate duplicate amounts. The correct approach is a client-supplied idempotency key that is explicitly tied to a single intent. The interceptor stores results in `idempotency_records` — not Redis alone — so they survive a Redis restart during a retry window.

### Why pessimistic locking for debits?

Optimistic locking (`@Version`) causes retries at the application layer, which is wrong for financial operations — a failed optimistic lock means the business logic already ran once. `SELECT FOR UPDATE` holds the row lock for the duration of the transaction, guaranteeing that a second concurrent debit waits and re-reads the updated balance.

### Why BullMQ for payment provider calls?

Payment providers have latencies of 500ms–5s and failure rates of 2–10%. Calling them synchronously inside an HTTP handler would:
- Tie up the request thread for seconds
- Expose the user to provider downtime
- Make retries impossible without the user waiting

BullMQ moves the provider call to a background worker with retry, backoff, and a dead-letter queue. The HTTP response returns in milliseconds.

---

## Running Tests

```bash
# Unit tests
npm run test

# Unit tests with coverage
npm run test:cov

# E2E tests (requires PostgreSQL + Redis running)
npm run test:e2e

# Run the manual test script (requires jq)
chmod +x scripts/test-api.sh
bash scripts/test-api.sh
```

The test script exercises every major flow in sequence:
health → register → KYC → wallets → deposit (with idempotency check) → internal transfer → ledger → reports → webhooks → admin → rate limiting → error cases.

---

## DevOps

### CI/CD Pipeline (GitHub Actions)

```
Push to develop ──▶ lint ──▶ unit tests ──▶ e2e tests ──▶ security audit
                                                               │
                                                               ▼
                                                    build & push Docker image
                                                               │
                                                               ▼
                                                    deploy to staging (auto)
                                                    smoke test staging

Push to main    ──▶ same pipeline ──▶ manual approval required
                                                               │
                                                               ▼
                                                    run DB migrations
                                                    deploy to production (rolling)
                                                    smoke test production
                                                    notify Slack
```

### Docker

```bash
# Development (hot reload)
docker compose -f docker/docker-compose.yml up --build

# Production image build
docker build -f docker/Dockerfile --target production -t transactgo:latest .

# Run production image locally
docker run -p 3004:3004 --env-file .env transactgo:latest
```

---

## Monitoring

Start the monitoring stack:
```bash
docker compose -f docker/docker-compose.yml --profile monitoring up
```

| Panel | URL |
|---|---|
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3002 (admin/admin) |
| Bull Board | http://localhost:3001 |

**Key metrics exposed at `/metrics`:**
- `transfers_total` — labelled by `status`, `currency`, `type`
- `transfer_duration_seconds` — P50/P95/P99 latency histogram
- `fraud_checks_triggered` — labelled by rule name
- BullMQ queue depth, active jobs, failed jobs

---

## Roadmap

- [ ] Real KYC provider integration (Smile Identity / Youverify)
- [ ] Cross-currency internal transfers (swap via exchange rate)
- [ ] Virtual account numbers (Flutterwave / Paystack)
- [ ] Recurring transfers / scheduled payments
- [ ] Merchant API (accept payments, payout to bank)
- [ ] 2FA (TOTP) for high-value transfers
- [ ] Admin role-based access control (RBAC)
- [ ] TypeORM migrations (replace `synchronize: true` in dev)
- [ ] OpenAPI / Swagger documentation
- [ ] Load testing suite (k6)