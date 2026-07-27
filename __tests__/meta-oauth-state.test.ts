import { createMetaOauthState, verifyMetaOauthState } from "@/lib/meta/oauthState";

describe("Meta OAuth state", () => {
  it("accepts the signed state for the same logged-in user", () => {
    const state = createMetaOauthState("user-1", "app-secret");
    expect(verifyMetaOauthState(state, "user-1", "app-secret")).toBe(true);
  });

  it("rejects a different user or a modified state", () => {
    const state = createMetaOauthState("user-1", "app-secret");
    expect(verifyMetaOauthState(state, "user-2", "app-secret")).toBe(false);
    expect(verifyMetaOauthState(`${state}x`, "user-1", "app-secret")).toBe(false);
  });
});
