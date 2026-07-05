/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/db";
import { Octokit } from "octokit";

// Consistent structured JSON Logger helper
function logStep(deliveryId: string, eventType: string, status: string, message: string, extra = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    deliveryId,
    eventType,
    status,
    message,
    ...extra
  }));
}

export async function processWebhookEvent(eventId: string): Promise<void> {
  const event = await prisma.webhookEvent.findUnique({
    where: { id: eventId },
    include: { repo: true },
  });

  if (!event) {
    throw new Error(`Event with ID ${eventId} not found`);
  }

  logStep(event.deliveryId, event.eventType, "processing", `Started processing event ID: ${event.id}`);

  // Update status to processing
  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: { status: "processing", error: null },
  });

  try {
    const payload = event.payload as any;
    const eventType = event.eventType;
    const connectedRepo = event.repo;

    // 1. Optional Gemini AI Triage Step (Phase E)
    const geminiKey = process.env.GEMINI_API_KEY;
    let aiLabel: string | null = null;
    let aiSummary: string | null = null;

    if (geminiKey && (eventType === "issues" || eventType === "pull_request")) {
      try {
        logStep(event.deliveryId, eventType, "processing", "Initiating Gemini AI triage classification");
        const title = payload.issue?.title || payload.pull_request?.title || "";
        const body = payload.issue?.body || payload.pull_request?.body || "";

        const prompt = `Analyze the following GitHub issue/pull request. Return a JSON object with two fields: 'suggestedLabel' (a single lowercase word like bug, docs, feature, enhancement, question) and 'summary' (a concise one-sentence summary under 100 characters). Output only the raw JSON, no markdown blocks.
Title: ${title}
Body: ${body}`;

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: prompt }]
              }],
              generationConfig: {
                responseMimeType: "application/json"
              }
            })
          }
        );

        if (geminiRes.ok) {
          const resData = await geminiRes.json();
          const textResponse = resData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          const parsed = JSON.parse(textResponse.trim());
          aiLabel = parsed.suggestedLabel || null;
          aiSummary = parsed.summary || null;
          logStep(event.deliveryId, eventType, "processing", "Gemini AI triage analysis succeeded", { aiLabel, aiSummary });
        } else {
          const errText = await geminiRes.text();
          logStep(event.deliveryId, eventType, "processing", "Gemini AI API call failed", { response: errText });
        }
      } catch (geminiError: any) {
        logStep(event.deliveryId, eventType, "processing", "Failed to fetch triage analysis from Gemini", { error: geminiError.message || String(geminiError) });
      }
    }

    // Fetch the rules configured for this repo
    const rules = await prisma.rule.findMany({
      where: { repoId: connectedRepo.id },
    });

    logStep(event.deliveryId, eventType, "processing", `Fetched ${rules.length} rules from database`);

    // If there are no rules configured, we're done
    if (rules.length === 0) {
      logStep(event.deliveryId, eventType, "done", "No rules configured for this repository, skipping dispatches");
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: {
          status: "done",
          aiLabel,
          aiSummary,
          error: "No rules configured for this repository.",
        },
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
      logStep(event.deliveryId, eventType, "processing", `Matched rule ID: ${rule.id} [Field: ${rule.matchField}, Value: ${rule.matchValue}]`);
      actionsLogs.push(`Matched rule: [Field: ${rule.matchField}, Value: ${rule.matchValue}]`);

      // A. GitHub Actions (Labels / Comments)
      const number = payload.issue?.number || payload.pull_request?.number;

      if ((rule.action === "label" || rule.action === "all") && rule.label && number) {
        logStep(event.deliveryId, eventType, "processing", `Applying label: "${rule.label}" to issue/PR #${number}`);
        await octokit.rest.issues.addLabels({
          owner,
          repo: repoName,
          issue_number: number,
          labels: [rule.label],
        });
        actionsLogs.push(`Applied label "${rule.label}" to issue/PR #${number}`);
      }

      if ((rule.action === "comment" || rule.action === "all") && rule.comment && number) {
        logStep(event.deliveryId, eventType, "processing", `Creating comment on issue/PR #${number}`);
        await octokit.rest.issues.createComment({
          owner,
          repo: repoName,
          issue_number: number,
          body: rule.comment,
        });
        actionsLogs.push(`Added comment to issue/PR #${number}`);
      }

      // B. Slack Notification
      const slackUrl = process.env.SLACK_WEBHOOK_URL;
      if (slackUrl && rule.slackMessageTemplate) {
        let slackText = rule.slackMessageTemplate;
        slackText = slackText
          .replace("{event}", eventType)
          .replace("{repo}", connectedRepo.repoFullName)
          .replace("{title}", payload.issue?.title || payload.pull_request?.title || payload.compare || "Commit/Push")
          .replace("{author}", payload.sender?.login || "unknown")
          .replace("{url}", payload.issue?.html_url || payload.pull_request?.html_url || payload.compare || "");

        // Append Gemini AI insights if generated
        if (aiLabel || aiSummary) {
          slackText += `\n\n*🤖 AI Triage Insight*:\n• *Suggested Label*: \`${aiLabel || "none"}\`\n• *Summary*: _${aiSummary || "N/A"}_`;
        }

        logStep(event.deliveryId, eventType, "processing", "Sending POST request to Slack incoming webhook");
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

    logStep(event.deliveryId, eventType, "done", `Successfully processed event ID: ${event.id}`, { actions: actionsLogs });

    // Update event status to done
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: "done",
        aiLabel,
        aiSummary,
        error: matchedAnyRule ? actionsLogs.join("\n") : "No rules matched this event.",
      },
    });

  } catch (error: any) {
    logStep(event.deliveryId, event.eventType, "failed", `Error processing webhook event ID: ${event.id}`, { error: error.message || String(error) });

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
