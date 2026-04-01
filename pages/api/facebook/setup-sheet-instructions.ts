// pages/api/facebook/setup-sheet-instructions.ts
// GET — returns step-by-step instructions and Apps Script template for Google Sheet setup
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

const BASE_HEADERS = [
  "date",
  "campaign_name",
  "lead_type",
  "first_name",
  "last_name",
  "phone",
  "email",
  "city",
  "state",
  "zip",
  "source",
  "status",
  "assigned_to",
  "notes",
];

const LEAD_TYPE_HEADERS: Record<string, string[]> = {
  mortgage_protection: ["birthdate", "homeowner", "mortgage_balance", "smoker"],
  final_expense: ["birthdate", "age_range", "coverage_amount"],
  iul: ["birthdate", "household_income", "current_coverage_amount"],
  veteran: ["birthdate", "veteran_status"],
  trucker: ["birthdate", "cdl_status"],
};

function buildAppsScriptTemplate(headers: string[]) {
  return `// CoveCRM Facebook Lead Ads — Google Apps Script
// Paste this into script.google.com, attach it to the Google Sheet you own,
// then deploy as a Web App with access "Anyone"

var HEADERS = ${JSON.stringify(headers)};

function ensureHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    return;
  }

  var firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  var hasHeaders = firstRow.some(function(cell) {
    return String(cell || "").trim() !== "";
  });

  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
}

function normalizePayload(data) {
  return {
    date: data.date || new Date().toISOString(),
    campaign_name: data.campaign_name || data.campaignName || "",
    lead_type: data.lead_type || data.leadType || "",
    first_name: data.first_name || data.firstName || "",
    last_name: data.last_name || data.lastName || "",
    phone: data.phone || "",
    email: data.email || "",
    city: data.city || "",
    state: data.state || "",
    zip: data.zip || data.postal_code || "",
    birthdate: data.birthdate || data.date_of_birth || "",
    homeowner: data.homeowner || "",
    coverage_amount: data.coverage_amount || data.coverageAmount || "",
    mortgage_balance: data.mortgage_balance || data.mortgageBalance || "",
    smoker: data.smoker || "",
    age_range: data.age_range || data.ageRange || "",
    household_income: data.household_income || data.householdIncome || "",
    current_coverage_amount: data.current_coverage_amount || data.currentCoverageAmount || "",
    veteran_status: data.veteran_status || data.veteranStatus || "",
    cdl_status: data.cdl_status || data.cdlStatus || "",
    source: data.source || "facebook_lead",
    status: data.status || "New",
    assigned_to: data.assigned_to || data.assignedTo || "",
    notes: data.notes || ""
  };
}

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    ensureHeaders(sheet);
    var data = JSON.parse(e.postData.contents);
    var normalized = normalizePayload(data);
    var row = HEADERS.map(function(header) {
      return normalized[header] || "";
    });

    sheet.appendRow(row);
    var rowNum = sheet.getLastRow();

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
    ensureHeaders(sheet);
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

      var headerValues = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), HEADERS.length)).getValues()[0];
      var headerMap = {};
      for (var h = 0; h < headerValues.length; h++) {
        headerMap[String(headerValues[h] || "").trim().toLowerCase()] = h;
      }

      function getCell(row, key) {
        var idx = headerMap[key];
        if (idx === undefined) return "";
        return row[idx] || "";
      }

      var numRows = lastRow - startRow + 1;
      var data = sheet.getRange(startRow, 1, numRows, Math.max(sheet.getLastColumn(), HEADERS.length)).getValues();

      for (var i = 0; i < data.length; i++) {
        var row = data[i];
        leads.push({
          date: getCell(row, "date") || getCell(row, "timestamp"),
          firstName: getCell(row, "first_name") || getCell(row, "first name"),
          lastName: getCell(row, "last_name") || getCell(row, "last name"),
          email: getCell(row, "email"),
          phone: getCell(row, "phone"),
          leadType: getCell(row, "lead_type") || getCell(row, "lead type"),
          source: getCell(row, "source"),
          campaignName: getCell(row, "campaign_name") || getCell(row, "campaign"),
          city: getCell(row, "city"),
          state: getCell(row, "state"),
          zip: getCell(row, "zip"),
          birthdate: getCell(row, "birthdate"),
          homeowner: getCell(row, "homeowner"),
          coverageAmount: getCell(row, "coverage_amount"),
          status: getCell(row, "status"),
          assignedTo: getCell(row, "assigned_to"),
          notes: getCell(row, "notes"),
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
}

const SETUP_STEPS = [
  "Create one Google Sheet you own for Facebook leads",
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

  const leadType = String(req.query.leadType || "").trim().toLowerCase();
  const specificHeaders = LEAD_TYPE_HEADERS[leadType] || [];
  const headers = [...BASE_HEADERS, ...specificHeaders];
  const headerRowText = headers.join(",");

  return res.status(200).json({
    steps: SETUP_STEPS,
    appsScriptTemplate: buildAppsScriptTemplate(headers),
    headers,
    headerRowText,
  });
}
