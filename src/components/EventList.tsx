import React from 'react';
import type { TourEvent } from '../types';

function fmtDate(d: string) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

interface Props {
  events: TourEvent[];
  selectedId: string | null;
  testConflictIds: string[];
  onSelect: (id: string) => void;
}

export const EventList: React.FC<Props> = ({
  events,
  selectedId,
  testConflictIds,
  onSelect,
}) => {
  const sorted = [...events].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  if (!sorted.length) {
    return (
      <div className="empty-state">
        Keine Events geladen.
        <br />
        CSV-Datei oben importieren.
      </div>
    );
  }

  return (
    <div className="event-list">
      {sorted.map(ev => {
        const isTestHit = testConflictIds.includes(ev.id);
        const isSelected = selectedId === ev.id;
        const cls = [
          'event-item',
          `s-${ev.status}`,
          isSelected ? 'selected' : '',
          isTestHit ? 'test-hit' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <div key={ev.id} className={cls} onClick={() => onSelect(ev.id)}>
            <div className="ev-date">{fmtDate(ev.date)}</div>
            <div className="ev-city">{ev.city}</div>
            <div className="ev-meta">
              {ev.postal_code ? `${ev.postal_code} · ` : ''}
              R {ev.protection_radius_km} km · ±{ev.protection_time_months} M
            </div>
            {isTestHit && (
              <span className="test-hit-badge">⚡ TEST-KONFLIKT</span>
            )}
          </div>
        );
      })}
    </div>
  );
};
