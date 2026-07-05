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
    const { repoId, matchField, matchValue, action, label, comment, slackMessageTemplate } = await req.json();

    if (!repoId || !matchField || !matchValue || !action) {
      return NextResponse.json({ error: "Missing required rule parameters" }, { status: 400 });
    }

    const rule = await prisma.rule.create({
      data: {
        userId: session.user.id,
        repoId,
        matchField,
        matchValue,
        action,
        label,
        comment,
        slackMessageTemplate,
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
