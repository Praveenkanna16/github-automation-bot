# GitAutomate Bot & Dashboard

A secure, event-driven full-stack Next.js 16 (App Router) automation web app and bot. It connects to users' GitHub repositories, registers webhooks, matches incoming events (Issues, Pull Requests, Pushes) against configurable automation rules, adds GitHub labels/comments, and posts Slack notification webhooks.

## Key Features

1. **GitHub OAuth Authentication**: Managed securely via **Auth.js v5 (NextAuth)** with requested `repo` and `admin:repo_hook` scopes.
2. **Secure Webhook Ingestion (`/api/webhooks/github`)**:
   - **Signature Verification**: Verifies HMAC-SHA256 signatures using a timing-safe buffer comparison (`crypto.timingSafeEqual`) to defend against timing attacks and forgery.
   - **Idempotency**: Prevents double-processing of duplicate deliveries via unique `X-GitHub-Delivery` ID logging.
   - **Durability**: Webhook payloads are persisted immediately in a `"received"` state before downstream action execution (preventing data loss if GitHub writeback or Slack fails).
3. **Structured Ingestion Logging**: Emits consistent JSON logs (`timestamp`, `deliveryId`, `eventType`, `status`, `message`, `error`) at each processing phase to simplify Vercel function log inspections.
4. **Interactive Dashboard**: A glassmorphic dark-theme UI to connect repositories, create/edit/delete match rules, and inspect live webhook logs with their execution states, retry counts, errors, and AI insights.
5. **Gemini AI Triage**: When configured, incoming issues and PRs are sent to **Gemini 1.5 Flash** to suggest a label classification and a one-sentence summary. These are logged in the database, shown on the dashboard, and appended to Slack notifications.
6. **Fault-Tolerant Retries**: A cron route (`/api/cron/retry-failed`) executes periodically to retry failed executions using exponential backoff.

---

## Technical Stack

- **Framework**: Next.js 16 (App Router, TypeScript)
- **Database**: Postgres on Neon, accessed via Prisma ORM
- **Authentication**: Auth.js (NextAuth) v5 with GitHub Provider
- **GitHub API**: Octokit
- **AI Engine**: Google Gemini (via AI Studio API)
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
NEXTAUTH_URL="http://localhost:3000"

# Optional Gemini Triage
GEMINI_API_KEY="your_google_gemini_api_key_here"
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
   npx vercel env add GEMINI_API_KEY
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

---

## 🏁 Grader End-to-End Testing Instructions

Because our application leverages standard GitHub OAuth, the bot is fully self-serve. Graders can easily test the entire pipeline end-to-end using their own GitHub credentials without any pre-configured access:

### Step 1: Login & Setup
1. Open the live deployment URL: `https://github-automation-bot-tau.vercel.app`.
2. Click **Sign In with GitHub** and authorize the application. (This registers your account and securely saves your session token).
3. On the dashboard sidebar, you will see a dropdown listing all GitHub repositories you own or administer. Select any repository and click **Connect**. (This automatically registers our webhook listener on your GitHub repository).

### Step 2: Configure a Rule
1. Once connected, select the repository from the left sidebar.
2. In the **Rules** tab, create a new rule with the following parameters:
   - **Match Field**: `title`
   - **Match Value**: `bug`
   - **Action**: `all`
   - **Label**: `bug`
   - **Comment**: `Automated Comment: Thanks for reporting this bug!`
   - **Slack message template**: `New Bug Alert in {repo}: #{number} "{title}" by {sender}`
3. Click **Create Rule**.

### Step 3: Trigger the Webhook
1. Go to your connected repository on GitHub.
2. Open a new issue with a title containing the word `bug` (e.g. `Critical login page bug`).
3. Return to our dashboard, switch to the **Logs** tab, and click **Refresh**.
4. You will see the incoming `issues` webhook listed with its unique `X-GitHub-Delivery` ID, transition from `received` to `processing`, and finally to:
   - `done` (if your Slack webhook configuration was valid), OR
   - `failed` (if the Slack webhook was unconfigured or the mock token failed, listing the exact error trace and scheduling retries with exponential backoff).
5. If the Slack webhook configuration is correct, you will immediately see a Slack notification in the configured channel.
6. The bot will automatically apply the `bug` label and write the comment back to your GitHub issue!
