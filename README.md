# GitAutomate Bot & Dashboard

A secure, production-grade, event-driven Next.js 16 (App Router) automation dashboard and webhook ingestion bot. It allows users to authenticate with GitHub, connect repositories, configure rule-based triggers, automate GitHub actions (labels, comments), send structured Block Kit alerts to Slack, and view real-time logs with integrated Gemini AI triage.

---

## 📐 Architecture Overview

```mermaid
graph TD
    User[GitHub User/Graders] -->|GitHub OAuth| Auth[Auth.js v5 Middleware]
    User -->|Dashboard UI| Dashboard[Next.js App Router Frontend]
    Dashboard -->|GET/POST/PUT/DELETE| API[Next.js API Routes]
    
    GitHub[GitHub Repo Webhooks] -->|POST Payload + HMAC| WebhookRoute["/api/webhooks/github"]
    WebhookRoute -->|1. Timing-safe Signature Verify| WebhookRoute
    WebhookRoute -->|2. Idempotency Check| DB[(Neon Postgres DB)]
    WebhookRoute -->|3. Durable Ingestion| DB
    WebhookRoute -->|4. Async Process Trigger| Processor[webhookProcessor.ts]
    
    Processor -->|Optional 8s Timeout| Gemini[Google Gemini AI Studio API]
    Processor -->|Fetch Enabled Rules| DB
    Processor -->|Match Rules Engine| Processor
    Processor -->|Octokit Label/Comment| GitHubAPI[GitHub REST API]
    Processor -->|Block Kit JSON Payload| Slack[Slack Webhook URL]
    
    Cron["/api/cron/retry-failed"] -->|Bearer auth| Processor
```

---

## 🗄️ Database Schema & ERD

The Postgres database is structured as follows (managed via Prisma):

```
+-------------------------------------------------------+
|                         User                          |
+-------------------------------------------------------+
| id (cuid, PK)                                         |
| name, email (unique), emailVerified, image            |
| aiEnabled (Boolean, default: true)                    |
| createdAt, updatedAt                                  |
+-------------------------------------------------------+
                           | 1
                           |
                           | 0..*
+-------------------------------------------------------+
|                     ConnectedRepo                     |
+-------------------------------------------------------+
| id (cuid, PK)                                         |
| userId (FK -> User.id)                                |
| repoFullName (String)                                 |
| accessToken (String)                                  |
| webhookId (String, nullable)                          |
| createdAt, updatedAt                                  |
| @@unique([userId, repoFullName])                      |
+-------------------------------------------------------+
       | 1                                 | 1
       |                                   |
       | 0..*                              | 0..*
+------+----------------+           +------+------------+
|         Rule          |           |   WebhookEvent    |
+-----------------------+           +-------------------+
| id (cuid, PK)         |           | id (cuid, PK)     |
| userId (FK)           |           | repoId (FK)       |
| repoId (FK)           |           | deliveryId (UQ)   |
| enabled (Boolean)     |           | eventType         |
| matchField (Enum)     |           | payload (Json)    |
| matchValue            |           | status (Enum)     |
| eventType (Enum)      |           | error (String)    |
| action (Enum)         |           | retryCount (Int)  |
| label                 |           | nextRetryAt       |
| comment               |           | processingMs (Int)|
| slackMessageTemplate  |           | aiSummary         |
| createdAt, updatedAt  |           | aiLabel           |
|                       |           | aiPriority        |
|                       |           | aiReasoning       |
|                       |           | aiConfidence      |
|                       |           | createdAt,        |
|                       |           | updatedAt         |
+-----------------------+           +-------------------+
```

---

## 🏁 Grader & Local Setup Guide

### 1. Environment variables
Create a `.env` file at the root of the workspace (refer to `.env.example`):
```env
# Neon Serverless PostgreSQL
DATABASE_URL="postgresql://user:password@neon-db-host/dbname?sslmode=require"
DIRECT_URL="postgresql://user:password@neon-db-host/dbname?sslmode=require"

# Auth.js (NextAuth v5)
AUTH_SECRET="your_nextauth_secret_minimum_32_characters"

# GitHub OAuth App credentials
AUTH_GITHUB_ID="your_github_oauth_client_id"
AUTH_GITHUB_SECRET="your_github_oauth_client_secret"

# Webhooks & Integrations
GITHUB_WEBHOOK_SECRET="your_custom_webhook_secret_key"
SLACK_WEBHOOK_URL="your_slack_incoming_webhook_url"
CRON_SECRET="your_cron_secret_for_retry_protection"
NEXTAUTH_URL="http://localhost:3000"
GEMINI_API_KEY="your_google_gemini_api_key_here"
```

### 2. Quickstart local run
```bash
# 1. Install packages
npm install

# 2. Push database schema without losing data
npx prisma db push

# 3. Spin up development server
npm run dev
```

---

## 🧪 Webhook Testing & Replays

We provide a lightweight script to simulate webhook deliveries without waiting for GitHub:

```bash
# Simulates a mock issue webhook payload to local server
npx ts-node src/scripts/simulate-webhook.ts
```

For manual testing, perform standard GitHub actions (creating issues or pull requests) on your connected repository, and watch the status in the **Event Log** tab.

---

## 🛠️ Troubleshooting

- **Build freezing:** Hardened compiler guard proxy in `src/lib/db.ts` automatically detects the static pre-rendering phase `phase-production-build` and bypasses connecting to Neon Postgres.
- **Webhook signature validation failing (401):** Ensure `GITHUB_WEBHOOK_SECRET` env var matches the secret configured in the GitHub repository Webhook settings.
- **Hobby plan cron schedule limits:** Vercel Hobby accounts restrict cron frequencies to once per day (`0 0 * * *`). The `vercel.json` is set to daily schedule. To run retries on demand, hit `/api/cron/retry-failed` with the `Authorization: Bearer <CRON_SECRET>` header.
