/** Id du conteneur principal du reçu (ReceiptPreview). */
export const RECEIPT_PRINT_ROOT_ID = 'receipt-content';

/** A4 plein format : @page margin = 0 (voir note dans index.css), la marge visuelle est
 * gérée par le padding du reçu (`.print-container` en `@media print`). */
const PRINTABLE_HEIGHT_MM = 297;
/** Marge de sécurité PHYSIQUE (en mm) : certains moteurs d'export PDF mobile (notamment
 * "Imprimer" → "Enregistrer en PDF" sur iOS) conservent une petite zone non imprimable même
 * avec `@page { margin: 0 }`. Sans cette marge, un reçu dont la hauteur mesurée est tout
 * juste sous la limite d'une page A4 passait le test "tient déjà sur une page" (donc aucune
 * réduction appliquée), puis se faisait rogner de quelques mm tout en bas à l'impression
 * réelle — coupant pile la dernière ligne (le "Merci pour votre confiance !"). On réserve
 * donc cette marge AVANT tout calcul, pour que même les reçus "limite" soient légèrement
 * réduits par sécurité plutôt que risquer de perdre la fin du reçu. */
const PRINT_SAFETY_MARGIN_MM = 6;
/** Marge de sécurité anti-arrondi (évite qu'un reçu pile à la limite déborde d'1px). */
const FIT_SAFETY = 0.99;
/** Id du wrapper temporaire inséré autour de #receipt-content pendant l'impression (voir
 * `fitReceiptToSinglePage`). Nom dédié : ne doit correspondre à AUCUN sélecteur CSS existant
 * (notamment pas les règles "ne jamais couper les parents" du fallback Ctrl+P dans
 * index.css), pour que sa hauteur figée ne soit jamais écrasée par une règle `!important`. */
const PRINT_FIT_WRAPPER_ID = 'receipt-print-fit-wrapper';

/**
 * IMPORTANT — pourquoi on n'utilise plus d'iframe dédiée :
 * `iframe.contentWindow.print()` n'isole PAS le contenu sur Safari iOS / Chrome iOS
 * (tous basés sur WebKit) : ces navigateurs impriment systématiquement le document
 * principal, en ignorant l'iframe (limitation connue, non contournable côté web). Sur PC,
 * ça fonctionnait car Chrome/Edge desktop respectent bien l'iframe — mais sur iPhone, tout
 * notre travail de mise à l'échelle sur une page ne s'appliquait jamais : seul le CSS
 * `@media print` "de secours" de `index.css` s'appliquait (d'où le reçu correct mais étalé
 * sur 2 pages). On applique donc désormais la même logique de mise à l'échelle DIRECTEMENT
 * sur le reçu affiché à l'écran, puis on imprime la fenêtre principale (`window.print()`) :
 * un seul chemin de code, identique sur PC et mobile.
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
  return px;
}

/**
 * Attend que toutes les images du reçu (logo, pastilles de paiement) soient chargées avant
 * de mesurer sa hauteur : une image pas encore chargée fausserait `scrollHeight` et donc le
 * calcul de mise à l'échelle. Timeout de sécurité pour ne jamais bloquer l'impression.
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

/**
 * Ne réduit QUE si le reçu dépasse réellement une page A4. Utilise un `transform: scale()`
 * pur (jamais `zoom`, qui perturbe le calcul des largeurs à l'impression et peut tronquer
 * du texte) : la mise en page interne du reçu (largeur des colonnes, retours à la ligne)
 * reste identique à l'écran, seul le rendu final est réduit visuellement — donc jamais de
 * coupure de texte ni de perte d'information, juste un reçu légèrement plus petit si besoin.
 *
 * Applique directement sur le nœud RÉEL affiché à l'écran (pas un clone), afin que la mise
 * à l'échelle soit prise en compte quel que soit le chemin d'impression emprunté par le
 * navigateur (isolation via iframe ou impression de toute la page, cas de Safari iOS).
 *
 * Insère un wrapper dédié (au lieu de réutiliser `.mobile-receipt-zoom`) car ce dernier est
 * ciblé par une règle `@media print` "ne jamais couper les parents" (`overflow: visible
 * !important; height: auto !important`) nécessaire au fallback Ctrl+P — elle écraserait
 * sinon notre hauteur figée. Le wrapper est retiré (et le nœud remis à sa place d'origine)
 * par la fonction de restauration retournée, appelée juste après l'impression.
 */
function fitReceiptToSinglePage(container: HTMLElement): () => void {
  const maxHeight = mmToPx(PRINTABLE_HEIGHT_MM - PRINT_SAFETY_MARGIN_MM);
  const naturalHeight = container.scrollHeight;

  if (naturalHeight <= maxHeight) {
    // Tient déjà sur une page : aucune modification, rendu identique à l'aperçu.
    return () => {};
  }

  const parent = container.parentNode;
  const nextSibling = container.nextSibling;
  if (!parent) return () => {};

  const wrapper = document.createElement('div');
  wrapper.id = PRINT_FIT_WRAPPER_ID;
  parent.insertBefore(wrapper, container);
  wrapper.appendChild(container);

  const scale = (maxHeight * FIT_SAFETY) / naturalHeight;
  container.style.transformOrigin = 'top center';
  container.style.transform = `scale(${scale})`;
  // +2px de coussin anti-arrondi sub-pixel (moteurs de rendu mobile notamment).
  wrapper.style.height = `${Math.ceil(naturalHeight * scale) + 2}px`;
  wrapper.style.overflow = 'hidden';

  return () => {
    container.style.transform = '';
    container.style.transformOrigin = '';
    parent.insertBefore(container, nextSibling);
    wrapper.remove();
  };
}

/**
 * Export PDF / impression : imprime la fenêtre principale directement (voir note ci-dessus
 * sur l'abandon de l'iframe dédiée). Le reçu est mis à l'échelle sur place si nécessaire
 * pour toujours tenir sur 1 page A4 ; le CSS `@media print` de `index.css` masque tout le
 * reste de l'application (boutons, barre latérale, etc.).
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
  // Laisse le moteur de rendu recalculer la mise en page après le chargement des images
  // avant de mesurer la hauteur réelle du reçu.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const restore = fitReceiptToSinglePage(container);

  let didCleanup = false;
  const cleanup = () => {
    if (didCleanup) return;
    didCleanup = true;
    restore();
    if (requestedTitle) {
      document.title = originalTitle;
    }
    window.removeEventListener('afterprint', cleanup);
  };

  window.addEventListener('afterprint', cleanup, { once: true });
  // Filet de sécurité : certains navigateurs mobiles ne déclenchent pas toujours
  // `afterprint` de façon fiable.
  setTimeout(cleanup, 20_000);

  window.print();
  return true;
}
