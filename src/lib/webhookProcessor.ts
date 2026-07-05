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
  const startTime = Date.now();
  const event = await prisma.webhookEvent.findUnique({
    where: { id: eventId },
    include: { repo: { include: { user: true } } },
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
    const user = connectedRepo.user;

    // 1. Optional Gemini AI Triage Step
    const geminiKey = process.env.GEMINI_API_KEY;
    let aiLabel: string | null = null;
    let aiSummary: string | null = null;
    let aiPriority: string | null = null;
    let aiReasoning: string | null = null;
    let aiConfidence: number | null = null;

    if (geminiKey && user.aiEnabled && (eventType === "issues" || eventType === "pull_request")) {
      try {
        logStep(event.deliveryId, eventType, "processing", "Initiating Gemini AI triage classification");
        const title = payload.issue?.title || payload.pull_request?.title || "";
        const body = payload.issue?.body || payload.pull_request?.body || "";

        const prompt = `Analyze the following GitHub issue/pull request. Return a JSON object with the following fields:
- 'suggestedLabel': a single lowercase word (e.g. bug, docs, feature, enhancement, question)
- 'summary': a concise one-sentence summary under 100 characters
- 'priority': one of 'high', 'medium', 'low'
- 'reasoning': a brief explanation of the priority and label choice
- 'confidence': a decimal number between 0 and 1 representing your confidence level.

Output only valid, raw JSON, no markdown formatting blocks.
Title: ${title}
Body: ${body}`;

        const geminiController = new AbortController();
        const geminiTimeout = setTimeout(() => geminiController.abort(), 8000);
        let geminiRes;
        try {
          geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: geminiController.signal,
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
        } finally {
          clearTimeout(geminiTimeout);
        }

        if (geminiRes.ok) {
          const resData = await geminiRes.json();
          const textResponse = resData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          const parsed = JSON.parse(textResponse.trim());
          aiLabel = parsed.suggestedLabel || null;
          aiSummary = parsed.summary || null;
          aiPriority = parsed.priority || null;
          aiReasoning = parsed.reasoning || null;
          aiConfidence = typeof parsed.confidence === "number" ? parsed.confidence : null;
          logStep(event.deliveryId, eventType, "processing", "Gemini AI triage analysis succeeded", { aiLabel, aiSummary, aiPriority });
        } else {
          const errText = await geminiRes.text();
          logStep(event.deliveryId, eventType, "processing", "Gemini AI API call failed", { response: errText });
        }
      } catch (geminiError: any) {
        logStep(event.deliveryId, eventType, "processing", "Failed to fetch triage analysis from Gemini", { error: geminiError.message || String(geminiError) });
      }
    }

    // Fetch the rules configured for this repo (only enabled ones)
    const rules = await prisma.rule.findMany({
      where: { repoId: connectedRepo.id, enabled: true },
    });

    logStep(event.deliveryId, eventType, "processing", `Fetched ${rules.length} active rules from database`);

    // If there are no rules configured, we're done
    if (rules.length === 0) {
      logStep(event.deliveryId, eventType, "done", "No active rules configured for this repository, skipping dispatches");
      const processingMs = Date.now() - startTime;
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: {
          status: "done",
          aiLabel,
          aiSummary,
          aiPriority,
          aiReasoning,
          aiConfidence,
          processingMs,
          error: "No active rules configured for this repository.",
        },
      });
      return;
    }

    const octokit = new Octokit({ auth: connectedRepo.accessToken });
    const [owner, repoName] = connectedRepo.repoFullName.split("/");

    let matchedAnyRule = false;
    const actionsLogs: string[] = [];

    // Keep track of labels/comments applied to this specific run to prevent duplicates within a single delivery trigger
    const appliedLabels = new Set<string>();
    let commentPosted = false;

    for (const rule of rules) {
      // Filter by rule eventType
      if (rule.eventType !== "all" && rule.eventType !== eventType) {
        continue;
      }

      const isMatch = matchRule(payload, eventType, rule.matchField, rule.matchValue, { aiLabel });
      if (!isMatch) continue;

      matchedAnyRule = true;
      logStep(event.deliveryId, eventType, "processing", `Matched rule ID: ${rule.id} [Field: ${rule.matchField}, Value: ${rule.matchValue}]`);
      actionsLogs.push(`Matched rule: [Field: ${rule.matchField}, Value: ${rule.matchValue}]`);

      // A. GitHub Actions (Labels / Comments)
      const number = payload.issue?.number || payload.pull_request?.number;

      if ((rule.action === "label" || rule.action === "all") && rule.label && number) {
        if (!appliedLabels.has(rule.label)) {
          logStep(event.deliveryId, eventType, "processing", `Applying label: "${rule.label}" to issue/PR #${number}`);
          await octokit.rest.issues.addLabels({
            owner,
            repo: repoName,
            issue_number: number,
            labels: [rule.label],
          });
          appliedLabels.add(rule.label);
          actionsLogs.push(`Applied label "${rule.label}" to issue/PR #${number}`);
        } else {
          actionsLogs.push(`Skipped duplicate label "${rule.label}" on this event trigger.`);
        }
      }

      if ((rule.action === "comment" || rule.action === "all") && rule.comment && number) {
        if (!commentPosted) {
          logStep(event.deliveryId, eventType, "processing", `Creating comment on issue/PR #${number}`);
          await octokit.rest.issues.createComment({
            owner,
            repo: repoName,
            issue_number: number,
            body: rule.comment,
          });
          commentPosted = true;
          actionsLogs.push(`Added comment to issue/PR #${number}`);
        } else {
          actionsLogs.push(`Skipped duplicate comment actions on this event trigger.`);
        }
      }

      // B. Slack Notification (Structured Message with Block Kit)
      const slackUrl = process.env.SLACK_WEBHOOK_URL;
      if (slackUrl && rule.slackMessageTemplate) {
        let slackText = rule.slackMessageTemplate;
        slackText = slackText
          .replace("{event}", eventType)
          .replace("{repo}", connectedRepo.repoFullName)
          .replace("{title}", payload.issue?.title || payload.pull_request?.title || payload.compare || "Commit/Push")
          .replace("{author}", payload.sender?.login || "unknown")
          .replace("{url}", payload.issue?.html_url || payload.pull_request?.html_url || payload.compare || "");

        // Build Block Kit Blocks
        const blocks = [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*GitAutomate Notification* :bell:\n*Event:* \`${eventType}\` in *${connectedRepo.repoFullName}*`
            }
          },
          {
            type: "divider"
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Title:* ${payload.issue?.title || payload.pull_request?.title || "Commit/Push"}\n*Author:* \`${payload.sender?.login || "unknown"}\``
            }
          }
        ];

        if (aiLabel || aiSummary || aiPriority) {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*🤖 AI Triage Insight:*\n• *Suggested Label:* \`${aiLabel || "none"}\`\n• *Priority:* \`${aiPriority || "low"}\`\n• *Summary:* _${aiSummary || "N/A"}_`
            }
          } as any);
        }

        blocks.push({
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "View on GitHub",
                emoji: true
              },
              url: payload.issue?.html_url || payload.pull_request?.html_url || payload.compare || "https://github.com"
            }
          ]
        } as any);

        logStep(event.deliveryId, eventType, "processing", "Sending Block Kit POST request to Slack incoming webhook");
        const slackController = new AbortController();
        const slackTimeout = setTimeout(() => slackController.abort(), 8000);
        let slackRes;
        try {
          slackRes = await fetch(slackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: slackController.signal,
            body: JSON.stringify({
              text: slackText, // fallback text
              blocks: blocks
            }),
          });
        } finally {
          clearTimeout(slackTimeout);
        }

        if (!slackRes.ok) {
          const resText = await slackRes.text();
          throw new Error(`Slack Block Kit notification failed with status ${slackRes.status}: ${resText}`);
        }
        actionsLogs.push(`Sent Slack Block Kit alert successfully.`);
      }
    }

    logStep(event.deliveryId, eventType, "done", `Successfully processed event ID: ${event.id}`, { actions: actionsLogs });

    const processingMs = Date.now() - startTime;

    // Update event status to done
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: "done",
        aiLabel,
        aiSummary,
        aiPriority,
        aiReasoning,
        aiConfidence,
        processingMs,
        error: matchedAnyRule ? actionsLogs.join("\n") : "No rules matched this event.",
      },
    });

  } catch (error: any) {
    logStep(event.deliveryId, event.eventType, "failed", `Error processing webhook event ID: ${event.id}`, { error: error.message || String(error) });

    const processingMs = Date.now() - startTime;

    // Save failure error and update status to failed with backoff calculation
    const currentRetryCount = event.retryCount;
    const delayMinutes = Math.min(Math.pow(2, currentRetryCount), 60); // 1m, 2m, 4m, 8m, 16m, 32m, 60m...
    const nextRetry = new Date(Date.now() + delayMinutes * 60000);

    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: "failed",
        error: error.message || String(error),
        processingMs,
        retryCount: { increment: 1 },
        nextRetryAt: nextRetry,
      },
    });

    throw error;
  }
}

function matchRule(payload: any, eventType: string, matchField: string, matchValue: string, extra: { aiLabel?: string | null } = {}): boolean {
  try {
    let contentToMatch = "";
    if (matchField === "author") {
      contentToMatch = payload.sender?.login || "";
    } else if (matchField === "aiLabel") {
      contentToMatch = extra.aiLabel || "";
      return contentToMatch.toLowerCase() === matchValue.toLowerCase();
    } else if (eventType === "issues") {
      if (matchField === "title") contentToMatch = payload.issue?.title || "";
      else if (matchField === "body") contentToMatch = payload.issue?.body || "";
    } else if (eventType === "pull_request") {
      if (matchField === "title") contentToMatch = payload.pull_request?.title || "";
      else if (matchField === "body") contentToMatch = payload.pull_request?.body || "";
    } else if (eventType === "push") {
      if (matchField === "branch") {
        contentToMatch = payload.ref || "";
        const branch = contentToMatch.replace("refs/heads/", "");
        return branch.toLowerCase() === matchValue.toLowerCase() || contentToMatch.toLowerCase().includes(matchValue.toLowerCase());
      }
    }
    
    if (!contentToMatch) return false;
    return contentToMatch.toLowerCase().includes(matchValue.toLowerCase());
  } catch (error) {
    console.error("Error matching rule:", error);
    return false;
  }
}
