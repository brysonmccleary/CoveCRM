import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  FACEBOOK_PAGE_MARKETS,
  FACEBOOK_PAGE_STARTER_VARIETY,
  getFacebookPageStarterOption,
  marketForLeadType,
  type FacebookPageMarket,
} from "@/lib/facebook/pageStarterKits";
import {
  buildFacebookPageLogoSvg,
  facebookPageLogoDataUrl,
} from "@/lib/facebook/pageStarterLogos";

type PageStarterKitProps = {
  initialLeadType?: string;
};

function randomSeed() {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 1_000_000_000);
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function safeFilename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "insurance-page";
}

export default function PageStarterKit({ initialLeadType = "" }: PageStarterKitProps) {
  const [market, setMarket] = useState<FacebookPageMarket>(() => marketForLeadType(initialLeadType));
  const [seed, setSeed] = useState(19);
  const [offset, setOffset] = useState(0);
  const [copied, setCopied] = useState<"name" | "category" | "bio" | "">("");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  useEffect(() => {
    try {
      const storageKey = "cove-meta-page-starter-seed";
      const stored = Number(window.localStorage.getItem(storageKey));
      const nextSeed = Number.isInteger(stored) && stored > 0 ? stored : randomSeed();
      window.localStorage.setItem(storageKey, String(nextSeed));
      setSeed(nextSeed);
    } catch {
      setSeed(randomSeed());
    }
  }, []);

  useEffect(() => {
    setMarket(marketForLeadType(initialLeadType));
    setOffset(0);
  }, [initialLeadType]);

  const option = useMemo(
    () => getFacebookPageStarterOption(market, seed, offset),
    [market, offset, seed],
  );
  const logoUrl = useMemo(
    () => facebookPageLogoDataUrl(option.logoStyleId, option.paletteId),
    [option.logoStyleId, option.paletteId],
  );

  const handleCopy = async (field: "name" | "category" | "bio", value: string) => {
    await copyText(value);
    setCopied(field);
    window.setTimeout(() => setCopied(""), 1600);
  };

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError("");
    let source = "";
    try {
      const svg = buildFacebookPageLogoSvg(option.logoStyleId, option.paletteId);
      source = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      const image = new window.Image();
      image.decoding = "async";
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Could not render the profile picture"));
        image.src = source;
      });

      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 1024;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Profile picture download is unavailable in this browser");
      context.drawImage(image, 0, 0, 1024, 1024);
      URL.revokeObjectURL(source);

      const png = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Could not create the profile picture download"));
        }, "image/png");
      });
      const downloadUrl = URL.createObjectURL(png);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `${safeFilename(option.name)}-profile-picture.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (error: unknown) {
      setDownloadError(error instanceof Error ? error.message : "Could not download the profile picture");
    } finally {
      if (source) URL.revokeObjectURL(source);
      setDownloading(false);
    }
  };

  const chooseAnother = () => {
    setOffset((current) => current + 1);
    setCopied("");
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Your ready-to-use Page starter kit</p>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-400">
            Pick what you sell. CoveCRM gives you a page name, bio, category, and matching professional emblem. Every agent gets a different starting combination.
          </p>
        </div>
        <span className="w-fit rounded-full border border-teal-400/20 bg-teal-500/10 px-3 py-1 text-[11px] font-semibold text-teal-100">
          {FACEBOOK_PAGE_STARTER_VARIETY}+ combinations
        </span>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {FACEBOOK_PAGE_MARKETS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setMarket(item.id);
              setOffset(0);
            }}
            className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
              market === item.id
                ? "border-blue-400/50 bg-blue-500/20 text-blue-50"
                : "border-white/10 bg-white/[0.03] text-gray-300 hover:bg-white/[0.07]"
            }`}
          >
            {item.shortLabel}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[220px_1fr]">
        <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
          <div className="overflow-hidden rounded-full border-4 border-white/10 shadow-2xl shadow-black/30">
            <Image
              src={logoUrl}
              alt={`Suggested logo for ${option.name}`}
              width={168}
              height={168}
              unoptimized
              className="h-40 w-40 object-cover sm:h-[168px] sm:w-[168px]"
            />
          </div>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="mt-4 min-h-10 w-full rounded-xl bg-teal-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-teal-500 disabled:cursor-wait disabled:opacity-60"
          >
            {downloading ? "Preparing PNG..." : "Download profile picture"}
          </button>
          <p className="mt-2 text-[11px] leading-4 text-gray-500">1024 × 1024 PNG · Facebook crop-safe · No AI credits</p>
          {downloadError && <p className="mt-2 text-xs leading-4 text-red-300">{downloadError}</p>}
        </div>

        <div className="space-y-3">
          <StarterField
            label="Page name"
            value={option.name}
            copied={copied === "name"}
            onCopy={() => handleCopy("name", option.name)}
          />
          <StarterField
            label="Category"
            value={option.category}
            copied={copied === "category"}
            onCopy={() => handleCopy("category", option.category)}
          />
          <StarterField
            label="Bio"
            value={option.bio}
            copied={copied === "bio"}
            onCopy={() => handleCopy("bio", option.bio)}
            multiline
          />
          <button
            type="button"
            onClick={chooseAnother}
            className="min-h-11 w-full rounded-xl border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-400/15"
          >
            Give me a different name and logo
          </button>
        </div>
      </div>
    </div>
  );
}

function StarterField({
  label,
  value,
  copied,
  onCopy,
  multiline = false,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  multiline?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
          <p className={`mt-1 text-sm text-white ${multiline ? "leading-5" : "font-semibold"}`}>{value}</p>
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-semibold text-gray-200 transition hover:bg-white/10"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
