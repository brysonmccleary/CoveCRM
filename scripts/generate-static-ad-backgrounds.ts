// scripts/generate-static-ad-backgrounds.ts
//
// One-time generation of a fixed pool of ad background photos per lead type.
// These are generated ONCE and committed as static files; the app never calls
// OpenAI per-ad again (see AdPreviewCard.tsx getCreativeBackground). Run with:
//   OPENAI_API_KEY=... npx tsx scripts/generate-static-ad-backgrounds.ts
//
import fs from "fs";
import path from "path";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PROMPTS: Record<string, string[]> = {
  trucker: [
    "three large commercial semi trucks on a dark American highway at night, dramatic neon amber and cyan lighting, wide cinematic shot, no logos or readable text on trucks, no people",
    "a professional semi truck on an open American highway at dusk, dark dramatic sky, warm amber glow lighting, powerful low-angle composition, no logos, no people",
    "red white and blue semi trucks driving in formation on an American highway, a large American flag waving in the background, dramatic patriotic sky, no logos, no readable text",
    "a semi truck on an open American highway with a large American flag waving in the background, rugged Americana feel, red white and blue color palette, golden hour lighting, no logos",
    "a professional semi truck driving on a scenic mountain highway at sunset, warm amber tones, vast open American landscape, cinematic wide shot, no logos",
    "a commercial semi truck on a Route 66 style American highway, vintage roadside diner and neon signs in the background, rugged Americana feel, warm nostalgic lighting, no logos",
    "a professional CDL truck driver standing confidently beside his semi truck on the open highway, rugged determined expression, golden hour lighting, no logos, no readable text",
    "a semi truck on a wide open American highway, dramatic high-contrast lighting, storm clouds gathering on the horizon, powerful composition, no logos",
    "a semi truck parked at a scenic highway overlook at sunset, blue and amber color grading, calm reflective mood, no logos, no people",
    "three commercial semi trucks driving on a snow-covered American highway at dusk, pine trees along the roadside, cool blue winter light mixed with warm headlight glow, cinematic wide shot, no logos",
    "a semi truck emerging from thick early morning fog on a highway, cool grey-blue tones, moody atmosphere, no logos",
    "a semi truck on a desert highway at high noon, heat-shimmer haze, red rock formations in the background, no logos",
    "a semi truck merging onto a highway overpass with a city skyline glowing at dusk behind it, urban neon tones, no logos",
    "a semi truck parked outside a neon-lit roadside diner at night, warm glow, cinematic Americana mood, no logos, no readable signage",
    "a semi truck on a coastal highway with the ocean visible at golden hour, warm cinematic light, no logos",
    "a semi truck driving down a highway lined with orange and red autumn trees, warm fall light, no logos",
    "two semi trucks driving side by side on a wide interstate, dramatic motion-blurred background, powerful composition, no logos",
    "a semi truck crossing a large suspension bridge at dusk with city lights glowing beyond, cinematic wide shot, no logos",
    "a semi truck parked at a scenic canyon overlook, vast dramatic landscape, warm late-afternoon light, no logos, no people",
    "a semi truck under a full moon on a midnight highway, silver moonlight glinting off the chrome, no logos",
    "a semi truck driving straight toward camera on a long desert road, heat mirage effect, dramatic wide shot, no logos",
    "a semi truck on a rainy highway at dusk, wet reflective road surface, headlights cutting through the rain, no logos",
    "a semi truck near a weigh-station entrance sign at soft early morning light, no logos, no readable text on signage",
    "a high-angle view of a semi truck winding along a mountain pass road, dramatic scale, no logos",
    "a semi truck driving past oil rigs on an industrial energy field at sunset, warm orange tones, no logos",
    "three semi trucks crossing a plains highway with wind turbines in the background, wide cinematic shot, no logos",
    "a semi truck parked overnight at a truck stop under warm string lights, cozy Americana atmosphere, no logos",
    "a dramatic low-angle hero shot of a semi truck's grille and wheels, studio-style lighting, no logos, no readable text",
    "a semi truck on a coastal cliffside road with dramatic ocean cliffs and an overcast moody sky, no logos",
    "a bright red semi truck on a clean highway under a vivid blue sky, crisp patriotic clean look, no logos",
    "a semi truck driving through a small American town's main street at dusk with string lights overhead, no logos",
    "a semi truck at a border-crossing style checkpoint with flags visible, warm golden light, no logos, no readable signage",
    "a semi truck on a highway at night with dramatic lightning visible in the distant storm sky, no logos",
    "a semi truck parked at a scenic vista point overlooking a valley at sunrise, no logos, no people",
    "a semi truck at a snowy truck stop with snow falling and warm cab lights glowing, cozy winter mood, no logos",
    "a semi truck driving beneath a large American flag draped over a highway overpass, dramatic wide shot, no logos",
    "a semi truck on a Route 66 style desert highway with cactus silhouettes and a deep orange sunset, no logos",
    "an extreme wide aerial-style shot of a tiny semi truck on a vast empty highway at dusk, dramatic sense of scale, no logos",
    "a semi truck at golden hour with dramatic sun flare behind it, cinematic composition, no logos",
    "a semi truck parked beside a large painted American flag mural on a building wall, warm daylight, no logos",
  ],
  veteran: [
    "a veteran-aged civilian man in his 60s standing proudly in front of a softly blurred American flag, warm patriotic lighting, realistic photography, civilian clothing only, no military uniform, no insignia, no text",
    "a weathered distressed American flag texture background, dramatic warm lighting, patriotic mood, no people, no text, no official seals",
    "a veteran-aged civilian man silhouette against a glowing American flag backdrop at dusk, navy and gold tones, realistic photography, no uniform, no insignia",
    "a proud veteran-aged civilian man in casual clothing standing on a home porch at golden hour, a small American flag visible nearby, warm realistic photography, no uniform, no family, no insignia",
    "an American flag waving against a dramatic sunset sky, cinematic wide shot, no people, no text, no official seals",
    "a veteran-aged civilian couple's hands clasped together, wedding ring visible, warm intimate lighting, realistic photography, no faces, no uniforms, emotionally resonant",
    "a veteran-aged civilian man in casual clothing with a determined dignified expression, soft American flag bokeh in the background, warm realistic photography, no uniform, no insignia",
    "a quiet American small-town street at golden hour with flags on porches, warm nostalgic Americana mood, no people, no text",
    "a veteran-aged civilian man standing in front of a modest American home, small flag by the door, warm afternoon light, realistic photography, no uniform, no family, no insignia",
    "a folded American flag resting on a wooden table in warm window light, quiet dignified mood, realistic photography, no people, no text, no official seals",
    "an elderly veteran-aged civilian man fishing at a quiet lake at sunrise, peaceful mood, small American flag on a nearby dock post, no uniform",
    "a weathered wooden porch with a rocking chair and a small American flag, warm autumn light, no people",
    "a veteran-aged civilian man's hands holding a folded flag, close-up, warm light, no face, no uniform",
    "rolling green hills with a single flagpole and flag at sunset, cinematic wide shot, no people",
    "a veteran-aged civilian man standing at a fence line on a rural property, flag visible in the distance, warm light, no uniform",
    "a close-up of an American flag pin on a civilian lapel, shallow depth of field, warm tones, no insignia",
    "a veteran-aged civilian man walking a dog on a quiet street lined with flags on porches, golden hour, no uniform",
    "dramatic clouds parting over an American flag at dusk, cinematic sky, no people",
    "a veteran-aged civilian couple's hands intertwined on a porch railing, warm evening light, no faces, no uniforms",
    "an old barn with a large American flag painted on the side, rural American countryside, warm light, no people",
    "a veteran-aged civilian man in a flannel shirt sitting on porch steps, contemplative mood, flag nearby, no uniform, no direct eye contact",
    "sunrise over a quiet respectful American memorial park with flags, dignified mood, no readable names, no people",
    "a veteran-aged civilian man's weathered hands resting on a wooden cane, flag softly blurred in the background, no uniform",
    "a small town main street decorated with American flags, warm daylight, no crowd faces, no uniforms",
    "a lake house dock at sunset with an American flag waving, peaceful Americana mood, no people",
    "a veteran-aged civilian man standing in the doorway of a modest home, flag visible outside, warm interior light, no uniform",
    "a close-up of dog tags resting on a wooden table next to a folded American flag, warm light, no people",
    "a veteran-aged civilian man walking along a rural road at golden hour, flag on a mailbox post, no uniform",
    "an eagle silhouette against a flag-colored sunset sky, patriotic symbolism, no text, no people",
    "a veteran-aged civilian man's profile silhouette against a bright sunset sky, dignified mood, no uniform",
    "a quiet veterans hall exterior at dusk with American flags out front, no readable signage, no people",
    "a rustic farmhouse porch with an American flag quilt draped over the railing, warm light, no people",
    "a veteran-aged civilian man tending a small garden, small flag on a post nearby, peaceful daily life, no uniform",
    "storm clouds breaking to reveal warm sunlight over an American flag on a hilltop, cinematic mood, no people",
    "a pair of weathered work boots by a front door with an American flag visible through a window, warm interior light, no people",
    "a veteran-aged civilian man reading on a porch at sunset, flag gently waving nearby, no uniform",
    "an aerial-style view of a small American town with flags on many porches, golden hour, no people",
    "a close-up of a weathered civilian hand resting on a flag-draped table, dignified mood, no uniform",
    "a lighthouse with an American flag at sunset, coastal Americana mood, no people",
    "a veteran-aged civilian man standing by a pickup truck in a driveway, American flag on the porch behind him, warm dusk light, no uniform",
  ],
  mortgage_protection: [
    "a clean modern house silhouette with a house key, red white and navy color palette, minimal graphic poster composition, no people, no text, no logos",
    "a red and white suburban home exterior illustration, clean flat graphic style, warm afternoon lighting, no people, no text",
    "a modern house icon with a protective shield overlay, navy and gold color palette, premium clean graphic composition, no people, no text",
    "a cozy suburban home exterior at golden hour, warm inviting lighting, clean realistic photography, no people visible, no text",
    "a house key resting on a stack of documents on a wooden table, warm natural window light, shallow depth of field, no people, no text, no logos",
    "a happy young couple standing together in front of their suburban home, warm natural sunlight, candid realistic photography, genuine smiles, no text overlay",
    "a smiling couple embracing playfully in their bright living room, warm cozy natural lighting, candid realistic photography, no text",
    "a young family of four standing together in front of their home, warm golden hour lighting, genuine candid moment, realistic photography, no text overlay",
    "a couple unpacking moving boxes in their new living room, warm natural light, joyful candid moment, realistic photography, no text",
    "a smiling couple sitting on their porch steps together at sunset, warm relaxed mood, realistic photography, no text overlay",
    "a young family playing together in the front yard of their home, warm afternoon light, candid realistic photography, no text",
    "a couple reviewing paperwork together at their kitchen table, warm natural light, genuine candid moment, no text",
    "a charming home exterior with a yard sign silhouette in front, warm daylight, no readable text, no people",
    "a couple holding hands walking up to their new front door, warm golden hour light, candid moment, no text",
    "a cozy living room interior with a fireplace, warm and inviting, no people, no text",
    "a family carrying moving boxes into a new home, joyful candid energy, warm light, no text",
    "a close-up of a house key being handed from one hand to another, warm light, no text",
    "a suburban street lined with charming homes at golden hour, no people, no text",
    "a couple laughing together in their backyard, warm natural light, candid realistic photography, no text",
    "a modern farmhouse-style home exterior at dusk with warm porch lights glowing, no people",
    "a family of four having a picnic on their front lawn, warm afternoon light, candid moment, no text",
    "a small model house resting on a stack of coins, close-up, financial security concept, no text",
    "a couple painting a room together in their new home, joyful candid moment, warm light, no text",
    "a cute suburban home with a white picket fence, warm morning light, no people, no text",
    "a couple looking over house blueprints together at a table, warm light, candid moment, no text",
    "a cozy front porch with rocking chairs and warm string lights, evening mood, no people",
    "a couple standing arm in arm in their driveway, warm golden hour light, candid moment, no text",
    "a house key and a small wooden house model resting on a rustic table, warm window light, no text",
    "a newly renovated bright modern kitchen interior, warm light, no people, no text",
    "a couple celebrating with a toast in their new home, candid joyful moment, warm light, no text",
    "a charming brick townhome exterior at golden hour, no people, no text",
    "a family walking their dog in front of their home, warm afternoon light, candid moment, no text",
    "a couple sitting on their front steps together looking at a laptop, warm light, candid moment, no text",
    "a cozy bedroom with warm morning light streaming through the window, no people, no text",
    "a close-up of a hand signing paperwork with a small house-shaped keychain nearby, warm light, no text",
    "a modern suburban home exterior with a manicured lawn, warm daylight, no people, no text",
    "a couple hugging amid moving boxes in their new home, candid joyful moment, warm light, no text",
    "a home exterior at blue hour with warm lights glowing from inside the windows, no people",
    "a family of four walking hand in hand toward their front door, warm dusk light, candid moment, no text",
    "a close-up of house keys on a ring resting on a sunlit windowsill, warm afternoon light, no text",
  ],
};

const SUFFIX =
  " -- direct-response Facebook ad background, poster composition with clear open space near the top and bottom for overlaid headline and button text, high quality, no watermark";

async function generateOne(leadType: string, index: number, prompt: string) {
  const dir = path.join(__dirname, "..", "public", "ad-backgrounds", leadType);
  const pngPath = path.join(dir, `${index + 1}.png`);
  const jpgPath = path.join(dir, `${index + 1}.jpg`);
  if (fs.existsSync(pngPath) || fs.existsSync(jpgPath)) {
    console.log(`skip (exists): ${leadType}/${index + 1}`);
    return;
  }
  const img = await openai.images.generate({
    model: "gpt-image-1",
    prompt: prompt + SUFFIX,
    size: "1536x1024",
  });
  const item = img.data?.[0];
  let buffer: Buffer;
  if (item?.b64_json) {
    buffer = Buffer.from(item.b64_json, "base64");
  } else if (item?.url) {
    const res = await fetch(item.url);
    buffer = Buffer.from(await res.arrayBuffer());
  } else {
    throw new Error(`No image data returned for ${leadType}/${index + 1}`);
  }
  fs.writeFileSync(pngPath, buffer);
  console.log(`saved: ${leadType}/${index + 1}.png`);
}

async function main() {
  for (const [leadType, prompts] of Object.entries(PROMPTS)) {
    for (let i = 0; i < prompts.length; i++) {
      await generateOne(leadType, i, prompts[i]);
    }
  }
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
