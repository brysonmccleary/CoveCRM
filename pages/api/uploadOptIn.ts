// /pages/api/uploadOptIn.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { IncomingForm } from "formidable";
import type { File as FormidableFile } from "formidable";
import fs from "fs";
import path from "path";

// Disable default bodyParser to allow formidable to handle it
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const uploadDir = path.join(process.cwd(), "/public/uploads");

  // Ensure directory exists
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const form = new IncomingForm({
    uploadDir,
    keepExtensions: true,
    maxFileSize: 5 * 1024 * 1024, // 5 MB limit
  });

  form.parse(req, async (err, _fields, files) => {
    if (err) {
      console.error("Form parse error:", err);
      return res.status(500).json({ message: "File upload error" });
    }

    // "file" can be a single File or File[]
    const fileField = (files as any).file as FormidableFile | FormidableFile[] | undefined;
    const file: FormidableFile | undefined = Array.isArray(fileField)
      ? fileField[0]
      : fileField;

    if (!file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const fileName = path.basename((file as FormidableFile).filepath);
    const fileUrl = `/uploads/${fileName}`;

    return res.status(200).json({ message: "File uploaded", url: fileUrl });
  });
}
