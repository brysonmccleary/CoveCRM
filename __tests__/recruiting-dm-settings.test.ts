import {
  DEFAULT_DAILY_DM_LIMIT,
  FIRST_NAME_MESSAGE_TOKEN,
  insertMessageToken,
  MAX_DAILY_DM_LIMIT,
  parseDailyDmLimit,
} from "@/lib/recruiting/dm-settings";

describe("recruiting DM settings", () => {
  test("defaults new accounts to a conservative 25 DMs with a hard maximum of 50", () => {
    expect(DEFAULT_DAILY_DM_LIMIT).toBe(25);
    expect(MAX_DAILY_DM_LIMIT).toBe(50);
    expect(parseDailyDmLimit(50)).toBe(50);
    expect(parseDailyDmLimit("25")).toBe(25);
  });

  test.each([0, 51, 2.5, Number.NaN, "", "not-a-number"])("rejects invalid daily DM limit %p", (value) => {
    expect(() => parseDailyDmLimit(value)).toThrow("whole number from 1 to 50");
  });

  test("inserts first name at the caret without requiring braces", () => {
    expect(insertMessageToken("Hi , welcome", FIRST_NAME_MESSAGE_TOKEN, 3, 3)).toEqual({
      message: "Hi {{firstName}}, welcome",
      caret: 16,
    });
  });

  test("replaces selected text and respects the message length limit", () => {
    expect(insertMessageToken("Hi friend", FIRST_NAME_MESSAGE_TOKEN, 3, 9)).toEqual({
      message: "Hi {{firstName}}",
      caret: 16,
    });
    expect(insertMessageToken("12345", FIRST_NAME_MESSAGE_TOKEN, 5, 5, 8)).toEqual({ message: "12345", caret: 5 });
  });
});
