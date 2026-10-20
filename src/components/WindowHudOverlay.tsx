import { type FormEvent, useState } from 'react';
import {
  Plane,
  Compass,
  Gauge,
  ArrowUpRight,
  RefreshCw,
  SlidersHorizontal,
  Radio,
  Eye,
  EyeOff,
  Search,
  Map as MapIcon,
  Box,
  X,
  ChevronUp,
} from 'lucide-react';
import {
  type AirborneFlight,
  type BoundingBoxSector,
  METRO_SECTORS,
} from '../utils/flightMath';
import {
  type EngineStatus,
  type LiveInterpolatedTelemetry,
  type ViewMode,
  type WindowRigSettings,
} from '../simulator/cesiumWindowEngine';

interface WindowHudOverlayProps {
  sectors: BoundingBoxSector[];
  selectedSector: BoundingBoxSector;
  onSelectSector: (sector: BoundingBoxSector) => void;
  flights: AirborneFlight[];
  activeFlight: AirborneFlight | null;
  liveTelemetry: LiveInterpolatedTelemetry | null;
  onFindFlight: () => void;
  onSelectSpecificFlight: (flight: AirborneFlight) => void;
  onManualRefresh: () => void;
  isPolling: boolean;
  secondsUntilNextPoll: number;
  viewMode: ViewMode;
  onToggleViewMode: () => void;
  onSearchCallsign: (callsign: string) => Promise<void>;
  isSearchingCallsign: boolean;
  toastMessage: string | null;
  onDismissToast: () => void;
  rigSettings: WindowRigSettings;
  onUpdateRigSettings: (partial: Partial<WindowRigSettings>) => void;
  showWindowFrame: boolean;
  onToggleWindowFrame: () => void;
  shadePercent: number;
  onChangeShadePercent: (val: number) => void;
  engineStatus: EngineStatus;
}

export function WindowHudOverlay({
  sectors = METRO_SECTORS,
  selectedSector,
  onSelectSector,
  flights,
  activeFlight,
  liveTelemetry,
  onFindFlight,
  onSelectSpecificFlight,
  onManualRefresh,
  isPolling,
  secondsUntilNextPoll,
  viewMode,
  onToggleViewMode,
  onSearchCallsign,
  isSearchingCallsign,
  toastMessage,
  onDismissToast,
  rigSettings,
  onUpdateRigSettings,
  showWindowFrame,
  onToggleWindowFrame,
  shadePercent,
  onChangeShadePercent,
  engineStatus,
}: WindowHudOverlayProps) {
  const [searchInput, setSearchInput] = useState('');
  const [isFlightsDrawerOpen, setIsFlightsDrawerOpen] = useState(false);
  const [showRigPanel, setShowRigPanel] = useState(false);

  const displayAltFeet =
    liveTelemetry?.altitudeFeet ?? activeFlight?.altitudeFeet ?? 0;
  const displayAltMeters =
    liveTelemetry?.altitudeMeters ?? activeFlight?.altitudeMeters ?? 0;
  const displaySpeedMph =
    liveTelemetry?.speedMph ?? activeFlight?.speedMph ?? 0;
  const displaySpeedMps =
    liveTelemetry?.speedMps ?? activeFlight?.velocityMps ?? 0;
  const displayTrackDeg =
    liveTelemetry?.trueTrackDeg ?? activeFlight?.trueTrackDeg ?? 0;
  const displayCamHeadingDeg =
    liveTelemetry?.cameraHeadingDeg ??
    Math.round(((displayTrackDeg + (rigSettings.seatSide === 'right' ? 90 : -90)) + 360) % 360);

  const handleSearchSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const fromDom = typeof formData.get('callsign') === 'string' ? (formData.get('callsign') as string) : '';
    const rawValue = (fromDom || searchInput).trim();
    if (!rawValue) return;
    if (fromDom && fromDom !== searchInput) {
      setSearchInput(fromDom);
    }
    await onSearchCallsign(rawValue);
  };

  return (
    <>
      {/* Top 3-Zone Navigation Bar with 2D vs. 3D Map Mode Toggle */}
      <header className="fixed top-0 left-0 right-0 z-20 flex items-center justify-between gap-8 px-5 py-3 bg-slate-950/90 border-b border-slate-800/80">
        {/* Zone 1: Brand Title (single text element, one line) */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onFindFlight();
          }}
          className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          YS-WebFLY
        </a>

        {/* Zone 2: 4 Metropolitan Airspace Sector Links */}
        <nav
          aria-label="Metropolitan Airspace Sectors"
          className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-400"
        >
          {sectors.map((sector) => {
            const isSelected = sector.id === selectedSector.id;
            return (
              <button
                key={sector.id}
                type="button"
                onClick={() => onSelectSector(sector)}
                className={`whitespace-nowrap shrink-0 py-1 transition-colors border-b-2 cursor-pointer ${
                  isSelected
                    ? 'text-sky-300 border-sky-400 font-semibold'
                    : 'text-slate-400 border-transparent hover:text-slate-100'
                }`}
              >
                {sector.name}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 Primary Action — 2D vs. 3D Map Mode Toggle */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onToggleViewMode}
            data-testid="toggle-2d-3d-btn"
            aria-label={
              viewMode === '3d'
                ? 'Switch to 2D Moving Map'
                : 'Switch to 3D Window View'
            }
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-slate-100 bg-slate-900 border border-slate-700 hover:border-sky-400/70 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {viewMode === '3d' ? (
              <>
                <MapIcon className="w-3.5 h-3.5 text-sky-400" />
                <span>2D Moving Map</span>
              </>
            ) : (
              <>
                <Box className="w-3.5 h-3.5 text-sky-400" />
                <span>3D Window View</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Non-Blocking Toast Notification (e.g., "Flight not found or currently grounded.") */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          data-testid="flight-toast"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-900/95 border border-amber-400/50 text-amber-200 text-xs font-medium shadow-2xl"
        >
          <span>{toastMessage}</span>
          <button
            type="button"
            onClick={onDismissToast}
            aria-label="Dismiss notification"
            className="text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Clickable Sector Flights Drawer / Modal */}
      {isFlightsDrawerOpen && (
        <dialog
          open
          aria-label="Active Sector Airborne Flights"
          data-testid="sector-flights-drawer"
          className="fixed bottom-4 left-4 sm:left-auto sm:right-[460px] z-30 w-[calc(100vw-2rem)] sm:w-[384px] m-0 rounded-2xl bg-slate-950/95 border border-slate-800 shadow-2xl p-4 text-slate-100"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-sm font-semibold text-white">
                {selectedSector.name} Airspace
              </h2>
              <p className="text-xs text-slate-400">
                {flights.length} airborne aircraft · Click to lock camera
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onManualRefresh}
                disabled={isPolling}
                aria-label="Refresh Sector Flights"
                className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isPolling ? 'animate-spin' : ''}`}
                />
              </button>
              <button
                type="button"
                onClick={() => setIsFlightsDrawerOpen(false)}
                aria-label="Close Sector Flights Drawer"
                className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Sector Selector Dropdown inside Drawer */}
          <div className="mt-3 flex items-center justify-between gap-2 min-w-0">
            <label
              htmlFor="drawer-sector-select"
              className="text-xs text-slate-400 whitespace-nowrap shrink-0"
            >
              Active Sector
            </label>
            <select
              id="drawer-sector-select"
              value={selectedSector.id}
              onChange={(e) => {
                const found = sectors.find((s) => s.id === e.target.value);
                if (found) onSelectSector(found);
              }}
              className="flex-1 min-w-0 truncate bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-sky-400"
            >
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.airportCode})
                </option>
              ))}
            </select>
          </div>

          {/* Clickable List of Sector Flights */}
          <div className="mt-3 max-h-64 overflow-y-auto space-y-2 pr-1">
            {flights.length === 0 ? (
              <div
                data-testid="sector-empty-message"
                className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80 text-center text-xs text-slate-300"
              >
                No active flights detected in this sector right now.
              </div>
            ) : (
              flights.map((flight) => {
                const isCurrent = activeFlight?.icao24 === flight.icao24;
                return (
                  <button
                    key={flight.icao24}
                    type="button"
                    data-testid={`sector-flight-item-${flight.callsign}`}
                    onClick={() => {
                      onSelectSpecificFlight(flight);
                      setIsFlightsDrawerOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-3 p-3 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                      isCurrent
                        ? 'bg-sky-500/20 border border-sky-400/60 text-white'
                        : 'bg-slate-900/85 border border-slate-800/90 text-slate-300 hover:bg-slate-800/90 hover:border-slate-700'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm text-white truncate">
                        {flight.callsign}
                      </div>
                      <div className="mt-0.5 text-slate-400 font-mono-tabular whitespace-nowrap truncate">
                        {flight.aircraftModel} · HEX {flight.icao24.toUpperCase()}
                      </div>
                    </div>
                    <div className="text-right font-mono-tabular shrink-0">
                      <div className="text-slate-100 font-semibold whitespace-nowrap">
                        {flight.altitudeFeet.toLocaleString()} ft
                      </div>
                      <div className="text-slate-400 whitespace-nowrap">
                        {flight.speedMph} mph · {flight.speedKnots} kn
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </dialog>
      )}

      {/* Bottom-Right Translucent Flight Telemetry, Global Search & Window Controls Overlay */}
      <aside
        aria-label="Flight Window Telemetry Overlay"
        className="fixed bottom-4 right-4 z-20 w-[calc(100vw-2rem)] sm:w-[436px] rounded-2xl bg-slate-950/92 border border-slate-800/90 shadow-2xl p-4 sm:p-5 text-slate-100"
      >
        {/* Global Flight Search Bar */}
        <form
          onSubmit={handleSearchSubmit}
          className="flex items-center gap-2 pb-3.5 border-b border-slate-800/80"
        >
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              name="callsign"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search Callsign / Flight # (e.g. DAL418, SWA123, BAW9)"
              aria-label="Search Callsign or Flight Number"
              data-testid="global-flight-search-input"
              className="w-full pl-8 pr-2.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs placeholder:text-[11px] text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-400 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={isSearchingCallsign}
            data-testid="global-flight-search-btn"
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed text-slate-100 font-semibold text-xs border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isSearchingCallsign ? 'Searching...' : 'Search'}
          </button>
        </form>

        {/* Active Aircraft Header + Clickable Flights (N) Button + Find Flight CTA */}
        <div className="flex items-start justify-between gap-3 pt-3.5 pb-3.5 border-b border-slate-800/80">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
              <span className="whitespace-nowrap">
                {selectedSector.shortCode} Sector
              </span>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => setIsFlightsDrawerOpen((prev) => !prev)}
                data-testid="sector-flights-trigger"
                className="inline-flex items-center gap-1 font-semibold text-sky-300 hover:text-sky-200 underline underline-offset-2 whitespace-nowrap cursor-pointer"
              >
                <span>Flights ({flights.length})</span>
                <ChevronUp
                  className={`w-3 h-3 transition-transform ${
                    isFlightsDrawerOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular whitespace-nowrap">
                Poll {secondsUntilNextPoll}s
              </span>
            </div>

            <div className="mt-1 flex items-baseline gap-2">
              <h1
                data-testid="active-flight-callsign"
                className="text-xl font-bold tracking-tight text-white truncate"
              >
                {activeFlight ? activeFlight.callsign : 'No Flight Locked'}
              </h1>
              {activeFlight && (
                <span className="text-xs text-slate-400 font-mono-tabular whitespace-nowrap shrink-0">
                  HEX {activeFlight.icao24.toUpperCase()}
                </span>
              )}
            </div>

            <p
              data-testid="hud-sector-status"
              className="mt-0.5 text-xs text-slate-400 leading-snug"
            >
              {activeFlight
                ? `${activeFlight.originCountry} · ${activeFlight.aircraftModel}`
                : flights.length === 0
                ? 'No active flights detected in this sector right now.'
                : 'Click Find Flight to lock onto an airborne aircraft'}
            </p>
          </div>

          <button
            type="button"
            onClick={onFindFlight}
            data-testid="find-flight-btn"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-400 hover:bg-sky-300 active:bg-sky-500 text-slate-950 font-semibold text-xs transition-colors whitespace-nowrap shrink-0 shadow-sm cursor-pointer"
          >
            <Plane className="w-3.5 h-3.5" />
            <span>Find Flight</span>
          </button>
        </div>

        {/* Primary Live Telemetry Metrics: Altitude (ft) and Speed (mph) */}
        <div className="mt-3.5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="whitespace-nowrap">Altitude</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              </div>
              <div
                data-testid="telemetry-altitude-ft"
                className="mt-1 text-2xl font-bold text-white font-mono-tabular whitespace-nowrap"
              >
                {displayAltFeet.toLocaleString()}{' '}
                <span className="text-xs font-normal text-slate-400">ft</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-400 font-mono-tabular whitespace-nowrap">
                {displayAltMeters.toLocaleString()} m MSL
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="whitespace-nowrap">Ground Speed</span>
                <Gauge className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              </div>
              <div
                data-testid="telemetry-speed-mph"
                className="mt-1 text-2xl font-bold text-white font-mono-tabular whitespace-nowrap"
              >
                {displaySpeedMph.toLocaleString()}{' '}
                <span className="text-xs font-normal text-slate-400">mph</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-400 font-mono-tabular whitespace-nowrap">
                {displaySpeedMps.toFixed(1)} m/s ·{' '}
                {activeFlight ? `${activeFlight.speedKnots} kn` : '0 kn'}
              </div>
            </div>
          </div>

          {/* Secondary Telemetry Row: Heading, Window Rig Toggle & Bezel Toggle */}
          <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between gap-2 text-xs text-slate-300 font-mono-tabular">
            <div className="whitespace-nowrap">
              <span className="text-slate-400">Hdg </span>
              <span data-testid="telemetry-heading-deg">
                {Math.round(displayTrackDeg)}°
              </span>
              <span aria-hidden="true" className="mx-1.5 text-slate-600">
                ·
              </span>
              <span className="text-slate-400">
                {viewMode === '2d' ? '2D Overhead' : 'Win '}
              </span>
              {viewMode === '3d' && (
                <span>
                  {displayCamHeadingDeg}° / {rigSettings.pitchDeg}°
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 shrink-0 font-sans">
              <button
                type="button"
                onClick={() => setShowRigPanel((prev) => !prev)}
                className="text-xs text-slate-300 hover:text-white transition-colors whitespace-nowrap cursor-pointer"
              >
                {showRigPanel ? 'Hide Rig' : 'Seat Rig'}
              </button>
              {viewMode === '3d' && (
                <button
                  type="button"
                  onClick={onToggleWindowFrame}
                  className="flex items-center gap-1 text-xs text-sky-300 hover:text-sky-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  aria-label={
                    showWindowFrame
                      ? 'Hide Cabin Window Bezel'
                      : 'Show Cabin Window Bezel'
                  }
                >
                  {showWindowFrame ? (
                    <>
                      <EyeOff className="w-3.5 h-3.5" />
                      <span>Hide Bezel</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-3.5 h-3.5" />
                      <span>Show Bezel</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Expandable Window Seat Camera Rig Controls */}
          {showRigPanel && (
            <div className="pt-3 border-t border-slate-800/80 space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-300 flex items-center gap-1.5 whitespace-nowrap">
                  <Compass className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span>Window Seat</span>
                </span>
                <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => onUpdateRigSettings({ seatSide: 'right' })}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      rigSettings.seatSide === 'right'
                        ? 'bg-sky-400 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Right 14F (+90°)
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateRigSettings({ seatSide: 'left' })}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      rigSettings.seatSide === 'left'
                        ? 'bg-sky-400 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Left 14A (-90°)
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-slate-300 mb-1">
                  <label htmlFor="pitch-slider" className="flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-sky-400" />
                    <span>Window Look Pitch</span>
                  </label>
                  <span className="font-mono-tabular text-slate-200">
                    {rigSettings.pitchDeg}°
                  </span>
                </div>
                <input
                  id="pitch-slider"
                  type="range"
                  min={-45}
                  max={5}
                  step={1}
                  value={rigSettings.pitchDeg}
                  onChange={(e) =>
                    onUpdateRigSettings({ pitchDeg: Number(e.target.value) })
                  }
                  className="w-full accent-sky-400 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-slate-300 mb-1">
                  <label htmlFor="shade-slider" className="flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-sky-400" />
                    <span>Cabin Window Shade</span>
                  </label>
                  <span className="font-mono-tabular text-slate-200">
                    {shadePercent}%
                  </span>
                </div>
                <input
                  id="shade-slider"
                  type="range"
                  min={0}
                  max={75}
                  step={5}
                  value={shadePercent}
                  onChange={(e) => onChangeShadePercent(Number(e.target.value))}
                  className="w-full accent-sky-400 cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* Coordinates & Engine Mode Footer */}
          <div className="flex items-center justify-between gap-2 text-xs text-slate-400 pt-0.5">
            <span className="font-mono-tabular whitespace-nowrap">
              {liveTelemetry
                ? `${Math.abs(liveTelemetry.latitude).toFixed(4)}° ${
                    liveTelemetry.latitude >= 0 ? 'N' : 'S'
                  }, ${Math.abs(liveTelemetry.longitude).toFixed(4)}° ${
                    liveTelemetry.longitude >= 0 ? 'E' : 'W'
                  }`
                : `${selectedSector.centerLat.toFixed(4)}° N, ${Math.abs(
                    selectedSector.centerLon
                  ).toFixed(4)}° W`}
            </span>
            <span className="text-slate-400 truncate">
              {engineStatus.statusMessage}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
