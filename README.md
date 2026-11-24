# SendsClub (`sendsclub.vip`)

A private nightlife social & event platform built with React, TypeScript, Tailwind CSS, Express, and SQLite.

## Features

- **Home Feed**: Curated party flyers, event dates, locations, venue notes, multi-image galleries, and pinned dispatches.
- **Events & Social**: Like posts, toggle **I'M GOING** or **Interested**, view attendee previews, write threaded comments and replies, edit/delete your own comments, and report inappropriate comments.
- **User Accounts**: Unique `@username`, display name, bio, profile picture upload, activity tracking, and self-service password reset using a cryptographic Account Recovery Key or admin-issued one-time reset code.
- **Admin Dashboard**: Protected server-side administrator routes for publishing, editing, pinning, and deleting posts, uploading multiple flyer images, viewing engagement analytics, and moderating reported comments.

## Secure Administrator Setup

You can configure the administrator account in **either** of two ways:

### Option A — Environment Secrets (Recommended for Replit / Production)
Set the following environment secrets in Replit (**Tools → Secrets**) or your `.env` file:
- `ADMIN_EMAIL` (e.g. `admin@sendsclub.vip`)
- `ADMIN_USERNAME` (e.g. `sendsclub`)
- `ADMIN_PASSWORD` (strong password, minimum 8 characters)
- `SESSION_SECRET` (random 32+ character string for signing session tokens)

When `ADMIN_PASSWORD` is configured, the server hashes it using `scrypt` on startup and automatically provisions/syncs the administrator account without storing plain-text passwords.

### Option B — One-Time First-Run Claim (Zero-Config Setup)
If `ADMIN_PASSWORD` is left unset, open the app, navigate to **Profile** (or click **Claim Admin Access**), and complete the one-time **Initialize Administrator Account** form. Once claimed, this endpoint permanently locks itself so no subsequent user can claim admin privileges.

## Deployment on Replit

1. Import this repository into Replit.
2. Add `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` in Replit **Secrets**.
3. Run `npm install && npm run build`.
4. Start the production server with `npm run start` (configured automatically in `.replit`).
5. Persistent SQLite data (`data/sendsclub.db`) and uploaded images (`data/uploads/`) are stored in the `data/` directory.
