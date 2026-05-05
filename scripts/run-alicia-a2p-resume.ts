import { config } from "dotenv";
config({ path: ".env.local" });

import { resumeA2PAutomationForUserEmail } from "../lib/a2p/resumeAutomation";

async function main() {
  const email = "aliciaandrade.ffl@gmail.com";
  console.log("[A2P][LOCAL_RESUME_START]", { email });

  const result = await resumeA2PAutomationForUserEmail(email);

  console.log("[A2P][LOCAL_RESUME_RESULT]");
  console.dir(result, { depth: 10 });
}

main().catch((err) => {
  console.error("[A2P][LOCAL_RESUME_FATAL]", {
    message: err?.message,
    code: err?.code,
    status: err?.status,
    stack: err?.stack,
  });
  process.exit(1);
});
