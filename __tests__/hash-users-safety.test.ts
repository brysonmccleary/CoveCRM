const mockDbConnect = jest.fn();

jest.mock("../lib/dbConnect", () => ({
  __esModule: true,
  default: mockDbConnect,
}));

import handler, {
  isEligibleForExplicitPasswordMigration,
  isExistingBcryptHash,
} from "../pages/api/scripts/hashUsers";

function createResponse() {
  const response: any = {
    statusCode: 200,
    payload: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };

  return response;
}

describe("hashUsers production safety", () => {
  const bcryptBody = "A".repeat(53);

  beforeEach(() => {
    mockDbConnect.mockClear();
  });

  test("module import and route discovery perform no database work or process exit", () => {
    const exitSpy = jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    expect(handler).toBeInstanceOf(Function);
    expect(mockDbConnect).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });

  test("ordinary request handling remains permanently non-writing", () => {
    const exitSpy = jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const response = createResponse();

    handler({ method: "POST" } as any, response);

    expect(response.statusCode).toBe(410);
    expect(response.payload).toMatchObject({ writesPerformed: 0 });
    expect(mockDbConnect).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });

  test.each(["2a", "2b", "2y"])(
    "recognizes $%s$ bcrypt hashes as already hashed",
    (variant) => {
      const hash = `$${variant}$10$${bcryptBody}`;

      expect(isExistingBcryptHash(hash)).toBe(true);
      expect(
        isEligibleForExplicitPasswordMigration(hash, {
          authorized: true,
          execute: true,
        }),
      ).toBe(false);
    },
  );

  test("plaintext is eligible only for an explicit authorized migration execution", () => {
    expect(
      isEligibleForExplicitPasswordMigration("plaintext", {
        authorized: false,
        execute: false,
      }),
    ).toBe(false);
    expect(
      isEligibleForExplicitPasswordMigration("plaintext", {
        authorized: true,
        execute: false,
      }),
    ).toBe(false);
    expect(
      isEligibleForExplicitPasswordMigration("plaintext", {
        authorized: false,
        execute: true,
      }),
    ).toBe(false);
    expect(
      isEligibleForExplicitPasswordMigration("plaintext", {
        authorized: true,
        execute: true,
      }),
    ).toBe(true);
  });
});
