import Image from "next/image";
import { useMemo, useState } from "react";
import { getFacebookPageStarterOption, marketForLeadType } from "@/lib/facebook/pageStarterKits";
import { buildFacebookPageLogoSvg, facebookPageLogoDataUrl } from "@/lib/facebook/pageStarterLogos";

type PageProfilePicturePickerProps = {
  pageId: string;
  pageName: string;
  leadType: string;
};

function stableSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) || 19;
}

function safeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "insurance-page";
}

const logoLabels: Record<string, string> = {
  "signature-mark": "Signature Mark",
  "classic-monogram": "Classic Monogram",
  "modern-wordmark": "Modern Wordmark",
  "seal-mark": "Professional Seal",
};

async function logoPng(styleId: string, paletteId: string, pageName: string) {
  const svg = buildFacebookPageLogoSvg(styleId, paletteId, pageName);
  const source = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new window.Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not render this profile picture"));
      image.src = source;
    });

    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Profile-picture downloads are unavailable in this browser");
    context.drawImage(image, 0, 0, 1024, 1024);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create the PNG download")), "image/png");
    });
  } finally {
    URL.revokeObjectURL(source);
  }
}

export default function PageProfilePicturePicker({ pageId, pageName, leadType }: PageProfilePicturePickerProps) {
  const [batch, setBatch] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState("");
  const market = marketForLeadType(leadType);
  const seed = stableSeed(`${pageId}:${pageName}:${market}`);
  const options = useMemo(
    () => Array.from({ length: 4 }, (_, index) => getFacebookPageStarterOption(market, seed, batch * 4 + index)),
    [batch, market, seed],
  );
  const selected = options[selectedIndex] || options[0];

  const download = async () => {
    setDownloading(true);
    setDownloaded(false);
    setError("");
    try {
      const blob = await logoPng(selected.logoStyleId, selected.paletteId, pageName);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFilename(pageName)}-facebook-profile-picture.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setDownloaded(true);
      try {
        window.localStorage.setItem(`cove-page-profile-picture:${pageId}`, `${selected.logoStyleId}:${selected.paletteId}`);
      } catch {
        // Download still succeeds when browser storage is unavailable.
      }
    } catch (downloadError: unknown) {
      setError(downloadError instanceof Error ? downloadError.message : "Could not download the profile picture");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="rounded-3xl border border-cyan-400/20 bg-gradient-to-br from-[#0b1930] to-[#101827] p-5 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">Page profile picture</p>
          <h2 className="mt-1 text-xl font-bold text-white">Choose a professional insurance logo</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-300">
            These are built for {pageName} as clean, real-world insurance marks—not generic app icons—and stay clear in Facebook&apos;s circular crop.
          </p>
        </div>
        <span className="w-fit rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-100">
          1024 × 1024 PNG
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {options.map((option, index) => {
          const isSelected = index === selectedIndex;
          return (
            <button
              key={`${option.logoStyleId}:${option.paletteId}:${index}`}
              type="button"
              onClick={() => {
                setSelectedIndex(index);
                setDownloaded(false);
                setError("");
              }}
              className={`rounded-2xl border p-3 text-center transition ${
                isSelected
                  ? "border-cyan-300 bg-cyan-400/10 ring-2 ring-cyan-300/20"
                  : "border-white/10 bg-white/[0.03] hover:border-cyan-300/40 hover:bg-white/[0.06]"
              }`}
            >
              <span className="mx-auto block w-fit overflow-hidden rounded-xl border border-white/10 shadow-xl shadow-black/30">
                <Image
                  src={facebookPageLogoDataUrl(option.logoStyleId, option.paletteId, pageName)}
                  alt={`Profile picture option ${index + 1} for ${pageName}`}
                  width={144}
                  height={144}
                  unoptimized
                  className="h-28 w-28 object-cover sm:h-32 sm:w-32"
                />
              </span>
              <span className={`mt-2 block text-xs font-semibold ${isSelected ? "text-cyan-100" : "text-gray-300"}`}>
                {isSelected ? `Selected — ${logoLabels[option.logoStyleId] || "Insurance Mark"}` : logoLabels[option.logoStyleId] || `Option ${index + 1}`}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={download}
          disabled={downloading}
          className="min-h-12 flex-1 rounded-xl bg-cyan-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:cursor-wait disabled:opacity-60"
        >
          {downloading ? "Preparing PNG…" : downloaded ? "Downloaded — download again" : "Download selected profile picture"}
        </button>
        <button
          type="button"
          onClick={() => {
            setBatch((current) => current + 1);
            setSelectedIndex(0);
            setDownloaded(false);
            setError("");
          }}
          className="min-h-12 rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-gray-200 hover:bg-white/10"
        >
          Show four different logos
        </button>
      </div>

      {downloaded && (
        <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
          Downloaded. Open your Facebook Page and use the PNG as its profile picture. Facebook will apply the circular crop automatically. {" "}
          <a
            href={`https://www.facebook.com/${pageId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline underline-offset-4"
          >
            Open {pageName}
          </a>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </section>
  );
}
