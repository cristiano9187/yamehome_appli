import { ReceiptData } from '../types';
import { getRateForApartment, LOGO_BASE64, formatCurrency } from '../constants';

interface ReceiptPreviewProps {
  data: ReceiptData;
}

export default function ReceiptPreview({ data }: ReceiptPreviewProps) {
  if (!data.lastName && !data.apartmentName) {
    return (
      <div className="w-full max-w-[210mm] h-[297mm] bg-white shadow-lg flex items-center justify-center text-gray-400 italic text-sm">
        Veuillez remplir les détails pour voir l'aperçu.
      </div>
    );
  }

  const diffTime = new Date(data.endDate).getTime() - new Date(data.startDate).getTime();
  const nights = Math.max(0, Math.ceil(diffTime / (1000 * 3600 * 24)));
  
  const rateInfo = getRateForApartment(data.apartmentName, nights);
  
  const totalPaid = data.payments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = data.grandTotal - totalPaid;
  
  const pricePerNight = data.isCustomRate 
    ? (nights > 0 ? Math.round(data.customLodgingTotal / nights) : 0)
    : (data.isNegotiatedRate ? data.negotiatedPricePerNight : rateInfo.prix);

  const lodgingTotal = data.isCustomRate ? data.customLodgingTotal : (pricePerNight * nights);
  
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
        <h1 className="text-2xl font-bold text-[#2B4B8C] uppercase">YAMEHOME : REÇU DE PAIEMENT</h1>
        <p className="text-sm text-gray-600 mt-1">Location d'appartements, chambres et studios meublés</p>
        <p className="text-xs text-gray-500 mt-1">+237 656 751 310 | christian@yamehome.com | www.yamehome.com</p>
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
            <p><span className="font-bold">Tél:</span> {data.phone || 'N/A'}</p>
            <p><span className="font-bold">Email:</span> {data.email || 'N/A'}</p>
          </div>
        </div>
        <div className="border rounded-lg p-3 bg-gray-50 text-[11px]">
          <h3 className="text-[#2B4B8C] font-bold border-b mb-2 uppercase pb-1">Réservation</h3>
          <div className="space-y-1">
            <p className="truncate"><span className="font-bold">Logement:</span> {data.apartmentName}</p>
            <p className="truncate"><span className="font-bold">Lieu:</span> {rateInfo.address}</p>
            <p><span className="font-bold">Séjour:</span> {nights} nuit(s) ({new Date(data.startDate).toLocaleDateString('fr-FR')} - {new Date(data.endDate).toLocaleDateString('fr-FR')})</p>
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
              <td className="py-2 text-right font-semibold">{formatCurrency(rateInfo.caution)}</td>
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
            <tr className="border-t-2 border-gray-300">
              <td className="py-2 pl-2 font-bold text-red-600 uppercase text-xs">Reste à Payer</td>
              <td className="text-right pr-2 font-bold text-red-600 text-lg">{formatCurrency(remaining)}</td>
            </tr>
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
}
