import { createMocks } from "node-mocks-http";
import campaignsHandler from "@/pages/api/facebook/campaigns";
import campaignHandler from "@/pages/api/facebook/campaigns/[id]";
import creativePreviewHandler from "@/pages/api/facebook/campaigns/[id]/creative-preview";
import { getServerSession } from "next-auth/next";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import MetaLaunchArchive from "@/models/MetaLaunchArchive";

jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));
jest.mock("@/pages/api/auth/[...nextauth]", () => ({ authOptions: {} }));
jest.mock("@/lib/mongooseConnect", () => jest.fn());
jest.mock("@/models/FBLeadCampaign", () => ({
  __esModule: true,
  default: { find: jest.fn(), findOne: jest.fn() },
}));
jest.mock("@/models/MetaLaunchArchive", () => ({
  __esModule: true,
  default: { find: jest.fn(), findOne: jest.fn() },
}));
jest.mock("@/models/User", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

const CAMPAIGN_ID = "507f1f77bcf86cd799439011";

describe("Facebook campaign dashboard regressions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: "agent@example.com" } });
  });

  test("campaign list exposes the protected exact-creative URL and disables caching", async () => {
    (FBLeadCampaign.find as jest.Mock).mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ _id: CAMPAIGN_ID, campaignName: "Veteran Campaign" }]),
      }),
    });
    (MetaLaunchArchive.find as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ campaignId: CAMPAIGN_ID }]),
      }),
    });

    const { req, res } = createMocks({ method: "GET" });
    await campaignsHandler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.getHeader("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(JSON.parse(res._getData()).campaigns[0].creativePreviewUrl).toBe(
      `/api/facebook/campaigns/${CAMPAIGN_ID}/creative-preview`
    );
  });

  test("creative preview returns the exact archived bytes uploaded to Meta", async () => {
    const expected = Buffer.from("exact-rendered-meta-image");
    (MetaLaunchArchive.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          images: [{ dataUrl: `data:image/png;base64,${expected.toString("base64")}` }],
        }),
      }),
    });

    const { req, res } = createMocks({ method: "GET", query: { id: CAMPAIGN_ID } });
    await creativePreviewHandler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.getHeader("Content-Type")).toBe("image/png");
    expect(res._getBuffer()).toEqual(expected);
  });

  test("delete removes the CoveCRM campaign even when no Meta connection exists", async () => {
    const campaign = { metaCampaignId: "", deleteOne: jest.fn().mockResolvedValue(undefined) };
    (FBLeadCampaign.findOne as jest.Mock).mockResolvedValue(campaign);

    const { req, res } = createMocks({ method: "DELETE", query: { id: CAMPAIGN_ID } });
    await campaignHandler(req as any, res as any);

    expect(campaign.deleteOne).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ ok: true });
  });
});
