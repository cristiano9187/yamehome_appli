/** Id du conteneur principal du reçu (ReceiptPreview). */
export const RECEIPT_PRINT_ROOT_ID = 'receipt-content';

/** A4 plein format : @page margin = 0 (voir note dans index.css), la marge visuelle est
 * gérée par le padding du reçu (`.print-container` en `@media print`). */
const PRINTABLE_HEIGHT_MM = 297;
/**
 * Marge de sécurité physique (mm). Certains moteurs d'export PDF mobile (iOS Safari,
 * MIUI / Xiaomi / Redmi « Enregistrer en PDF ») gardent une zone non imprimable même
 * avec `@page { margin: 0 }`. On réserve cette marge avant le calcul pour que les reçus
 * « juste à la limite » soient légèrement réduits plutôt que de perdre le pied de page.
 */
const PRINT_SAFETY_MARGIN_MM = 8;
/** Marge anti-arrondi supplémentaire sur le facteur d'échelle. */
const FIT_SAFETY = 0.985;
/** Id du wrapper temporaire autour de #receipt-content pendant l'impression. */
const PRINT_FIT_WRAPPER_ID = 'receipt-print-fit-wrapper';
/** Id de la balise <style> injectée pour forcer l'échelle UNIQUEMENT en @media print. */
const PRINT_FIT_STYLE_ID = 'receipt-print-fit-style';

/**
 * IMPORTANT — pourquoi on n'utilise plus d'iframe dédiée :
 * `iframe.contentWindow.print()` n'isole PAS le contenu sur Safari iOS / Chrome iOS
 * (WebKit) : ces navigateurs impriment le document principal. On scale donc le reçu
 * affiché, puis `window.print()`.
 *
 * Sur Xiaomi / Redmi (MIUI Browser / WebView Chromium), un second piège apparaît :
 * l'événement `afterprint` est souvent déclenché IMMÉDIATEMENT (avant même que
 * l'utilisateur valide « Enregistrer en PDF »). Si on restaure le DOM à ce moment-là,
 * le PDF part sans mise à l'échelle → 2 pages (signature / remerciement isolés en page 2).
 * Contre-mesure : (1) injecter l'échelle dans une règle `@media print` (pas seulement
 * en style inline), (2) ignorer les `afterprint` prématurés, (3) ne nettoyer qu'à la
 * sortie réelle du mode print (matchMedia) ou après un délai long.
 */

function mmToPx(mm: number): number {
  const probe = document.createElement('div');
  probe.style.height = `${mm}mm`;
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  return px || mm * (96 / 25.4);
}

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

function removePrintFitStyle(): void {
  document.getElementById(PRINT_FIT_STYLE_ID)?.remove();
}

/**
 * Injecte une règle `@media print` avec l'échelle calculée.
 * Avantage vs styles inline seuls : même si un `afterprint` prématuré restaure le DOM
 * trop tôt, le moteur d'impression (qui applique @media print) conserve l'échelle.
 * `zoom` est ajouté en filet pour les WebView Android / MIUI qui ignorent parfois
 * `transform` à l'impression.
 */
function injectPrintFitStyle(scale: number, scaledHeightPx: number): void {
  removePrintFitStyle();
  const style = document.createElement('style');
  style.id = PRINT_FIT_STYLE_ID;
  style.textContent = `
    @media print {
      #${PRINT_FIT_WRAPPER_ID} {
        height: ${scaledHeightPx}px !important;
        max-height: ${PRINTABLE_HEIGHT_MM}mm !important;
        overflow: hidden !important;
        page-break-after: avoid !important;
        break-after: avoid-page !important;
      }
      #${RECEIPT_PRINT_ROOT_ID},
      #${RECEIPT_PRINT_ROOT_ID}.print-container {
        transform: scale(${scale}) !important;
        transform-origin: top center !important;
        zoom: ${scale};
        page-break-after: avoid !important;
        break-after: avoid-page !important;
      }
      .receipt-print-footer {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Met le reçu à l'échelle d'une page A4 si nécessaire.
 * Retourne une fonction de restauration (DOM + style injecté).
 */
function fitReceiptToSinglePage(container: HTMLElement): () => void {
  const maxHeight = mmToPx(PRINTABLE_HEIGHT_MM - PRINT_SAFETY_MARGIN_MM);
  // getBoundingClientRect().height ignore un éventuel scale parent (mobile-receipt-zoom)
  // pour la boîte layout ; scrollHeight reste la hauteur « naturelle » du contenu.
  const naturalHeight = Math.max(container.scrollHeight, container.offsetHeight);

  if (!naturalHeight || naturalHeight <= maxHeight) {
    return () => {};
  }

  const parent = container.parentNode;
  const nextSibling = container.nextSibling;
  if (!parent) return () => {};

  // Retirer un éventuel wrapper précédent (double clic / export raté).
  const existing = document.getElementById(PRINT_FIT_WRAPPER_ID);
  if (existing) {
    while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
    existing.remove();
  }

  const wrapper = document.createElement('div');
  wrapper.id = PRINT_FIT_WRAPPER_ID;
  parent.insertBefore(wrapper, container);
  wrapper.appendChild(container);

  const scale = Math.min(1, (maxHeight * FIT_SAFETY) / naturalHeight);
  const scaledHeightPx = Math.ceil(naturalHeight * scale) + 2;

  container.style.transformOrigin = 'top center';
  container.style.transform = `scale(${scale})`;
  (container.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(scale);
  wrapper.style.height = `${scaledHeightPx}px`;
  wrapper.style.overflow = 'hidden';

  injectPrintFitStyle(scale, scaledHeightPx);

  return () => {
    container.style.transform = '';
    container.style.transformOrigin = '';
    (container.style as CSSStyleDeclaration & { zoom?: string }).zoom = '';
    if (wrapper.parentNode) {
      parent.insertBefore(container, nextSibling);
      wrapper.remove();
    }
    removePrintFitStyle();
  };
}

/**
 * Attend la fin réelle de l'impression.
 * - Ignore les `afterprint` qui arrivent trop tôt (bug MIUI / certains Android).
 * - Préfère la sortie de `matchMedia('print')` quand disponible.
 * - Filet de sécurité temporel pour ne jamais bloquer l'UI.
 */
function waitForPrintCycleEnd(printStartedAt: number): Promise<void> {
  const MIN_AFTERPRINT_MS = 1500;
  const HARD_TIMEOUT_MS = 90_000;

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('afterprint', onAfterPrint);
      try {
        mql?.removeEventListener('change', onMqlChange);
      } catch {
        /* older browsers */
      }
      clearTimeout(hardTimer);
      resolve();
    };

    const onAfterPrint = () => {
      if (Date.now() - printStartedAt < MIN_AFTERPRINT_MS) {
        // afterprint prématuré (MIUI) : on ignore et on attend matchMedia / timeout.
        return;
      }
      // Petite latence : certains moteurs finalisent le PDF juste après afterprint.
      setTimeout(finish, 400);
    };

    const onMqlChange = (e: MediaQueryListEvent) => {
      if (!e.matches && Date.now() - printStartedAt >= MIN_AFTERPRINT_MS) {
        setTimeout(finish, 300);
      }
    };

    window.addEventListener('afterprint', onAfterPrint);
    const mql = window.matchMedia?.('print') ?? null;
    mql?.addEventListener?.('change', onMqlChange);

    const hardTimer = window.setTimeout(finish, HARD_TIMEOUT_MS);
  });
}

/**
 * Export PDF / impression : met à l'échelle sur place si besoin, imprime la fenêtre
 * principale. Le CSS `@media print` de `index.css` masque le reste de l'app.
 */
export async function printReceiptElement(options?: {
  title?: string;
  waitMs?: number;
}): Promise<boolean> {
  const waitMs = options?.waitMs ?? 200;
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const container = document.getElementById(RECEIPT_PRINT_ROOT_ID);
  if (!container) return false;

  const requestedTitle = options?.title?.trim();
  const originalTitle = document.title;
  if (requestedTitle) {
    document.title = requestedTitle;
  }

  await waitForImages(container);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const restore = fitReceiptToSinglePage(container);

  // Laisse le navigateur peindre l'état scalé avant d'ouvrir le dialogue d'impression
  // (crucial sur WebView Android / MIUI).
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const printStartedAt = Date.now();
  try {
    window.print();
  } catch {
    restore();
    if (requestedTitle) document.title = originalTitle;
    return false;
  }

  await waitForPrintCycleEnd(printStartedAt);
  restore();
  if (requestedTitle) {
    document.title = originalTitle;
  }
  return true;
}
