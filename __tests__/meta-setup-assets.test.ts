import {
  chooseSetupAdAccount,
  chooseSetupPage,
  mapMetaAdAccounts,
  mapMetaPages,
} from "@/lib/meta/setupAssets";

describe("automatic Meta setup asset selection", () => {
  const oldPage = { id: "old", name: "Old Page" };
  const newPage = { id: "new", name: "New Page" };

  it("keeps the saved page during an ordinary refresh", () => {
    expect(chooseSetupPage([oldPage, newPage], "old", false)?.id).toBe("old");
  });

  it("selects the one newly-created page after the create-page flow", () => {
    expect(chooseSetupPage([oldPage, newPage], "old", true)?.id).toBe("new");
    expect(chooseSetupPage([oldPage, newPage], "", true, ["old"])?.id).toBe("new");
  });

  it("does not guess when several unsaved pages are available", () => {
    expect(chooseSetupPage([oldPage, newPage, { id: "third", name: "Third" }], "old", true)?.id).toBe("old");
    expect(chooseSetupPage([oldPage, newPage], "", false)).toBeNull();
  });

  it("automatically chooses the only active ad account", () => {
    const accounts = [
      { id: "act_1", accountId: "1", name: "Disabled", status: 2 },
      { id: "act_2", accountId: "2", name: "Active", status: 1 },
    ];
    expect(chooseSetupAdAccount(accounts)?.accountId).toBe("2");
  });

  it("maps Meta responses without leaking or dropping identifiers", () => {
    expect(mapMetaPages([{ id: 7, name: "Page", access_token: "secret" }])[0]).toMatchObject({
      id: "7", name: "Page", accessToken: "secret",
    });
    expect(mapMetaAdAccounts([{ id: "act_9", name: "Ads", account_status: 1 }])[0]).toMatchObject({
      accountId: "9", status: 1,
    });
  });
});
