/* eslint-disable @typescript-eslint/no-explicit-any */
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { z } from "zod";

const ruleSchema = z.object({
  id: z.string().optional(),
  repoId: z.string(),
  matchField: z.enum(["title", "body", "branch", "author", "aiLabel"]),
  matchValue: z.string().min(1, "Match keyword is required"),
  eventType: z.enum(["all", "issues", "pull_request", "push"]),
  action: z.enum(["label", "comment", "slack", "all"]),
  label: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  slackMessageTemplate: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

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

  if (!repoId) {
    return NextResponse.json({ error: "Missing repoId parameter" }, { status: 400 });
  }

  try {
    const rules = await prisma.rule.findMany({
      where: {
        repoId,
        userId: session.user.id,
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(rules);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const result = ruleSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: result.error.issues[0].message }, { status: 400 });
    }

    const { repoId, matchField, matchValue, eventType, action, label, comment, slackMessageTemplate } = result.data;

    // Verify repository ownership
    const repo = await prisma.connectedRepo.findFirst({
      where: {
        id: repoId,
        userId: session.user.id,
      },
    });

    if (!repo) {
      return NextResponse.json({ error: "Repository not connected or unauthorized" }, { status: 403 });
    }

    const rule = await prisma.rule.create({
      data: {
        userId: session.user.id,
        repoId,
        matchField,
        matchValue,
        eventType,
        action,
        label,
        comment,
        slackMessageTemplate,
        enabled: true,
      },
    });

    return NextResponse.json(rule);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const result = ruleSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: result.error.issues[0].message }, { status: 400 });
    }

    const { id, matchField, matchValue, eventType, action, label, comment, slackMessageTemplate, enabled } = result.data;

    if (!id) {
      return NextResponse.json({ error: "Missing rule ID parameter" }, { status: 400 });
    }

    const rule = await prisma.rule.update({
      where: {
        id,
        userId: session.user.id,
      },
      data: {
        matchField,
        matchValue,
        eventType,
        action,
        label,
        comment,
        slackMessageTemplate,
        enabled: enabled !== undefined ? enabled : true,
      },
    });

    return NextResponse.json(rule);
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
    return NextResponse.json({ error: "Missing rule ID parameter" }, { status: 400 });
  }

  try {
    const rule = await prisma.rule.delete({
      where: {
        id,
        userId: session.user.id,
      },
    });
    return NextResponse.json(rule);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
