import { normalizeMetaPixelId, trackMetaLead, trackMetaPageView } from "@/lib/meta/browserPixel";

describe("hosted funnel Meta browser events", () => {
  const priorWindow = (global as any).window;
  const priorDocument = (global as any).document;

  afterEach(() => {
    (global as any).window = priorWindow;
    (global as any).document = priorDocument;
  });

  test("loads the configured Pixel and fires PageView then a deduplicated Lead", () => {
    const appended: any[] = [];
    (global as any).window = {};
    (global as any).document = {
      createElement: jest.fn().mockReturnValue({}),
      head: { appendChild: jest.fn((node) => appended.push(node)) },
    };
    expect(trackMetaPageView("725252660577483")).toBe(true);
    expect(trackMetaLead("725252660577483", "shared-submission-event")).toBe(true);
    expect((global as any).window.fbq.queue).toEqual([
      ["init", "725252660577483"],
      ["track", "PageView"],
      ["track", "Lead", {}, { eventID: "shared-submission-event" }],
    ]);
    expect(appended).toHaveLength(1);
  });

  test("does not fire without a valid dataset or event ID", () => {
    (global as any).window = {};
    (global as any).document = { createElement: jest.fn(), head: { appendChild: jest.fn() } };
    expect(normalizeMetaPixelId("not-a-pixel")).toBe("");
    expect(trackMetaPageView("not-a-pixel")).toBe(false);
    expect(trackMetaLead("725252660577483", "")).toBe(false);
  });
});
