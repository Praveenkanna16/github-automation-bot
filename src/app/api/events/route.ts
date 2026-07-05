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
  const repoId = searchParams.get("repoId");

  try {
    const events = await prisma.webhookEvent.findMany({
      where: repoId ? { repoId } : {
        repo: { userId: session.user.id }
      },
      orderBy: { createdAt: "desc" },
      take: 50,
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
