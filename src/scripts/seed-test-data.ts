import { prisma } from "../lib/db";

async function main() {
  console.log("🌱 Seeding test data directly to the database...");

  // 1. Clean up existing test repo
  const existingRepo = await prisma.connectedRepo.findFirst({
    where: { repoFullName: "test-owner/test-repo" }
  });

  if (existingRepo) {
    console.log(`🗑️ Cleaning up existing repo: ${existingRepo.repoFullName}`);
    await prisma.webhookEvent.deleteMany({ where: { repoId: existingRepo.id } });
    await prisma.rule.deleteMany({ where: { repoId: existingRepo.id } });
    await prisma.connectedRepo.delete({ where: { id: existingRepo.id } });
  }

  // 2. Upsert test user
  const user = await prisma.user.upsert({
    where: { email: "test-user@example.com" },
    update: {},
    create: {
      email: "test-user@example.com",
      name: "Test User"
    }
  });
  console.log(`👤 User ready: ${user.name} (${user.email})`);

  // 3. Create test connected repo
  const repo = await prisma.connectedRepo.create({
    data: {
      userId: user.id,
      repoFullName: "test-owner/test-repo",
      accessToken: "mock-github-access-token"
    }
  });
  console.log(`📦 ConnectedRepo ready: ${repo.repoFullName}`);

  // 4. Create matching rules
  const rule = await prisma.rule.create({
    data: {
      userId: user.id,
      repoId: repo.id,
      matchField: "title",
      matchValue: "bug",
      action: "all",
      label: "bug",
      comment: "Automated Comment: Thank you for reporting this bug! Our team is looking into it.",
      slackMessageTemplate: "🚨 *Issue Alert* in {repo}: Issue #{number} \"{title}\" created by {sender}. Details: {url}"
    }
  });
  console.log(`📋 Rule ready: Match field "${rule.matchField}" on "${rule.matchValue}" with action "${rule.action}"`);

  console.log("✅ Seeding completed successfully!");
}

main()
  .catch(err => {
    console.error("❌ Seeding failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    // Force exit to cleanup connections
    process.exit(0);
  });
