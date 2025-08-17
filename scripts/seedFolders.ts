require("dotenv").config({ path: ".env.local" });

const dbConnect = require("../dbConnect").default;
const Folder = require("../models/Folder").default;

async function seedFolders() {
  await dbConnect();

  const folders = [
    { name: "Mortgage Leads 7/1" },
    { name: "Veteran Leads 7/15" },
    { name: "Final Expense Leads" },
    { name: "IUL Leads" },
  ];

  for (const folder of folders) {
    await Folder.create(folder);
  }

  console.log("✅ Folders seeded");
  process.exit();
}

seedFolders();

