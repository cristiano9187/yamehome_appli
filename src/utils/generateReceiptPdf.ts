import { pdf } from '@react-pdf/renderer';
import React from 'react';
import { ReceiptData } from '../types';
import ReceiptPdfDocument from '../components/receiptPdf/ReceiptPdfDocument';
import { buildReceiptFileName } from './receiptCalculations';

/**
 * Génération PDF « uniforme » — un vrai fichier PDF (vecteur) construit directement à partir
 * des données du reçu, sans dépendre du moteur d'impression du navigateur (window.print()).
 *
 * Pourquoi ce choix après plusieurs itérations sur window.print() :
 * Safari iOS, Chrome iOS (WebKit) et les navigateurs Android/MIUI (Xiaomi, Redmi…) implémentent
 * chacun leur propre pipeline d'impression → mise à l'échelle, sauts de page et marges
 * imprévisibles et non uniformes d'un appareil à l'autre (voir historique : reçu coupé, étalé sur
 * 2 pages, remerciements tronqués...). En générant nous-mêmes les octets du PDF (react-pdf), le
 * rendu est strictement identique sur PC, iPhone, Android, quel que soit le navigateur : aucune
 * dépendance à un moteur de rendu tiers. Si un reçu a exceptionnellement trop de contenu pour une
 * page (nombreux paiements / segments), react-pdf ajoute automatiquement une 2e page plutôt que de
 * couper l'information — jamais de perte de données.
 */
export async function buildReceiptPdfBlob(
  data: ReceiptData,
  options?: { showPaymentMethods?: boolean; proforma?: boolean }
): Promise<Blob> {
  const doc = React.createElement(ReceiptPdfDocument, {
    data,
    showPaymentMethods: options?.showPaymentMethods ?? false,
    proforma: options?.proforma ?? false,
  });
  const instance = pdf(doc as any);
  return instance.toBlob();
}

function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isAppleTouch = /iP(hone|od|ad)/.test(ua);
  const isIPadOS13Plus = navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1;
  return isAppleTouch || isIPadOS13Plus;
}

/**
 * Génère le PDF du reçu et déclenche son téléchargement / affichage.
 * - Desktop & Android : téléchargement direct via <a download> (nom de fichier fiable).
 * - iOS (Safari/Chrome, tous basés sur WebKit) : l'attribut download sur un blob: n'est pas fiable,
 *   et le nom de fichier proposé par Safari dans sa feuille de partage se base sur l'identifiant
 *   technique de l'URL blob: (ex. « 5cdc83a5-... ») plutôt que sur le titre du PDF. On utilise donc
 *   l'API Web Share avec un vrai objet File nommé correctement : Safari respecte alors ce nom aussi
 *   bien dans « Enregistrer dans Fichiers » que lors d'un partage (WhatsApp, Mail, AirDrop…).
 *   Si l'API Web Share n'est pas disponible, on retombe sur l'ouverture dans un nouvel onglet.
 */
export async function exportReceiptPdf(
  data: ReceiptData,
  options?: { showPaymentMethods?: boolean; proforma?: boolean }
): Promise<void> {
  const blob = await buildReceiptPdfBlob(data, options);
  const fileName = `${buildReceiptFileName(data, { proforma: options?.proforma })}.pdf`;

  if (isIOSDevice()) {
    const file = new File([blob], fileName, { type: 'application/pdf' });
    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
      share?: (data?: ShareData) => Promise<void>;
    };
    if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
      try {
        await nav.share({ files: [file] });
        return;
      } catch (err: any) {
        if (err && err.name === 'AbortError') {
          // L'utilisateur a annulé le partage : ne rien faire d'autre.
          return;
        }
        // Échec inattendu du partage : on retombe sur l'ouverture en nouvel onglet ci-dessous.
      }
    }
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
