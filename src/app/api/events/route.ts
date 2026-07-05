/* eslint-disable @typescript-eslint/no-explicit-any */
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  // Health check endpoint - return simple status without DB access
  if (searchParams.get('health') === '1') {
    return NextResponse.json({ status: 'ok' });
  }
  const repoId = searchParams.get("repoId");
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const eventType = searchParams.get("eventType");
  const skip = parseInt(searchParams.get("skip") || "0", 10);
  const take = parseInt(searchParams.get("take") || "100", 10);

  try {
    const whereClause: any = repoId ? {
      repoId,
      repo: { userId: session.user.id }
    } : {
      repo: { userId: session.user.id }
    };

    if (status && status !== "all") {
      whereClause.status = status;
    }

    if (eventType && eventType !== "all") {
      whereClause.eventType = eventType;
    }

    if (search) {
      whereClause.OR = [
        { deliveryId: { contains: search, mode: "insensitive" } },
        { eventType: { contains: search, mode: "insensitive" } },
        { status: { contains: search, mode: "insensitive" } },
        { error: { contains: search, mode: "insensitive" } },
        { aiSummary: { contains: search, mode: "insensitive" } },
        { aiLabel: { contains: search, mode: "insensitive" } },
      ];
    }

    const events = await prisma.webhookEvent.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
    
    const serializedEvents = events.map(e => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      nextRetryAt: e.nextRetryAt ? e.nextRetryAt.toISOString() : null,
    }));
    
    return NextResponse.json(serializedEvents);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
