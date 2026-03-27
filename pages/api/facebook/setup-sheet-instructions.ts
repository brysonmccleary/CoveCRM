// pages/api/facebook/setup-sheet-instructions.ts
// GET — returns step-by-step instructions and Apps Script template for Google Sheet setup
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

const APPS_SCRIPT_TEMPLATE = `// CoveCRM Facebook Lead Ads — Google Apps Script
// Paste this into script.google.com, deploy as a Web App with access "Anyone"

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // Add headers if first row is empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Timestamp", "First Name", "Last Name", "Email",
        "Phone", "Lead Type", "Source", "Campaign", "Row"
      ]);
    }

    var data = JSON.parse(e.postData.contents);
    var rowNum = sheet.getLastRow() + 1;

    sheet.appendRow([
      data.date || new Date().toISOString(),
      data.firstName || "",
      data.lastName || "",
      data.email || "",
      data.phone || "",
      data.leadType || "",
      data.source || "Facebook",
      data.campaignName || "",
      rowNum
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, row: rowNum }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var action = e.parameter.action;

    if (action === "getLeads") {
      var sinceRow = parseInt(e.parameter.sinceRow || "1", 10);
      var lastRow = sheet.getLastRow();
      var leads = [];

      // Row 1 = headers, data starts at row 2
      var startRow = Math.max(2, sinceRow + 1);
      if (startRow > lastRow) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: true, leads: [], lastRow: lastRow }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      var numRows = lastRow - startRow + 1;
      var data = sheet.getRange(startRow, 1, numRows, 9).getValues();

      for (var i = 0; i < data.length; i++) {
        var row = data[i];
        leads.push({
          date: row[0],
          firstName: row[1],
          lastName: row[2],
          email: row[3],
          phone: row[4],
          leadType: row[5],
          source: row[6],
          campaignName: row[7],
          rowNumber: startRow + i
        });
      }

      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, leads: leads, lastRow: lastRow }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, status: "CoveCRM Apps Script active" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}`;

const SETUP_STEPS = [
  "Go to script.google.com and click '+ New project'",
  "Delete any existing code in the editor",
  "Paste the Apps Script template below",
  "Click 'Deploy' → 'New Deployment'",
  "Select type: 'Web app'",
  "Set 'Execute as': Me",
  "Set 'Who has access': Anyone",
  "Click Deploy and copy the Web App URL",
  "Paste your Web App URL into CoveCRM below",
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  return res.status(200).json({
    steps: SETUP_STEPS,
    appsScriptTemplate: APPS_SCRIPT_TEMPLATE,
  });
}
