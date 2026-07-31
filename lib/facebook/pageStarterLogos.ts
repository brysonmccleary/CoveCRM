type LogoPalette = {
  canvas: string;
  ink: string;
  accent: string;
  accentSoft: string;
  paper: string;
};

// Deliberately brand-like, not illustrative. These echo the simple profile
// treatment used by established insurance advertisers: compact, flat and clear.
const PALETTES: Record<string, LogoPalette> = {
  "navy-mint": { canvas: "#102d48", ink: "#102d48", accent: "#56c7b7", accentSoft: "#dff4ef", paper: "#ffffff" },
  "forest-cream": { canvas: "#0f4c46", ink: "#12384a", accent: "#65c8ba", accentSoft: "#e8f3ef", paper: "#fbfaf5" },
  "slate-sky": { canvas: "#24465e", ink: "#1e3d54", accent: "#72bdd1", accentSoft: "#e7f2f5", paper: "#ffffff" },
  "indigo-sand": { canvas: "#243453", ink: "#243453", accent: "#d6ae67", accentSoft: "#f5eddf", paper: "#fffdf9" },
};

function escaped(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character] || character));
}

function initialsFor(name?: string) {
  const words = (name || "Life Coverage")
    .replace(/[^a-z0-9 ]/gi, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !["the", "and", "of", "for", "your"].includes(word.toLowerCase()));
  const initials = words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
  return initials || "LC";
}

function mark(styleId: string, palette: LogoPalette, initials: string) {
  const safeInitials = escaped(initials.slice(0, 2));
  switch (styleId) {
    case "classic-monogram":
      return `
        <rect width="1024" height="1024" fill="${palette.paper}"/>
        <circle cx="512" cy="512" r="344" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="18"/>
        <path d="M334 402 H690" stroke="${palette.accent}" stroke-width="18"/>
        <path d="M334 622 H690" stroke="${palette.accent}" stroke-width="18"/>
        <text x="512" y="570" text-anchor="middle" fill="${palette.ink}" font-family="Georgia, Times New Roman, serif" font-size="278" font-weight="700" letter-spacing="-16">${safeInitials}</text>`;
    case "seal-mark":
      return `
        <rect width="1024" height="1024" fill="${palette.canvas}"/>
        <circle cx="512" cy="512" r="340" fill="none" stroke="${palette.paper}" stroke-opacity="0.94" stroke-width="15"/>
        <circle cx="512" cy="512" r="300" fill="none" stroke="${palette.accent}" stroke-width="9"/>
        <text x="512" y="574" text-anchor="middle" fill="${palette.paper}" font-family="Arial, Helvetica, sans-serif" font-size="260" font-weight="700" letter-spacing="-18">${safeInitials}</text>
        <circle cx="512" cy="716" r="14" fill="${palette.accent}"/>`;
    case "modern-wordmark":
      return `
        <rect width="1024" height="1024" fill="${palette.accentSoft}"/>
        <circle cx="512" cy="512" r="342" fill="${palette.accent}"/>
        <text x="512" y="560" text-anchor="middle" fill="${palette.ink}" font-family="Arial, Helvetica, sans-serif" font-size="266" font-weight="800" letter-spacing="-22">${safeInitials}</text>
        <path d="M354 665 H670" stroke="${palette.ink}" stroke-opacity="0.65" stroke-width="14"/>
        <text x="512" y="731" text-anchor="middle" fill="${palette.ink}" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="700" letter-spacing="10">LIFE</text>`;
    case "signature-mark":
    default:
      return `
        <rect width="1024" height="1024" fill="${palette.canvas}"/>
        <path d="M281 702 C352 348 672 348 743 702" fill="none" stroke="${palette.accent}" stroke-width="28" stroke-linecap="round"/>
        <text x="512" y="602" text-anchor="middle" fill="${palette.paper}" font-family="Arial, Helvetica, sans-serif" font-size="292" font-weight="700" letter-spacing="-24">${safeInitials}</text>
        <circle cx="512" cy="746" r="12" fill="${palette.accent}"/>`;
  }
}

export function buildFacebookPageLogoSvg(styleId: string, paletteId: string, pageName?: string) {
  const palette = PALETTES[paletteId] || PALETTES["navy-mint"];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="Insurance page logo">
    ${mark(styleId, palette, initialsFor(pageName))}
  </svg>`;
}

export function facebookPageLogoDataUrl(styleId: string, paletteId: string, pageName?: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildFacebookPageLogoSvg(styleId, paletteId, pageName))}`;
}
