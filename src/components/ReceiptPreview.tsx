import React from 'react';
import { Mail, Globe, Phone, MessageCircle, Landmark, Banknote } from 'lucide-react';
import { ReceiptData } from '../types';
import { getRateForApartment, LOGO_BASE64, formatCurrency, RECEIPT_OFFICIAL_PAYMENT_METHODS, RECEIPT_PAYMENT_BADGE_SRC } from '../constants';
import { getReceiptSegments, receiptHasMultipleSegments, totalNightsAcrossReceipt } from '../utils/receiptSegments';

interface ReceiptPreviewProps {
  data: ReceiptData;
  /** Si false : pas de bloc « moyens de paiement » (reçu compact). Défaut côté parent : affiché (voir App). */
  showPaymentMethods?: boolean;
}

/**
 * Normalise un numéro de téléphone pour les protocoles tel: et wa.me/
 * Gère les formats camerounais : 6XXXXXXXX, +2376XXXXXXXX, 002376XXXXXXXX
 */
function normalizePhone(raw: string): { tel: string; wa: string } {
  const digits = raw.replace(/[\s\-\.\(\)]/g, '');
  let international = digits;
  if (digits.startsWith('00')) international = '+' + digits.slice(2);
  else if (digits.startsWith('237')) international = '+' + digits;
  else if (!digits.startsWith('+')) international = '+237' + digits;
  const waDigits = international.replace(/[^\d]/g, '');
  return { tel: international, wa: waDigits };
}

/**
 * Sur le PDF, les libellés « … APPARTEMENT … STUDIO » sont souvent coupés avant « mode studio ».
 * Si le nom contient STUDIO, on remplace « Appartement » / « Appartements » par « APT » pour l’affichage uniquement.
 */
function formatApartmentNameForPdfDisplay(name: string): string {
  if (!name.trim()) return name;
  if (!name.toUpperCase().includes('STUDIO')) return name;
  return name.replace(/\bappartements?\b/gi, 'APT');
}

const ReceiptPreview = React.memo(({ data, showPaymentMethods = false }: ReceiptPreviewProps) => {
  if (!data.lastName && !data.apartmentName) {
    return (
      <div className="w-full max-w-[210mm] h-[297mm] bg-white shadow-lg flex items-center justify-center text-gray-400 italic text-sm">
        Veuillez remplir les détails pour voir l'aperçu.
      </div>
    );
  }

  const segments = getReceiptSegments(data);
  const multiStay = receiptHasMultipleSegments(data);
  const nights = multiStay
    ? totalNightsAcrossReceipt(data)
    : Math.max(0, Math.ceil((new Date(data.endDate).getTime() - new Date(data.startDate).getTime()) / (1000 * 3600 * 24)));
  
  const rateInfo = getRateForApartment(data.apartmentName, nights);
  
  const totalPaid = data.payments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = data.grandTotal - totalPaid;
  
  const pricePerNight = data.isCustomRate 
    ? (nights > 0 ? Math.round(data.customLodgingTotal / nights) : 0)
    : (data.isNegotiatedRate ? data.negotiatedPricePerNight : rateInfo.prix);

  const lodgingTotal = data.isCustomRate ? data.customLodgingTotal : (pricePerNight * nights);

  /** Caution : total enregistré sur le reçu (somme segments en multi-barème dans l’app). */
  const cautionDisplay = multiStay ? data.cautionAmount : rateInfo.caution;

  const latePenalty = Math.round(pricePerNight / 2);

  const basePrice = rateInfo.prix;
  const discountPercent = (data.isNegotiatedRate || data.isCustomRate) && basePrice > 0 && pricePerNight < basePrice
    ? Math.round(((basePrice - pricePerNight) / basePrice) * 100)
    : 0;

  const priceLabel = data.isCustomRate 
    ? '(Ajusté Plateforme)' 
    : (data.isNegotiatedRate ? '(Tarif Négocié)' : '');

  const isAppartement = data.apartmentName.toUpperCase().includes('APPARTEMENT') && !data.apartmentName.toUpperCase().includes('STUDIO');
  const isStudio = data.apartmentName.toUpperCase().includes('STUDIO');

  const logementDisplay = formatApartmentNameForPdfDisplay(data.apartmentName);
  
  const kwPerNightEco = isAppartement ? 8 : 6;
  const totalKwEco = kwPerNightEco * nights;

  let kwPerNightConfort = 8; // Default for Chambre
  let towelsCount = 2;
  if (isAppartement) {
    kwPerNightConfort = 15;
    towelsCount = 4;
  } else if (isStudio) {
    kwPerNightConfort = 10;
    towelsCount = 2;
  }
  const totalKwConfort = kwPerNightConfort * nights;

  return (
    <div id="receipt-content" className="print-container w-full max-w-[210mm] min-h-[297mm] bg-white shadow-2xl p-10 text-gray-800 font-sans print:shadow-none print:p-0 relative">
      {/* Header */}
      <div className="text-center mb-6 border-b-2 border-[#2B4B8C] pb-4">
        <div className="mb-4 flex justify-center">
          {LOGO_BASE64 ? (
            <img 
              src={LOGO_BASE64} 
              alt="YameHome Logo" 
              className="h-12 object-contain"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-20 h-12 bg-gray-50 flex flex-col items-center justify-center border border-dashed border-gray-300 rounded text-gray-400">
              <span className="text-[8px] font-bold uppercase tracking-wider">Logo YameHome</span>
            </div>
          )}
        </div>
        <p className="text-2xl font-bold text-[#2B4B8C] uppercase">YAMEHOME : REÇU DE PAIEMENT</p>
        <p className="text-sm text-gray-600 mt-1">Location d'appartements, chambres et studios meublés</p>
        <div className="text-[10px] text-gray-500 mt-2 flex items-center justify-center gap-4 flex-wrap">
          <a 
            href="https://wa.me/237657507671" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="flex items-center gap-1.5 hover:text-green-600 transition-colors group"
          >
            <Phone size={11} className="text-green-600" />
            <span className="font-semibold">+237 6 57 50 76 71</span>
            <span className="text-[9px] opacity-80">(WhatsApp - Agent IA 24h/24)</span>
          </a>
          <span className="text-gray-300">|</span>
          <div className="flex items-center gap-1.5">
            <Mail size={11} className="text-[#2B4B8C]" />
            <span>christian@yamehome.com</span>
          </div>
          <span className="text-gray-300">|</span>
          <a 
            href="https://www.yamehome.com" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="flex items-center gap-1.5 hover:text-blue-600 transition-colors"
          >
            <Globe size={11} className="text-[#2B4B8C]" />
            <span>www.yamehome.com</span>
          </a>
        </div>
        <div className="mt-2 text-xs font-semibold text-gray-700">
          Date d'émission: {new Date(data.createdAt).toLocaleDateString('fr-FR')} | N°: {data.receiptId}
        </div>
      </div>

      {/* Client & Reservation Boxes */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="border rounded-lg p-3 bg-gray-50 text-[11px]">
          <h3 className="text-[#2B4B8C] font-bold border-b mb-2 uppercase pb-1">Client</h3>
          <div className="space-y-1">
            <p><span className="font-bold">Nom:</span> {data.firstName} {data.lastName}</p>
            <p className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold">Tél:</span>
              {data.phone ? (
                <>
                  <a
                    href={`tel:${normalizePhone(data.phone).tel}`}
                    className="text-blue-700 hover:underline font-mono"
                    title="Appeler"
                  >
                    {data.phone}
                  </a>
                  <a
                    href={`https://wa.me/${normalizePhone(data.phone).wa}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 bg-green-100 text-green-700 px-1.5 py-0.5 rounded-md text-[9px] font-black hover:bg-green-200 transition-colors print:hidden"
                    title="Ouvrir dans WhatsApp"
                  >
                    <MessageCircle size={9} />
                    WhatsApp
                  </a>
                </>
              ) : 'N/A'}
            </p>
            <p className="flex items-center gap-1.5">
              <span className="font-bold">Email:</span>
              {data.email ? (
                <a
                  href={`mailto:${data.email}`}
                  className="text-blue-700 hover:underline"
                  title="Envoyer un email"
                >
                  {data.email}
                </a>
              ) : 'N/A'}
            </p>
          </div>
        </div>
        <div className="border rounded-lg p-3 bg-gray-50 text-[11px]">
          <h3 className="text-[#2B4B8C] font-bold border-b mb-2 uppercase pb-1">Réservation</h3>
          <div className="space-y-1">
            <p className="break-words leading-snug">
              <span className="font-bold">Logement:</span> {logementDisplay}
            </p>
            <p className="truncate"><span className="font-bold">Lieu:</span> {rateInfo.address}</p>
            <p><span className="font-bold">Séjour :</span> {nights} nuit(s) — du {new Date(data.startDate).toLocaleDateString('fr-FR')} au {new Date(data.endDate).toLocaleDateString('fr-FR')}
              {multiStay ? ' (plusieurs plages)' : ''}
            </p>
            {multiStay && (
              <ul className="mt-1 pl-3 list-disc text-[10px] text-gray-600 space-y-0.5">
                {segments.map((s) => (
                  <li key={s.id} className="break-words">
                    {formatApartmentNameForPdfDisplay(s.apartmentName)} — {s.calendarSlug} —{' '}
                    {new Date(s.startDate).toLocaleDateString('fr-FR')} → {new Date(s.endDate).toLocaleDateString('fr-FR')}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Financial Details */}
      <div className="mb-6">
        <h3 className="text-[#2B4B8C] font-bold mb-3 text-sm uppercase">Détails Financiers</h3>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-t">
              <td className="py-2">Prix par nuit {priceLabel}</td>
              <td className="py-2 text-right font-semibold">
                <div className="flex flex-col items-end">
                  <span>{formatCurrency(pricePerNight)}</span>
                  {discountPercent > 0 && (
                    <span className="text-green-700 italic text-[10px]">
                      Remise appliquée (-{discountPercent}%) vs Std: {formatCurrency(basePrice)}
                    </span>
                  )}
                </div>
              </td>
            </tr>
            <tr className="border-t">
              <td className="py-2">Sous-total Séjour</td>
              <td className="py-2 text-right font-semibold">{formatCurrency(lodgingTotal)}</td>
            </tr>
            <tr className="border-b">
              <td className="py-2">Caution (Remboursable)</td>
              <td className="py-2 text-right font-semibold">{formatCurrency(cautionDisplay)}</td>
            </tr>
            <tr className="bg-blue-50 font-bold">
              <td className="py-2 pl-2">Montant Total à Payer</td>
              <td className="py-2 pr-2 text-right text-base">{formatCurrency(data.grandTotal)}</td>
            </tr>
            
            {/* Payment History */}
            {data.payments.filter(p => p.amount > 0).map((p) => (
              <tr key={p.id} className="text-green-700 text-xs border-b border-green-50">
                <td className="py-1.5 pl-2 italic">Versement le {new Date(p.date).toLocaleDateString('fr-FR')} ({p.method})</td>
                <td className="pr-2 text-right font-bold">+ {formatCurrency(p.amount)}</td>
              </tr>
            ))}

            <tr className="bg-green-50 font-bold text-green-800 border-t-2 border-green-200">
              <td className="py-2 pl-2">TOTAL REÇU</td>
              <td className="text-right pr-2 text-base">{totalPaid.toLocaleString()} XAF</td>
            </tr>
            {showPaymentMethods ? (
              <tr className="border-t-2 border-gray-300 align-top bg-gray-50/80">
                <td className="py-3 pl-2 align-top text-[9px] text-gray-800 leading-snug pr-3">
                  <p className="font-bold text-[#2B4B8C] uppercase text-[10px] mb-1.5 tracking-wide">
                    Moyens de paiement officiels
                  </p>
                  <div className="space-y-1.5">
                    <div className="flex gap-1.5 items-start">
                      <div className="flex shrink-0 gap-0.5 mt-0.5">
                        <img
                          src={RECEIPT_PAYMENT_BADGE_SRC.orange}
                          alt=""
                          width={18}
                          height={18}
                          className="rounded-sm object-contain"
                        />
                        <img
                          src={RECEIPT_PAYMENT_BADGE_SRC.mtn}
                          alt=""
                          width={18}
                          height={18}
                          className="rounded-sm object-contain"
                        />
                      </div>
                      <span className="leading-snug">
                        <strong className="text-gray-900">Orange Money</strong>
                        {' · code marchand'}{' '}
                        <span className="font-mono font-bold">
                          {RECEIPT_OFFICIAL_PAYMENT_METHODS.orangeMoney.merchantCode}
                        </span>
                        {' · '}
                        <strong className="text-gray-900">MTN MoMo</strong>
                        {' ('}
                        <span className="italic text-gray-700">
                          {RECEIPT_OFFICIAL_PAYMENT_METHODS.mtnMoMo.pendingNotice}
                        </span>
                        {')'}
                        {' · '}
                        <span className="font-semibold">{RECEIPT_OFFICIAL_PAYMENT_METHODS.orangeMoney.merchantAccountName}</span>
                        {RECEIPT_OFFICIAL_PAYMENT_METHODS.orangeMoney.provisional ? (
                          <em className="text-gray-600 not-italic text-[8px] ml-0.5">(provisoire)</em>
                        ) : null}
                      </span>
                    </div>
                    <div className="flex gap-1.5 items-start">
                      <div className="flex shrink-0 gap-0.5 text-[#2B4B8C] mt-0.5" aria-hidden>
                        <Landmark size={17} strokeWidth={2} />
                        <Banknote size={17} className="text-emerald-700" strokeWidth={2} />
                      </div>
                      <span className="leading-snug">
                        {RECEIPT_OFFICIAL_PAYMENT_METHODS.ribLine.replace(/\.$/, '')}
                        {' · '}
                        {RECEIPT_OFFICIAL_PAYMENT_METHODS.cashLine}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="py-3 pr-2 align-middle text-right whitespace-nowrap border-l border-gray-200">
                  <div className="inline-block text-right pl-3">
                    <div className="font-bold text-red-600 uppercase text-xs leading-tight">Reste à Payer</div>
                    <div className="font-bold text-red-600 text-lg tabular-nums">{formatCurrency(remaining)}</div>
                  </div>
                </td>
              </tr>
            ) : (
              <tr className="border-t-2 border-gray-300">
                <td className="py-2 pl-2 font-bold text-red-600 uppercase text-xs">Reste à Payer</td>
                <td className="text-right pr-2 font-bold text-red-600 text-lg tabular-nums">{formatCurrency(remaining)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Observations & Conditions */}
      <div className="border rounded-lg p-4 bg-gray-50 mb-8 text-[11px]">
        <h3 className="font-bold text-gray-700 mb-2 uppercase">Observations & Conditions</h3>
        <ul className="list-disc pl-4 space-y-1 text-gray-600">
          <li>Check-in: 15h00 | Check-out: 11h30.</li>
          <li>Départ tardif: pénalité de {formatCurrency(latePenalty)}.</li>
          {data.electricityCharge && (
            <li>
              <strong>Électricité à la charge du client :</strong> Le client devra entièrement prendre en charge sa consommation d'électricité via le compteur prépayé présent dans le logement. Le ménage est prévu tous les 3 jours et le change du linge de lit tous les 3 jours.
            </li>
          )}
          {data.packEco && (
            <li>
              <strong>Pack ECO appliqué :</strong> Nous vous offrons en guise de bienvenue un forfait de <strong>{totalKwEco} kW</strong> ({kwPerNightEco} kW/nuit) d'électricité. Le ménage est prévu tous les 3 jours et le change du linge de lit tous les 3 jours. Tout excédent sera à la charge du voyageur.
            </li>
          )}
          {data.packConfort && (
            <li>
              <strong>Pack CONFORT appliqué :</strong> Nous vous offrons en guise de bienvenue un forfait de <strong>{totalKwConfort} kW</strong> ({kwPerNightConfort} kW/nuit) d'électricité. Le ménage est prévu tous les 2 jours, le change du linge de lit tous les 2 jours et {towelsCount} serviettes sont fournies à l'arrivée. Tout excédent sera à la charge du voyageur.
            </li>
          )}
          <li className="mt-1">
            <span className="font-bold underline text-gray-700">Politique d'Annulation (1/3 Sous-total Séjour) :</span>
            <ul className="list-disc ml-5 mt-1 space-y-1">
              <li><span className="font-semibold text-green-700">100% remboursé :</span> Annulation sous 24h (si séjour dans +14j).</li>
              <li><span className="font-semibold text-orange-600">50% remboursé :</span> Jusqu'à 7 jours avant l'arrivée.</li>
              <li><span className="font-semibold text-red-600">Non remboursable :</span> Moins de 7 jours avant l'arrivée.</li>
            </ul>
          </li>
          {data.observations && <li><em>Note: {data.observations}</em></li>}
        </ul>
        {data.hosts.length > 0 && (
          <div className="mt-3 pt-2 border-t border-gray-200 font-semibold text-[10px]">
            Vos hôtes sur place : {data.hosts.join(', ')}
          </div>
        )}
      </div>

      {/* Signature */}
      <div className="mt-auto flex justify-end pr-4">
        <div className="text-center">
          <p className="text-[#2B4B8C] font-bold text-lg italic">{data.signature || 'PAOLA'}</p>
          <div className="border-t border-gray-400 mt-1 pt-1">
            <p className="text-[10px] font-bold uppercase text-gray-500">SIGNATURE GÉRANT / YAMEHOME</p>
          </div>
        </div>
      </div>
      <p className="text-center text-[10px] text-gray-400 italic mt-8">Merci pour votre confiance !</p>
    </div>
  );
});

export default ReceiptPreview;
