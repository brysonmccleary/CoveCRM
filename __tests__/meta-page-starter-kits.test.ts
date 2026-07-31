import {
  FACEBOOK_PAGE_MARKETS,
  FACEBOOK_PAGE_STARTER_VARIETY,
  allFacebookPageNames,
  getFacebookPageStarterOption,
  marketForLeadType,
} from "@/lib/facebook/pageStarterKits";
import {
  buildFacebookPageLogoSvg,
  facebookPageLogoDataUrl,
} from "@/lib/facebook/pageStarterLogos";

describe("Meta Page starter kits", () => {
  test("covers every supported insurance lead type", () => {
    expect(marketForLeadType("final_expense")).toBe("final_expense");
    expect(marketForLeadType("mortgage_protection")).toBe("mortgage_protection");
    expect(marketForLeadType("iul")).toBe("iul");
    expect(marketForLeadType("veteran")).toBe("veteran");
    expect(marketForLeadType("trucker")).toBe("trucker");
  });

  test("ships a large, non-duplicated curated name library", () => {
    const names = allFacebookPageNames();
    expect(names).toHaveLength(60);
    expect(new Set(names).size).toBe(names.length);
    expect(FACEBOOK_PAGE_STARTER_VARIETY).toBeGreaterThanOrEqual(480);
  });

  test("provides ten different starter names for every market", () => {
    for (const market of FACEBOOK_PAGE_MARKETS) {
      const options = Array.from({ length: 10 }, (_, seed) =>
        getFacebookPageStarterOption(market.id, seed),
      );
      expect(new Set(options.map((option) => option.name)).size).toBe(10);
      expect(options.every((option) => option.category === "Insurance Broker")).toBe(true);
      expect(options.every((option) => option.bio.length >= 80)).toBe(true);
    }
  });

  test("generates self-contained, square, name-aware logo artwork", () => {
    for (const market of FACEBOOK_PAGE_MARKETS) {
      for (let seed = 0; seed < 8; seed += 1) {
        const option = getFacebookPageStarterOption(market.id, seed, seed);
        const svg = buildFacebookPageLogoSvg(option.logoStyleId, option.paletteId, option.name);
        expect(svg).toContain('width="1024"');
        expect(svg).toContain('height="1024"');
        expect(svg).toContain('viewBox="0 0 1024 1024"');
        expect(svg).toContain("<text");
        expect(svg).toContain("font-family");
        expect(svg).not.toMatch(/<image|\shref=/);
        expect(facebookPageLogoDataUrl(option.logoStyleId, option.paletteId, option.name)).toMatch(/^data:image\/svg\+xml/);
      }
    }
  });
});
