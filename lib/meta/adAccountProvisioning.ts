import { metaGraphUrl } from "@/lib/meta/graphApi";
import { mapMetaAdAccounts, type MetaSetupAdAccount } from "@/lib/meta/setupAssets";

export type MetaBusiness = {
  id: string;
  name: string;
  timezoneId?: number;
  primaryPageId?: string;
};

export type ProvisioningResult = {
  status: "ready" | "payment_required" | "blocked";
  business: MetaBusiness | null;
  adAccount: MetaSetupAdAccount | null;
  createdBusiness: boolean;
  createdAdAccount: boolean;
  paymentRequired: boolean;
  paymentUrl: string;
  reason?: "account_limit" | "verification_required" | "permissions" | "page_assignment_required" | "unknown";
  message?: string;
};

export type ProvisioningInput = {
  token: string;
  pageId: string;
  pageName: string;
  userName?: string;
  userEmail: string;
  currentAdAccountId?: string;
  currentBusinessId?: string;
  serverUserId?: string;
  browserTimeZone?: string;
  currency?: string;
};

type GraphClient = {
  get(path: string, fields: string, params?: Record<string, string>): Promise<any>;
  post(path: string, params: Record<string, string>): Promise<any>;
};

const US_TIMEZONE_IDS: Record<string, number> = {
  "America/Los_Angeles": 1,
  "America/Denver": 2,
  "Pacific/Honolulu": 3,
  "America/Anchorage": 4,
  "America/Phoenix": 5,
  "America/Chicago": 6,
  "America/New_York": 7,
};

function normalizeId(value: unknown) {
  return String(value || "").replace(/^act_/, "").trim();
}

function uniqueAccounts(accounts: MetaSetupAdAccount[]) {
  return Array.from(new Map(accounts.map((account) => [account.accountId, account])).values());
}

function shouldRenameRecoveredAccount(name: string) {
  const value = String(name || "").trim();
  return !value || /^covecrm$/i.test(value) || /\b(?:ai|generated)\s*(?:ad\s*)?(?:account|slot)\b/i.test(value) || /^ad account(?:\s*#?\d+)?$/i.test(value);
}

export function buildInsuranceAdAccountName(pageName = "", userName = "") {
  const cleanedPageName = String(pageName || "")
    .replace(/\s+/g, " ")
    .replace(/\b(?:facebook|official)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 80);
  const looksLikeInsuranceBrand = /\b(?:insurance|life|quotes?|mortgage|final expense|burial|protection|coverage|retirement|benefits?)\b/i.test(cleanedPageName);
  if (looksLikeInsuranceBrand) return cleanedPageName;

  const cleanedUserName = String(userName || "").replace(/[^a-z0-9 '&.-]/gi, "").replace(/\s+/g, " ").trim();
  if (cleanedUserName && /\b(?:insurance|life|quotes?)\b/i.test(cleanedUserName)) {
    return cleanedUserName.slice(0, 80);
  }
  return "My Insurance Quotes";
}

export function getMetaTimezoneId(browserTimeZone = "", businessTimezoneId?: number) {
  if (Number.isInteger(businessTimezoneId) && Number(businessTimezoneId) > 0) return Number(businessTimezoneId);
  return US_TIMEZONE_IDS[browserTimeZone] || US_TIMEZONE_IDS["America/Phoenix"];
}

export function buildMetaPaymentUrl(accountId: string, businessId = "") {
  const normalizedAccountId = normalizeId(accountId);
  const url = new URL("https://business.facebook.com/latest/billing_hub/accounts/details/");
  url.searchParams.set("payment_account_id", normalizedAccountId);
  url.searchParams.set("asset_id", normalizedAccountId);
  url.searchParams.set("placement", "campaign_manager");
  if (businessId) url.searchParams.set("business_id", businessId);
  return url.toString();
}

function createGraphClient(token: string): GraphClient {
  async function parse(response: Response) {
    const json = await response.json() as any;
    if (!response.ok || json?.error) {
      const error = new Error(String(json?.error?.message || "Meta could not finish ad account setup")) as Error & {
        code?: number;
        subcode?: number;
      };
      error.code = Number(json?.error?.code || 0);
      error.subcode = Number(json?.error?.error_subcode || 0);
      throw error;
    }
    return json;
  }

  return {
    async get(path, fields, params = {}) {
      const url = new URL(metaGraphUrl(path));
      url.searchParams.set("access_token", token);
      url.searchParams.set("fields", fields);
      url.searchParams.set("limit", "200");
      Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
      return parse(await fetch(url.toString()));
    },
    async post(path, params) {
      return parse(await fetch(metaGraphUrl(path), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ...params, access_token: token }).toString(),
      }));
    },
  };
}

function mapBusiness(raw: any): MetaBusiness | null {
  const id = String(raw?.id || "");
  if (!id) return null;
  return {
    id,
    name: String(raw?.name || "Meta business"),
    timezoneId: Number(raw?.timezone_id || 0) || undefined,
    primaryPageId: String(raw?.primary_page?.id || raw?.primary_page || "") || undefined,
  };
}

async function inspectAccount(client: GraphClient, account: MetaSetupAdAccount) {
  const detail = await client.get(
    `act_${account.accountId}`,
    "id,name,account_id,account_status,currency,funding_source,funding_source_details,timezone_id,timezone_name,business,business_name,business_street,business_city,business_state,business_zip,business_country_code"
  );
  const fundingSource = String(detail?.funding_source || detail?.funding_source_details?.id || "");
  return {
    account: mapMetaAdAccounts([detail])[0] || account,
    paymentRequired: !fundingSource,
  };
}

function classifyProvisioningError(error: any): ProvisioningResult["reason"] {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("maximum number") || message.includes("ad account limit") || message.includes("too many ad accounts")) return "account_limit";
  if (message.includes("verif") || message.includes("security check") || message.includes("two-factor")) return "verification_required";
  if (Number(error?.code || 0) === 200 || message.includes("permission") || message.includes("not authorized")) return "permissions";
  return "unknown";
}

async function discoverBusinesses(client: GraphClient, pageId: string, preferredBusinessId = "") {
  const result = await client.get("me/businesses", "id,name,timezone_id,primary_page{id}");
  const businesses = (Array.isArray(result?.data) ? result.data : []).map(mapBusiness).filter(Boolean) as MetaBusiness[];
  if (!businesses.length) return { businesses, selected: null as MetaBusiness | null };

  const primaryMatch = businesses.find((business) => business.primaryPageId === pageId);
  if (primaryMatch) return { businesses, selected: primaryMatch };

  for (const business of businesses) {
    try {
      const pages = await client.get(`${business.id}/owned_pages`, "id");
      if ((pages?.data || []).some((page: any) => String(page?.id || "") === pageId)) {
        return { businesses, selected: business };
      }
    } catch {
      // Some portfolios do not expose owned_pages even though the user can manage the Page.
    }
  }
  const preferred = businesses.find((business) => business.id === preferredBusinessId);
  if (preferred) return { businesses, selected: preferred };
  return { businesses, selected: businesses.length === 1 ? businesses[0] : null };
}

async function businessHasPage(client: GraphClient, businessId: string, pageId: string) {
  const edges = ["owned_pages", "client_pages"];
  for (const edge of edges) {
    try {
      const result = await client.get(`${businessId}/${edge}`, "id,name");
      if ((result?.data || []).some((page: any) => String(page?.id || "") === pageId)) return true;
    } catch {
      // Some portfolios do not expose both edges. Try the other relationship.
    }
  }
  return false;
}

async function ensureBusinessHasPage(client: GraphClient, businessId: string, pageId: string) {
  if (await businessHasPage(client, businessId, pageId)) return true;
  try {
    const result = await client.post(`${businessId}/owned_pages`, { page_id: pageId });
    if (result?.success === true || result?.id) return true;
  } catch (error) {
    // Meta may report an already-owned conflict while the read edge is still
    // catching up. Re-read before treating the setup as blocked.
    if (await businessHasPage(client, businessId, pageId)) return true;
    throw error;
  }
  return businessHasPage(client, businessId, pageId);
}

async function ensureServerAssetAssignments(
  client: GraphClient,
  businessId: string,
  accountId: string,
  pageId: string,
  serverUserId = ""
) {
  const businessSystemUsers = await client.get(
    `${businessId}/system_users`,
    "id,name,role"
  ).catch(() => ({ data: [] }));
  const serverUserIds = Array.from(new Set([
    serverUserId,
    ...(businessSystemUsers?.data || [])
      .filter((user: any) => /cove\s*crm/i.test(String(user?.name || "")))
      .map((user: any) => String(user?.id || "")),
  ].filter(Boolean)));
  if (!serverUserIds.length) return;
  const accountUsers = await client.get(
    `act_${normalizeId(accountId)}/assigned_users`,
    "id",
    { business: businessId }
  ).catch(() => ({ data: [] }));
  const pageUsers = await client.get(
    `${pageId}/assigned_users`,
    "id",
    { business: businessId }
  ).catch(() => ({ data: [] }));
  for (const id of serverUserIds) {
    if (!(accountUsers?.data || []).some((user: any) => String(user?.id || "") === id)) {
      await client.post(`act_${normalizeId(accountId)}/assigned_users`, {
        business: businessId,
        user: id,
        tasks: JSON.stringify(["MANAGE", "ADVERTISE", "ANALYZE"]),
      });
    }
    if (!(pageUsers?.data || []).some((user: any) => String(user?.id || "") === id)) {
      await client.post(`${pageId}/assigned_users`, {
        business: businessId,
        user: id,
        tasks: JSON.stringify(["MANAGE", "CREATE_CONTENT", "MODERATE", "MESSAGING", "ADVERTISE", "ANALYZE"]),
      });
    }
  }
}

async function getOwnedAccounts(client: GraphClient, businessId: string) {
  const result = await client.get(
    `${businessId}/owned_ad_accounts`,
    "id,name,account_id,account_status,currency,timezone_id,timezone_name,business"
  );
  return mapMetaAdAccounts(result?.data);
}

export async function provisionMetaAdAccount(
  input: ProvisioningInput,
  providedClient?: GraphClient
): Promise<ProvisioningResult> {
  const client = providedClient || createGraphClient(input.token);
  const accountName = buildInsuranceAdAccountName(input.pageName, input.userName);
  const currentId = normalizeId(input.currentAdAccountId);
  let createdBusiness = false;
  let createdAdAccount = false;

  const accessibleResult = await client.get(
    "me/adaccounts",
    "id,name,account_id,account_status,currency,timezone_id,timezone_name,business"
  );
  const accessibleAccounts = mapMetaAdAccounts(accessibleResult?.data);
  const current = accessibleAccounts.find((account) => account.accountId === currentId && account.status === 1);
  const currentRaw = (accessibleResult?.data || []).find(
    (raw: any) => normalizeId(raw?.account_id || raw?.id) === current?.accountId
  );
  const currentBusinessId = String(currentRaw?.business?.id || input.currentBusinessId || "");

  let { selected: business } = await discoverBusinesses(client, input.pageId, currentBusinessId);

  if (!business) {
    const timezoneId = getMetaTimezoneId(input.browserTimeZone);
    try {
      const result = await client.post("me/businesses", {
        name: accountName,
        email: input.userEmail,
        primary_page: input.pageId,
        timezone_id: String(timezoneId),
      });
      business = { id: String(result?.id || ""), name: accountName, timezoneId, primaryPageId: input.pageId };
      if (!business.id) throw new Error("Meta did not return the new business ID");
      createdBusiness = true;
    } catch (error: any) {
      return {
        status: "blocked",
        business: null,
        adAccount: null,
        createdBusiness,
        createdAdAccount,
        paymentRequired: false,
        paymentUrl: "",
        reason: classifyProvisioningError(error),
        message: error?.message,
      };
    }
  }

  try {
    const pageReady = await ensureBusinessHasPage(client, business.id, input.pageId);
    if (!pageReady) throw new Error("Meta did not attach the Facebook Page to the business portfolio.");
  } catch (error: any) {
    return {
      status: "blocked",
      business,
      adAccount: null,
      createdBusiness,
      createdAdAccount,
      paymentRequired: false,
      paymentUrl: "",
      reason: "page_assignment_required",
      message: String(error?.message || "The Facebook Page must be added to the selected Meta business portfolio."),
    };
  }

  let ownedAccounts = await getOwnedAccounts(client, business.id).catch(() => [] as MetaSetupAdAccount[]);
  let account = uniqueAccounts(ownedAccounts).find((candidate) =>
    candidate.status === 1 && candidate.accountId === current?.accountId
  ) || uniqueAccounts(ownedAccounts).find((candidate) => candidate.status === 1) || null;

  if (account && !accessibleAccounts.some((candidate) => candidate.accountId === account?.accountId)) {
    try {
      const me = await client.get("me", "id");
      if (me?.id) {
        await client.post(`act_${account.accountId}/assigned_users`, {
          user: String(me.id),
          tasks: JSON.stringify(["MANAGE", "ADVERTISE", "ANALYZE"]),
        });
      }
    } catch {
      // Business admins can often manage the account without a direct assignment.
      // The final account read below is the source of truth.
    }
  }

  if (account && shouldRenameRecoveredAccount(account.name) && account.name !== accountName) {
    await client.post(`act_${account.accountId}`, { name: accountName }).catch(() => null);
    account = { ...account, name: accountName };
  }

  if (!account) {
    try {
      const result = await client.post(`${business.id}/adaccount`, {
        name: accountName,
        currency: input.currency || "USD",
        timezone_id: String(getMetaTimezoneId(input.browserTimeZone, business.timezoneId)),
      });
      const createdId = normalizeId(result?.account_id || result?.id);
      if (!createdId) throw new Error("Meta did not return the new ad account ID");
      account = { id: `act_${createdId}`, accountId: createdId, name: accountName, status: 1, currency: input.currency || "USD" };
      createdAdAccount = true;
    } catch (error: any) {
      // Account creation is not idempotent. Re-fetch before reporting failure in case Meta created it but timed out.
      ownedAccounts = await getOwnedAccounts(client, business.id).catch(() => [] as MetaSetupAdAccount[]);
      account = uniqueAccounts(ownedAccounts).find((candidate) => candidate.status === 1) || null;
      if (!account) {
        return {
          status: "blocked",
          business,
          adAccount: null,
          createdBusiness,
          createdAdAccount,
          paymentRequired: false,
          paymentUrl: "",
          reason: classifyProvisioningError(error),
          message: error?.message,
        };
      }
    }
  }

  try {
    await ensureServerAssetAssignments(
      client,
      business.id,
      account.accountId,
      input.pageId,
      String(input.serverUserId || "")
    );
  } catch (error: any) {
    return {
      status: "blocked",
      business,
      adAccount: account,
      createdBusiness,
      createdAdAccount,
      paymentRequired: false,
      paymentUrl: buildMetaPaymentUrl(account.accountId, business.id),
      reason: "page_assignment_required",
      message: String(error?.message || "Meta did not grant CoveCRM access to the Facebook Page and ad account."),
    };
  }

  const inspected = await inspectAccount(client, account);
  return {
    status: inspected.paymentRequired ? "payment_required" : "ready",
    business,
    adAccount: inspected.account,
    createdBusiness,
    createdAdAccount,
    paymentRequired: inspected.paymentRequired,
    paymentUrl: buildMetaPaymentUrl(account.accountId, business.id),
  };
}
