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

/** Heure & minute locales au Cameroun (0–23, 0–59). */
export function getCameroonHourMinute(date: Date): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: CAMEROON_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    let hour = 0;
    let minute = 0;
    for (const p of parts) {
      if (p.type === 'hour') hour = parseInt(p.value, 10);
      if (p.type === 'minute') minute = parseInt(p.value, 10);
    }
    return { hour: Number.isFinite(hour) ? hour : 0, minute: Number.isFinite(minute) ? minute : 0 };
  } catch {
    let h = date.getUTCHours() + 1;
    const m = date.getUTCMinutes();
    if (h >= 24) h -= 24;
    return { hour: h, minute: m };
  }
}

/** Entrée « journée » : avant 18h à Douala → kWh obligatoire au check-in. */
export function isCameroonStrictlyBefore18h(date: Date = new Date()): boolean {
  return getCameroonHourMinute(date).hour < 18;
}

/** Libellé date + heure pour affichage (fuseau Cameroun). */
export function formatCameroonDateTimeVerbose(date: Date): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: CAMEROON_TZ,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return formatCameroonHm(date);
  }
}
