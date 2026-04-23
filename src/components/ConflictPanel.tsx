import React from 'react';
import type { ConflictPair } from '../types';

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

interface Props {
  conflicts: ConflictPair[];
  onHighlight: (ids: [string, string]) => void;
}

export const ConflictPanel: React.FC<Props> = ({ conflicts, onHighlight }) => (
  <div className="conflict-panel">
    <div className="conflict-header">
      <span className="conflict-label">KONFLIKTE</span>
      {conflicts.length > 0 && (
        <span className="conflict-badge">{conflicts.length}</span>
      )}
    </div>

    <div className="conflict-scroll">
      {conflicts.length === 0 ? (
        <div className="no-conflicts">✓  Keine Konflikte erkannt</div>
      ) : (
        conflicts.map(c => (
          <div
            key={c.id}
            className="conflict-item"
            onClick={() => onHighlight([c.eventAId, c.eventBId])}
            title="Auf Karte fokussieren"
          >
            <span className="conflict-type">GEBIETSSCHUTZ-KONFLIKT</span>
            <div className="conflict-text">
              <strong>{c.cityA}</strong> ({fmtDate(c.dateA)})
              {' ↔ '}
              <strong>{c.cityB}</strong> ({fmtDate(c.dateB)})
            </div>
            <div className="conflict-dist">{c.distanceKm} km Abstand</div>
          </div>
        ))
      )}
    </div>
  </div>
);
