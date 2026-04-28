/** Fuseau IANA du Cameroun (UTC+1, pas d’heure d’été). */
const CAMEROON_TZ = 'Africa/Douala';

/**
 * Retourne l’heure locale au Cameroun au format `HH:mm` (24 h).
 * Indépendant du fuseau du téléphone / navigateur de l’utilisateur.
 */
export function formatCameroonHm(date: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: CAMEROON_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    let hh = '00';
    let mm = '00';
    for (const p of parts) {
      if (p.type === 'hour') hh = p.value.padStart(2, '0');
      if (p.type === 'minute') mm = p.value.padStart(2, '0');
    }
    return `${hh}:${mm}`;
  } catch {
    // Repli : Cameroun = UTC+1 toute l’année (approximation si Intl.timeZone absent)
    let h = date.getUTCHours() + 1;
    const m = date.getUTCMinutes();
    if (h >= 24) h -= 24;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
