# AskJuthis Borrower Portal (SaaS) - AI Context Document

## Project Overview
This repository (`BorrowerPortal` / `SaaSMortgage`) is the secure, private software application designed for mortgage applicants and brokers. It was successfully extracted from the public brochure site to operate autonomously.

## Tech Stack & Architecture
- **Backend:** Node.js, Express.js
- **Database:** MongoDB (Mongoose ORM)
- **Frontend Base:** Plain HTML5, Vanilla JavaScript (`portal.js`), Tailwind CSS.
- **Real-Time:** Socket.IO for live chat messaging and instant dashboard application updates.
- **Authentication:** JWT (JSON Web Tokens) with Hybrid Multi-Factor Authentication (Email + Twilio SMS / TOTP Authenticator).

## Key Integrations & APIs
1. **Plaid:** Bank account linking, `sync_income`, and `sync_assets` routing.
2. **Persona:** Identity verification (Production server-to-server validation via webhook/API).
3. **Experian:** Sandbox credit pull integration.
4. **Stripe:** Appraisal fee collection with automated pipeline staging.
5. **Twilio:** SMS dispatch for MFA and Registration Verification.
6. **LOS Export:** Generates industry-standard Fannie Mae 3.2 MISMO formats.

## Critical Rules & Guidelines
1. **Zero-Access Security:** 
   - All protected routes must pass through the JWT verification middleware.
   - The UI must enforce a strict step-by-step locking mechanism (Step 2 unlocks only when Step 1 is verified in the MongoDB record).
2. **Material 3 Design:** 
   - Global UI must adhere to the editorial glass-card aesthetic.
   - Always use Google Material Symbols. Do *not* use Phosphor icons.
3. **Frontend Refactoring:** 
   - Operations are localized in `portal/index.html` and the massive `portal.js` monolith. 
   - **Performance:** Keep image assets strictly optimized as `.webp`. Avoid CSS `backdrop-filter: blur()` to prevent scroll lag.

## Developer Note
When modifying the 1003 wizard, updating Document uploads, tweaking the Admin routing, or editing Node backend models, you are in the correct repository. Ensure all environment variables `.env` (Stripe, Plaid, Mongo URI, Twilio) are securely configured before runtime.
