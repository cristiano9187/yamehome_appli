import React from 'react';
import { ProInvoice } from '../types';
import { LOGO_BASE64, formatCurrency, COMPANY_LEGAL_ISSUER } from '../constants';
import { amountFcfaToFrenchWords } from '../utils/frenchNumberWords';

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

      <div className="relative isolate">
        {showPaidStamp && (
          <div
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden rounded-sm"
            aria-hidden
          >
            <span
              className="-rotate-[12deg] whitespace-nowrap rounded-xl border-[0.3rem] border-red-700/45 px-8 py-4 font-black uppercase tracking-[0.2em] text-red-700/55 shadow-sm [text-shadow:1px_1px_0_rgba(255_255_255_/_0_5)] select-none print:border-red-700/40 print:text-red-800/50"
              style={{ fontSize: 'clamp(1.25rem, 4.5vmin, 2rem)' }}
            >
              {paidStampLabel}
            </span>
          </div>
        )}
        <p className="text-center text-sm font-black uppercase tracking-wide underline decoration-[#2B4B8C] decoration-1 underline-offset-4 mb-6 relative z-0">
          Facture N° <span className="font-mono">{data.invoiceNumber}</span>
        </p>

        <div className="mb-6 relative z-0">
          <p className="text-xs font-black uppercase tracking-wider text-gray-500 mb-1">Doit</p>
          <p className="text-base font-black text-gray-900">{data.billedToDisplayName}</p>
        </div>

        <div className="text-center mb-4 relative z-0">
          <p className="font-black uppercase text-base underline underline-offset-2">{data.sectionTitle}</p>
          <p className="text-xs mt-2 underline">{stayRangeLabel(data.startDate, data.endDate)}</p>
          <p className="text-[10px] text-gray-500 mt-1">
            Réf. reçu interne :{' '}
            <span className="font-mono">{data.receiptBusinessId}</span> — {data.apartmentName}
          </p>
        </div>

        <table className="w-full border-collapse border border-gray-300 text-[11px] mb-6 relative z-0">
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

        <p className="text-xs leading-relaxed mb-8 border border-gray-200 rounded-lg px-3 py-2 bg-gray-50/80 relative z-0">
          Arrêtée la présente facture à la somme de {wordsTotal}.
        </p>
      </div>

      <div className="mt-10 pt-4 border-t-2 border-gray-300 space-y-2 text-[9px] text-gray-700 leading-relaxed">
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

      <div className="flex justify-end mt-auto pt-6 border-t border-dashed border-gray-200">
        <div className="text-right text-[10px] text-gray-500 max-w-[42%] ml-auto">
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
