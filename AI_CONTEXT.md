# 🤖 AI System Prompt & Project Context (BorrowerPortal)

> **AI INSTRUCTION:** If you are a new AI assistant (e.g., Cursor, Codeium, GitHub Copilot) reading this repository for the first time, this file contains the absolute source of truth for the project's architecture, design philosophy, and current state. **Read this entirely before making any changes.**

---

## 1. Project Overview: MajesticEquity
**MajesticEquity** (SaaSMortgage / BorrowerPortal) is a production-ready, full-stack Node.js mortgage operations platform. It serves as both a public marketing site and a highly secure, real-time portal for borrowers, brokers, and admins to process mortgage applications.

### 🛠️ Core Tech Stack
*   **Backend:** Node.js (v18+), Express.js
*   **Database:** MongoDB via Mongoose (Hosted on MongoDB Atlas)
*   **Frontend:** Vanilla HTML5, Vanilla JavaScript (`portal.js` monolith), CSS3, Tailwind CSS
*   **Real-Time:** Socket.IO (WebSockets for chat and instant status updates)
*   **Security:** JWT, bcryptjs, Helmet, Express-Rate-Limit, CORS
*   **Infrastructure:** Render.com (`render.yaml` Blueprint), `npm run dev` (using `node --watch`)

### 🔌 Third-Party Integrations
*   **Plaid:** Bank syncing (auth, transactions, assets) for income/asset verification.
*   **Persona:** KYC Identity Verification via server-to-server validation.
*   **Stripe:** Processing appraisal fee payments via Webhooks.
*   **Experian (Sandbox):** Credit pull simulations.
*   **Twilio:** SMS dispatch for MFA and Registration Verification.
*   **SendGrid / Nodemailer:** Automated email notifications.

---

## 2. Repository Map & Key Files

The codebase does *not* use a frontend framework like React or Next.js. It relies on a monolith vanilla JS architecture.

*   `server.js` ➡️ **The Backend Monolith.** Contains all API routes, Express configuration, WebSocket setup, Multer file uploads, PDFKit generation, and Stripe webhooks.
*   `portal.js` ➡️ **The Frontend Monolith.** Contains all client-side logic, DOM manipulation, authentication state, and UI rendering.
*   `index.html` ➡️ The single app shell and DOM mount point.
*   `style.css` ➡️ Core design tokens and custom CSS that complement Tailwind.
*   `render.yaml` ➡️ Infrastructure-as-Code blueprint for Render.com automated deployment.
*   `models/` ➡️ Mongoose schemas (`User.js`, `Application.js`, `Document.js`, `PlaidItem.js`).
*   `utils/fnmExporter.js` ➡️ Generates industry-standard Fannie Mae 3.2 (.fnm) exports.

---

## 3. Strict AI Development Rules

### 🎨 Design System: "The Editorial Guardian"
You must adhere strictly to the custom premium UI guidelines:
1.  **No-Line Rule:** Do not use 1px solid borders. Create structure using background color shifts (e.g., `surface` to `surface-container-low`) or "Ghost Borders" (15% opacity).
2.  **Glassmorphism:** Use translucent cards with `backdrop-blur` and subtle ambient glows instead of hard drop shadows.
3.  **Typography:** Use high contrast between *Manrope* (Headlines/Display) and *Inter* (Body/UI).
4.  **Colors:** Deep navy/muted blues for base. **Champagne Gold (`#D3BD73`)** is the primary conversion/CTA accent.
5.  **Icons:** Google Material Symbols ONLY. No Phosphor or FontAwesome.

### 🔒 Security & Data Flow
1.  **Zero-Access Security:** All protected routes must pass through the `authenticateToken` JWT middleware.
2.  **Strict Step-by-Step Locking:** The frontend 1003 application wizard locks steps. Step 2 cannot unlock unless Step 1 is verified in the MongoDB record.
3.  **MFA Requirement:** The system uses a Hybrid Multi-Factor Authentication (Email + Twilio SMS / TOTP Authenticator).

### ⚡ Performance
1.  **Assets:** Use `.webp` exclusively for imagery. 
2.  **Monolith Edits:** When modifying UI, you must edit the DOM in `index.html` and attach the listeners/logic in `portal.js`. Do not attempt to introduce React components.

---

## 4. Current State & Where We Left Off (May 2026)

### Recent Accomplishments
1.  **Deployment:** The app is fully configured for automated CI/CD on **Render.com** using the `render.yaml` blueprint. The `plan: free` is explicitly set to bypass credit card requirements.
2.  **Database Connection:** The `.env` MongoDB connection string was corrected and tested. 
3.  **Persona Configuration:** The UI previously threw a "PERSONA TEMPLATE ID NOT CONFIGURED" error. This was fixed by adding `PERSONA_TEMPLATE_ID` to the `render.yaml` and instructing the user to add it to the Render dashboard.
4.  **Local Dev Workflow:** `package.json` was updated so `npm run dev` runs `node --watch server.js`, eliminating the need to manually restart the server.

### Environment Setup Instructions
If starting fresh on a new machine:
1. Run `npm install`
2. Ensure you have a `.env` file with the variables listed in `render.yaml` (including `MONGODB_URI`, `JWT_SECRET`, `PLAID_*`, `STRIPE_*`, `PERSONA_*`, `TWILIO_*`).
3. Run `npm run dev` to start the backend on port 3000.
4. *Note on Production:* We are moving away from local `.env` files for production. Production secrets are handled natively in the Render Dashboard. The domain `abinanj.com` is configured to map to Render via DNS CNAME records.

### Next Immediate Steps
*   Ensure all Persona server-to-server webhook validations are passing in production.
*   Verify Stripe webhook processing for the appraisal fee on the live Render URL.
*   Continue expanding the Admin dashboard features or 1003 mortgage wizard as requested.
