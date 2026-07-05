# AI Notes — GitAutomate Bot & Dashboard

This document details the development process, architectural decisions, core bug-fixes, and future steps for the GitAutomate project.

## 1. AI Tools & Division of Labor

- **Primary AI Agent**: Antigravity, powered by the **Gemini 3.5 Flash (High)** model.
- **Division of Labor**:
  - **Antigravity**: Autonomously scaffolded the Next.js App, designed the CSS modules layout, wrote database schemas, built API routes (auth callback, repos list, cron, rules, events), implemented secure signature verification and retry/backoff processing.
  - **User (Praveen)**: Ran local Vercel linking command to authenticate, provisioned Neon Postgres database connection strings, registered the GitHub OAuth application settings, and managed phase-gate code approvals.

---

## 2. Key Architecture & Data-Model Decisions

- **Modular Webhook Processor (`src/lib/webhookProcessor.ts`)**:
  Rather than processing rules directly in the API handler, the ingestion route writes the event to the DB and delegates processing to a standalone `processWebhookEvent` module. This allows both the real-time endpoint (`/api/webhooks/github`) and the background scheduler (`/api/cron/retry-failed`) to execute identical business logic, preventing code mismatch.
  
- **Durable Ingestion & Status-Flow Verification**:
  Events are saved with a `"received"` state before any network calls to Octokit or Slack are initiated. Downstream operations are wrapped inside safe `try-catch` blocks. If an API call fails, the database log changes to `"failed"` with details, returning a clean `200 OK` to GitHub. This prevents unhandled 500 crashes and guarantees data preservation.

- **Unified Prisma Schema Design**:
  Combined NextAuth v5 user accounts tables directly with custom `ConnectedRepo`, `Rule`, and `WebhookEvent` models. Using cascading deletes (`onDelete: Cascade`), we ensure that if a user deletes their account or disconnects, all associated rules, webhooks, and raw event histories are cleared in a single operation.

---

## 3. Notable Bugs & Resolution Paths

- **The Capitalization Crash (Phase 0)**:
  - **Problem**: Running `create-next-app` in the root workspace `/Users/praveenkannakr/Desktop/Githubauto` failed immediately because npm package naming guidelines reject uppercase letters.
  - **Fix**: We scaffolded the project inside a temporary lowercase directory `github-auto-temp`, moved all files (including hidden dotfiles) back to the root workspace, and removed the temporary directory.

- **Prisma 7 Configuration Transition (`P1012` Error)**:
  - **Problem**: When running the Prisma database migration, the CLI threw a validation error (`P1012`). In Prisma 7, specifying `url` or `directUrl` in the `datasource` block of `schema.prisma` is deprecated and throws an error.
  - **Fix**: We modified `schema.prisma` to only define `provider = "postgresql"` in the datasource block, moved connection strings to `prisma.config.ts`, and updated it to use `DIRECT_URL` for CLI migration operations.

---

## 4. What's Left / Next Steps

- **Webhook Cleanup**: Implement automatic delete commands on GitHub when a user disconnects a repository via the dashboard, removing stale webhook listeners.
- **AI Triage Integration (Stretch Goal)**: Integrate Google Gemini via the AI Studio API to perform issue categorization and summary suggestions, embedding these summaries directly into the Slack alerting payload.
- **Multi-Repo/Multi-User Robustness**: Make `deliveryId` unique per repository (`@@unique([repoId, deliveryId])`) to allow multiple users to connect and configure actions for the same repository.
