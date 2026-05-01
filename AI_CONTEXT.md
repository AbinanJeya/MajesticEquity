# 🤖 AI System Prompt & Project Context (BorrowerPortal)

> **AI INSTRUCTION:** If you are a new AI assistant reading this repository for the first time, this file is the absolute source of truth. **Read this entirely before making any changes.**

---

## 1. Project Overview: MajesticEquity
**MajesticEquity** is a production-grade, full-stack Node.js mortgage operations platform. It serves as both a public marketing site and a highly secure, real-time portal for borrowers, brokers, and agents.

### 🛠️ Core Tech Stack
*   **Backend:** Node.js (v18+), Express.js — modular architecture (see §2)
*   **Database:** MongoDB via Mongoose (Atlas), with connection pooling & explicit indexes
*   **Frontend:** Vanilla JS (`portal.js` monolith), Tailwind CSS, Material Symbols
*   **Real-Time:** Socket.IO (WebSockets for chat and live status updates)
*   **Security:** JWT, bcryptjs, Helmet, express-rate-limit, Joi validation, XSS sanitization
*   **Logging:** Winston (structured JSON in prod), Sentry (error tracking)
*   **Uploads:** AWS S3 (production) with pre-signed URLs; local disk fallback (dev)
*   **Infrastructure:** Render.com (`render.yaml` Blueprint)

### 🔌 Third-Party Integrations
*   **Plaid:** Bank syncing (auth, transactions, assets)
*   **Persona:** KYC Identity Verification (server-to-server) — 3-layer agent verification
*   **Stripe:** Appraisal fee payments via Webhooks
*   **Experian (Sandbox):** Credit pull simulations
*   **Twilio:** SMS for MFA and registration verification
*   **Nodemailer:** Email notifications

---

## 2. Repository Map & Architecture

### Modular Backend (Post-Refactor May 2026)
```
server.js              → Main Express entry point (routes only, no business logic definitions)
├── services/
│   ├── logger.js      → Winston + Sentry (structured logging, error capture)
│   ├── database.js    → Mongoose connection pooling + index management
│   ├── envValidator.js→ Startup validation (fails fast if secrets are missing in prod)
│   ├── fileUpload.js  → AWS S3 / local disk file upload with pre-signed URLs
│   └── notifications.js → Email (Nodemailer) + SMS (Twilio)
├── middlewares/
│   ├── auth.js        → authenticateToken, requireAdmin, requireApprovedAgent, errorHandler
│   └── validation.js  → Joi schemas + validate() middleware factory
├── models/
│   ├── User.js, Application.js, Document.js
│   ├── AgentProfile.js, AgentInvite.js, PlaidItem.js
├── utils/
│   ├── agentVerification.js → FSRA registry scraper
│   ├── agentNetwork.js      → Invite & access control helpers
│   └── fnmExporter.js       → Fannie Mae 3.2 export
├── test/
│   └── validation.test.js   → Jest unit tests for Joi schemas
```

### Frontend
*   `portal.js` → ~3,500-line monolith (planned React migration)
*   `index.html` → Single app shell
*   `style.css` → Design tokens + custom CSS
*   `config.js` → Public-facing site config

---

## 3. Agent 3-Layer Identity Verification
1. **Layer 1 — Persona:** Gov ID scan + live selfie liveness check
2. **Layer 2 — FSRA Registry:** Automated scrape of Ontario FSRA/FSCO registry
3. **Layer 3 — Admin Review:** Manual admin approval via `PATCH /api/admin/agents/:profileId`

Flow: `pending_identity` → `pending_registry` → `pending_admin` → `approved`

---

## 4. Strict AI Development Rules

### 🎨 Design: "The Editorial Guardian"
1.  No 1px borders — use background shifts or ghost borders (15% opacity)
2.  Glassmorphism with `backdrop-blur` and ambient glows
3.  Typography: Manrope (headings) + Inter (body)
4.  Champagne Gold (`#D3BD73`) for CTAs
5.  Google Material Symbols ONLY

### 🔒 Security
1.  All protected routes go through `authenticateToken` JWT middleware
2.  All inputs validated via Joi schemas in `middlewares/validation.js`
3.  MFA: Email OTP or TOTP (Google Authenticator)
4.  Persona verification is server-to-server (never trust client status)

---

## 5. Environment Variables
**Required in production** (server refuses to start without these):
`MONGODB_URI`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PERSONA_API_KEY`, `PERSONA_TEMPLATE_ID`

**Optional but recommended:**
`PLAID_*`, `TWILIO_*`, `SMTP_*`, `SENTRY_DSN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, `AWS_REGION`
