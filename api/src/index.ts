import { createApp } from "./app";
import { env } from "./env";
import prisma from "./prisma";

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`youbet API listening on http://localhost:${env.port}`);
  console.log(`  chain    ${env.chainId} via ${env.rpcUrl}`);
  console.log(`  book     ${env.wagerBookAddress ?? "(not configured)"}`);
  console.log(`  database ${env.databaseUrl ? "configured" : "(not configured)"}`);
});

async function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
