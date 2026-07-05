const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "../../.env");
if (!fs.existsSync(envPath)) {
  console.error("❌ .env file not found at:", envPath);
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, "utf8");
const envs = {};

envContent.split(/\r?\n/).forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return;
  const index = trimmed.indexOf("=");
  if (index === -1) return;
  const key = trimmed.substring(0, index).trim();
  let value = trimmed.substring(index + 1).trim();
  // Strip enclosing quotes if present
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.substring(1, value.length - 1);
  }
  envs[key] = value;
});

const keysToSync = [
  "DATABASE_URL",
  "DIRECT_URL",
  "AUTH_SECRET",
  "AUTH_GITHUB_ID",
  "AUTH_GITHUB_SECRET",
  "GITHUB_WEBHOOK_SECRET",
  "SLACK_WEBHOOK_URL",
  "CRON_SECRET",
  "NEXTAUTH_URL"
];

for (const key of keysToSync) {
  const value = envs[key];
  if (!value) {
    console.warn(`⚠️ Warning: ${key} not found in .env, skipping.`);
    continue;
  }

  console.log(`🧹 Cleaning existing ${key} on Vercel...`);
  try {
    execSync(`npx vercel env rm ${key} production --yes`, { stdio: ["ignore", "pipe", "pipe"] });
    console.log(`   Removed ${key}`);
  } catch (err) {
    console.log(`   (Not found or skipped)`);
  }

  console.log(`➕ Adding ${key} on Vercel...`);
  try {
    execSync(`npx vercel env add ${key} production --value "${value}" --yes`, { stdio: ["ignore", "pipe", "pipe"] });
    console.log(`✅ Successfully added ${key}`);
  } catch (err) {
    console.error(`❌ Failed to add ${key}:`, err.message);
  }
}

console.log("🎉 All Vercel environment variables synced!");
