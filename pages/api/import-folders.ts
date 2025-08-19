import type { NextApiRequest, NextApiResponse } from "next";
import formidable from "formidable";
import fs from "fs";
import csvParser from "csv-parser";
import { Readable } from "stream";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";

export const config = {
  api: { bodyParser: false },
};

function bufferToStream(buffer: Buffer): Readable {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const userEmail = session.user.email as string;

  await dbConnect();

  const form = formidable({ multiples: false, keepExtensions: true });

  form.parse(req, async (err, _fields, files) => {
    if (err) {
      console.error("❌ Formidable parse error:", err);
      return res.status(500).json({ message: "Error parsing form" });
    }

    const file = Array.isArray(files.file) ? files.file[0] : (files.file as any);

    if (!file || !file.filepath) {
      return res.status(400).json({ message: "CSV file missing" });
    }

    try {
      const buffer = await fs.promises.readFile(file.filepath);
      const rows: any[] = [];

      bufferToStream(buffer)
        .pipe(csvParser())
        .on("data", (row) => {
          const clean = Object.entries(row).reduce(
            (acc, [key, value]) => {
              acc[String(key).trim()] = String(value ?? "").trim();
              return acc;
            },
            {} as Record<string, string>,
          );
          rows.push(clean);
        })
        .on("end", async () => {
          try {
            const folders = rows.map((row) => ({
              name: row["Folder Name"] || "Unnamed",
              userEmail,
              assignedDrips: [] as string[],
            }));

            await Folder.insertMany(folders);
            return res
              .status(200)
              .json({ message: "Folders imported", count: folders.length });
          } catch (insertError) {
            console.error("❌ DB insert failed:", insertError);
            return res
              .status(500)
              .json({ message: "Failed to insert folders" });
          }
        })
        .on("error", (csvErr) => {
          console.error("❌ CSV parse failed:", csvErr);
          return res.status(500).json({ message: "CSV parse error" });
        });
    } catch (fileErr) {
      console.error("❌ File read failed:", fileErr);
      return res.status(500).json({ message: "Could not read file" });
    }
  });
}
