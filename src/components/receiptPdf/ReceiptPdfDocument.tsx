import React from 'react';
import { Document, Page, View, Text, Image, Link, StyleSheet } from '@react-pdf/renderer';
import { ReceiptData } from '../../types';
import { LOGO_BASE64, RECEIPT_OFFICIAL_PAYMENT_METHODS } from '../../constants';
import { computeReceiptCalculations, formatApartmentNameForPdfDisplay, normalizePhone, buildReceiptFileName } from '../../utils/receiptCalculations';

const BLUE = '#2B4B8C';

/**
 * `formatCurrency` (constants.ts) et `Number.prototype.toLocaleString('fr-FR')` utilisent un
 * espace fine insécable (U+202F) comme séparateur de milliers. Ce caractère n'existe pas dans
 * l'encodage WinAnsi des polices PDF standard (Helvetica) : il s'affichait comme un glyphe
 * incorrect (ex. « 45/000 » au lieu de « 45 000 »). On reformate donc les montants localement
 * avec un espace ASCII classique, sûr dans tout lecteur PDF.
 */
function formatMoneyForPdf(amount: number, suffix: string = 'FCFA'): string {
  const rounded = Math.round(amount || 0);
  const sign = rounded < 0 ? '-' : '';
  const grouped = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${grouped} ${suffix}`;
}

/**
 * Les polices PDF standard (14 polices Adobe, encodage WinAnsi) ne garantissent un rendu fiable
 * que pour l'ASCII imprimable + les lettres latines accentuées (Latin-1, ex. é, è, ç, É). Toute
 * ponctuation « typographique » (tirets cadratins, flèches, puces, points médians, espaces
 * fines/insécables, guillemets courbes, emoji…) est silencieusement supprimée par le moteur de
 * rendu — le texte se retrouve tronqué sans avertissement (ex. « Chambre A  Chambre B » au lieu
 * de « Chambre A -> Chambre B »). On neutralise donc systématiquement ces caractères, y compris
 * dans le texte libre saisi par les opérateurs (observations…), pour qu'aucune information ne
 * disparaisse jamais du PDF exporté.
 */
function pdfSafeText(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '';
  const str = String(input).normalize('NFC');
  return str
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2192\u21D2\u21E8]/g, '->')
    .replace(/[\u2190\u21D0\u21E6]/g, '<-')
    .replace(/\u2026/g, '...')
    .replace(/[\u00B7\u2022\u25CF\u25AA\u2023]/g, '-')
    .replace(/[\u00A0\u202F\u2000-\u200A\u2028\u2029]/g, ' ')
    // Filet de sécurité final : tout ce qui reste hors ASCII imprimable / Latin-1 (accents FR) disparaît.
    .replace(/[^\x20-\x7E\u00A1-\u00FF]/g, '');
}

const styles = StyleSheet.create({
  page: {
    padding: 26,
    fontSize: 8.5,
    fontFamily: 'Helvetica',
    color: '#27272a',
  },
  header: {
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: BLUE,
    paddingBottom: 8,
    marginBottom: 10,
  },
  logo: { height: 34, marginBottom: 6, objectFit: 'contain' },
  title: { fontSize: 15, fontWeight: 700, color: BLUE, textTransform: 'uppercase', textAlign: 'center' },
  subtitle: { fontSize: 8.5, color: '#57534e', marginTop: 2, textAlign: 'center' },
  contactRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  contactText: { fontSize: 7.5, color: '#57534e' },
  contactSep: { fontSize: 7.5, color: '#d6d3d1' },
  metaLine: { fontSize: 8, fontWeight: 700, color: '#3f3f46', marginTop: 6, textAlign: 'center' },

  boxesRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  box: { flex: 1, borderWidth: 1, borderColor: '#e7e5e4', borderRadius: 4, backgroundColor: '#fafaf9', padding: 7 },
  boxTitle: {
    fontSize: 8,
    fontWeight: 700,
    color: BLUE,
    textTransform: 'uppercase',
    borderBottomWidth: 1,
    borderBottomColor: '#e7e5e4',
    paddingBottom: 3,
    marginBottom: 4,
  },
  boxLine: { fontSize: 8, marginBottom: 2, lineHeight: 1.35 },
  bold: { fontWeight: 700 },
  segmentItem: { fontSize: 7, color: '#57534e', marginBottom: 1.5, paddingLeft: 6 },

  sectionTitle: { fontSize: 9.5, fontWeight: 700, color: BLUE, textTransform: 'uppercase', marginBottom: 5 },

  table: { borderTopWidth: 1, borderTopColor: '#e7e5e4', marginBottom: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e7e5e4',
  },
  rowLabel: { fontSize: 8.5 },
  rowValue: { fontSize: 8.5, fontWeight: 700, textAlign: 'right' },
  discountNote: { fontSize: 7, color: '#15803d', fontStyle: 'italic', textAlign: 'right', marginTop: 1 },
  totalRow: { backgroundColor: '#eff6ff', paddingHorizontal: 4 },
  totalLabel: { fontSize: 9, fontWeight: 700 },
  totalValue: { fontSize: 10.5, fontWeight: 700 },
  paymentRow: { borderBottomColor: '#f0fdf4' },
  paymentLabel: { fontSize: 7.5, color: '#15803d', fontStyle: 'italic' },
  paymentValue: { fontSize: 7.5, color: '#15803d', fontWeight: 700 },
  receivedRow: { backgroundColor: '#f0fdf4', borderTopWidth: 2, borderTopColor: '#bbf7d0', paddingHorizontal: 4 },
  receivedLabel: { fontSize: 9, fontWeight: 700, color: '#166534' },
  receivedValue: { fontSize: 10.5, fontWeight: 700, color: '#166534' },
  remainingRow: { borderTopWidth: 2, borderTopColor: '#d6d3d1', paddingHorizontal: 4 },
  remainingLabel: { fontSize: 8.5, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase' },
  remainingValue: { fontSize: 11, fontWeight: 700, color: '#dc2626' },

  paymentMethodsRow: { backgroundColor: '#fafaf9', borderTopWidth: 2, borderTopColor: '#d6d3d1' },
  paymentMethodsLeft: { flex: 1, padding: 6, paddingRight: 8 },
  paymentMethodsTitle: { fontSize: 7.5, fontWeight: 700, color: BLUE, textTransform: 'uppercase', marginBottom: 3 },
  paymentMethodLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  badge: { width: 13, height: 13, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 5, fontWeight: 700, color: '#ffffff' },
  paymentMethodText: { fontSize: 6.8, color: '#3f3f46', flex: 1 },
  paymentMethodsRight: {
    justifyContent: 'center',
    alignItems: 'flex-end',
    padding: 6,
    borderLeftWidth: 1,
    borderLeftColor: '#e7e5e4',
    minWidth: 90,
  },

  obsBox: { borderWidth: 1, borderColor: '#e7e5e4', borderRadius: 4, backgroundColor: '#fafaf9', padding: 8, marginBottom: 16 },
  obsTitle: { fontSize: 8.5, fontWeight: 700, color: '#44403c', textTransform: 'uppercase', marginBottom: 4 },
  bulletRow: { flexDirection: 'row', marginBottom: 2.5 },
  bulletMark: { fontSize: 7.5, width: 8, color: '#57534e' },
  bulletText: { fontSize: 7.5, color: '#57534e', flex: 1, lineHeight: 1.4 },
  underline: { fontWeight: 700, textDecoration: 'underline' },
  subBulletRow: { flexDirection: 'row', marginBottom: 2, marginLeft: 10 },

  footer: { marginTop: 10 },
  signatureWrap: { alignItems: 'flex-end', paddingRight: 8 },
  signatureBlock: { alignItems: 'center' },
  signatureName: { fontSize: 12, fontWeight: 700, color: BLUE, fontStyle: 'italic', marginBottom: 3 },
  signatureCaption: {
    fontSize: 6.5,
    fontWeight: 700,
    color: '#78716c',
    textTransform: 'uppercase',
    textAlign: 'center',
    borderTopWidth: 1,
    borderTopColor: '#a8a29e',
    paddingTop: 2,
    minWidth: 130,
  },
  thanksText: { fontSize: 7.5, color: '#78716c', fontStyle: 'italic', textAlign: 'center', marginTop: 14 },
});

interface ReceiptPdfDocumentProps {
  data: ReceiptData;
  showPaymentMethods?: boolean;
}

/**
 * Génération PDF « native » (vecteur, pas de capture d'écran / pas de window.print()).
 * Rend exactement les mêmes données que ReceiptPreview (calculs partagés via receiptCalculations.ts)
 * mais produit un vrai fichier PDF, identique quel que soit le navigateur / l'appareil (PC, iPhone, Android, MIUI…).
 * Si le contenu dépasse une page (cas rare : nombreux paiements / segments), react-pdf ajoute
 * automatiquement une page suivante — aucune information n'est jamais tronquée.
 */
export default function ReceiptPdfDocument({ data, showPaymentMethods = false }: ReceiptPdfDocumentProps) {
  const {
    segments,
    multiStay,
    nights,
    lodgingTotal,
    cautionDisplay,
    latePenalty,
    basePrice,
    discountPercent,
    priceLabel,
    logementDisplay,
    rateInfo,
    totalKwEco,
    kwPerNightEco,
    totalKwConfort,
    kwPerNightConfort,
    towelsCount,
    totalPaid,
    remaining,
    pricePerNight,
  } = computeReceiptCalculations(data);

  const phoneInfo = data.phone ? normalizePhone(data.phone) : null;

  return (
    <Document title={buildReceiptFileName(data)} author="YameHome">
      <Page size="A4" style={styles.page} wrap>
        {/* Header */}
        <View style={styles.header}>
          {LOGO_BASE64 ? <Image src={LOGO_BASE64} style={styles.logo} /> : null}
          <Text style={styles.title}>YAMEHOME : REÇU DE PAIEMENT</Text>
          <Text style={styles.subtitle}>Location d'appartements, chambres et studios meublés</Text>
          <View style={styles.contactRow}>
            <Link src="https://wa.me/237657507671" style={styles.contactText}>
              +237 6 57 50 76 71 (WhatsApp - Agent IA 24h/24)
            </Link>
            <Text style={styles.contactSep}>|</Text>
            <Link src="mailto:christian@yamehome.com" style={styles.contactText}>
              christian@yamehome.com
            </Link>
            <Text style={styles.contactSep}>|</Text>
            <Link src="https://www.yamehome.com" style={styles.contactText}>
              www.yamehome.com
            </Link>
          </View>
          <Text style={styles.metaLine}>
            Date d'émission: {new Date(data.createdAt).toLocaleDateString('fr-FR')} | N: {pdfSafeText(data.receiptId)}
          </Text>
        </View>

        {/* Client & Reservation */}
        <View style={styles.boxesRow}>
          <View style={styles.box}>
            <Text style={styles.boxTitle}>Client</Text>
            <Text style={styles.boxLine}>
              <Text style={styles.bold}>Nom: </Text>
              {pdfSafeText(data.firstName)} {pdfSafeText(data.lastName)}
            </Text>
            <Text style={styles.boxLine}>
              <Text style={styles.bold}>Tél: </Text>
              {data.phone && phoneInfo ? (
                <Link src={`tel:${phoneInfo.tel}`}>{pdfSafeText(data.phone)}</Link>
              ) : (
                'N/A'
              )}
            </Text>
            <Text style={styles.boxLine}>
              <Text style={styles.bold}>Email: </Text>
              {data.email ? <Link src={`mailto:${data.email}`}>{pdfSafeText(data.email)}</Link> : 'N/A'}
            </Text>
          </View>
          <View style={styles.box}>
            <Text style={styles.boxTitle}>Réservation</Text>
            <Text style={styles.boxLine}>
              <Text style={styles.bold}>Logement: </Text>
              {pdfSafeText(logementDisplay)}
            </Text>
            <Text style={styles.boxLine}>
              <Text style={styles.bold}>Lieu: </Text>
              {pdfSafeText(rateInfo.address)}
            </Text>
            <Text style={styles.boxLine}>
              <Text style={styles.bold}>Séjour: </Text>
              {nights} nuit(s) - du {new Date(data.startDate).toLocaleDateString('fr-FR')} au{' '}
              {new Date(data.endDate).toLocaleDateString('fr-FR')}
              {multiStay ? ' (plusieurs plages)' : ''}
            </Text>
            {multiStay &&
              segments.map((s) => (
                <Text key={s.id} style={styles.segmentItem}>
                  - {pdfSafeText(formatApartmentNameForPdfDisplay(s.apartmentName))} - {pdfSafeText(s.calendarSlug)} -{' '}
                  {new Date(s.startDate).toLocaleDateString('fr-FR')} -{'>'} {new Date(s.endDate).toLocaleDateString('fr-FR')}
                </Text>
              ))}
          </View>
        </View>

        {/* Financial Details */}
        <Text style={styles.sectionTitle}>Détails Financiers</Text>
        <View style={styles.table}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Prix par nuit {priceLabel}</Text>
            <View>
              <Text style={styles.rowValue}>{formatMoneyForPdf(pricePerNight)}</Text>
              {discountPercent > 0 && (
                <Text style={styles.discountNote}>
                  Remise appliquée (-{discountPercent}%) vs Std: {formatMoneyForPdf(basePrice)}
                </Text>
              )}
            </View>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Sous-total Séjour</Text>
            <Text style={styles.rowValue}>{formatMoneyForPdf(lodgingTotal)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Caution (Remboursable)</Text>
            <Text style={styles.rowValue}>{formatMoneyForPdf(cautionDisplay)}</Text>
          </View>
          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Montant Total à Payer</Text>
            <Text style={styles.totalValue}>{formatMoneyForPdf(data.grandTotal)}</Text>
          </View>

          {data.payments
            .filter((p) => p.amount > 0)
            .map((p) => (
              <View key={p.id} style={[styles.row, styles.paymentRow]}>
                <Text style={styles.paymentLabel}>
                  Versement le {new Date(p.date).toLocaleDateString('fr-FR')} ({pdfSafeText(p.method)})
                </Text>
                <Text style={styles.paymentValue}>+ {formatMoneyForPdf(p.amount)}</Text>
              </View>
            ))}

          <View style={[styles.row, styles.receivedRow]}>
            <Text style={styles.receivedLabel}>TOTAL REÇU</Text>
            <Text style={styles.receivedValue}>{formatMoneyForPdf(totalPaid, 'XAF')}</Text>
          </View>

          {showPaymentMethods ? (
            <View style={[styles.row, styles.paymentMethodsRow]}>
              <View style={styles.paymentMethodsLeft}>
                <Text style={styles.paymentMethodsTitle}>Moyens de paiement officiels</Text>
                <View style={styles.paymentMethodLine}>
                  <View style={[styles.badge, { backgroundColor: '#FF6600' }]}>
                    <Text style={styles.badgeText}>OM</Text>
                  </View>
                  <Text style={styles.paymentMethodText}>
                    <Text style={styles.bold}>Orange Money</Text> - code marchand{' '}
                    <Text style={styles.bold}>{RECEIPT_OFFICIAL_PAYMENT_METHODS.orangeMoney.merchantCode}</Text> -{' '}
                    {RECEIPT_OFFICIAL_PAYMENT_METHODS.orangeMoney.merchantAccountName}
                  </Text>
                </View>
                <View style={styles.paymentMethodLine}>
                  <View style={[styles.badge, { backgroundColor: '#FFCB05' }]}>
                    <Text style={[styles.badgeText, { color: '#111827' }]}>MTN</Text>
                  </View>
                  <Text style={styles.paymentMethodText}>
                    <Text style={styles.bold}>MTN MoMo</Text> ({RECEIPT_OFFICIAL_PAYMENT_METHODS.mtnMoMo.pendingNotice}) -{' '}
                    {RECEIPT_OFFICIAL_PAYMENT_METHODS.mtnMoMo.merchantAccountName}
                  </Text>
                </View>
                <View style={styles.paymentMethodLine}>
                  <View style={[styles.badge, { backgroundColor: BLUE }]}>
                    <Text style={styles.badgeText}>B</Text>
                  </View>
                  <Text style={styles.paymentMethodText}>
                    {pdfSafeText(RECEIPT_OFFICIAL_PAYMENT_METHODS.ribLine.replace(/\.$/, ''))}
                  </Text>
                </View>
                <View style={styles.paymentMethodLine}>
                  <View style={[styles.badge, { backgroundColor: '#047857' }]}>
                    <Text style={styles.badgeText}>ESP</Text>
                  </View>
                  <Text style={styles.paymentMethodText}>{pdfSafeText(RECEIPT_OFFICIAL_PAYMENT_METHODS.cashLine)}</Text>
                </View>
              </View>
              <View style={styles.paymentMethodsRight}>
                <Text style={styles.remainingLabel}>Reste à Payer</Text>
                <Text style={styles.remainingValue}>{formatMoneyForPdf(remaining)}</Text>
              </View>
            </View>
          ) : (
            <View style={[styles.row, styles.remainingRow]}>
              <Text style={styles.remainingLabel}>Reste à Payer</Text>
              <Text style={styles.remainingValue}>{formatMoneyForPdf(remaining)}</Text>
            </View>
          )}
        </View>

        {/* Observations & Conditions */}
        <View style={styles.obsBox}>
          <Text style={styles.obsTitle}>Observations & Conditions</Text>
          <View style={styles.bulletRow}>
            <Text style={styles.bulletMark}>-</Text>
            <Text style={styles.bulletText}>Check-in: 15h00 | Check-out: 11h30.</Text>
          </View>
          <View style={styles.bulletRow}>
            <Text style={styles.bulletMark}>-</Text>
            <Text style={styles.bulletText}>Départ tardif: pénalité de {formatMoneyForPdf(latePenalty)}.</Text>
          </View>
          {data.electricityCharge && (
            <View style={styles.bulletRow}>
              <Text style={styles.bulletMark}>-</Text>
              <Text style={styles.bulletText}>
                <Text style={styles.bold}>Électricité à la charge du client : </Text>
                Le client devra entièrement prendre en charge sa consommation d'électricité via le compteur prépayé
                présent dans le logement. Le ménage est prévu tous les 3 jours et le change du linge de lit tous les 3
                jours.
              </Text>
            </View>
          )}
          {data.packEco && (
            <View style={styles.bulletRow}>
              <Text style={styles.bulletMark}>-</Text>
              <Text style={styles.bulletText}>
                <Text style={styles.bold}>Pack ECO appliqué : </Text>
                Nous vous offrons en guise de bienvenue un forfait de <Text style={styles.bold}>{totalKwEco} kW</Text> (
                {kwPerNightEco} kW/nuit) d'électricité. Le ménage est prévu tous les 3 jours et le change du linge de
                lit tous les 3 jours. Tout excédent sera à la charge du voyageur.
              </Text>
            </View>
          )}
          {data.packConfort && (
            <View style={styles.bulletRow}>
              <Text style={styles.bulletMark}>-</Text>
              <Text style={styles.bulletText}>
                <Text style={styles.bold}>Pack CONFORT appliqué : </Text>
                Nous vous offrons en guise de bienvenue un forfait de <Text style={styles.bold}>{totalKwConfort} kW</Text>{' '}
                ({kwPerNightConfort} kW/nuit) d'électricité. Le ménage est prévu tous les 2 jours, le change du linge de
                lit tous les 2 jours et {towelsCount} serviettes sont fournies à l'arrivée. Tout excédent sera à la
                charge du voyageur.
              </Text>
            </View>
          )}
          <View style={styles.bulletRow}>
            <Text style={styles.bulletMark}>-</Text>
            <Text style={[styles.bulletText, styles.underline]}>
              Politique d'Annulation (1/3 Sous-total Séjour) :
            </Text>
          </View>
          <View style={styles.subBulletRow}>
            <Text style={styles.bulletMark}>-</Text>
            <Text style={styles.bulletText}>
              <Text style={[styles.bold, { color: '#15803d' }]}>100% remboursé : </Text>
              Annulation sous 24h (si séjour dans +14j).
            </Text>
          </View>
          <View style={styles.subBulletRow}>
            <Text style={styles.bulletMark}>-</Text>
            <Text style={styles.bulletText}>
              <Text style={[styles.bold, { color: '#c2410c' }]}>50% remboursé : </Text>
              Jusqu'à 7 jours avant l'arrivée.
            </Text>
          </View>
          <View style={styles.subBulletRow}>
            <Text style={styles.bulletMark}>-</Text>
            <Text style={styles.bulletText}>
              <Text style={[styles.bold, { color: '#dc2626' }]}>Non remboursable : </Text>
              Moins de 7 jours avant l'arrivée.
            </Text>
          </View>
          {data.observations && (
            <View style={styles.bulletRow}>
              <Text style={styles.bulletMark}>-</Text>
              <Text style={[styles.bulletText, { fontStyle: 'italic' }]}>Note: {pdfSafeText(data.observations)}</Text>
            </View>
          )}
          {data.hosts.length > 0 && (
            <Text style={{ fontSize: 7, fontWeight: 700, marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: '#e7e5e4' }}>
              Vos hôtes sur place : {pdfSafeText(data.hosts.join(', '))}
            </Text>
          )}
        </View>

        {/* Signature & remerciement */}
        <View style={styles.footer} wrap={false}>
          <View style={styles.signatureWrap}>
            <View style={styles.signatureBlock}>
              <Text style={styles.signatureName}>{pdfSafeText(data.signature) || 'PAOLA'}</Text>
              <Text style={styles.signatureCaption}>SIGNATURE GÉRANT / YAMEHOME</Text>
            </View>
          </View>
          <Text style={styles.thanksText}>Merci pour votre confiance !</Text>
        </View>
      </Page>
    </Document>
  );
}
