# BorrowerPortal Project Overview

## What This Project Is

BorrowerPortal is a mortgage application and broker portal for the MajesticEquity brand. It combines:

- A public marketing site
- Borrower registration and login
- Multi-factor and phone/email verification
- Mortgage application intake
- Document upload and file management
- Plaid-based income and asset syncing
- Identity and credit verification workflows
- Real-time borrower/admin messaging
- Admin review, status updates, conditions, and exports
- Payment collection through Stripe

The codebase is a full-stack Node.js and MongoDB application with a custom front-end rendered through `index.html`, `style.css`, and `portal.js`.

## Main Stack

- Runtime: Node.js 18+
- Backend: Express
- Database: MongoDB with Mongoose
- Auth: JWT, bcryptjs
- Security: helmet, express-rate-limit, cors
- Files: multer, pdfkit
- Messaging: socket.io, nodemailer, twilio
- Integrations: Plaid, Stripe, Persona, Experian

## Core Files

- `server.js` - main backend server, API routes, websocket setup, auth, admin actions, uploads, payments, and verification logic
- `portal.js` - front-end application logic for the landing page, auth, dashboards, and portal interactions
- `index.html` - app shell and DOM mount point
- `style.css` - styling for the public site and portal
- `config.js` - brand and agent content used by the public-facing site
- `models/` - MongoDB schemas
- `utils/fnmExporter.js` - Fannie Mae 3.2 export helper
- `Frontend/DESIGN.md` - design system notes for the UI direction
- `Frontend/code.html` - static front-end prototype or archived implementation

## User Roles

The app supports three roles:

- `borrower` - default customer account
- `admin` - broker/admin dashboard access
- `agent` - professional partner dashboard

## Main User Journeys

### Borrower Flow

1. Visit the public site
2. Register or log in
3. Verify email and phone
4. Complete identity verification
5. Sync financial data through Plaid
6. Upload documents
7. Submit a mortgage application
8. Track status and message the broker team
9. Pay the appraisal fee when prompted

### Admin Flow

1. Log in as an admin
2. Review submitted applications
3. Update application status
4. Add broker notes
5. Create or update conditions
6. Export the application to Fannie Mae `.fnm`
7. Monitor users, stats, and documents

### Agent Flow

1. Register as an agent with professional credentials
2. Verify the account
3. Access the expert portal

## Backend Architecture

`server.js` is the center of the application. It:

- Connects to MongoDB
- Configures Express middleware
- Starts Socket.io alongside the HTTP server
- Serves the static front-end
- Handles uploads under `uploads/`
- Sends email and SMS notifications when providers are configured
- Generates pre-approval PDFs after approval
- Creates Stripe checkout sessions and processes webhook events
- Manages application, document, verification, messaging, and admin endpoints

## Data Models

### `User`

Stores account and verification data, including:

- Email, password, phone, name, role
- Agent credentials such as NMLS ID, brokerage, and license state
- Identity data for credit pulls
- MFA state
- Registration verification codes

### `Application`

Stores the mortgage file itself, including:

- Borrower identity and contact data
- Loan type, amount, and property details
- Employment history
- Residential history
- REO and declaration data
- HMDA demographic fields
- Conditions and status history
- Documents, messages, notes, and payment status

### `Document`

Tracks uploaded files by user, type, size, and category.

### `PlaidItem`

Stores Plaid access tokens and institution metadata per user.

## Notable API Groups

### Authentication

- `POST /api/auth/register`
- `POST /api/auth/register-agent`
- `POST /api/auth/login`
- `POST /api/auth/verify-registration`
- `POST /api/auth/resend-verification`
- MFA routes under `/api/auth/mfa/*`

### Verification and Data Sync

- `POST /api/create_link_token`
- `POST /api/exchange_public_token`
- `POST /api/create_inquiry`
- `POST /api/persona_complete`
- `POST /api/credit_pull`
- `POST /api/applications/sync_income`
- `POST /api/applications/sync_assets`

### Documents and Applications

- `POST /api/documents/upload`
- `GET /api/documents`
- `DELETE /api/documents/:id`
- `POST /api/applications/submit`
- `GET /api/applications/mine`
- `POST /api/applications/sample`
- `DELETE /api/applications/reset`

### Messaging

- `POST /api/applications/:id/messages`
- `GET /api/applications/:id/messages`

### Admin

- `GET /api/admin/applications`
- `PATCH /api/admin/applications/:id`
- `GET /api/admin/users`
- `POST /api/admin/applications/:id/conditions`
- `PATCH /api/admin/applications/:id/conditions/:conditionId`
- `GET /api/admin/stats`
- `GET /api/admin/applications/:id/export`
- `PATCH /api/admin/applications/:id/notes`
- `POST /api/admin/create`

### Payments

- `POST /api/payments/create-checkout-session`
- `POST /api/payments/webhook`

## Environment Variables

The app expects several optional or required environment variables:

- `MONGODB_URI`
- `JWT_SECRET`
- `PORT`
- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_ENV`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `EMAIL_FROM`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `ADMIN_CREATE_KEY`

## Repository Notes

- The repository name in `package.json` is `MortgageSite`, while the working app branding is MajesticEquity.
- The project includes both a public marketing experience and a secured portal experience in one codebase.
- `uploads/` is used for generated PDFs and uploaded borrower files.
- `Procfile` suggests deployment support for a hosted Node process.

## Quick Summary

This is a polished mortgage-portal system with a public website, borrower intake, broker/admin workflow, financial integrations, document handling, real-time messaging, and payment processing. The backend is feature-rich and the front-end is heavily customized for a premium branded experience.
