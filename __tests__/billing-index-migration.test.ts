describe("UsageAccrualLedger legacy eventKey index migration", () => {
  function setup(indexes: any[], duplicates: any[] = []) {
    jest.resetModules();
    const collection = {
      indexes: jest.fn().mockResolvedValue(indexes),
      aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(duplicates) }),
      dropIndex: jest.fn().mockResolvedValue(undefined),
      createIndex: jest.fn().mockResolvedValue("usage_accrual_tenant_bucket_event"),
    };
    jest.doMock("../lib/mongooseConnect", () => ({ __esModule: true, default: jest.fn() }));
    jest.doMock("../models/Message", () => ({ __esModule: true, default: { collection: {} } }));
    jest.doMock("../models/CallLog", () => ({ __esModule: true, default: { collection: {} } }));
    jest.doMock("../models/BillingEvent", () => ({ __esModule: true, default: { createIndexes: jest.fn() } }));
    jest.doMock("../models/UsageAccrualLedger", () => ({ __esModule: true, default: { collection } }));
    return collection;
  }

  test("drops only legacy eventKey_1 and creates the compound unique index", async () => {
    const collection = setup([
      { name: "_id_", key: { _id: 1 } },
      { name: "eventKey_1", key: { eventKey: 1 }, unique: true },
      { name: "unrelated_1", key: { source: 1 } },
    ]);
    const { ensureBillingIndexes } = await import("../scripts/create-indexes");
    await ensureBillingIndexes(collection);
    expect(collection.dropIndex).toHaveBeenCalledWith("eventKey_1");
    expect(collection.createIndex).toHaveBeenCalledWith(
      { userEmail: 1, bucket: 1, eventKey: 1 },
      { unique: true, name: "usage_accrual_tenant_bucket_event" },
    );
    expect(collection.dropIndex).toHaveBeenCalledTimes(1);
  });

  test("is safe to rerun when the compound index already exists", async () => {
    const collection = setup([
      { name: "usage_accrual_tenant_bucket_event", key: { userEmail: 1, bucket: 1, eventKey: 1 }, unique: true },
    ]);
    const { ensureBillingIndexes } = await import("../scripts/create-indexes");
    await ensureBillingIndexes(collection);
    expect(collection.dropIndex).not.toHaveBeenCalled();
    expect(collection.createIndex).not.toHaveBeenCalled();
  });

  test("does not mutate indexes when compound-key duplicates exist", async () => {
    const collection = setup(
      [{ name: "eventKey_1", key: { eventKey: 1 }, unique: true }],
      [{ ids: ["duplicate-a", "duplicate-b"] }],
    );
    const { ensureBillingIndexes } = await import("../scripts/create-indexes");
    await expect(ensureBillingIndexes(collection)).rejects.toThrow("duplicate tenant/bucket/eventKey rows");
    expect(collection.dropIndex).not.toHaveBeenCalled();
    expect(collection.createIndex).not.toHaveBeenCalled();
  });
});
