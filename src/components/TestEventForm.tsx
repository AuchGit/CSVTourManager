import React, { useState } from 'react';

interface Props {
  onCheck: (
    city: string,
    postalCode: string,
    date: string,
    street?: string,
    radiusKm?: number,
    months?: number
  ) => void;
  onClear: () => void;
  isChecking: boolean;
  conflictCount: number;
  hasResult: boolean;
  error: string | null;
}

export const TestEventForm: React.FC<Props> = ({
  onCheck,
  onClear,
  isChecking,
  conflictCount,
  hasResult,
  error,
}) => {
  const [city, setCity]           = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [street, setStreet]       = useState('');
  const [date, setDate]           = useState('');
  const [radius, setRadius]       = useState('');
  const [months, setMonths]       = useState('');

  const canSubmit =
    date.trim().length > 0 &&
    (city.trim().length > 0 || postalCode.trim().length > 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    const streetVal  = street.trim()  || undefined;
    const radiusVal  = radius.trim()  ? parseFloat(radius.trim())  : undefined;
    const monthsVal  = months.trim()  ? parseFloat(months.trim())  : undefined;

    onCheck(
      city.trim(),
      postalCode.trim(),
      date.trim(),
      streetVal,
      isNaN(radiusVal as number) ? undefined : radiusVal,
      isNaN(monthsVal as number) ? undefined : monthsVal
    );
  };

  const handleClear = () => {
    setCity('');
    setPostalCode('');
    setStreet('');
    setDate('');
    setRadius('');
    setMonths('');
    onClear();
  };

  return (
    <div className="test-form">
      <div className="test-form-title">NEUES EVENT PRÜFEN</div>

      <form onSubmit={handleSubmit} noValidate>
        {/* PLZ + ORT */}
        <div className="form-row-plz">
          <div className="form-field">
            <label htmlFor="tf-plz">PLZ</label>
            <input
              id="tf-plz"
              type="text"
              value={postalCode}
              onChange={e => setPostalCode(e.target.value)}
              placeholder="20095"
            />
          </div>
          <div className="form-field">
            <label htmlFor="tf-city">ORT</label>
            <input
              id="tf-city"
              type="text"
              value={city}
              onChange={e => setCity(e.target.value)}
              placeholder="Hamburg"
            />
          </div>
        </div>

        {/* STRASSE (optional) */}
        <div className="form-field">
          <label htmlFor="tf-street">
            STRASSE <span className="form-optional">(optional)</span>
          </label>
          <input
            id="tf-street"
            type="text"
            value={street}
            onChange={e => setStreet(e.target.value)}
            placeholder="Reeperbahn 1"
          />
        </div>

        {/* DATUM */}
        <div className="form-field">
          <label htmlFor="tf-date">DATUM</label>
          <input
            id="tf-date"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>

        {/* GEBIETSSCHUTZ + ZEITSPERRE (both optional) */}
        <div className="form-row-2">
          <div className="form-field">
            <label htmlFor="tf-radius">
              RADIUS KM <span className="form-optional">(opt.)</span>
            </label>
            <input
              id="tf-radius"
              type="number"
              min="0"
              step="1"
              value={radius}
              onChange={e => setRadius(e.target.value)}
              placeholder="50"
            />
          </div>
          <div className="form-field">
            <label htmlFor="tf-months">
              MONATE <span className="form-optional">(opt.)</span>
            </label>
            <input
              id="tf-months"
              type="number"
              min="0"
              step="1"
              value={months}
              onChange={e => setMonths(e.target.value)}
              placeholder="6"
            />
          </div>
        </div>

        <div className="form-actions">
          <button
            type="submit"
            className="check-btn"
            disabled={isChecking || !canSubmit}
          >
            {isChecking ? '↻  PRÜFEN…' : '⬡  KONFLIKTE PRÜFEN'}
          </button>
          {hasResult && (
            <button type="button" className="clear-btn" onClick={handleClear}>
              ✕
            </button>
          )}
        </div>
      </form>

      {error && <div className="form-error">{error}</div>}

      {hasResult && !isChecking && !error && (
        <div
          className={`form-result ${
            conflictCount > 0 ? 'result-conflict' : 'result-ok'
          }`}
        >
          {conflictCount > 0
            ? `⚡  ${conflictCount} Konflikt${conflictCount !== 1 ? 'e' : ''} gefunden`
            : '✓  Keine Konflikte gefunden'}
        </div>
      )}
    </div>
  );
};