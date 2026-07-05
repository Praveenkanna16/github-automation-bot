# GitAutomate Bot & Dashboard

A secure, event-driven full-stack Next.js 16 (App Router) automation web app and bot. It connects to users' GitHub repositories, registers webhooks, matches incoming events (Issues, Pull Requests, Pushes) against configurable automation rules, adds GitHub labels/comments, and posts Slack notification webhooks.

## Key Features

1. **GitHub OAuth Authentication**: Managed securely via **Auth.js v5 (NextAuth)** with requested `repo` and `admin:repo_hook` scopes.
2. **Secure Webhook Ingestion (`/api/webhooks/github`)**:
   - **Signature Verification**: Verifies HMAC-SHA256 signatures using a timing-safe buffer comparison (`crypto.timingSafeEqual`) to defend against timing attacks and forgery.
   - **Idempotency**: Prevents double-processing of duplicate deliveries via unique `X-GitHub-Delivery` ID logging.
   - **Durability**: Webhook payloads are persisted immediately in a `"received"` state before downstream action execution (preventing data loss if GitHub writeback or Slack fails).
3. **Fault-Tolerant Retries**: A cron route (`/api/cron/retry-failed`) executes periodically to retry failed executions using exponential backoff.
4. **Interactive Dashboard**: A glassmorphic dark-theme UI to connect repositories, edit automation match rules, and inspect live webhook logs with their execution states.

---

## Technical Stack

- **Framework**: Next.js 16 (App Router, TypeScript)
- **Database**: Postgres on Neon, accessed via Prisma ORM
- **Authentication**: Auth.js (NextAuth) v5 with GitHub Provider
- **GitHub API**: Octokit
- **Styling**: Vanilla CSS (CSS Modules)
- **Deployment**: Vercel & Vercel Cron

---

## Environment Configuration

Create a `.env` file at the root of the workspace (refer to `.env.example`):

```env
# Postgres connection strings (Neon)
DATABASE_URL="postgresql://user:password@neon-db-host/dbname?sslmode=require"
DIRECT_URL="postgresql://user:password@neon-db-host/dbname?sslmode=require"

# NextAuth configuration
AUTH_SECRET="your_nextauth_secret_minimum_32_characters"
AUTH_GITHUB_ID="your_github_oauth_client_id"
AUTH_GITHUB_SECRET="your_github_oauth_client_secret"

# Webhooks & Cron
GITHUB_WEBHOOK_SECRET="your_custom_webhook_secret_key"
SLACK_WEBHOOK_URL="your_slack_incoming_webhook_url"
CRON_SECRET="your_cron_secret_for_retry_protection"
```

---

## Local Setup & Run

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Database Migrations**:
   Run the Prisma migration to synchronize your Neon database schema:
   ```bash
   npx prisma migrate dev --name init
   ```

3. **Start Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to access the landing redirect.

---

## Deployment to Vercel

1. Link the local project to Vercel:
   ```bash
   npx vercel link
   ```
2. Upload the environment variables through Vercel's Dashboard (Settings > Environment Variables) or CLI:
   ```bash
   npx vercel env add DATABASE_URL
   npx vercel env add DIRECT_URL
   npx vercel env add AUTH_SECRET
   npx vercel env add AUTH_GITHUB_ID
   npx vercel env add AUTH_GITHUB_SECRET
   npx vercel env add GITHUB_WEBHOOK_SECRET
   npx vercel env add SLACK_WEBHOOK_URL
   npx vercel env add CRON_SECRET
   ```
3. Deploy the application:
   ```bash
   npx vercel deploy --prod
   ```

4. Configure Vercel Cron in `vercel.json` to trigger the retry endpoint periodically:
   ```json
   {
     "crons": [
       {
         "path": "/api/cron/retry-failed",
         "schedule": "*/5 * * * *"
       }
     ]
   }
   ```
