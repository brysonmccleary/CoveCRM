// /pages/api/cron/sync-google-sheets.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import DripCampaign from "@/models/DripCampaign";
import { sendSMS } from "@/lib/twilio/sendSMS";
import { google } from "googleapis";
import { ObjectId } from "mongodb";
import {
  renderTemplate,
  ensureOptOut,
  splitName,
} from "@/utils/renderTemplate";

function getFirstStepText(drip: any): string | null {
  const steps = Array.isArray(drip?.steps) ? [...drip.steps] : [];
  if (!steps.length) return null;
  steps.sort(
    (a: any, b: any) =>
      (parseInt(a?.day ?? "0", 10) || 0) - (parseInt(b?.day ?? "0", 10) || 0),
  );
  const text = steps[0]?.text?.trim?.();
  return text || null;
}

function normalizeToE164Maybe(phone?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  const just = digits.replace(/\D/g, "");
  if (just.length === 10) return `+1${just}`;
  if (just.length === 11 && just.startsWith("1")) return `+${just}`;
  return null;
}

async function runBatched<T>(
  items: T[],
  batchSize: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let i = 0;
  while (i < items.length) {
    const batch = items.slice(i, i + batchSize);
    await Promise.allSettled(batch.map((item, idx) => worker(item, i + idx)));
    i += batchSize;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await dbConnect();

    // Pull users who have Google Sheets refresh tokens configured
    const users = await User.find({
      "googleSheets.refreshToken": { $exists: true },
    }).select({ email: 1, name: 1, googleSheets: 1 });

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      process.env.GOOGLE_REDIRECT_URI!,
    );

    let imported = 0;
    let smsSent = 0;
    let smsFailed = 0;

    for (const user of users) {
      try {
        const configs = (user.googleSheets as any)?.syncedSheets || [];
        if (!configs.length) continue;

        oauth2Client.setCredentials({
          refresh_token: (user.googleSheets as any)!.refreshToken,
        });

        const sheets = google.sheets({ version: "v4", auth: oauth2Client });

        // Prepare agent context once per user
        const agentNameRaw = user.name || "";
        const { first: agentFirst, last: agentLast } = splitName(agentNameRaw);
        const agentCtx = {
          name: agentNameRaw || null,
          first_name: agentFirst,
          last_name: agentLast,
        };

        for (const cfg of configs) {
          if (!cfg.sheetId) continue;

          // Resolve mapped folder
          let folder: any = null;
          if (cfg.folderId) {
            folder = await Folder.findOne({
              _id: new ObjectId(cfg.folderId),
              userEmail: user.email,
            });
          }
          if (!folder && cfg.sheetName) {
            folder = await Folder.findOne({
              name: cfg.sheetName,
              userEmail: user.email,
            });
          }
          if (!folder) continue;

          const response = await sheets.spreadsheets.values.get({
            spreadsheetId: cfg.sheetId,
            range: "A1:Z1000",
          });

          const rows = response.data.values;
          if (!rows || rows.length < 2) continue;

          const headers = rows[0].map((h) => String(h || "").trim());
          const dataRows = rows.slice(1);

          const map: Record<string, string> = {
            "first name": "First Name",
            firstname: "First Name",
            "last name": "Last Name",
            lastname: "Last Name",
            email: "Email",
            phone: "Phone",
            phone1: "Phone",
            phone_number: "Phone",
            state: "State",
            notes: "Notes",
            age: "Age",
            beneficiary: "Beneficiary",
            "coverage amount": "Coverage Amount",
          };

          for (const row of dataRows) {
            const rowObj: Record<string, string> = {};
            headers.forEach((h, i) => {
              const key = map[h.toLowerCase()];
              if (key) rowObj[key] = String(row[i] || "").trim();
            });

            const phone = normalizeToE164Maybe(rowObj["Phone"]);
            const emailLower = rowObj["Email"]?.toLowerCase?.();

            // De-dupe by Phone (preferred) or Email
            const exists = await Lead.findOne(
              phone
                ? { userEmail: user.email, Phone: phone }
                : emailLower
                  ? { userEmail: user.email, Email: emailLower }
                  : { _id: null },
            ).lean();
            if (exists) continue;

            // Pull folder's assigned drips NOW so we persist on the new lead
            const folderAssignedDrips: string[] = Array.isArray(
              folder.assignedDrips,
            )
              ? folder.assignedDrips
              : [];

            const newLead = await Lead.create({
              State: rowObj["State"] || "",
              "First Name": rowObj["First Name"] || "",
              "Last Name": rowObj["Last Name"] || "",
              Email: emailLower || "",
              Phone: phone || "",
              Notes: rowObj["Notes"] || "",
              Age: rowObj["Age"] || "",
              Beneficiary: rowObj["Beneficiary"] || "",
              "Coverage Amount": rowObj["Coverage Amount"] || "",
              userEmail: user.email,
              folderId: folder._id,
              status: "New",
              assignedDrips: folderAssignedDrips, // ✅ persist for scheduler
            });

            imported++;

            // Enroll & send first step for each assigned drip
            if (
              folderAssignedDrips.length &&
              newLead.Phone &&
              !newLead.unsubscribed
            ) {
              const to = normalizeToE164Maybe(newLead.Phone);
              if (to) {
                await runBatched(folderAssignedDrips, 3, async (dripId) => {
                  try {
                    const drip = await DripCampaign.findById(dripId).lean();
                    if (!drip || drip.type !== "sms") return;

                    const firstTextRaw = getFirstStepText(drip);
                    if (!firstTextRaw) return;

                    // Safety: don't send a raw opt-out keyword as a message
                    const lower = firstTextRaw.toLowerCase();
                    const optOutKeywords = [
                      "stop",
                      "unsubscribe",
                      "end",
                      "quit",
                      "cancel",
                    ];
                    if (optOutKeywords.includes(lower)) return;

                    // Build contact context from the lead we just created
                    const firstName = (newLead as any)["First Name"] || null;
                    const lastName = (newLead as any)["Last Name"] || null;
                    const fullName =
                      [firstName, lastName]
                        .filter((x) => x && String(x).trim().length > 0)
                        .join(" ") || null;

                    // Render + ensure opt-out
                    const rendered = renderTemplate(firstTextRaw, {
                      contact: {
                        first_name: firstName,
                        last_name: lastName,
                        full_name: fullName,
                      },
                      agent: agentCtx,
                    });

                    const finalBody = ensureOptOut(rendered);

                    await sendSMS(to, finalBody, user._id.toString());

                    // ✅ Initialize dripProgress for this drip (Day 1 was sent -> index 0)
                    const canonicalDripId = String(
                      (drip as any)?._id || dripId,
                    );
                    const now = new Date();

                    const matched = await Lead.updateOne(
                      {
                        _id: newLead._id,
                        "dripProgress.dripId": canonicalDripId,
                      },
                      {
                        $set: {
                          "dripProgress.$.startedAt": now,
                          "dripProgress.$.lastSentIndex": 0,
                        },
                      },
                    );

                    if (matched.matchedCount === 0) {
                      await Lead.updateOne(
                        { _id: newLead._id },
                        {
                          $push: {
                            dripProgress: {
                              dripId: canonicalDripId,
                              startedAt: now,
                              lastSentIndex: 0,
                            },
                          },
                        },
                      );
                    }

                    smsSent++;
                  } catch (e) {
                    console.error("Immediate drip send failed:", e);
                    smsFailed++;
                  }
                });
              }
            }
          }
        }
      } catch (err) {
        console.error(`❌ Error syncing ${user.email}:`, err);
      }
    }

    return res
      .status(200)
      .json({
        message: "Google Sheets sync complete",
        imported,
        smsSent,
        smsFailed,
      });
  } catch (error) {
    console.error("❌ Cron sync error:", error);
    return res.status(500).json({ message: "Server error" });
  }
}
