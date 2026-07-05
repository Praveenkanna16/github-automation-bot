/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHmac } from "crypto";

const TARGET_URL = process.argv[2] || "http://localhost:3000/api/webhooks/github";
const SECRET = process.argv[3] || process.env.GITHUB_WEBHOOK_SECRET || "your_custom_webhook_secret_key";
const EVENT_TYPE = process.argv[4] || "issues"; // "issues" | "pull_request" | "push"

async function run() {
  console.log(`🚀 Simulating GitHub Webhook Event: "${EVENT_TYPE}" to ${TARGET_URL}`);
  
  // 1. Construct mock payload
  const payload: any = {
    repository: {
      full_name: "test-owner/test-repo"
    },
    sender: {
      login: "test-user"
    }
  };

  if (EVENT_TYPE === "issues") {
    payload.issue = {
      title: "This is a bug in the code",
      body: "We found a serious bug in the database connection layer. Please apply the bug label.",
      number: 42,
      html_url: "https://github.com/test-owner/test-repo/issues/42"
    };
  } else if (EVENT_TYPE === "pull_request") {
    payload.pull_request = {
      title: "docs: update development guide",
      body: "We updated the instructions to compile correctly under Prisma 7. Please review.",
      number: 43,
      html_url: "https://github.com/test-owner/test-repo/pull/43"
    };
  } else if (EVENT_TYPE === "push") {
    payload.ref = "refs/heads/main";
    payload.compare = "https://github.com/test-owner/test-repo/compare/a...b";
  }

  const bodyText = JSON.stringify(payload);

  // 2. Compute signature
  const hmac = createHmac("sha256", SECRET);
  const signature = `sha256=${hmac.update(bodyText).digest("hex")}`;
  const deliveryId = `test-delivery-${Math.random().toString(36).substring(2, 15)}`;

  console.log(`🔑 Signed with HMAC-SHA256 Signature: ${signature}`);
  console.log(`📦 Delivery ID: ${deliveryId}`);

  try {
    const res = await fetch(TARGET_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": signature,
        "X-GitHub-Delivery": deliveryId,
        "X-GitHub-Event": EVENT_TYPE
      },
      body: bodyText
    });

    console.log(`📥 Response Status: ${res.status} ${res.statusText}`);
    const resText = await res.text();
    console.log(`💬 Response Body: ${resText}`);
  } catch (error: any) {
    console.error("❌ Request failed:", error.message || String(error));
  }
}

run();
