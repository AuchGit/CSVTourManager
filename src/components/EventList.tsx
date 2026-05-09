import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
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

function isDirty(ev: TourEvent): boolean {
  if (ev.isNew) return true;
  if (!ev.original) return false;
  return (
    ev.original.protection_radius_km !== ev.protection_radius_km ||
    ev.original.protection_time_months !== ev.protection_time_months
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (next: number) => void;
}

const Slider: React.FC<SliderProps> = React.memo(({
  label, value, min, max, step, unit, onChange,
}) => {
  const handleSlide = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const n = parseFloat(e.target.value);
      if (!isNaN(n)) onChange(n);
    },
    [onChange]
  );
  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const n = parseFloat(e.target.value);
      if (!isNaN(n)) onChange(n);
    },
    [onChange]
  );

  return (
    <div className="ev-slider" onClick={e => e.stopPropagation()}>
      <div className="ev-slider-head">
        <span className="ev-slider-label">{label}</span>
        <input
          type="number"
          className="ev-slider-num"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleInput}
        />
        <span className="ev-slider-unit">{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleSlide}
        className="ev-slider-range"
      />
    </div>
  );
});

interface ItemProps {
  ev: TourEvent;
  isSelected: boolean;
  isTestHit: boolean;
  expanded: boolean;
  onSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onChange: (id: string, patch: Partial<TourEvent>) => void;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
}

const EventItem: React.FC<ItemProps> = React.memo(({
  ev, isSelected, isTestHit, expanded, onSelect, onToggleExpand, onChange, registerRef,
}) => {
  const dirty = isDirty(ev);
  const cls = [
    'event-item',
    `s-${ev.status}`,
    isSelected ? 'selected' : '',
    isTestHit ? 'test-hit' : '',
    dirty ? 'event-item--dirty' : '',
  ].filter(Boolean).join(' ');

  const onRadiusChange = useCallback(
    (v: number) => onChange(ev.id, { protection_radius_km: v }),
    [ev.id, onChange]
  );
  const onMonthsChange = useCallback(
    (v: number) => onChange(ev.id, { protection_time_months: v }),
    [ev.id, onChange]
  );
  const setRef = useCallback(
    (el: HTMLDivElement | null) => registerRef(ev.id, el),
    [ev.id, registerRef]
  );

  return (
    <div className={cls} ref={setRef}>
      <div className="event-item-row" onClick={() => onSelect(ev.id)}>
        <div className="event-item-main">
          <div className="ev-date">{fmtDate(ev.date)}</div>
          <div className="ev-city">{ev.city}</div>
          <div className="ev-meta">
            {ev.postal_code ? `${ev.postal_code} · ` : ''}
            R {ev.protection_radius_km} km · ±{ev.protection_time_months} M
          </div>
          {isTestHit && (
            <span className="test-hit-badge">⚠ TEST-KONFLIKT</span>
          )}
          {dirty && <span className="dirty-badge">● Unsaved</span>}
        </div>
        <button
          type="button"
          className="event-expand-btn"
          aria-expanded={expanded}
          aria-label={expanded ? 'Slider einklappen' : 'Slider öffnen'}
          onClick={e => {
            e.stopPropagation();
            onToggleExpand(ev.id);
          }}
        >
          {expanded ? '▴' : '▾'}
        </button>
      </div>

      {expanded && (
        <div className="event-controls">
          <Slider
            label="RADIUS"
            value={ev.protection_radius_km}
            min={0}
            max={300}
            step={1}
            unit="km"
            onChange={onRadiusChange}
          />
          <Slider
            label="MONATE"
            value={ev.protection_time_months}
            min={0}
            max={36}
            step={1}
            unit="M"
            onChange={onMonthsChange}
          />
        </div>
      )}
    </div>
  );
});

interface Props {
  events: TourEvent[];
  selectedId: string | null;
  testConflictIds: string[];
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<TourEvent>) => void;
}

export const EventList: React.FC<Props> = ({
  events,
  selectedId,
  testConflictIds,
  onSelect,
  onChange,
}) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  // Map of event id → row DOM node, for scroll-into-view on external select.
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const registerRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const testConflictSet = useMemo(
    () => new Set(testConflictIds),
    [testConflictIds]
  );

  const sorted = useMemo(
    () =>
      [...events].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      ),
    [events]
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Whenever `selectedId` changes (e.g. user clicked a marker on the map)
  // auto-expand that row's slider section AND scroll it into view. The
  // ref-gated check keeps this from running on every render.
  const prevSelected = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId === prevSelected.current) return;
    prevSelected.current = selectedId;
    if (!selectedId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedIds(prev => {
      if (prev.has(selectedId)) return prev;
      const next = new Set(prev);
      next.add(selectedId);
      return next;
    });
    const el = rowRefs.current.get(selectedId);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedId]);

  if (!sorted.length) {
    return (
      <div className="empty-state">
        Keine Events geladen.
        <br />
        CSV- oder XLSX-Datei oben importieren.
      </div>
    );
  }

  return (
    <div className="event-list">
      {sorted.map(ev => (
        <EventItem
          key={ev.id}
          ev={ev}
          isSelected={selectedId === ev.id}
          isTestHit={testConflictSet.has(ev.id)}
          expanded={expandedIds.has(ev.id)}
          onSelect={onSelect}
          onToggleExpand={toggleExpand}
          onChange={onChange}
          registerRef={registerRef}
        />
      ))}
    </div>
  );
};
