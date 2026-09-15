import { run } from "graphile-worker";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const runner = await run({
    connectionString: process.env.DB_CONNECTION_STRING,
    maxPoolSize: 10,
    pollInterval: 2000,
    preparedStatements: true,
    schema: "graphile_worker",
    concurrentJobs: 3,
    fileExtensions: [".js", ".cjs", ".mjs"],
    taskDirectory: `${import.meta.dirname}/tasks`,
  });
  await runner.promise;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
