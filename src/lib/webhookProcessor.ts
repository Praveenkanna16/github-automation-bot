import { prisma } from "@/lib/db";
import { Octokit } from "octokit";

export async function processWebhookEvent(eventId: string): Promise<void> {
  const event = await prisma.webhookEvent.findUnique({
    where: { id: eventId },
    include: { repo: true },
  });

  if (!event) {
    throw new Error(`Event with ID ${eventId} not found`);
  }

  // Update status to processing
  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: { status: "processing", error: null },
  });

  try {
    const payload = event.payload as any;
    const eventType = event.eventType;
    const connectedRepo = event.repo;

    // Fetch the rules configured for this repo
    const rules = await prisma.rule.findMany({
      where: { repoId: connectedRepo.id },
    });

    // If there are no rules configured, we're done
    if (rules.length === 0) {
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: { status: "done", error: "No rules configured for this repository." },
      });
      return;
    }

    const octokit = new Octokit({ auth: connectedRepo.accessToken });
    const [owner, repoName] = connectedRepo.repoFullName.split("/");

    let matchedAnyRule = false;
    const actionsLogs: string[] = [];

    for (const rule of rules) {
      const isMatch = matchRule(payload, eventType, rule.matchField, rule.matchValue);
      if (!isMatch) continue;

      matchedAnyRule = true;
      actionsLogs.push(`Matched rule: [Field: ${rule.matchField}, Value: ${rule.matchValue}]`);

      // 1. GitHub Actions (Labels / Comments)
      const number = payload.issue?.number || payload.pull_request?.number;

      if ((rule.action === "label" || rule.action === "all") && rule.label && number) {
        await octokit.rest.issues.addLabels({
          owner,
          repo: repoName,
          issue_number: number,
          labels: [rule.label],
        });
        actionsLogs.push(`Applied label "${rule.label}" to issue/PR #${number}`);
      }

      if ((rule.action === "comment" || rule.action === "all") && rule.comment && number) {
        await octokit.rest.issues.createComment({
          owner,
          repo: repoName,
          issue_number: number,
          body: rule.comment,
        });
        actionsLogs.push(`Added comment to issue/PR #${number}`);
      }

      // 2. Slack Notification
      const slackUrl = process.env.SLACK_WEBHOOK_URL;
      if (slackUrl && rule.slackMessageTemplate) {
        let slackText = rule.slackMessageTemplate;
        slackText = slackText
          .replace("{event}", eventType)
          .replace("{repo}", connectedRepo.repoFullName)
          .replace("{title}", payload.issue?.title || payload.pull_request?.title || payload.compare || "Commit/Push")
          .replace("{author}", payload.sender?.login || "unknown")
          .replace("{url}", payload.issue?.html_url || payload.pull_request?.html_url || payload.compare || "");

        const slackRes = await fetch(slackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: slackText }),
        });

        if (!slackRes.ok) {
          const resText = await slackRes.text();
          throw new Error(`Slack notification failed with status ${slackRes.status}: ${resText}`);
        }
        actionsLogs.push(`Sent Slack alert successfully.`);
      }
    }

    // Update event status to done
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: "done",
        error: matchedAnyRule ? actionsLogs.join("\n") : "No rules matched this event.",
      },
    });

  } catch (error: any) {
    console.error(`Error processing webhook event ${eventId}:`, error);

    // Save failure error and update status to failed with backoff calculation
    const currentRetryCount = event.retryCount;
    const delayMinutes = Math.min(Math.pow(2, currentRetryCount), 60); // 1m, 2m, 4m, 8m, 16m, 32m, 60m...
    const nextRetry = new Date(Date.now() + delayMinutes * 60000);

    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: "failed",
        error: error.message || String(error),
        retryCount: { increment: 1 },
        nextRetryAt: nextRetry,
      },
    });

    throw error;
  }
}

function matchRule(payload: any, eventType: string, matchField: string, matchValue: string): boolean {
  try {
    let contentToMatch = "";
    if (eventType === "issues") {
      if (matchField === "title") contentToMatch = payload.issue?.title || "";
      else if (matchField === "body") contentToMatch = payload.issue?.body || "";
    } else if (eventType === "pull_request") {
      if (matchField === "title") contentToMatch = payload.pull_request?.title || "";
      else if (matchField === "body") contentToMatch = payload.pull_request?.body || "";
    } else if (eventType === "push") {
      if (matchField === "branch") {
        contentToMatch = payload.ref || "";
        const branch = contentToMatch.replace("refs/heads/", "");
        return branch.toLowerCase() === matchValue.toLowerCase() || contentToMatch.includes(matchValue);
      }
    }
    
    if (!contentToMatch) return false;
    return contentToMatch.toLowerCase().includes(matchValue.toLowerCase());
  } catch (error) {
    console.error("Error matching rule:", error);
    return false;
  }
}
