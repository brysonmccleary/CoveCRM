import fs from "fs";
import path from "path";
import {
  CREATE_REMINDER_TOOL_DEF,
  MANAGE_DRIP_TOOL_DEF,
  CONTROL_DIAL_SESSION_TOOL_DEF,
  MANAGE_APPOINTMENT_TOOL_DEF,
  CRM_REPORT_TOOL_DEF,
  EXPORT_LEADS_TOOL_DEF,
} from "@/lib/ai/assistant/crmWorkflowTools";
import { MANAGE_LEADS_TOOL_DEF } from "@/lib/ai/assistant/manageLeadsTool";
import { MANAGE_FOLDER_TOOL_DEF } from "@/lib/ai/assistant/manageFolderTool";

describe("expanded top-level CRM assistant tools", () => {
  test("all requested non-email abilities are exposed to the main assistant", () => {
    const names = [
      MANAGE_LEADS_TOOL_DEF, MANAGE_FOLDER_TOOL_DEF, CREATE_REMINDER_TOOL_DEF,
      MANAGE_DRIP_TOOL_DEF, CONTROL_DIAL_SESSION_TOOL_DEF, MANAGE_APPOINTMENT_TOOL_DEF,
      CRM_REPORT_TOOL_DEF, EXPORT_LEADS_TOOL_DEF,
    ].map((tool) => tool.function.name);
    expect(names).toEqual(expect.arrayContaining([
      "manage_leads", "manage_folder", "create_reminder", "manage_drip_enrollment",
      "control_dial_session", "manage_appointment", "crm_report", "export_leads",
    ]));
    const route = fs.readFileSync(path.join(process.cwd(), "pages/api/chat-assistant.ts"), "utf8");
    for (const name of names) expect(route).toContain(name);
  });

  test("destructive and message-producing actions describe preview confirmation", () => {
    expect(MANAGE_LEADS_TOOL_DEF.function.description.toLowerCase()).toContain("preview");
    expect(MANAGE_DRIP_TOOL_DEF.function.description.toLowerCase()).toContain("preview");
    expect(MANAGE_APPOINTMENT_TOOL_DEF.function.description.toLowerCase()).toContain("confirmation");
  });

  test("email sending is explicitly excluded from the assistant prompt", () => {
    const route = fs.readFileSync(path.join(process.cwd(), "pages/api/chat-assistant.ts"), "utf8");
    expect(route).toContain("does not provide assistant email sending");
  });
});
