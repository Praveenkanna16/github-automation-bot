# AI Notes — GitAutomate Bot & Dashboard

This document details the development process, key architectural decisions, core bug-fixes, and future steps for the GitAutomate project.

## 1. AI Tools & Division of Labor

- **Primary AI Agent**: Antigravity, powered by the **Gemini 3.5 Flash (High)** model.
- **Division of Labor**:
  - **Antigravity**: Autonomously scaffolded the Next.js App, designed the CSS modules layout, wrote database schemas, built API routes (auth callback, repos list, cron, rules, events), implemented secure signature verification, structured JSON logging, and designed the rule matching and retry queue.
  - **User (Praveen)**: Managed the local shell environment (Vercel credentials integration, local repository linking), set up Neon Postgres database connection strings, configured GitHub OAuth credentials, and reviewed/approved the phase gates.

---

## 2. Key Architecture & Data-Model Decisions

- **Modular Webhook Processor (`src/lib/webhookProcessor.ts`)**:
  Separated rule matching, Octokit dispatches, and Slack notifications from the HTTP routes. This allows both the real-time webhook endpoint (`/api/webhooks/github`) and the cron retrier (`/api/cron/retry-failed`) to invoke identical logic, eliminating code discrepancies.
  
- **Durable Ingestion & Flow Validation**:
  Events are stored as `"received"` in the database before any downstream network tasks are fired. Downstream rules processing and notifications are wrapped inside safe `try-catch` structures. This guarantees no event is lost on API failure and avoids throwing unhandled `500` status codes back to GitHub.

- **Edge-Guard Security Policies**:
  Timing-safe buffer comparisons are applied to webhook signatures using `crypto.timingSafeEqual` to defend against timing attacks. Substring matches are made case-insensitive to ensure reliable matching.

---

## 3. Notable Bugs & Resolution Paths

- **The Hardest Bug: Turbopack Build-Time Credential Freezing**:
  - **Problem**: Next.js App Router API routes are evaluated at compile time to collect static page generation data. NextAuth v5 adapter (`PrismaAdapter(prisma)`) reads properties of the `prisma` client module during evaluation. Since we run `vercel build` locally, Next.js loaded our local `.env` database URL, causing the Prisma adapter to immediately instantiate the database client and freeze the local dev database URL inside the production server bundles. At runtime, the production serverless functions tried to connect using the frozen dev connection details and crashed.
  - **Wrong Turns**:
    1. We tried using dynamic bracket notation (`process.env["DATABASE_URL"]`), but Turbopack's static constant-folding optimizer evaluated and inlined it anyway.
    2. We tried using global variables (`global.process.env["DATABASE_URL"]`), but the module evaluation still triggered when metadata properties were checked by Next.js's bundler.
  - **Resolution**: We hardened `src/lib/db.ts` to implement a multi-layered compiler guard:
    1. **Metadata property filtering**: The Proxy `get` handler immediately returns the target if the property is a built-in symbol or standard framework metadata (like `then`, `constructor`, `toJSON`, or `$$typeof`).
    2. **Build-Phase bypass**: Checked if `process.env.NEXT_PHASE === "phase-production-build"`. If so, the Proxy returns target defaults without ever creating a connection pool. This guarantees the Neon serverless pool is strictly initialized dynamically at runtime using Vercel's decrypted environment secrets.

- **Prisma 7 Configuration Transition (`P1012` Error)**:
  - **Problem**: When running the Prisma database migration, the CLI threw a validation error (`P1012`). In Prisma 7, specifying `url` or `directUrl` in the `datasource` block of `schema.prisma` is deprecated and throws an error.
  - **Fix**: We modified `schema.prisma` to only define `provider = "postgresql"` in the datasource block, moved connection strings to `prisma.config.ts`, and updated it to use `DIRECT_URL` for CLI migration operations.
  - **Neon Driver Adapter API Change**: Prisma 7 updated the `@prisma/adapter-neon` constructor properties. The custom driver adapter now directly expects the database configurations object (e.g. `new PrismaNeon({ connectionString })`), rather than an already instantiated Neon connection `Pool` object. We updated `db.ts` to conform to this new API contract.

- **The Capitalization Crash (Phase 0)**:
  - **Problem**: Running `create-next-app` in the root workspace `/Users/praveenkannakr/Desktop/Githubauto` failed because npm package guidelines reject uppercase letters.
  - **Fix**: We scaffolded the project inside a temporary lowercase directory `github-auto-temp`, moved all files (including hidden dotfiles) back to the root workspace, and removed the temporary directory.

---

## 4. Completed Gemini AI Triage

We integrated Gemini 1.5 Flash via a structured JSON POST query (leveraging the developer API with the `GEMINI_API_KEY` parameter).
- **Function**: Automatically triages incoming GitHub issue and pull request events.
- **Payloads**: Analyzes titles and descriptions to generate:
  - A suggested label classification (e.g. `bug`, `docs`, `feature`, `enhancement`, `question`).
  - A concise one-sentence description summary under 100 characters.
- **Delivery**: Insights are stored in the database, displayed in the dashboard's "AI Insights" column, and appended to Slack alerts.

---

## 5. Production Hardening Pass (Completed)

- **Clean UI & CSS Redesign**: Shifted from dark-theme radial gradients to a crisp, light, Stripe-style dashboard using Inter typography, Lucide React icons, and a cohesive set of styling primitives.
- **Repository Management**: Added Sync and Disconnect actions, including automatic cleanup of webhooks on GitHub using Octokit to prevent stale listeners.
- **Rule Customizations**: Added Zod validation schemas, enabled toggles, and event-type parameters (issues, PRs, pushes).
- **Observability Stats API**: Built `/api/stats` to aggregate total events, failure counts, success rates, retry queue depth, and average processing milliseconds.
- **Security & Headers**: Applied security headers (X-Frame-Options, Referrer-Policy) in next.config.ts and rate limiting in the webhook route.
- **Deduplication**: Webhook processor now prevents duplicate label or comment actions on a single delivery trigger.
- **Structured Block Kit**: Updated Slack integrations to use rich Block Kit structure.

