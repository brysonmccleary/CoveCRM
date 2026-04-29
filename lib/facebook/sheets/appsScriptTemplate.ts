import { getCanonicalHeaders } from "./sheetHeaders";

export function buildAppsScriptTemplate(leadType: string) {
  const headers = getCanonicalHeaders(leadType);
  return `// CoveCRM Facebook Campaign Leads — Google Apps Script
// 1) Paste the exact CoveCRM header row into row 1 of your blank sheet.
// 2) Paste this script into Apps Script.
// 3) Deploy as Web App. Execute as: Me. Access: Anyone.

var HEADERS = ${JSON.stringify(headers, null, 2)};

function jsonOutput(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\\s+/g, " ").trim();
}

function ensureHeaders(sheet) {
  var width = Math.max(sheet.getLastColumn(), HEADERS.length);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    return HEADERS;
  }
  var firstRow = sheet.getRange(1, 1, 1, width).getValues()[0];
  var hasHeaders = firstRow.some(function(cell) { return String(cell || "").trim() !== ""; });
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    return HEADERS;
  }
  return firstRow.map(function(cell) { return String(cell || "").trim(); }).filter(String);
}

function synonymValue(data, header) {
  var keys = {
    "Phone": ["Phone", "phone", "phoneNumber", "Mobile"],
    "Mobile": ["Mobile", "mobile", "phone", "Phone"],
    "Date Of Birth": ["Date Of Birth", "DOB", "dob", "dateOfBirth", "birthdate"],
    "DOB": ["DOB", "Date Of Birth", "dob", "dateOfBirth", "birthdate"],
    "ZIP Code": ["ZIP Code", "Zip", "zip", "zipCode", "postalCode"],
    "Zip": ["Zip", "ZIP Code", "zip", "zipCode", "postalCode"]
  }[header] || [header];
  for (var i = 0; i < keys.length; i++) {
    var value = data[keys[i]];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var actualHeaders = ensureHeaders(sheet);
    var data = JSON.parse((e.postData && e.postData.contents) || "{}");
    var row = HEADERS.map(function(header) {
      return synonymValue(data, header);
    });
    sheet.appendRow(row);
    return jsonOutput({ ok: true, row: sheet.getLastRow() });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var headers = ensureHeaders(sheet);
    var action = e && e.parameter ? e.parameter.action : "";
    if (action === "headers" || action === "health") {
      return jsonOutput({ ok: true, status: "active", headers: headers, expectedHeaders: HEADERS });
    }
    if (action === "getLeads") {
      var lastRow = sheet.getLastRow();
      var startRow = Math.max(2, parseInt(e.parameter.sinceRow || "1", 10) + 1);
      if (startRow > lastRow) return jsonOutput({ ok: true, leads: [], lastRow: lastRow });
      var width = Math.max(sheet.getLastColumn(), HEADERS.length);
      var headerRow = sheet.getRange(1, 1, 1, width).getValues()[0];
      var data = sheet.getRange(startRow, 1, lastRow - startRow + 1, width).getValues();
      var leads = data.map(function(row, idx) {
        var out = { rowNumber: startRow + idx };
        for (var i = 0; i < headerRow.length; i++) {
          var key = String(headerRow[i] || "").trim();
          if (key) out[key] = row[i] || "";
        }
        return out;
      });
      return jsonOutput({ ok: true, leads: leads, lastRow: lastRow });
    }
    return jsonOutput({ ok: true, status: "CoveCRM Apps Script active", headers: headers });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}`;
}
