type LogoPalette = {
  background: string;
  backgroundAlt: string;
  primary: string;
  secondary: string;
  highlight: string;
};

const PALETTES: Record<string, LogoPalette> = {
  "navy-teal-gold": { background: "#061b3a", backgroundAlt: "#0a2d58", primary: "#2cc7c9", secondary: "#f2b84b", highlight: "#ffffff" },
  "midnight-blue-silver": { background: "#081426", backgroundAlt: "#183153", primary: "#d9e2ec", secondary: "#5ca9e6", highlight: "#ffffff" },
  "forest-cream-gold": { background: "#0d3028", backgroundAlt: "#175244", primary: "#f4ead7", secondary: "#d4a94f", highlight: "#ffffff" },
  "charcoal-cobalt-cyan": { background: "#121923", backgroundAlt: "#1e293b", primary: "#3b82f6", secondary: "#22d3ee", highlight: "#f8fafc" },
  "burgundy-cream-gold": { background: "#3a101c", backgroundAlt: "#651f32", primary: "#f7ead7", secondary: "#d9a441", highlight: "#ffffff" },
  "deep-teal-navy-white": { background: "#063b3d", backgroundAlt: "#075b5f", primary: "#e6fffb", secondary: "#38b2ac", highlight: "#ffffff" },
  "slate-blue-copper": { background: "#1f2a44", backgroundAlt: "#314568", primary: "#e5edf7", secondary: "#c67c4e", highlight: "#ffffff" },
  "indigo-sky-white": { background: "#24205b", backgroundAlt: "#3730a3", primary: "#ffffff", secondary: "#60a5fa", highlight: "#e0f2fe" },
};

function shield(content: string, palette: LogoPalette) {
  return `
    <path d="M512 168 C610 250 711 282 807 297 V489 C807 678 684 815 512 886 C340 815 217 678 217 489 V297 C313 282 414 250 512 168Z"
      fill="rgba(1,12,32,0.34)" stroke="${palette.primary}" stroke-width="36" stroke-linejoin="round"/>
    <path d="M512 222 C594 286 678 316 754 330 V493 C754 641 663 751 512 820 C361 751 270 641 270 493 V330 C346 316 430 286 512 222Z"
      fill="none" stroke="${palette.secondary}" stroke-opacity="0.42" stroke-width="13" stroke-linejoin="round"/>
    ${content}`;
}

function motif(styleId: string, palette: LogoPalette) {
  const primary = palette.primary;
  const secondary = palette.secondary;
  const highlight = palette.highlight;

  switch (styleId) {
    case "family-circle":
      return shield(`
        <path d="M326 500 L512 340 L698 500" fill="none" stroke="${secondary}" stroke-width="45" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="512" cy="474" r="54" fill="${highlight}"/>
        <circle cx="408" cy="522" r="39" fill="${primary}"/>
        <circle cx="616" cy="522" r="39" fill="${primary}"/>
        <path d="M353 678 C370 584 432 558 512 626 C592 558 654 584 671 678" fill="none" stroke="${highlight}" stroke-width="48" stroke-linecap="round"/>
        <path d="M385 695 Q512 784 639 695" fill="none" stroke="${secondary}" stroke-width="34" stroke-linecap="round"/>`, palette);
    case "umbrella":
      return shield(`
        <path d="M322 520 C347 384 433 331 512 331 C591 331 677 384 702 520 C642 477 586 479 530 523 C472 479 414 479 358 520 C346 510 334 510 322 520Z" fill="${primary}"/>
        <path d="M512 507 V666 C512 718 584 730 611 677" fill="none" stroke="${secondary}" stroke-width="31" stroke-linecap="round"/>
        <path d="M512 599 C470 540 390 589 414 658 C434 716 512 755 512 755 C512 755 590 716 610 658 C634 589 554 540 512 599Z" fill="${highlight}"/>`, palette);
    case "compass":
      return shield(`
        <circle cx="512" cy="520" r="191" fill="none" stroke="${highlight}" stroke-opacity="0.82" stroke-width="25"/>
        <path d="M512 292 L574 462 L739 520 L574 578 L512 748 L450 578 L285 520 L450 462Z" fill="${secondary}"/>
        <path d="M512 364 L547 485 L667 520 L547 555 L512 676 L477 555 L357 520 L477 485Z" fill="${highlight}"/>
        <circle cx="512" cy="520" r="34" fill="${primary}"/>`, palette);
    case "legacy-tree":
      return shield(`
        <path d="M512 724 V497 M512 590 L417 484 M512 612 L618 480 M512 524 L548 419" fill="none" stroke="${secondary}" stroke-width="35" stroke-linecap="round"/>
        <path d="M381 465 C321 405 372 328 451 359 C458 289 557 270 594 338 C672 305 724 384 675 449 C710 516 635 568 579 531 C543 590 451 574 438 516 C386 536 345 506 381 465Z" fill="${primary}"/>
        <path d="M390 748 Q512 704 634 748" fill="none" stroke="${highlight}" stroke-width="31" stroke-linecap="round"/>
        <path d="M512 330 C546 361 568 390 568 420 C568 453 543 476 512 476 C481 476 456 453 456 420 C456 390 478 361 512 330Z" fill="${highlight}" fill-opacity="0.9"/>`, palette);
    case "dove-leaf":
      return shield(`
        <path d="M325 559 C404 372 579 329 703 385 C612 399 560 447 546 510 C632 469 684 488 718 534 C618 537 573 577 528 667 C468 616 400 576 325 559Z" fill="${primary}"/>
        <path d="M348 674 C438 645 516 590 589 516" fill="none" stroke="${secondary}" stroke-width="33" stroke-linecap="round"/>
        <path d="M401 633 L389 694 M459 601 L457 672 M512 560 L522 626" stroke="${highlight}" stroke-width="19" stroke-linecap="round"/>`, palette);
    case "home-shield":
      return shield(`
        <path d="M333 501 L512 352 L691 501" fill="none" stroke="${secondary}" stroke-width="43" stroke-linecap="square" stroke-linejoin="round"/>
        <path d="M387 455 V385 H430 V418" fill="${secondary}"/>
        <path d="M512 527 C456 444 354 503 382 591 C403 659 512 711 512 711 C512 711 621 659 642 591 C670 503 568 444 512 527Z" fill="${highlight}"/>
        <path d="M354 614 L512 755 L670 614" fill="none" stroke="${secondary}" stroke-width="37" stroke-linecap="square" stroke-linejoin="miter"/>`, palette);
    case "roof-heart":
      return shield(`
        <path d="M327 493 L512 342 L697 493" fill="none" stroke="${primary}" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M512 530 C451 441 345 506 377 602 C402 675 512 729 512 729 C512 729 622 675 647 602 C679 506 573 441 512 530Z" fill="${secondary}"/>
        <path d="M512 568 C480 520 424 555 441 606 C454 645 512 673 512 673 C512 673 570 645 583 606 C600 555 544 520 512 568Z" fill="${highlight}"/>`, palette);
    case "home-key":
      return `
        <path d="M232 510 L512 268 L792 510" fill="none" stroke="${primary}" stroke-width="58" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M310 470 V748 H714 V470" fill="none" stroke="${primary}" stroke-width="48" stroke-linejoin="round"/>
        <circle cx="480" cy="580" r="88" fill="none" stroke="${secondary}" stroke-width="44"/>
        <path d="M549 637 L690 744 M635 703 L681 657" stroke="${highlight}" stroke-width="42" stroke-linecap="round"/>`;
    case "growth-shield":
      return shield(`
        <path d="M330 674 L451 550 L536 615 L704 420" fill="none" stroke="${secondary}" stroke-width="50" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M606 420 H704 V518" fill="none" stroke="${highlight}" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/>`, palette);
    case "bridge":
      return `
        <path d="M230 708 H794" stroke="${primary}" stroke-width="50" stroke-linecap="round"/>
        <path d="M284 700 V474 M740 700 V474" stroke="${secondary}" stroke-width="46"/>
        <path d="M284 494 C398 326 626 326 740 494" fill="none" stroke="${primary}" stroke-width="52" stroke-linecap="round"/>
        <path d="M326 684 C371 545 467 541 512 684 C557 541 653 545 698 684" fill="none" stroke="${highlight}" stroke-width="38" stroke-linecap="round"/>
        <circle cx="512" cy="310" r="72" fill="${secondary}"/>`;
    case "liberty-star":
      return shield(`
        <path d="M512 350 L570 468 L700 487 L606 579 L628 708 L512 647 L396 708 L418 579 L324 487 L454 468Z" fill="${secondary}"/>
        <circle cx="512" cy="528" r="46" fill="${highlight}"/>`, palette);
    case "torch":
      return `
        <path d="M512 752 L440 488 H584Z" fill="${primary}"/>
        <path d="M402 742 H622" stroke="${secondary}" stroke-width="48" stroke-linecap="round"/>
        <path d="M512 477 C387 416 446 279 512 220 C578 279 637 416 512 477Z" fill="${secondary}"/>
        <path d="M512 433 C463 397 488 338 520 300 C552 345 570 401 512 433Z" fill="${highlight}"/>
        <circle cx="512" cy="512" r="292" fill="none" stroke="${primary}" stroke-width="38"/>`;
    case "road-shield":
      return shield(`
        <path d="M420 716 L480 384 H544 L604 716Z" fill="${secondary}"/>
        <path d="M512 426 V664" stroke="${highlight}" stroke-width="30" stroke-linecap="round" stroke-dasharray="52 40"/>`, palette);
    case "route-badge":
      return `
        <circle cx="512" cy="512" r="294" fill="none" stroke="${primary}" stroke-width="46"/>
        <path d="M364 744 C388 628 462 594 478 502 C493 414 437 359 401 292" fill="none" stroke="${secondary}" stroke-width="72" stroke-linecap="round"/>
        <path d="M660 744 C636 628 562 594 546 502 C531 414 587 359 623 292" fill="none" stroke="${secondary}" stroke-width="72" stroke-linecap="round"/>
        <path d="M512 710 V326" stroke="${highlight}" stroke-width="30" stroke-linecap="round" stroke-dasharray="54 40"/>`;
    case "mountain-road":
      return `
        <path d="M205 630 L398 344 L512 506 L611 382 L819 630Z" fill="${primary}"/>
        <path d="M398 344 L452 420 L398 398 L350 415Z M611 382 L667 459 L612 432 L568 448Z" fill="${highlight}"/>
        <path d="M390 806 C430 686 477 638 512 586 C547 638 594 686 634 806Z" fill="${secondary}"/>
        <path d="M512 625 V765" stroke="${highlight}" stroke-width="28" stroke-linecap="round" stroke-dasharray="42 32"/>`;
    case "shield-heart":
    default:
      return shield(`
        <path d="M329 481 L512 332 L695 481" fill="none" stroke="${secondary}" stroke-width="43" stroke-linecap="square" stroke-linejoin="miter"/>
        <path d="M382 435 V370 H424 V401" fill="${secondary}"/>
        <path d="M512 518 C456 436 358 494 386 581 C407 648 512 699 512 699 C512 699 617 648 638 581 C666 494 568 436 512 518Z" fill="${highlight}"/>
        <path d="M356 604 L512 748 L668 604" fill="none" stroke="${secondary}" stroke-width="39" stroke-linecap="square" stroke-linejoin="miter"/>
        <path d="M380 677 Q433 747 512 781 Q591 747 644 677" fill="none" stroke="${primary}" stroke-width="25" stroke-linecap="round"/>`, palette);
  }
}

export function buildFacebookPageLogoSvg(styleId: string, paletteId: string) {
  const palette = PALETTES[paletteId] || PALETTES["navy-teal-gold"];
  const renderedPalette: LogoPalette = {
    ...palette,
    primary: "url(#primaryGradient)",
    secondary: "url(#accentGradient)",
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="Insurance page logo">
    <defs>
      <radialGradient id="bg" cx="50%" cy="38%" r="72%">
        <stop offset="0%" stop-color="${palette.backgroundAlt}"/>
        <stop offset="100%" stop-color="${palette.background}"/>
      </radialGradient>
      <linearGradient id="primaryGradient" x1="20%" y1="10%" x2="80%" y2="90%">
        <stop offset="0%" stop-color="${palette.primary}"/>
        <stop offset="100%" stop-color="${palette.secondary}"/>
      </linearGradient>
      <linearGradient id="accentGradient" x1="15%" y1="15%" x2="85%" y2="85%">
        <stop offset="0%" stop-color="${palette.secondary}"/>
        <stop offset="100%" stop-color="${palette.highlight}" stop-opacity="0.88"/>
      </linearGradient>
      <filter id="emblemShadow" x="-30%" y="-30%" width="160%" height="170%">
        <feDropShadow dx="0" dy="24" stdDeviation="20" flood-color="#000814" flood-opacity="0.68"/>
      </filter>
      <radialGradient id="glow" cx="50%" cy="42%" r="58%">
        <stop offset="0%" stop-color="${palette.primary}" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="${palette.primary}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1024" height="1024" fill="url(#bg)"/>
    <circle cx="512" cy="458" r="430" fill="url(#glow)"/>
    <path d="M95 210 C260 100 764 75 929 210" fill="none" stroke="rgba(255,255,255,0.055)" stroke-width="8"/>
    <path d="M118 825 C316 927 708 927 906 825" fill="none" stroke="rgba(255,255,255,0.055)" stroke-width="8"/>
    <g filter="url(#emblemShadow)">
      ${motif(styleId, renderedPalette)}
    </g>
  </svg>`;
}

export function facebookPageLogoDataUrl(styleId: string, paletteId: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildFacebookPageLogoSvg(styleId, paletteId))}`;
}
