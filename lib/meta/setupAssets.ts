export type MetaSetupPage = {
  id: string;
  name: string;
  accessToken?: string;
  instagramId?: string;
  pictureUrl?: string;
  category?: string;
  link?: string;
  tasks?: string[];
};

export type MetaSetupAdAccount = {
  id: string;
  name: string;
  accountId: string;
  status?: number;
  currency?: string;
};

export function chooseSetupPage(
  pages: MetaSetupPage[],
  currentPageId = "",
  preferNewPage = false,
  knownPageIds: string[] = []
): MetaSetupPage | null {
  const current = pages.find((page) => page.id === currentPageId) || null;
  if (preferNewPage) {
    const known = new Set(knownPageIds.length ? knownPageIds : currentPageId ? [currentPageId] : []);
    const newPages = pages.filter((page) => !known.has(page.id));
    if (newPages.length === 1) return newPages[0];
  }
  if (current) return current;
  return pages.length === 1 ? pages[0] : null;
}

export function chooseSetupAdAccount(
  accounts: MetaSetupAdAccount[],
  currentAccountId = "",
  preferNewAccount = false,
  knownAccountIds: string[] = []
): MetaSetupAdAccount | null {
  const normalizedCurrent = currentAccountId.replace(/^act_/, "");
  const current = accounts.find((account) => account.accountId === normalizedCurrent) || null;
  if (preferNewAccount) {
    const known = new Set(
      (knownAccountIds.length ? knownAccountIds : normalizedCurrent ? [normalizedCurrent] : [])
        .map((id) => String(id || "").replace(/^act_/, ""))
        .filter(Boolean)
    );
    const newActiveAccounts = accounts.filter(
      (account) => account.status === 1 && !known.has(account.accountId)
    );
    if (newActiveAccounts.length === 1) return newActiveAccounts[0];
  }
  if (current) return current;
  return null;
}

export function mapMetaPages(rawPages: any[]): MetaSetupPage[] {
  return (Array.isArray(rawPages) ? rawPages : [])
    .map((page) => ({
      id: String(page?.id || ""),
      name: String(page?.name || ""),
      accessToken: String(page?.access_token || ""),
      instagramId: String(page?.instagram_business_account?.id || ""),
      pictureUrl: String(page?.picture?.data?.url || ""),
      category: String(page?.category || ""),
      link: String(page?.link || ""),
      tasks: Array.isArray(page?.tasks) ? page.tasks.map((task: unknown) => String(task || "")).filter(Boolean) : [],
    }))
    .filter((page) => page.id && page.name);
}

export function mapMetaAdAccounts(rawAccounts: any[]): MetaSetupAdAccount[] {
  return (Array.isArray(rawAccounts) ? rawAccounts : [])
    .map((account) => ({
      id: String(account?.id || ""),
      name: String(account?.name || ""),
      accountId: String(account?.account_id || account?.id || "").replace(/^act_/, ""),
      status: Number(account?.account_status || 0),
      currency: String(account?.currency || ""),
    }))
    .filter((account) => account.accountId);
}
