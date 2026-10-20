/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AirplaneWindowFrame } from './components/AirplaneWindowFrame';
import { WindowHudOverlay } from './components/WindowHudOverlay';
import {
  CesiumWindowEngine,
  type EngineStatus,
  type LiveInterpolatedTelemetry,
  type ViewMode,
  type WindowRigSettings,
} from './simulator/cesiumWindowEngine';
import {
  type AirborneFlight,
  type BoundingBoxSector,
  METRO_SECTORS,
  parseAirplanesLiveCallsignResponse,
  parseAirplanesLivePointResponse,
  sanitizeCallsign,
} from './utils/flightMath';

const RADAR_POLL_INTERVAL_SECONDS = 10;

export default function App() {
  const cesiumContainerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<CesiumWindowEngine | null>(null);

  const [selectedSector, setSelectedSector] = useState<BoundingBoxSector>(METRO_SECTORS[0]);
  const [flights, setFlights] = useState<AirborneFlight[]>([]);
  const [activeFlight, setActiveFlight] = useState<AirborneFlight | null>(null);
  const [liveTelemetry, setLiveTelemetry] = useState<LiveInterpolatedTelemetry | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [secondsUntilNextPoll, setSecondsUntilNextPoll] = useState(RADAR_POLL_INTERVAL_SECONDS);

  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [isSearchingCallsign, setIsSearchingCallsign] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [rigSettings, setRigSettings] = useState<WindowRigSettings>({
    seatSide: 'right',
    pitchDeg: -20,
    yawFineTuneDeg: 0,
    seatOffsetMeters: 3.2,
  });
  const [showWindowFrame, setShowWindowFrame] = useState(true);
  const [shadePercent, setShadePercent] = useState(0);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>({
    mode: 'cesium-osm-3d',
    tilesLoaded: false,
    statusMessage: 'Initializing 3D Globe & OSM Buildings...',
  });

  const activeFlightRef = useRef<AirborneFlight | null>(null);
  activeFlightRef.current = activeFlight;

  const selectedSectorRef = useRef<BoundingBoxSector>(selectedSector);
  selectedSectorRef.current = selectedSector;

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 7000);
  }, []);

  // True Live Sector Polling:
  // Polls https://api.adsb.lol/v2/point/{lat}/{lon}/150 every 10 seconds.
  // Only renders aircraft actually returned by data.ac (zero mock/placeholder flights).
  const pollAirplanesLiveSector = useCallback(
    async (sector: BoundingBoxSector, autoLockFirstIfNone = false) => {
      setIsPolling(true);
      let nextFlights: AirborneFlight[] = [];

      try {
        const lat = sector.centerLat;
        const lon = sector.centerLon;
        const response = await fetch(
          'https://api.allorigins.win/raw?url=' +
            encodeURIComponent(
              `https://api.adsb.lol/v2/point/${lat}/${lon}/150?t=${Date.now()}`
            )
        );

        if (response.ok) {
          const data = await response.json();
          console.log('Live ADS-B Data:', data);
          if (data && Array.isArray(data.ac) && data.ac.length > 0) {
            nextFlights = parseAirplanesLivePointResponse(data, 60);
          }
        }
      } catch {
        // Network error — leave nextFlights empty (no mock fallback)
      }

      const currentLocked = activeFlightRef.current;
      if (currentLocked) {
        const updatedMatch = nextFlights.find(
          (f) =>
            f.icao24 === currentLocked.icao24 || f.callsign === currentLocked.callsign
        );
        if (updatedMatch) {
          setActiveFlight(updatedMatch);
          engineRef.current?.lockToFlight(updatedMatch);
        }
      } else if (autoLockFirstIfNone && nextFlights.length > 0) {
        const firstAirborne = nextFlights[0];
        setActiveFlight(firstAirborne);
        engineRef.current?.lockToFlight(firstAirborne);
      } else if (!currentLocked && nextFlights.length === 0) {
        setLiveTelemetry(null);
        engineRef.current?.clearFlightLock(sector.centerLat, sector.centerLon);
      }

      setFlights(nextFlights);
      setSecondsUntilNextPoll(RADAR_POLL_INTERVAL_SECONDS);
      setIsPolling(false);
    },
    []
  );

  // Initialize CesiumJS Viewer with 100% Free OSM 3D Buildings & World Terrain
  useEffect(() => {
    const container = cesiumContainerRef.current;
    if (!container) return;

    const engine = new CesiumWindowEngine({
      onTelemetryFrame: (telemetry) => {
        setLiveTelemetry(telemetry);
      },
      onStatusChange: (status) => {
        setEngineStatus(status);
      },
    });
    engineRef.current = engine;

    engine.initialize(container).then(() => {
      engine.focusSector(METRO_SECTORS[0].centerLat, METRO_SECTORS[0].centerLon);
      pollAirplanesLiveSector(METRO_SECTORS[0], true);
    });

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [pollAirplanesLiveSector]);

  // 10-second adsb.lol polling timer + 1-second countdown display
  useEffect(() => {
    const countdownTimer = window.setInterval(() => {
      setSecondsUntilNextPoll((prev) => {
        if (prev <= 1) {
          pollAirplanesLiveSector(selectedSectorRef.current, false);
          return RADAR_POLL_INTERVAL_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(countdownTimer);
    };
  }, [pollAirplanesLiveSector]);

  // True Live Flight Search via AllOrigins + https://api.adsb.lol/v2/callsign/{callsign}
  const handleSearchCallsign = useCallback(
    async (rawCallsign: string) => {
      const callsign = sanitizeCallsign(rawCallsign);
      if (!callsign) return;

      setIsSearchingCallsign(true);
      setToastMessage(null);

      try {
        const response = await fetch(
          'https://api.allorigins.win/raw?url=' +
            encodeURIComponent(
              `https://api.adsb.lol/v2/callsign/${callsign}?t=${Date.now()}`
            )
        );

        if (response.status === 404) {
          showToast('Flight not active in radar coverage.');
          return;
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('Live ADS-B Data:', data);

        if (!data || !Array.isArray(data.ac) || data.ac.length === 0) {
          showToast('Flight not active in radar coverage.');
          return;
        }

        const foundFlight = parseAirplanesLiveCallsignResponse(data, callsign);
        if (
          foundFlight &&
          Number.isFinite(foundFlight.latitude) &&
          Number.isFinite(foundFlight.longitude) &&
          Number.isFinite(foundFlight.altitudeMeters) &&
          foundFlight.altitudeMeters > 0
        ) {
          setActiveFlight(foundFlight);
          setFlights((prev) => {
            const filtered = prev.filter(
              (f) =>
                f.icao24 !== foundFlight.icao24 &&
                f.callsign !== foundFlight.callsign
            );
            return [foundFlight, ...filtered];
          });
          engineRef.current?.lockToFlight(foundFlight);
        } else {
          showToast('Flight not active in radar coverage.');
        }
      } catch {
        showToast('Network Error: Unable to reach radar API. Please try again.');
      } finally {
        setIsSearchingCallsign(false);
      }
    },
    [showToast]
  );

  // Toggle between 3D Window View and 2D Moving Map
  const handleToggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const next: ViewMode = prev === '3d' ? '2d' : '3d';
      engineRef.current?.setViewMode(next);
      return next;
    });
  }, []);

  const handleFindFlight = useCallback(() => {
    if (flights.length === 0) {
      showToast('No active flights detected in this sector right now.');
      return;
    }

    let targetFlight = flights[0];
    if (activeFlight && flights.length > 1) {
      const currentIndex = flights.findIndex((f) => f.icao24 === activeFlight.icao24);
      const nextIndex = (currentIndex + 1) % flights.length;
      targetFlight = flights[nextIndex];
    }

    setActiveFlight(targetFlight);
    engineRef.current?.lockToFlight(targetFlight);
  }, [flights, activeFlight, showToast]);

  const handleSelectSector = useCallback(
    (sector: BoundingBoxSector) => {
      setSelectedSector(sector);
      activeFlightRef.current = null;
      setActiveFlight(null);
      setLiveTelemetry(null);
      setFlights([]);
      engineRef.current?.clearFlightLock(sector.centerLat, sector.centerLon);
      pollAirplanesLiveSector(sector, true);
    },
    [pollAirplanesLiveSector]
  );

  const handleSelectSpecificFlight = useCallback((flight: AirborneFlight) => {
    setActiveFlight(flight);
    engineRef.current?.lockToFlight(flight);
  }, []);

  const handleUpdateRigSettings = useCallback((partial: Partial<WindowRigSettings>) => {
    setRigSettings((prev) => {
      const updated = { ...prev, ...partial };
      engineRef.current?.updateRigSettings(updated);
      return updated;
    });
  }, []);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-slate-950 select-none">
      {/* 3D / 2D CesiumJS Viewport Container */}
      <div
        id="cesiumContainer"
        ref={cesiumContainerRef}
        data-testid="cesium-viewport"
        className="w-full h-full"
      />

      {/* Sculpted Airplane Cabin Window Bezel (shown only in 3D Window View mode) */}
      <AirplaneWindowFrame
        visible={viewMode === '3d' && showWindowFrame}
        shadePercent={shadePercent}
        seatSide={rigSettings.seatSide}
      />

      {/* Bottom Corner Translucent Flight Telemetry, Global Search & Sector Flights Overlay */}
      <WindowHudOverlay
        sectors={METRO_SECTORS}
        selectedSector={selectedSector}
        onSelectSector={handleSelectSector}
        flights={flights}
        activeFlight={activeFlight}
        liveTelemetry={liveTelemetry}
        onFindFlight={handleFindFlight}
        onSelectSpecificFlight={handleSelectSpecificFlight}
        onManualRefresh={() => pollAirplanesLiveSector(selectedSector, true)}
        isPolling={isPolling}
        secondsUntilNextPoll={secondsUntilNextPoll}
        viewMode={viewMode}
        onToggleViewMode={handleToggleViewMode}
        onSearchCallsign={handleSearchCallsign}
        isSearchingCallsign={isSearchingCallsign}
        toastMessage={toastMessage}
        onDismissToast={() => setToastMessage(null)}
        rigSettings={rigSettings}
        onUpdateRigSettings={handleUpdateRigSettings}
        showWindowFrame={showWindowFrame}
        onToggleWindowFrame={() => setShowWindowFrame((prev) => !prev)}
        shadePercent={shadePercent}
        onChangeShadePercent={setShadePercent}
        engineStatus={engineStatus}
      />
    </main>
  );
}
