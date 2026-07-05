import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { Octokit } from "octokit";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const sync = searchParams.get("sync") === "1";

  if (sync) {
    // Re-fetch the repositories list from GitHub for connected account
    try {
      const account = await prisma.account.findFirst({
        where: { userId: session.user.id, provider: "github" },
      });

      if (!account?.access_token) {
        return NextResponse.json({ error: "GitHub access token not found" }, { status: 400 });
      }

      const octokit = new Octokit({ auth: account.access_token });
      const { data } = await octokit.rest.repos.listForAuthenticatedUser({
        sort: "updated",
        per_page: 100,
      });

      const formatted = data.map((r: any) => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        owner: r.owner.login,
        private: r.private,
        defaultBranch: r.default_branch,
      }));

      return NextResponse.json({ githubRepos: formatted });
    } catch (err: any) {
      return NextResponse.json({ error: `GitHub Sync Failed: ${err.message}` }, { status: 500 });
    }
  }

  try {
    const repos = await prisma.connectedRepo.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(repos);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing repo ID" }, { status: 400 });
  }

  try {
    const repo = await prisma.connectedRepo.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!repo) {
      return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    }

    // Try deleting the webhook from GitHub
    if (repo.webhookId) {
      try {
        const octokit = new Octokit({ auth: repo.accessToken });
        const [owner, repoName] = repo.repoFullName.split("/");
        await octokit.rest.repos.deleteWebhook({
          owner,
          repo: repoName,
          hook_id: parseInt(repo.webhookId, 10),
        });
      } catch (err: any) {
        console.error(`Failed to delete webhook for ${repo.repoFullName}:`, err.message);
      }
    }

    // Delete from local DB
    await prisma.connectedRepo.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
