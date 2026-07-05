/* eslint-disable @typescript-eslint/no-explicit-any */
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { Octokit } from "octokit";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { repoFullName } = await req.json();
    if (!repoFullName || !repoFullName.includes("/")) {
      return NextResponse.json({ error: "Invalid repository name" }, { status: 400 });
    }

    const [owner, repo] = repoFullName.split("/");

    // Fetch user's GitHub access token
    const account = await prisma.account.findFirst({
      where: {
        userId: session.user.id,
        provider: "github",
      },
    });

    if (!account?.access_token) {
      return NextResponse.json({ error: "GitHub account token not found" }, { status: 400 });
    }

    // Instantiate Octokit
    const octokit = new Octokit({ auth: account.access_token });

    // Webhook configuration
    const host = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
    if (!host) {
      return NextResponse.json({ error: "Host URL not configured. Ensure VERCEL_URL or NEXTAUTH_URL is set." }, { status: 500 });
    }

    const webhookUrl = `${host}/api/webhooks/github`;
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return NextResponse.json({ error: "GITHUB_WEBHOOK_SECRET is not configured." }, { status: 500 });
    }

    // Register Webhook on GitHub
    let webhookId: string | null = null;
    try {
      const webhookResponse = await octokit.rest.repos.createWebhook({
        owner,
        repo,
        config: {
          url: webhookUrl,
          content_type: "json",
          secret: webhookSecret,
          insecure_ssl: "0",
        },
        events: ["issues", "pull_request", "push"],
        active: true,
      });
      webhookId = String(webhookResponse.data.id);
    } catch (err: any) {
      console.error("GitHub webhook registration failed:", err);
      // Proceed even if it's already registered or has a warning, but return error if block-stopping
      if (!err.message.includes("Hook already exists")) {
        return NextResponse.json({ error: `Failed to create GitHub webhook: ${err.message}` }, { status: 500 });
      }
    }

    // Persist connection in DB
    const connectedRepo = await prisma.connectedRepo.upsert({
      where: {
        userId_repoFullName: {
          userId: session.user.id,
          repoFullName,
        },
      },
      update: {
        accessToken: account.access_token,
        webhookId,
      },
      create: {
        userId: session.user.id,
        repoFullName,
        accessToken: account.access_token,
        webhookId,
      },
    });

    return NextResponse.json({ success: true, repo: connectedRepo });
  } catch (error: any) {
    console.error("Error in connect repo api:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
