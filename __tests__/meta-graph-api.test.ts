import { getMetaGraphVersion, metaDialogUrl, metaGraphUrl } from "@/lib/meta/graphApi";

describe("central Meta Graph API version", () => {
  it("uses one validated version for graph and OAuth URLs", () => {
    const env = { META_GRAPH_VERSION: "v24.0" } as NodeJS.ProcessEnv;
    expect(getMetaGraphVersion(env)).toBe("v24.0");
    expect(metaGraphUrl("me/accounts", env)).toBe("https://graph.facebook.com/v24.0/me/accounts");
    expect(metaDialogUrl("dialog/oauth", env)).toBe("https://www.facebook.com/v24.0/dialog/oauth");
  });

  it("rejects malformed versions instead of silently calling an unintended endpoint", () => {
    expect(() => getMetaGraphVersion({ META_GRAPH_VERSION: "latest" } as NodeJS.ProcessEnv)).toThrow(/vNN\.N/);
  });

  it("requires an intentional version choice in production", () => {
    expect(() => getMetaGraphVersion({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/explicitly configured/);
  });
});
