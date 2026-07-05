import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const repoId = searchParams.get("repoId");

  try {
    const userId = session.user.id;

    // Filters based on repo selection
    const repoFilter = repoId ? { id: repoId, userId } : { userId };
    const eventRepoFilter = repoId ? { id: repoId, userId } : { userId };

    const connectedReposCount = await prisma.connectedRepo.count({
      where: { userId },
    });

    const activeRulesCount = await prisma.rule.count({
      where: { userId, enabled: true, ...(repoId ? { repoId } : {}) },
    });

    // Query events associated with the user's connected repos
    const totalEvents = await prisma.webhookEvent.count({
      where: { repo: eventRepoFilter },
    });

    const failedEvents = await prisma.webhookEvent.count({
      where: { repo: eventRepoFilter, status: "failed" },
    });

    const doneEvents = await prisma.webhookEvent.count({
      where: { repo: eventRepoFilter, status: "done" },
    });

    const retryQueueDepth = await prisma.webhookEvent.count({
      where: { repo: eventRepoFilter, status: "failed", retryCount: { lt: 5 } },
    });

    // Average processing time
    const avgMsAggregate = await prisma.webhookEvent.aggregate({
      where: { repo: eventRepoFilter, status: "done", processingMs: { not: null } },
      _avg: {
        processingMs: true,
      },
    });

    // Last success/failure timestamps
    const lastSuccessEvent = await prisma.webhookEvent.findFirst({
      where: { repo: eventRepoFilter, status: "done" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const lastFailedEvent = await prisma.webhookEvent.findFirst({
      where: { repo: eventRepoFilter, status: "failed" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const successRate = totalEvents > 0 ? Math.round((doneEvents / totalEvents) * 100) : 100;

    return NextResponse.json({
      connectedReposCount,
      activeRulesCount,
      totalEvents,
      failedEvents,
      successRate,
      retryQueueDepth,
      avgProcessingMs: avgMsAggregate._avg.processingMs ? Math.round(avgMsAggregate._avg.processingMs) : null,
      lastSuccessfulWebhook: lastSuccessEvent?.createdAt || null,
      lastFailedWebhook: lastFailedEvent?.createdAt || null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
