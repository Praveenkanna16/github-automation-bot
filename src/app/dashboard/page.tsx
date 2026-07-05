import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { Octokit } from "octokit";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  // 1. Fetch user's GitHub access token
  const account = await prisma.account.findFirst({
    where: {
      userId: session.user.id,
      provider: "github",
    },
  });

  if (!account?.access_token) {
    redirect("/login");
  }

  // 2. Fetch connected repos from DB
  const dbConnectedRepos = await prisma.connectedRepo.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  // 3. Fetch GitHub repositories via Octokit
  let githubRepos: any[] = [];
  let fetchError = null;
  try {
    const octokit = new Octokit({ auth: account.access_token });
    const response = await octokit.rest.repos.listForAuthenticatedUser({
      sort: "updated",
      per_page: 100,
    });
    githubRepos = response.data.map(r => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      owner: r.owner.login,
      url: r.html_url,
      private: r.private,
    }));
  } catch (error: any) {
    console.error("Failed to fetch repositories from GitHub:", error);
    fetchError = error.message || "Failed to load GitHub repositories.";
  }

  // 4. Fetch the webhook event logs for connected repos
  const connectedRepoIds = dbConnectedRepos.map(r => r.id);
  const events = await prisma.webhookEvent.findMany({
    where: {
      repoId: { in: connectedRepoIds },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Convert Date types to ISO string to pass safely to Client Component
  const serializedEvents = events.map(e => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    nextRetryAt: e.nextRetryAt ? e.nextRetryAt.toISOString() : null,
  }));

  const serializedConnectedRepos = dbConnectedRepos.map(r => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return (
    <DashboardClient
      user={{
        name: session.user.name || "User",
        email: session.user.email || "",
        image: session.user.image || "",
      }}
      githubRepos={githubRepos}
      connectedRepos={serializedConnectedRepos}
      initialEvents={serializedEvents}
      fetchError={fetchError}
    />
  );
}
