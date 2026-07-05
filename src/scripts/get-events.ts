import { prisma } from "../lib/db";

async function main() {
  const events = await prisma.webhookEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 5
  });
  console.log("📊 Webhook Events in Database:");
  console.log(JSON.stringify(events, null, 2));
}

main()
  .catch(err => {
    console.error(err);
  })
  .finally(async () => {
    process.exit(0);
  });
