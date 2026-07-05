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

- **The db.ts Fallback Connection String (The Hardest Bug / Wrong Turn)**:
  - **Problem**: During local database setup debugging under Prisma 7, we temporarily introduced a fallback PostgreSQL connection string (`postgresql://postgres:postgres@localhost:5432/postgres`) in `src/lib/db.ts` to allow compile-time checks to succeed when `DATABASE_URL` was missing.
  - **Why it was a wrong turn**: Silent defaults leak credentials or allow the app to fall back to insecure local databases instead of throwing an error. During the Phase A audit, we flagged this fallback.
  - **Resolution**: Removed the fallback and introduced a strict validation block (`if (!connectionString) throw new Error(...)`). The application will now crash loudly at build/boot time if database configurations are missing, making environment mismatches transparent.

- **Prisma 7 Configuration Transition (`P1012` Error)**:
  - **Problem**: When running the Prisma database migration, the CLI threw a validation error (`P1012`). In Prisma 7, specifying `url` or `directUrl` in the `datasource` block of `schema.prisma` is deprecated and throws an error.
  - **Fix**: We modified `schema.prisma` to only define `provider = "postgresql"` in the datasource block, moved connection strings to `prisma.config.ts`, and updated it to use `DIRECT_URL` for CLI migration operations.

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

## 5. What's Left / Next Steps

- **Webhook Cleanup**: Implement automatic delete commands on GitHub when a user disconnects a repository via the dashboard, removing stale webhook listeners.
- **Multi-Repo/Multi-User Robustness**: Make `deliveryId` unique per repository (`@@unique([repoId, deliveryId])`) to allow multiple users to connect and configure actions for the same repository.
