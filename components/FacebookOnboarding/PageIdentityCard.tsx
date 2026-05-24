import ProfileVisibilityNotice from "./ProfileVisibilityNotice";

export type PageIdentity = {
  name?: string;
  category?: string;
  imageUrl?: string;
  pictureUrl?: string;
  link?: string;
};

type PageIdentityCardProps = {
  page?: PageIdentity | null;
};

export default function PageIdentityCard({ page }: PageIdentityCardProps) {
  const pageName = page?.name?.trim() || "";
  const category = page?.category?.trim() || "";
  const imageUrl = page?.pictureUrl?.trim() || page?.imageUrl?.trim() || "";
  const pageLink = page?.link?.trim() || "";

  return (
    <section className="rounded-3xl border border-white/10 bg-[#0f172a] p-5 shadow-2xl shadow-black/20 sm:p-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Step 3</p>
          <h2 className="mt-1 text-2xl font-bold text-white">Confirm what customers will see</h2>
          <p className="mt-2 text-sm leading-6 text-gray-400">
            Your ad identity should look like a real business, not a personal profile.
          </p>
        </div>
        <div className="w-full rounded-3xl border border-white/10 bg-white/[0.03] p-4 lg:max-w-md">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">This is what customers will see</p>
          <div className="mt-3 flex items-center gap-3">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt=""
                className="h-16 w-16 rounded-2xl border border-white/10 object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-blue-600/20 text-xl font-bold text-blue-100">
                {pageName ? pageName.charAt(0).toUpperCase() : "F"}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-white">
                {pageName || "Your business page preview"}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">
                {category || "We will show your connected page details here."}
              </p>
            </div>
          </div>
          {pageName && (
            <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-3 text-xs leading-5 text-emerald-100/80">
              Customers will see this business Page on your ads. Your personal Facebook profile will not be shown.
              {pageLink && (
                <a
                  href={pageLink}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 font-semibold text-emerald-200 underline decoration-emerald-300/40 underline-offset-2"
                >
                  View page
                </a>
              )}
            </div>
          )}
          {!pageName && (
            <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-950/20 p-3 text-xs leading-5 text-amber-100/90">
              Choose a business Page before launching ads. No Facebook page yet? Start with your business name above and we will help you create a professional presence.
            </div>
          )}
        </div>
      </div>
      <div className="mt-5">
        <ProfileVisibilityNotice compact />
      </div>
    </section>
  );
}
