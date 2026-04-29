import React from 'react';
import { ProInvoice } from '../types';
import { LOGO_BASE64, formatCurrency, COMPANY_LEGAL_ISSUER } from '../constants';
import { amountFcfaToFrenchWords } from '../utils/frenchNumberWords';

/** Fichier copié dans `public/` (facture représentant légal). */
const SIGNATURE_SRC = `${import.meta.env.BASE_URL}signature-yamepi-tonag.png`;

interface Props {
  data: ProInvoice;
}

function formatFrenchDate(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function stayRangeLabel(start: string, end: string): string {
  return `Du ${formatFrenchDate(start)} au ${formatFrenchDate(end)}`;
}

/**
 * Gabarit facture société — style sobre (inspiré des factures chambres d’hôtel / besoins employeurs).
 */
const ProInvoicePrintPreview = React.memo(function ProInvoicePrintPreview({ data }: Props) {
  const wordsTotal = amountFcfaToFrenchWords(data.amountInvoice);
  const showPaidStamp = data.paidStamp === 'paid' || data.paidStamp === 'paid_cash';
  const paidStampLabel = data.paidStamp === 'paid_cash' ? 'Payé comptant' : 'Payé';

  return (
    <div
      id="pro-invoice-print-root"
      className="print-container w-full max-w-[210mm] min-h-[297mm] bg-white shadow-xl p-10 text-gray-900 text-sm font-sans print:shadow-none print:p-[12mm]"
    >
      {/* En-tête */}
      <div className="flex flex-row justify-between items-start gap-4 mb-8 border-b-2 border-[#2B4B8C] pb-6">
        <div className="flex gap-3 items-start">
          {LOGO_BASE64 ? (
            <img src={LOGO_BASE64} alt="YameHome" className="h-14 w-14 object-contain shrink-0" referrerPolicy="no-referrer" />
          ) : (
            <div className="h-14 w-14 rounded-full border border-dashed border-gray-300 flex items-center justify-center text-[8px] text-gray-400 text-center p-1">
              Logo
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#2B4B8C] leading-tight">
              {COMPANY_LEGAL_ISSUER.legalTradeName}
            </p>
            <p className="text-lg font-black text-[#2B4B8C] tracking-tight">{COMPANY_LEGAL_ISSUER.brandSubtitle}</p>
            <p className="text-[10px] text-gray-600 leading-snug mt-1 max-w-[14rem]">
              Réf. réservation meublée — activité sous couvert commerce général (RCCM).
            </p>
          </div>
        </div>
        <div className="text-right text-xs">
          <p className="font-semibold text-gray-700">
            {data.issuePlace}, le {formatFrenchDate(data.invoiceDate)}
          </p>
        </div>
      </div>

      <p className="text-center text-sm font-black uppercase tracking-wide underline decoration-[#2B4B8C] decoration-1 underline-offset-4 mb-6">
        Facture N° <span className="font-mono">{data.invoiceNumber}</span>
      </p>

      <div className="mb-6">
        <p className="text-xs font-black uppercase tracking-wider text-gray-500 mb-1">Doit</p>
        <p className="text-base font-black text-gray-900">{data.billedToDisplayName}</p>
      </div>

      {/* Période de séjour : toujours lisible au-dessus du tableau */}
      <div className="text-center mb-4 relative z-[1]">
        <p className="font-black uppercase text-base underline underline-offset-2">{data.sectionTitle}</p>
        <p className="text-xs mt-2 underline">{stayRangeLabel(data.startDate, data.endDate)}</p>
        <p className="text-[10px] text-gray-500 mt-1">
          Réf. reçu interne :{' '}
          <span className="font-mono">{data.receiptBusinessId}</span> — {data.apartmentName}
        </p>
      </div>

      <div>
        <table className="w-full border-collapse border border-gray-300 text-[11px] mb-6 bg-white">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-300 px-2 py-2 font-black">N°</th>
            <th className="border border-gray-300 px-2 py-2 font-black text-left">Libellés</th>
            <th className="border border-gray-300 px-2 py-2 font-black">Ch./pers.</th>
            <th className="border border-gray-300 px-2 py-2 font-black">Nuitées</th>
            <th className="border border-gray-300 px-2 py-2 font-black text-right">Prix (FCFA)</th>
            <th className="border border-gray-300 px-2 py-2 font-black text-right">Montant total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-gray-300 px-2 py-2 text-center">1</td>
            <td className="border border-gray-300 px-2 py-2">{data.lineLabel}</td>
            <td className="border border-gray-300 px-2 py-2 text-center">{data.roomsCount}</td>
            <td className="border border-gray-300 px-2 py-2 text-center">{data.nightsCount}</td>
            <td className="border border-gray-300 px-2 py-2 text-right tabular-nums font-mono">
              {Math.round(data.unitPriceDisplay).toLocaleString('fr-FR')}
            </td>
            <td className="border border-gray-300 px-2 py-2 text-right font-bold tabular-nums font-mono">
              {data.amountInvoice.toLocaleString('fr-FR')}
            </td>
          </tr>
          <tr className="bg-gray-50 font-black">
            <td className="border border-gray-300 px-2 py-2 text-right uppercase" colSpan={5}>
              Montant total
            </td>
            <td className="border border-gray-300 px-2 py-2 text-right text-base">{formatCurrency(data.amountInvoice)}</td>
          </tr>
        </tbody>
        </table>

        <p className="text-xs leading-relaxed mb-8 border border-gray-200 rounded-lg px-3 py-2 bg-gray-50/80">
          Arrêtée la présente facture à la somme de {wordsTotal}.
        </p>
      </div>

      {/* Bloc émetteur + zone client « Payé » (à droite, demande employeur) */}
      <div className="mt-10 pt-4 border-t-2 border-gray-300 flex flex-row flex-wrap gap-x-4 gap-y-3 sm:gap-x-6 items-center print:flex-nowrap print:items-center print:justify-between">
        <div className="min-w-0 flex-1 space-y-2 text-[9px] text-gray-700 leading-relaxed">
          <p className="font-black uppercase tracking-wider text-[10px] text-gray-900">République du Cameroun — Émetteur</p>
          <p className="font-mono tabular-nums">
            RCCM : {COMPANY_LEGAL_ISSUER.rccm} · NIU : {COMPANY_LEGAL_ISSUER.niu}
          </p>
          <p>
            Centre des impôts : {COMPANY_LEGAL_ISSUER.taxOffice} — {COMPANY_LEGAL_ISSUER.taxRegime}. Activité RCCM :{' '}
            {COMPANY_LEGAL_ISSUER.activityDeclared}.
          </p>
          <p>
            Représentant légal : {COMPANY_LEGAL_ISSUER.representative} — Siège principal :{' '}
            {COMPANY_LEGAL_ISSUER.headquartersShort}.
          </p>
          <p className="font-mono">{COMPANY_LEGAL_ISSUER.phoneDisplay}</p>
        </div>
        {showPaidStamp && (
          <div
            className="shrink-0 mx-auto sm:mx-0 flex min-h-[5.5rem] w-full max-w-[11rem] sm:w-[10.5rem] flex-col items-center justify-center print:max-w-[11rem]"
            aria-hidden
          >
            <span
              className="-rotate-[10deg] text-center rounded-xl border-[0.28rem] border-red-700/45 px-4 py-3 font-black uppercase tracking-[0.15em] text-red-700/60 leading-tight shadow-sm [text-shadow:1px_1px_0_rgba(255_255_255_/_0_5)] select-none print:border-red-700/45 print:text-red-800/55"
              style={{ fontSize: data.paidStamp === 'paid_cash' ? 'clamp(0.75rem, 2.8vmin, 0.92rem)' : 'clamp(0.85rem, 3vmin, 1.05rem)' }}
            >
              {paidStampLabel}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row print:flex-row print:justify-between sm:justify-between sm:items-end gap-6 mt-auto pt-6 border-t border-dashed border-gray-200">
        <div className="flex flex-col items-center sm:items-start text-center sm:text-left order-2 sm:order-1 shrink-0">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
            Signature du représentant légal
          </span>
          <img
            src={SIGNATURE_SRC}
            alt={`Signature ${COMPANY_LEGAL_ISSUER.representative}`}
            className="h-[4.25rem] w-auto max-w-[220px] object-contain object-bottom print:h-[4.5rem]"
          />
        </div>
        <div className="text-right text-[10px] text-gray-500 max-w-[min(100%,20rem)] sm:max-w-[42%] ml-auto sm:ml-0 order-1 sm:order-2 flex-1 min-w-0">
          <p className="font-black uppercase text-[9px] text-gray-900 mb-1">
            Bon pour agrément frais professionnels sous réserve validation employeur.
          </p>
          <p>Pour et au nom de {COMPANY_LEGAL_ISSUER.legalTradeName}</p>
          <p className="italic text-[9px] text-gray-400 mt-2">{COMPANY_LEGAL_ISSUER.representative}</p>
        </div>
      </div>
    </div>
  );
});

export default ProInvoicePrintPreview;
