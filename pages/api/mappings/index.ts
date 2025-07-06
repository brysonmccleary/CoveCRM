import dbConnect from "@/lib/dbConnect";
import Mapping from "@/models/Mapping";

import type { NextApiRequest, NextApiResponse } from "next";
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await dbConnect();

  if (req.method === "GET") {
    const mappings = await Mapping.find({});
    res.status(200).json(mappings);
  } else if (req.method === "POST") {
    const { name, fields } = req.body;
    const mapping = await Mapping.create({ name, fields });
    res.status(201).json(mapping);
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
}

