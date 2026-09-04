import type { NextApiRequest } from "next";
import { isRetryMetaLeadsAuthorized } from "@/pages/api/cron/retry-meta-leads";

function request(input: { query?: Record<string, string>; headers?: Record<string, string> }): NextApiRequest {
  return {
    query: input.query || {},
    headers: input.headers || {},
  } as unknown as NextApiRequest;
}

describe("Meta lead retry cron authorization", () => {
  it("accepts Vercel's standard bearer cron authorization", () => {
    expect(isRetryMetaLeadsAuthorized(
      request({ headers: { authorization: "Bearer cron-secret" } }),
      "cron-secret"
    )).toBe(true);
  });

  it("retains query and x-cron-token compatibility", () => {
    expect(isRetryMetaLeadsAuthorized(request({ query: { token: "cron-secret" } }), "cron-secret")).toBe(true);
    expect(isRetryMetaLeadsAuthorized(
      request({ headers: { "x-cron-token": "cron-secret" } }),
      "cron-secret"
    )).toBe(true);
  });

  it("rejects an incorrect token", () => {
    expect(isRetryMetaLeadsAuthorized(
      request({ headers: { authorization: "Bearer wrong" } }),
      "cron-secret"
    )).toBe(false);
  });
});
