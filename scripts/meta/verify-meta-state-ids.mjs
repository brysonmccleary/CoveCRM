const TOKEN = process.env.META_ACCESS_TOKEN;

if (!TOKEN) {
  console.error("Missing META_ACCESS_TOKEN");
  process.exit(1);
}

const STATES = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],
  ["CA","California"],["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],
  ["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],
  ["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],
  ["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],
  ["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],
  ["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],
  ["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],
  ["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],
  ["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],
  ["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],
  ["VT","Vermont"],["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],
  ["WI","Wisconsin"],["WY","Wyoming"]
];

async function lookupState(code, name) {
  const url = new URL("https://graph.facebook.com/v25.0/search");
  url.searchParams.set("type", "adgeolocation");
  url.searchParams.set("q", name);
  url.searchParams.set("location_types", '["region"]');
  url.searchParams.set("access_token", TOKEN);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${name}: HTTP ${res.status}`);
  }

  const json = await res.json();
  const match = (json.data || []).find(
    (item) =>
      item?.type === "region" &&
      item?.country_code === "US" &&
      String(item?.name || "").toLowerCase() === name.toLowerCase()
  );

  if (!match) {
    return { code, name, key: null, raw: json.data || [] };
  }

  return { code, name, key: String(match.key) };
}

const out = {};
const missing = [];

for (const [code, name] of STATES) {
  try {
    const result = await lookupState(code, name);
    if (result.key) {
      out[code] = result.key;
      console.log(`${code} ${name} -> ${result.key}`);
    } else {
      missing.push(result);
      console.log(`${code} ${name} -> MISSING`);
    }
  } catch (err) {
    missing.push({ code, name, error: String(err) });
    console.log(`${code} ${name} -> ERROR ${String(err)}`);
  }
}

console.log("\nFINAL MAP:");
console.log(JSON.stringify(out, null, 2));

if (missing.length) {
  console.log("\nMISSING_OR_ERROR:");
  console.log(JSON.stringify(missing, null, 2));
  process.exitCode = 2;
}
