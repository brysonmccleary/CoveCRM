// runHashUsers.ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });  // explicitly load your env file

import path from "path";
import { exec } from "child_process";

// Run your hashUsers.ts script after env vars are loaded
const scriptPath = path.resolve(__dirname, "pages/api/scripts/hashUsers.ts");

exec(`npx ts-node ${scriptPath}`, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error executing hashUsers.ts: ${error.message}`);
    return;
  }
  if (stderr) {
    console.error(`stderr: ${stderr}`);
  }
  console.log(stdout);
});

