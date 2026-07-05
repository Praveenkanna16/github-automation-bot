import { prisma } from "@/lib/db";
import { processWebhookEvent } from "@/lib/webhookProcessor";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  
  if (!cronSecret || cronSecret.trim() === "" || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const now = new Date();
    // Fetch failed events where retryCount is under 5 and nextRetryAt is in the past
    const failedEvents = await prisma.webhookEvent.findMany({
      where: {
        status: "failed",
        retryCount: { lt: 5 },
        OR: [
          { nextRetryAt: null },
          { nextRetryAt: { lte: now } }
        ]
      },
      take: 10, // process in small batches to fit lambda timeouts
    });

    const results = [];
    for (const event of failedEvents) {
      try {
        await processWebhookEvent(event.id);
        results.push({ id: event.id, status: "success" });
      } catch (err: any) {
        results.push({ id: event.id, status: "failed", error: err.message || String(err) });
      }
    }

    return NextResponse.json({
      processedCount: failedEvents.length,
      results,
    });
  } catch (error: any) {
    console.error("Cron retry-failed task failed:", error);
    return NextResponse.json({ error: error.message || "Cron failure" }, { status: 500 });
  }
}
