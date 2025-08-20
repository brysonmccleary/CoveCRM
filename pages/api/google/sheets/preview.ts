// /pages/api/google/sheets/preview.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { google } from "googleapis";

type PreviewBody = {
  spreadsheetId: string;
  title?: string;        // sheet/tab title
  sheetId?: number;      // optional if you prefer using sheetId
  headerRow?: number;    // 1-based, default 1
  sampleOffset?: number; // default 1 (first row after header)
};

function escapeA1Title(title: string) {
  // A1 notation: single quotes inside sheet names are doubled
  return title.replace(/'/g, "''");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { spreadsheetId, title, sheetId, headerRow = 1, sampleOffset = 1 } =
    (req.body || {}) as PreviewBody;

  if (!spreadsheetId) return res.status(400).json({ error: "Missing spreadsheetId" });
  if (!title && typeof sheetId !== "number")
    return res.status(400).json({ error: "Provide title or sheetId" });

  await dbConnect();
  const user = await User.findOne({ email: session.user.email.toLowerCase() }).lean<any>();
  const gs = user?.googleSheets || user?.googleTokens;
  if (!gs?.refreshToken) return res.status(400).json({ error: "Google not connected" });

  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    `https://${req.headers["x-forwarded-host"] || req.headers.host}`;

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI_SHEETS ||
    `${base}/api/connect/google-sheets/callback`;

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri
  );
  oauth2.setCredentials({
    access_token: gs.accessToken,
    refresh_token: gs.refreshToken,
    expiry_date: gs.expiryDate,
  });

  const sheets = google.sheets({ version: "v4", auth: oauth2 });

  try {
    let tabTitle = title;

    // Resolve title from sheetId if needed
    if (!tabTitle && typeof sheetId === "number") {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(sheetId,title))",
      });
      const found = (meta.data.sheets || []).find(
        (s) => s.properties?.sheetId === sheetId
      );
      tabTitle = found?.properties?.title || undefined;
      if (!tabTitle) return res.status(400).json({ error: "sheetId not found" });
    }

    const safeTitle = escapeA1Title(tabTitle!);

    // Pull values (A1:ZZ to be safe)
    const valueResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${safeTitle}'!A1:ZZ`,
      majorDimension: "ROWS",
    });

    const values = (valueResp.data.values || []) as string[][];
    if (!values.length) {
      return res.status(200).json({
        headers: [],
        sampleRow: {},
        sampleRows: [] as string[][],
        rowCount: 0,
        headerRow,
        title: tabTitle,
      });
    }

    // headerRow is 1-based; convert to 0-based index
    const headerIdx = Math.max(0, headerRow - 1);
    const headers = (values[headerIdx] || []).map((h) => String(h || "").trim());

    // first non-empty row after headerIdx
    let sampleRowIndex = headerIdx + sampleOffset;
    while (sampleRowIndex < values.length) {
      const row = values[sampleRowIndex];
      const hasAny = row?.some((cell) => String(cell || "").trim() !== "");
      if (hasAny) break;
      sampleRowIndex++;
    }

    const row = values[sampleRowIndex] || [];
    const sampleRow: Record<string, any> = {};
    headers.forEach((h, i) => {
      if (!h) return;
      sampleRow[h] = row[i] ?? "";
    });

    // also return up to 5 example rows (for nicer preview UIs)
    const sampleRows: string[][] = [];
    for (let i = headerIdx + 1; i < Math.min(values.length, headerIdx + 6); i++) {
      sampleRows.push(values[i] || []);
    }

    return res.status(200).json({
      headers,
      sampleRow,
      sampleRows,
      rowCount: values.length,
      headerRow,
      title: tabTitle,
    });
  } catch (err: any) {
    const message = err?.errors?.[0]?.message || err?.message || "Sheets preview failed";
    return res.status(500).json({ error: message });
  }
}
