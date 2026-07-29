/** Id du conteneur principal du reçu (ReceiptPreview). */
export const RECEIPT_PRINT_ROOT_ID = 'receipt-content';

/** A4 plein format : @page margin = 0 (voir note ci-dessous), la marge visuelle est gérée par le padding du reçu. */
const PRINTABLE_HEIGHT_MM = 297;
const PRINTABLE_WIDTH_MM = 210;
/** Marge de sécurité anti-arrondi (évite qu'un reçu pile à la limite déborde d'1px). */
const FIT_SAFETY = 0.995;

/**
 * Styles d'impression : le reçu garde sa mise en page normale (mêmes tailles de police
 * qu'à l'écran) — seule la marge extérieure (p-10, pensée pour l'aperçu web) est réduite
 * pour récupérer de l'espace utile sur la page A4. Le rétrécissement final éventuel
 * (`fitReceiptToSinglePage`) se fait par un `transform: scale()` global, qui ne modifie
 * jamais la mise en page interne : donc jamais de texte tronqué ou coupé.
 *
 * `@page { margin: 0 }` : Chrome/Edge n'affichent leur en-tête/pied de page automatique
 * (titre, date, URL, numéro de page) que s'il reste de la place dans la marge de page.
 * En mettant cette marge à 0 et en gérant nous-mêmes l'espace via le padding du
 * `.print-container`, ces mentions du navigateur n'apparaissent plus sur le PDF.
 */
const IFRAME_PRINT_CSS = `
  @page {
    size: A4 portrait;
    margin: 0;
  }

  /* Ceinture et bretelles (Chrome 131+) : marges de page personnalisées vides, ce qui
     désactive aussi explicitement les en-têtes/pieds de page générés par le navigateur. */
  @page {
    @top-left { content: ""; }
    @top-center { content: ""; }
    @top-right { content: ""; }
    @bottom-left { content: ""; }
    @bottom-center { content: ""; }
    @bottom-right { content: ""; }
  }

  html, body {
    margin: 0;
    padding: 0;
    width: ${PRINTABLE_WIDTH_MM}mm;
    background: white !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  #receipt-print-wrapper {
    width: ${PRINTABLE_WIDTH_MM}mm;
    margin: 0 auto;
  }

  .print-container {
    display: block !important;
    visibility: visible !important;
    width: ${PRINTABLE_WIDTH_MM}mm !important;
    max-width: ${PRINTABLE_WIDTH_MM}mm !important;
    min-height: 0 !important;
    height: auto !important;
    margin: 0 !important;
    padding: 10mm !important;
    box-sizing: border-box !important;
    background: white !important;
    overflow: visible !important;
    box-shadow: none !important;
    transform-origin: top center;
    page-break-after: avoid;
    break-after: avoid-page;
  }

  button,
  .print\\:hidden {
    display: none !important;
  }

  .receipt-print-footer {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .text-red-600 { color: #dc2626 !important; }
  .text-green-700 { color: #15803d !important; }
  .text-green-600 { color: #16a34a !important; }
  .text-green-800 { color: #166534 !important; }
  .text-orange-600 { color: #ea580c !important; }
  .text-gray-400 { color: #9ca3af !important; }
  .text-gray-500 { color: #6b7280 !important; }
  .text-gray-600 { color: #4b5563 !important; }
  .text-gray-700 { color: #374151 !important; }
  .text-\\[\\#2B4B8C\\] { color: #2B4B8C !important; }
  .bg-green-50 { background-color: #f0fdf4 !important; }
  .bg-blue-50 { background-color: #eff6ff !important; }
  .bg-red-50 { background-color: #fef2f2 !important; }
  .bg-gray-50 { background-color: #f9fafb !important; }
  .bg-gray-50\\/80 { background-color: rgba(249, 250, 251, 0.8) !important; }

  img {
    max-width: 100%;
  }
`;

function mmToPx(mm: number, doc: Document): number {
  const probe = doc.createElement('div');
  probe.style.height = `${mm}mm`;
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  doc.body.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  return px;
}

/** Prépare un clone du reçu sans éléments interactifs (boutons, liens masqués à l'impression). */
function sanitizeReceiptClone(root: HTMLElement): HTMLElement {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('button').forEach((el) => el.remove());
  clone.querySelectorAll('[class*="print:hidden"]').forEach((el) => el.remove());
  return clone;
}

/**
 * Attend que toutes les images du clone (logo, pastilles de paiement) soient chargées
 * avant de mesurer la hauteur du reçu. Sur mobile (réseau plus lent), une image pas
 * encore chargée peut fausser `scrollHeight` et donc le calcul de mise à l'échelle.
 * Timeout de sécurité pour ne jamais bloquer l'impression indéfiniment.
 */
function waitForImages(root: HTMLElement, timeoutMs = 1500): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'));
  if (images.length === 0) return Promise.resolve();

  const perImage = images.map(
    (img) =>
      new Promise<void>((resolve) => {
        if (img.complete) {
          resolve();
          return;
        }
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      })
  );

  return Promise.race([
    Promise.all(perImage).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

function copyStylesToDocument(targetDoc: Document): Promise<void> {
  const nodes = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'));
  const tasks = nodes.map((node) => {
    if (node.tagName === 'STYLE') {
      targetDoc.head.appendChild(node.cloneNode(true));
      return Promise.resolve();
    }
    const link = node as HTMLLinkElement;
    return new Promise<void>((resolve) => {
      const cloned = targetDoc.createElement('link');
      cloned.rel = 'stylesheet';
      cloned.href = link.href;
      cloned.onload = () => resolve();
      cloned.onerror = () => resolve();
      targetDoc.head.appendChild(cloned);
    });
  });
  return Promise.all(tasks).then(() => undefined);
}

/**
 * Ne réduit QUE si le reçu dépasse réellement une page A4. Utilise un `transform: scale()`
 * pur (jamais `zoom`, qui perturbe le calcul des largeurs à l'impression et peut tronquer
 * du texte) : la mise en page interne du reçu (largeur des colonnes, retours à la ligne)
 * reste identique à l'écran, seul le rendu final est réduit visuellement — donc jamais de
 * coupure de texte ni de perte d'information, juste un reçu légèrement plus petit si besoin.
 */
function fitReceiptToSinglePage(doc: Document): void {
  const container = doc.querySelector('.print-container') as HTMLElement | null;
  if (!container) return;

  const wrapper = doc.createElement('div');
  wrapper.id = 'receipt-print-wrapper';
  container.parentNode?.insertBefore(wrapper, container);
  wrapper.appendChild(container);

  const maxHeight = mmToPx(PRINTABLE_HEIGHT_MM, doc);
  const naturalHeight = container.scrollHeight;

  if (naturalHeight <= maxHeight) {
    // Tient déjà sur une page : aucune modification, rendu identique à l'aperçu.
    return;
  }

  const scale = (maxHeight * FIT_SAFETY) / naturalHeight;
  container.style.transformOrigin = 'top center';
  container.style.transform = `scale(${scale})`;
  wrapper.style.height = `${Math.ceil(naturalHeight * scale)}px`;
  wrapper.style.overflow = 'hidden';
}

/**
 * Export PDF / impression : iframe dédiée contenant uniquement le reçu.
 * Toujours 1 page A4, jamais de coupure de contenu (voir fitReceiptToSinglePage).
 */
export async function printReceiptElement(options?: {
  title?: string;
  waitMs?: number;
}): Promise<boolean> {
  const waitMs = options?.waitMs ?? 200;
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const source = document.getElementById(RECEIPT_PRINT_ROOT_ID);
  if (!source) return false;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  // Important : dimensions RÉELLES (pas 0x0) positionnées hors écran. Un iframe 0x0 n'est
  // pas mis en page correctement sur Safari iOS (scrollHeight y revient à 0 ou faux),
  // ce qui empêchait la mise à l'échelle sur une seule page et faisait déborder le reçu
  // sur 2 pages à l'impression mobile alors que tout semblait correct sur PC.
  iframe.style.cssText =
    'position:fixed;top:-10000px;left:-10000px;width:794px;height:1123px;border:0;';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return false;
  }

  doc.open();
  doc.write('<!DOCTYPE html><html lang="fr"><head></head><body></body></html>');
  doc.close();

  doc.title = options?.title?.trim() || document.title;

  await copyStylesToDocument(doc);

  const extraStyle = doc.createElement('style');
  extraStyle.textContent = IFRAME_PRINT_CSS;
  doc.head.appendChild(extraStyle);

  const clone = sanitizeReceiptClone(source);
  doc.body.appendChild(clone);

  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await waitForImages(clone);
  // Une frame supplémentaire après le chargement des images pour laisser le moteur
  // de rendu (surtout WebKit mobile) recalculer la mise en page avant la mesure.
  await new Promise((resolve) => requestAnimationFrame(resolve));

  fitReceiptToSinglePage(doc);

  const cleanup = () => {
    iframe.remove();
  };

  win.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(cleanup, 120_000);

  win.focus();
  win.print();
  return true;
}
