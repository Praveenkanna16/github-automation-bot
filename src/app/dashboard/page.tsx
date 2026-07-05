import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Octokit } from "octokit";
import DashboardClient from "./DashboardClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const userId = session.user.id;

  // Load connected repos
  const connectedRepos = await prisma.connectedRepo.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  // Load latest events for first connected repo (client handles per-repo fetching)
  const initialEvents = connectedRepos.length > 0
    ? await prisma.webhookEvent.findMany({
        where: { repoId: connectedRepos[0].id },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    : [];

  // Fetch GitHub repos via Octokit
  let githubRepos: { id: number; name: string; fullName: string; owner: string; private: boolean; defaultBranch?: string }[] = [];
  let fetchError: string | null = null;

  try {
    const account = await prisma.account.findFirst({
      where: { userId, provider: "github" },
    });

    if (account?.access_token) {
      const octokit = new Octokit({ auth: account.access_token });
      const { data } = await octokit.rest.repos.listForAuthenticatedUser({
        sort: "updated",
        per_page: 100,
      });
      githubRepos = data.map((r: any) => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        owner: r.owner.login,
        private: r.private,
        defaultBranch: r.default_branch,
      }));
    }
  } catch (error) {
    console.error("Failed to fetch repositories from GitHub:", error);
    fetchError = "Could not load repositories from GitHub. Please try signing out and back in.";
  }

  return (
    <DashboardClient
      user={{
        name: session.user.name ?? "Unknown",
        email: session.user.email ?? "",
        image: session.user.image ?? "",
      }}
      githubRepos={githubRepos}
      connectedRepos={connectedRepos.map(r => ({
        id: r.id,
        userId: r.userId,
        repoFullName: r.repoFullName,
        webhookId: r.webhookId,
        createdAt: r.createdAt.toISOString(),
      }))}
      initialEvents={initialEvents.map(e => ({
        id: e.id,
        repoId: e.repoId,
        deliveryId: e.deliveryId,
        eventType: e.eventType,
        payload: e.payload,
        status: e.status,
        error: e.error,
        retryCount: e.retryCount,
        nextRetryAt: e.nextRetryAt?.toISOString() ?? null,
        processingMs: e.processingMs,
        aiSummary: e.aiSummary,
        aiLabel: e.aiLabel,
        aiPriority: e.aiPriority,
        aiReasoning: e.aiReasoning,
        aiConfidence: e.aiConfidence,
        createdAt: e.createdAt.toISOString(),
      }))}
      fetchError={fetchError}
    />
  );
}
