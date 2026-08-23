import React from 'react';
import {
  formatInterestedByLabel,
  formatInterestedDatesCompact,
} from '../utils/contactDirectory';

export default function ContactInterestLine({
  apartment,
  startDate,
  endDate,
  compact = false,
}: {
  apartment: string | null;
  startDate: string | null;
  endDate: string | null;
  compact?: boolean;
}) {
  const aptLabel = apartment ? formatInterestedByLabel(apartment) : null;
  const datesLabel = formatInterestedDatesCompact(startDate, endDate);
  if (!aptLabel && !datesLabel) return null;
  return (
    <p className={`truncate ${compact ? 'text-[10px] mt-0.5' : 'text-[11px] mt-0.5'}`}>
      {aptLabel ? (
        <span className="text-violet-700 font-semibold">Intéressé par : {aptLabel}</span>
      ) : (
        <span className="text-violet-700 font-semibold">Dates demandées</span>
      )}
      {datesLabel && (
        <>
          <span className="text-gray-300 mx-1">·</span>
          <span className="text-gray-500 font-medium tabular-nums">{datesLabel}</span>
        </>
      )}
    </p>
  );
}
