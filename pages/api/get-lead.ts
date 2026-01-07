// pages/api/get-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import { Types } from "mongoose";

/* ---------- helpers ---------- */
function pick(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
function toNumber(val: any): number | undefined {
  if (val === undefined || val === null) return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}
function normalizeUSPhone(raw?: string): string {
  const s = String(raw || "").replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return s;
}
function last10(raw?: string): string | undefined {
  const d = String(raw || "").replace(/\D+/g, "");
  if (!d) return undefined;
  return d.slice(-10) || undefined;
}
function escRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/* -------------------------------- */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const userEmail = session?.user?.email?.toLowerCase();
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

  // Accept id OR phone OR email (all optional; at least one required)
  const id = String(req.query.id ?? "").trim();
  const phoneParam = String(req.query.phone ?? "").trim();
  const emailParam = String(req.query.email ?? "").trim();

  if (!id && !phoneParam && !emailParam) {
    return res.status(400).json({ message: "Missing id/phone/email" });
  }

  try {
    await dbConnect();

    const or: any[] = [];

    // 1) Try ObjectId when possible
    if (id && Types.ObjectId.isValid(id)) {
      or.push({ _id: id });
    }

    // 2) Treat id as possible phone if not ObjectId
    if (id && !Types.ObjectId.isValid(id)) {
      const n = normalizeUSPhone(id);
      const l10 = last10(n);
      if (l10) {
        or.push({ phoneLast10: l10 }, { Phone: new RegExp(`${l10}$`) });
      }
    }

    // 3) Explicit phone
    if (phoneParam) {
      const n = normalizeUSPhone(phoneParam);
      const l10 = last10(n);
      if (l10) {
        or.push({ phoneLast10: l10 }, { Phone: new RegExp(`${l10}$`) });
      }
    }

    // 4) Explicit email
    if (emailParam) {
      const e = emailParam.toLowerCase();
      or.push({ Email: new RegExp(`^${escRe(e)}$`, "i") }, { email: new RegExp(`^${escRe(e)}$`, "i") });
    }

    if (or.length === 0) {
      return res.status(400).json({ message: "No valid lookup parameters" });
    }

    const leadDoc: any = await Lead.findOne({ userEmail, $or: or });
    if (!leadDoc) return res.status(404).json({ message: "Lead not found" });

    /* ------- present normalized fields (but DO NOT drop custom fields) ------- */
    const firstName =
      leadDoc.firstName ?? pick(leadDoc, ["First Name", "First_Name", "First", "Given Name", "FName"]);
    const lastName =
      leadDoc.lastName ?? pick(leadDoc, ["Last Name", "Last_Name", "Last", "Surname", "LName"]);
    const phone =
      leadDoc.phone ??
      normalizeUSPhone(
        pick(leadDoc, ["phone", "Phone", "Phone Number", "Primary Phone", "Mobile", "Cell"]),
      );
    const email = leadDoc.email ?? pick(leadDoc, ["email", "Email", "Email Address"]);
    const state = leadDoc.state ?? pick(leadDoc, ["State", "ST"]);
    const age = leadDoc.age ?? toNumber(pick(leadDoc, ["Age", "Client Age"]));
    const coverageAmount =
      leadDoc.coverageAmount ??
      toNumber(pick(leadDoc, ["Coverage Amount", "Coverage", "Policy Amount", "Face Amount"]));
    const notes =
      typeof leadDoc.notes === "string" ? leadDoc.notes : pick(leadDoc, ["Notes", "Comments", "Remarks"]);
    const status = leadDoc.status || "New";
    const folderId = leadDoc.folderId ?? null;

    // History newest-first (limit 50)
    const rawHistory = Array.isArray(leadDoc.history) ? leadDoc.history : [];
    const history = [...rawHistory]
      .sort((a: any, b: any) => new Date(b?.timestamp || 0).getTime() - new Date(a?.timestamp || 0).getTime())
      .slice(0, 50)
      .map((h: any) => ({
        type: h?.type || "system",
        message: h?.message || "",
        timestamp: h?.timestamp || null,
        userEmail: h?.userEmail || null,
        meta: h?.meta || {},
      }));

    const rawInteractions = Array.isArray(leadDoc.interactionHistory) ? leadDoc.interactionHistory : [];
    const interactionHistory = [...rawInteractions]
      .sort((a: any, b: any) => new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime())
      .slice(0, 50);

    // ✅ RETURN FULL LEAD DOC so UI can show ALL imported/synced fields
    // (This does NOT change imports — only what the API returns.)
    const full = typeof leadDoc.toObject === "function" ? leadDoc.toObject() : { ...leadDoc };

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      lead: {
        ...full,
        _id: String(leadDoc._id),
        id: String(leadDoc._id),

        // normalized convenience fields (kept)
        firstName,
        lastName,
        phone,
        email,
        state,
        age,
        coverageAmount,
        notes,
        status,
        folderId: folderId ? String(folderId) : null,

        // keep these for your UI
        history,
        interactionHistory,
      },
    });
  } catch (error) {
    console.error("Get lead error:", error);
    return res.status(500).json({ message: "Server error" });
  }
}
