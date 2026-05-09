import React, { useState, useCallback } from 'react';
import type { TestEventState } from '../types';

interface Props {
  /** Live test event from App; null when no Prüfen has been run yet. */
  testEvent: TestEventState | null;
  isChecking: boolean;
  error: string | null;
  /** True when a real file is open, so "Add to file" is meaningful. */
  hasFileOpen: boolean;
  /** Geocoding-required check. Creates / replaces the test event. */
  onCheck: (
    city: string,
    postalCode: string,
    date: string,
    radiusKm: number,
    months: number
  ) => void;
  /** Live patches applied to the existing test event without re-geocoding. */
  onUpdate: (patch: Partial<TestEventState>) => void;
  onClear: () => void;
  /** Append the current test event to the loaded events list as a new row. */
  onSaveToFile: () => void;
}

const RADIUS_MIN = 0;
const RADIUS_MAX = 200;
const MONTHS_MIN = 0;
const MONTHS_MAX = 12;

const DEFAULT_RADIUS = 50;
const DEFAULT_MONTHS = 6;

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (next: number) => void;
}

/**
 * Compact slider + companion number input. The slider stays clamped to
 * [min, max] (covers the common case at a glance), while the number
 * field accepts values outside that range too — typing "300" works
 * even though the slider thumb sits at the right edge.
 */
const BBSlider: React.FC<SliderProps> = React.memo(({
  label, value, min, max, unit, onChange,
}) => {
  const handleNum = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const n = parseFloat(e.target.value);
      if (!isNaN(n)) onChange(n);
    },
    [onChange]
  );
  const handleRange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const n = parseFloat(e.target.value);
      if (!isNaN(n)) onChange(n);
    },
    [onChange]
  );
  return (
    <label className="bb-slider">
      <span className="bb-slider-head">
        <span className="bb-label">{label}</span>
        <span className="bb-slider-val">
          <input
            type="number"
            className="bb-slider-num"
            value={value}
            onChange={handleNum}
          />
          <span className="bb-slider-unit">{unit}</span>
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={Math.max(min, Math.min(max, value))}
        onChange={handleRange}
      />
    </label>
  );
});

/**
 * Horizontal toolbar below the map. Single row, never wraps. Layout:
 *
 *   DATUM · PLZ · ORT · MONATE (slider) · UMKREIS (slider) · ⬡ · × · +
 *
 * Once a test event exists, the date and the two sliders update it
 * live (no re-geocoding). Changing PLZ or ORT requires a new "Prüfen"
 * click because those drive the geocoding query.
 */
export const BottomBar: React.FC<Props> = ({
  testEvent,
  isChecking,
  error,
  hasFileOpen,
  onCheck,
  onUpdate,
  onClear,
  onSaveToFile,
}) => {
  // Drafts hold what the user has typed/dragged BEFORE a test event exists.
  // Once a testEvent is live, sliders read from it directly so any external
  // change shows up instantly, and slider drags route through `onUpdate`.
  const [city, setCity]               = useState('');
  const [postal, setPostal]           = useState('');
  const [draftDate, setDraftDate]     = useState('');
  const [draftRadius, setDraftRadius] = useState(DEFAULT_RADIUS);
  const [draftMonths, setDraftMonths] = useState(DEFAULT_MONTHS);

  const date    = testEvent?.date ?? draftDate;
  const radius  = testEvent?.protection_radius_km ?? draftRadius;
  const months  = testEvent?.protection_time_months ?? draftMonths;

  const canSubmit =
    date.trim().length > 0 &&
    (city.trim().length > 0 || postal.trim().length > 0);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit || isChecking) return;
      onCheck(city.trim(), postal.trim(), date.trim(), radius, months);
    },
    [city, postal, date, radius, months, canSubmit, isChecking, onCheck]
  );

  const handleClear = useCallback(() => {
    onClear();
  }, [onClear]);

  const updateDate = useCallback((next: string) => {
    if (testEvent && next) {
      onUpdate({ date: next });
    } else {
      setDraftDate(next);
    }
  }, [testEvent, onUpdate]);

  const updateRadius = useCallback((next: number) => {
    if (testEvent) {
      onUpdate({ protection_radius_km: next });
    } else {
      setDraftRadius(next);
    }
  }, [testEvent, onUpdate]);

  const updateMonths = useCallback((next: number) => {
    if (testEvent) {
      onUpdate({ protection_time_months: next });
    } else {
      setDraftMonths(next);
    }
  }, [testEvent, onUpdate]);

  return (
    <form className="bottom-bar" onSubmit={handleSubmit} noValidate>
      <label className="bb-field bb-field--date">
        <span className="bb-label">DATUM</span>
        <input
          type="date"
          value={date}
          onChange={e => updateDate(e.target.value)}
        />
      </label>
      <label className="bb-field bb-field--xs">
        <span className="bb-label">PLZ</span>
        <input
          type="text"
          inputMode="numeric"
          value={postal}
          onChange={e => setPostal(e.target.value)}
          placeholder="20095"
        />
      </label>
      <label className="bb-field bb-field--md">
        <span className="bb-label">ORT</span>
        <input
          type="text"
          value={city}
          onChange={e => setCity(e.target.value)}
          placeholder="Hamburg"
        />
      </label>

      <BBSlider
        label="MONATE"
        value={months}
        min={MONTHS_MIN}
        max={MONTHS_MAX}
        unit="M"
        onChange={updateMonths}
      />
      <BBSlider
        label="UMKREIS"
        value={radius}
        min={RADIUS_MIN}
        max={RADIUS_MAX}
        unit="km"
        onChange={updateRadius}
      />

      <button
        type="submit"
        className="check-btn bb-check"
        disabled={isChecking || !canSubmit}
        title="Konflikte für diesen Ort prüfen"
        aria-label="Prüfen"
      >
        {isChecking ? '↻' : '⬡'}
      </button>

      {testEvent && (
        <button
          type="button"
          className="clear-btn bb-clear"
          onClick={handleClear}
          title="Test-Event entfernen"
          aria-label="Entfernen"
        >
          ×
        </button>
      )}

      {testEvent && hasFileOpen && (
        <button
          type="button"
          className="check-btn bb-add"
          onClick={onSaveToFile}
          title="Test-Event als neuen Eintrag in die geöffnete Datei übernehmen"
          aria-label="In Datei übernehmen"
        >
          +
        </button>
      )}

      {error && <div className="bottom-bar-error">{error}</div>}
    </form>
  );
};
