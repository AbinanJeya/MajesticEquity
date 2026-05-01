# BorrowerPortal Project Overview

## What This Project Is

BorrowerPortal is a professional mortgage application and broker portal for the MajesticEquity brand. It is a full-stack system that combines:

- **Public Marketing Site:** Branded landing page with agent/broker content.
- **Secure Borrower Portal:** Registration, login, and multi-factor authentication (MFA).
- **Identity & Credit Verification:** persona-based ID verification and Experian-based credit pull workflows.
- **Financial Integration:** Plaid-based syncing for income and assets.
- **Application Intake:** Comprehensive 1003 mortgage application wizard.
- **Document Management:** Secure file uploads, management, and categorization.
- **Real-Time Messaging:** Socket.io-powered chat between borrowers and administrators.
- **Admin & Broker Dashboard:** Tools for reviewing applications, managing conditions, updating status, and generating Fannie Mae 3.2 (FNM) exports.
- **Payment Processing:** Integrated Stripe checkout for appraisal fee collection.

The codebase is a full-stack Node.js and MongoDB application with a custom, high-end "Editorial Guardian" design system.

## Main Stack

- **Runtime:** Node.js 18+ (using `node --watch` for local development)
- **Backend:** Express.js
- **Database:** MongoDB with Mongoose (hosted on MongoDB Atlas)
- **Real-Time:** Socket.IO
- **Security:** JWT, bcryptjs, helmet, express-rate-limit, CORS
- **Files:** multer (uploads), pdfkit (PDF generation)
- **Integrations:** Plaid, Stripe, Persona, Experian, Twilio (SMS), SendGrid (SMTP)

## Core Files

- `server.js` — Main backend server, API routes, websocket setup, and core business logic.
- `portal.js` — Massive monolith frontend logic for auth, dashboards, and all interactive features.
- `index.html` — App shell and main DOM mount point for the vanilla JS application.
- `style.css` — Core styling following the premium editorial design system.
- `render.yaml` — Blueprint file for automated deployment on Render.com.
- `Procfile` — Web service configuration for hosting platforms.
- `config.js` — Agent-specific branding and content configuration.
- `models/` — MongoDB schemas for Users, Applications, Documents, and Plaid Items.
- `utils/fnmExporter.js` — Fannie Mae 3.2 export utility.
- `PROJECT_OVERVIEW.md` — This architectural summary.
- `ai_rules.md` — AI context and critical development guidelines.

## Infrastructure & Deployment

### Production (Render.com)
The project is configured for automated deployment via **Render.com**.
- **Blueprint:** Uses `render.yaml` to configure the environment, build commands, and service settings.
- **Environment Variables:** Managed securely in the Render Dashboard (not committed to Git).
- **Scaling:** Uses a Web Service with persistent connection support for WebSockets.
- **CI/CD:** Automatically redeploys whenever changes are pushed to the `main` branch.

### Local Development
- **Start Command:** `npm run dev` (uses built-in `node --watch` to automatically restart on file changes).
- **Environment:** Managed through a local `.env` file (ignored by Git).
- **Port:** Defaults to `3000`.

## User Roles

1. **Borrower:** Standard customer account for completing applications and tracking status.
2. **Admin:** Broker/Admin access to manage the full pipeline, review documents, and issue pre-approvals.
3. **Agent:** Professional partner dashboard for referral tracking and expert collaboration.

## Main User Journeys

### Borrower Flow
1. **Onboarding:** Register, verify email/phone (MFA), and complete identity verification via Persona.
2. **Financial Sync:** Link bank accounts via Plaid to verify income and assets.
3. **Application:** Complete the mortgage intake wizard.
4. **Compliance:** Upload required documents and pay the appraisal fee via Stripe.
5. **Closing:** Track real-time status updates and message the broker team.

### Admin Flow
1. **Management:** Monitor all incoming applications and user stats.
2. **Review:** Inspect synced financial data and uploaded files.
3. **Action:** Issue conditions, add broker notes, and update statuses.
4. **Export:** Generate Fannie Mae 3.2 `.fnm` files for LOS import.
5. **Approval:** Generate and send official Pre-Approval PDFs.

## Repository Architecture

- `uploads/` — Local directory for generated PDFs and temporary file storage.
- `assets/` — Optimized `.webp` assets for the premium UI.
- `Frontend/` — Design notes and static prototypes.

## Design Philosophy: "The Editorial Guardian"
The UI rejects standard fintech "utility" looks in favor of a luxury magazine feel:
- **Glassmorphism:** Translucent surfaces with depth.
- **Tonal Layering:** Using color shifts instead of hard 1px borders.
- **Typography:** Architectural contrast using Manrope and Inter.
- **Accents:** Champagne Gold (`#D3BD73`) for primary interaction points.

---
*Updated: May 2026*
