import React, { useEffect, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Circle,
  Popup,
  Tooltip,
  ZoomControl,
  GeoJSON,
  useMap,
} from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import type { GeoJsonObject } from 'geojson';
import type { TourEvent, Theme, TestEventState } from '../types';

// ── Map view limits ──────────────────────────────────────────────────────────
// Bounds: Germany (~47°-55°N, 6°-15°E) plus a small margin so the immediate
// neighbours stay visible. `maxBoundsViscosity: 1.0` turns the edge into a
// hard wall (no rubber-band drag-back).
const DE_MAX_BOUNDS: LatLngBoundsExpression = [
  [46.5, 5.0],   // SW
  [55.8, 16.0],  // NE
];
// At zoom 6 Germany fills the view with just the immediate neighbour
// countries visible around the edges. Zoom 5 would already show most of
// Europe, which the user explicitly does not want.
const DE_MIN_ZOOM = 6;

// Border outline sources, tried in order until one succeeds. The first two
// are the high/medium resolution variants from `isellsoap/deutschlandGeoJSON`
// (a well-known German GIS dataset on GitHub). The third is the much coarser
// `johan/world.geo.json` country file as a last-resort fallback so we still
// show *something* even if the better sources are unreachable.
const DE_GEOJSON_URLS = [
  'https://raw.githubusercontent.com/isellsoap/deutschlandGeoJSON/main/1_deutschland/2_hoch.geo.json',
  'https://raw.githubusercontent.com/isellsoap/deutschlandGeoJSON/main/1_deutschland/3_mittel.geo.json',
  'https://raw.githubusercontent.com/johan/world.geo.json/master/countries/DEU.geo.json',
];

// ── Tile URLs ─────────────────────────────────────────────────────────────────
const DARK_TILES =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const LIGHT_TILES =
  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const ATTRIBUTION =
  '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>';

// ── Status Colors ─────────────────────────────────────────────────────────────
const COLOR_OK           = '#22c55e';
const COLOR_CONFLICT     = '#ef4444';
const COLOR_TEST_HIT     = '#f59e0b';
const COLOR_TEST_MARKER  = '#f59e0b';

// ── FlyTo controller ─────────────────────────────────────────────────────────
interface FlyToProps { lat: number | null; lng: number | null; }
const FlyTo: React.FC<FlyToProps> = ({ lat, lng }) => {
  const map  = useMap();
  const prev = useRef<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });

  useEffect(() => {
    if (lat === null || lng === null) return;
    if (prev.current.lat === lat && prev.current.lng === lng) return;
    map.flyTo([lat, lng], 10, { duration: 0.75 });
    prev.current = { lat, lng };
  }, [lat, lng, map]);

  return null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

/** Compact label for the marker connector — DD.MM.YY, locale-independent. */
function fmtShort(d: string) {
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y.slice(2)}`;
}

function markerColor(ev: TourEvent, testConflictIds: string[]): string {
  if (testConflictIds.includes(ev.id)) return COLOR_TEST_HIT;
  return ev.status === 'conflict' ? COLOR_CONFLICT : COLOR_OK;
}

function circleColor(ev: TourEvent, testConflictIds: string[]): string {
  if (testConflictIds.includes(ev.id)) return COLOR_TEST_HIT;
  return ev.status === 'conflict' ? COLOR_CONFLICT : COLOR_OK;
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  events: TourEvent[];
  testConflictIds: string[];
  testEvent: TestEventState | null;
  selectedId: string | null;
  theme: Theme;
}

export const MapPanel: React.FC<Props> = ({
  events,
  testConflictIds,
  testEvent,
  selectedId,
  theme,
}) => {
  const selectedEvent = events.find(e => e.id === selectedId) ?? null;

  const hasTestCircle =
    testEvent !== null &&
    testEvent.protection_radius_km !== undefined &&
    testEvent.protection_radius_km > 0;

  // Fetch Germany outline once; try sources in order of preference. Silent
  // failure is fine — the map still works without the highlighted border.
  const [deOutline, setDeOutline] = useState<GeoJsonObject | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const url of DE_GEOJSON_URLS) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const data = (await res.json()) as GeoJsonObject;
          if (cancelled) return;
          setDeOutline(data);
          return; // first successful source wins
        } catch {
          // try next
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Outline color: tuned per theme for visibility against the basemap.
  const borderColor = theme === 'dark' ? '#7dd3fc' : '#0369a1';

  return (
    <div className="map-panel">
      <MapContainer
        center={[51.1, 10.4]}
        zoom={6}
        minZoom={DE_MIN_ZOOM}
        maxBounds={DE_MAX_BOUNDS}
        maxBoundsViscosity={1.0}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
      >
        {/* Tile layer — key forces remount on theme change */}
        <TileLayer
          key={theme}
          url={theme === 'dark' ? DARK_TILES : LIGHT_TILES}
          attribution={ATTRIBUTION}
          subdomains="abcd"
          maxZoom={19}
        />

        {/* Germany outline — non-interactive, fades behind tiles slightly so
            it never covers a marker. `key` forces a restyle when the theme
            changes. */}
        {deOutline && (
          <GeoJSON
            key={`de-outline-${theme}`}
            data={deOutline}
            interactive={false}
            style={{
              color: borderColor,
              weight: 2,
              opacity: 0.85,
              fill: false,
              dashArray: '4 3',
            }}
          />
        )}

        <ZoomControl position="bottomright" />

        {/* Fly to selected event */}
        <FlyTo
          lat={selectedEvent?.latitude ?? null}
          lng={selectedEvent?.longitude ?? null}
        />

        {/* ── Existing event protection circles ── */}
        {events.map(ev => {
          const col        = circleColor(ev, testConflictIds);
          const isHit      = testConflictIds.includes(ev.id);
          const isConflict = ev.status === 'conflict';
          return (
            <Circle
              key={`r-${ev.id}`}
              center={[ev.latitude, ev.longitude]}
              radius={ev.protection_radius_km * 1000}
              pathOptions={{
                color:       col,
                fillColor:   col,
                fillOpacity: isHit ? 0.1 : 0.05,
                weight:      isHit || isConflict ? 1.5 : 1,
                dashArray:   isConflict || isHit ? undefined : '6 5',
                opacity:     isHit ? 0.85 : 0.55,
              }}
            />
          );
        })}

        {/* ── Test event protection circle (only when radius was entered) ── */}
        {hasTestCircle && (
          <Circle
            center={[testEvent!.latitude, testEvent!.longitude]}
            radius={testEvent!.protection_radius_km! * 1000}
            pathOptions={{
              color:       COLOR_TEST_MARKER,
              fillColor:   COLOR_TEST_MARKER,
              fillOpacity: 0.07,
              weight:      2,
              dashArray:   '8 5',
              opacity:     0.8,
            }}
          />
        )}

        {/* ── Existing event markers ── */}
        {events.map(ev => {
          const col        = markerColor(ev, testConflictIds);
          const isSelected = selectedId === ev.id;
          return (
            <CircleMarker
              key={`m-${ev.id}`}
              center={[ev.latitude, ev.longitude]}
              radius={isSelected ? 10 : 7}
              pathOptions={{
                color:       col,
                fillColor:   col,
                fillOpacity: 0.9,
                weight:      isSelected ? 3 : 2,
              }}
            >
              <Popup className="tp-popup">
                <div className="popup-city">{ev.city}</div>
                <div className="popup-date">{fmtDate(ev.date)}</div>
                <div className="popup-meta">
                  {ev.postal_code && <>{ev.postal_code} · </>}
                  Radius {ev.protection_radius_km} km · ±{ev.protection_time_months} Mo.
                </div>
                {ev.status === 'conflict' && (
                  <div className="popup-badge popup-conflict">
                    ✕ GEBIETSSCHUTZ-KONFLIKT
                  </div>
                )}
                {testConflictIds.includes(ev.id) && (
                  <div className="popup-badge popup-test">⚡ TEST-KONFLIKT</div>
                )}
                {ev.status === 'ok' && !testConflictIds.includes(ev.id) && (
                  <div className="popup-badge popup-ok">✓ KEIN KONFLIKT</div>
                )}
              </Popup>
              <Tooltip
                permanent
                direction="right"
                offset={[8, 0]}
                className={`date-tag date-tag-${
                  testConflictIds.includes(ev.id)
                    ? 'test'
                    : ev.status === 'conflict'
                    ? 'conflict'
                    : 'ok'
                }`}
              >
                <span className="date-tag-leader" />
                <span className="date-tag-text">{fmtShort(ev.date)}</span>
              </Tooltip>
            </CircleMarker>
          );
        })}

        {/* ── Test event marker ── */}
        {testEvent && (
          <CircleMarker
            center={[testEvent.latitude, testEvent.longitude]}
            radius={9}
            pathOptions={{
              color:       COLOR_TEST_MARKER,
              fillColor:   COLOR_TEST_MARKER,
              fillOpacity: 1,
              weight:      3,
              dashArray:   '3 3',
            }}
          >
            <Popup className="tp-popup">
              <div className="popup-city">
                TEST{testEvent.city ? `: ${testEvent.city}` : ''}
              </div>
              <div className="popup-date">{fmtDate(testEvent.date)}</div>
              {hasTestCircle && (
                <div className="popup-meta">
                  Radius {testEvent.protection_radius_km} km
                  {testEvent.protection_time_months !== undefined &&
                    ` · ±${testEvent.protection_time_months} Mo.`}
                </div>
              )}
              <div className="popup-badge popup-test">TEST-POSITION</div>
            </Popup>
            <Tooltip
              permanent
              direction="right"
              offset={[8, 0]}
              className="date-tag date-tag-test"
            >
              <span className="date-tag-leader" />
              <span className="date-tag-text">{fmtShort(testEvent.date)}</span>
            </Tooltip>
          </CircleMarker>
        )}
      </MapContainer>

      {/* ── Legend ── */}
      <div className="map-legend">
        <div className="legend-row">
          <span className="legend-dot" style={{ background: COLOR_OK }} />
          Kein Konflikt
        </div>
        <div className="legend-row">
          <span className="legend-dot" style={{ background: COLOR_CONFLICT }} />
          Konflikt
        </div>
        <div className="legend-row">
          <span className="legend-dot" style={{ background: COLOR_TEST_MARKER }} />
          Test-Event / -Treffer
        </div>
      </div>
    </div>
  );
};