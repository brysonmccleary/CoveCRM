type LogoPalette = {
  background: string;
  backgroundAlt: string;
  shield: string;
  shieldLight: string;
  gold: string;
  white: string;
};

// Kept intentionally tight: these are Page marks, not illustration badges.
// Every option shares the same calm navy / teal / gold insurance treatment.
const PALETTES: Record<string, LogoPalette> = {
  "navy-teal-gold": { background: "#061a3d", backgroundAlt: "#0b2b5e", shield: "#18b9bc", shieldLight: "#47d4cf", gold: "#e7b74b", white: "#ffffff" },
  "navy-aqua-gold": { background: "#071a36", backgroundAlt: "#10366b", shield: "#20aeca", shieldLight: "#70dfdf", gold: "#f1c45a", white: "#ffffff" },
  "deep-blue-teal-gold": { background: "#06182f", backgroundAlt: "#0a3153", shield: "#19a6a9", shieldLight: "#57d2c9", gold: "#deb051", white: "#ffffff" },
  "midnight-teal-gold": { background: "#0a1730", backgroundAlt: "#123362", shield: "#24bfc3", shieldLight: "#65ded5", gold: "#efc56a", white: "#ffffff" },
};

function shieldShell(content: string, palette: LogoPalette) {
  return `
    <path d="M512 132 C650 244 759 277 865 296 V492 C865 707 724 857 512 930 C300 857 159 707 159 492 V296 C265 277 374 244 512 132Z" fill="#071a39"/>
    <path d="M512 132 C650 244 759 277 865 296 V492 C865 707 724 857 512 930 C300 857 159 707 159 492 V296 C265 277 374 244 512 132Z" fill="none" stroke="url(#primaryGradient)" stroke-width="36" stroke-linejoin="round"/>
    <path d="M512 185 C626 275 716 304 809 321 V493 C809 664 703 783 512 855 C321 783 215 664 215 493 V321 C308 304 398 275 512 185Z" fill="none" stroke="${palette.shieldLight}" stroke-opacity="0.55" stroke-width="10" stroke-linejoin="round"/>
    ${content}`;
}

function homeRoof(palette: LogoPalette) {
  return `
    <path d="M304 493 L512 323 L720 493" fill="none" stroke="${palette.gold}" stroke-width="47" stroke-linecap="square" stroke-linejoin="miter"/>
    <path d="M410 408 V343 H462 V366" fill="none" stroke="${palette.gold}" stroke-width="34" stroke-linejoin="miter"/>`;
}

function motif(styleId: string, palette: LogoPalette) {
  switch (styleId) {
    case "home-check":
      return shieldShell(`${homeRoof(palette)}
        <path d="M321 625 L458 749 L714 510" fill="none" stroke="${palette.gold}" stroke-width="48" stroke-linecap="square" stroke-linejoin="miter"/>
        <path d="M374 649 L461 728" fill="none" stroke="${palette.white}" stroke-opacity="0.78" stroke-width="16" stroke-linecap="square"/>`, palette);
    case "family-home":
      return shieldShell(`${homeRoof(palette)}
        <circle cx="512" cy="526" r="43" fill="${palette.white}"/>
        <circle cx="410" cy="568" r="31" fill="${palette.white}"/>
        <circle cx="614" cy="568" r="31" fill="${palette.white}"/>
        <path d="M360 715 C377 631 443 608 512 670 C581 608 647 631 664 715" fill="none" stroke="${palette.gold}" stroke-width="42" stroke-linecap="round"/>`, palette);
    case "legacy-heart":
      return shieldShell(`${homeRoof(palette)}
        <path d="M512 547 C453 467 353 520 383 613 C405 683 512 744 512 744 C512 744 619 683 641 613 C671 520 571 467 512 547Z" fill="${palette.white}"/>
        <path d="M512 591 C483 550 433 577 448 622 C459 655 512 684 512 684 C512 684 565 655 576 622 C591 577 541 550 512 591Z" fill="${palette.gold}"/>`, palette);
    case "roof-hand":
    default:
      return shieldShell(`${homeRoof(palette)}
        <path d="M318 620 L512 778 L706 548" fill="none" stroke="${palette.gold}" stroke-width="52" stroke-linecap="square" stroke-linejoin="miter"/>
        <path d="M512 558 C463 498 388 536 407 604 C424 659 512 703 512 703 C512 703 600 659 617 604 C636 536 561 498 512 558Z" fill="${palette.white}"/>`, palette);
  }
}

export function buildFacebookPageLogoSvg(styleId: string, paletteId: string) {
  const palette = PALETTES[paletteId] || PALETTES["navy-teal-gold"];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="Insurance page logo">
    <defs>
      <radialGradient id="bg" cx="50%" cy="35%" r="76%">
        <stop offset="0%" stop-color="${palette.backgroundAlt}"/>
        <stop offset="100%" stop-color="${palette.background}"/>
      </radialGradient>
      <linearGradient id="primaryGradient" x1="18%" y1="8%" x2="82%" y2="92%">
        <stop offset="0%" stop-color="${palette.shieldLight}"/>
        <stop offset="100%" stop-color="${palette.shield}"/>
      </linearGradient>
      <filter id="emblemShadow" x="-20%" y="-15%" width="140%" height="145%">
        <feDropShadow dx="0" dy="18" stdDeviation="14" flood-color="#000718" flood-opacity="0.5"/>
      </filter>
    </defs>
    <rect width="1024" height="1024" fill="url(#bg)"/>
    <g filter="url(#emblemShadow)">${motif(styleId, palette)}</g>
  </svg>`;
}

export function facebookPageLogoDataUrl(styleId: string, paletteId: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildFacebookPageLogoSvg(styleId, paletteId))}`;
}
