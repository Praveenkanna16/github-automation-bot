/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { processWebhookEvent } from "@/lib/webhookProcessor";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const signature = req.headers.get("x-hub-signature-256");
  const deliveryId = req.headers.get("x-github-delivery");
  const eventType = req.headers.get("x-github-event");

  if (!deliveryId || !eventType) {
    return new Response("Missing GitHub headers", { status: 400 });
  }

  // 1. Signature Verification
  const bodyText = await req.text();
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    console.error("GITHUB_WEBHOOK_SECRET is not configured on server.");
    return new Response("Server configuration error", { status: 500 });
  }

  const hmac = createHmac("sha256", webhookSecret);
  const computedSignature = `sha256=${hmac.update(bodyText).digest("hex")}`;

  const sigBuffer = Buffer.from(signature || "");
  const compBuffer = Buffer.from(computedSignature);

  if (sigBuffer.length !== compBuffer.length || !timingSafeEqual(sigBuffer, compBuffer)) {
    console.warn(`Signature verification failed for delivery: ${deliveryId}`);
    return new Response("Unauthorized Signature", { status: 401 });
  }

  try {
    const payload = JSON.parse(bodyText);
    const repoFullName = payload.repository?.full_name;

    if (!repoFullName) {
      return NextResponse.json({ message: "No repository name in payload" }, { status: 200 });
    }

    // 2. Identify the connected repository records
    const connectedRepo = await prisma.connectedRepo.findFirst({
      where: { repoFullName },
    });

    if (!connectedRepo) {
      return NextResponse.json({ message: `Repository ${repoFullName} is not connected to this application.` }, { status: 200 });
    }

    // 3. Idempotency check: Reject duplicate deliveries
    const existingEvent = await prisma.webhookEvent.findUnique({
      where: { deliveryId },
    });

    if (existingEvent) {
      return NextResponse.json({ message: `Event delivery ${deliveryId} already processed (Idempotent).` }, { status: 200 });
    }

    // 4. Durability: Persist raw event to DB in 'received' state
    const newEvent = await prisma.webhookEvent.create({
      data: {
        repoId: connectedRepo.id,
        deliveryId,
        eventType,
        payload: payload,
        status: "received",
      },
    });

    // 5. Downstream Execution (wrapped in a try-catch to keep it durable and prevent returning 500 to GitHub)
    try {
      await processWebhookEvent(newEvent.id);
    } catch (procError) {
      console.error(`Durable execution failure for event ID: ${newEvent.id}. Saved in DB.`, procError);
      // We don't return 500 here since the event is durably stored and marked 'failed' inside the DB.
    }

    return NextResponse.json({ success: true, eventId: newEvent.id });

  } catch (error: any) {
    console.error("Critical error in webhook ingestion:", error);
    return NextResponse.json({ error: error.message || "Failed to ingest webhook" }, { status: 500 });
  }
}
