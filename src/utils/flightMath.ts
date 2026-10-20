/**
 * Pure flight kinematics, Airplanes.live ADS-B API state parsing, forward geodesic extrapolation,
 * and window camera rig orientation calculations for YS-WebFLY.
 * Zero mock or hardcoded flight data — strictly parses live ADS-B telemetry from api.airplanes.live.
 */

export interface BoundingBoxSector {
  id: string;
  name: string;
  shortCode: string;
  airportCode: string;
  description: string;
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
  centerLat: number;
  centerLon: number;
}

export interface AirborneFlight {
  icao24: string;
  callsign: string;
  aircraftModel: string;
  originCountry: string;
  timePosition: number;
  lastContact: number;
  longitude: number;
  latitude: number;
  baroAltitudeMeters: number;
  geoAltitudeMeters: number;
  altitudeMeters: number;
  altitudeFeet: number;
  onGround: boolean;
  velocityMps: number;
  speedMph: number;
  speedKnots: number;
  trueTrackDeg: number;
  verticalRateMps: number;
  verticalRateFpm: number;
  isLiveAdsB: boolean;
}

export interface ExtrapolatedPoint {
  offsetSeconds: number;
  latitude: number;
  longitude: number;
  altitudeMeters: number;
}

export interface WindowCameraLocalFrame {
  seatOffsetEast: number;
  seatOffsetNorth: number;
  seatOffsetUp: number;
  directionEast: number;
  directionNorth: number;
  directionUp: number;
  upEast: number;
  upNorth: number;
  upUp: number;
  cameraHeadingDeg: number;
  cameraPitchDeg: number;
}

const EARTH_RADIUS_METERS = 6371000;
const METERS_TO_FEET = 3.280839895;
const MPS_TO_MPH = 2.236936292;
const MPS_TO_KNOTS = 1.943844492;
const MPS_TO_FPM = 196.8503937;

export const METRO_SECTORS: BoundingBoxSector[] = [
  {
    id: 'nyc',
    name: 'New York City Metro',
    shortCode: 'NYC',
    airportCode: 'JFK · LGA · EWR',
    description: 'Manhattan skyline, Hudson River corridor & NY/NJ approaches',
    lamin: 40.45,
    lomin: -74.35,
    lamax: 41.05,
    lomax: -73.55,
    centerLat: 40.7128,
    centerLon: -74.006,
  },
  {
    id: 'sfo',
    name: 'San Francisco Bay Area',
    shortCode: 'SFO',
    airportCode: 'SFO · OAK · SJC',
    description: 'Golden Gate Bridge, Financial District & Bay approach path',
    lamin: 37.35,
    lomin: -122.65,
    lamax: 37.95,
    lomax: -121.95,
    centerLat: 37.7749,
    centerLon: -122.4194,
  },
  {
    id: 'lax',
    name: 'Los Angeles Basin',
    shortCode: 'LAX',
    airportCode: 'LAX · BUR · LGB',
    description: 'Downtown LA, Santa Monica Bay & Pacific coastal corridor',
    lamin: 33.75,
    lomin: -118.65,
    lamax: 34.25,
    lomax: -117.95,
    centerLat: 33.9416,
    centerLon: -118.4085,
  },
  {
    id: 'chi',
    name: 'Chicago Lakefront',
    shortCode: 'ORD',
    airportCode: 'ORD · MDW',
    description: 'Willis Tower, Lake Michigan shoreline & O’Hare east-west finals',
    lamin: 41.65,
    lomin: -88.15,
    lamax: 42.15,
    lomax: -87.45,
    centerLat: 41.8781,
    centerLon: -87.6298,
  },
];

/**
 * Converts altitude in meters to feet.
 */
export function metersToFeet(meters: number): number {
  if (!Number.isFinite(meters)) return 0;
  return Math.round(meters * METERS_TO_FEET);
}

/**
 * Converts altitude in feet to meters.
 */
export function feetToMeters(feet: number): number {
  if (!Number.isFinite(feet)) return 0;
  return Math.round(feet / METERS_TO_FEET);
}

/**
 * Converts velocity in meters/second to miles/hour.
 */
export function mpsToMph(mps: number): number {
  if (!Number.isFinite(mps) || mps < 0) return 0;
  return Math.round(mps * MPS_TO_MPH);
}

/**
 * Converts velocity in meters/second to knots.
 */
export function mpsToKnots(mps: number): number {
  if (!Number.isFinite(mps) || mps < 0) return 0;
  return Math.round(mps * MPS_TO_KNOTS);
}

/**
 * Converts velocity in knots to meters/second.
 */
export function knotsToMps(knots: number): number {
  if (!Number.isFinite(knots) || knots < 0) return 0;
  return Number((knots / MPS_TO_KNOTS).toFixed(1));
}

/**
 * Converts vertical rate in meters/second to feet/minute.
 */
export function mpsToFpm(verticalRateMps: number): number {
  if (!Number.isFinite(verticalRateMps)) return 0;
  return Math.round(verticalRateMps * MPS_TO_FPM);
}

/**
 * Builds the AllOrigins-wrapped adsb.lol geographic radius endpoint URL with cache-busting timestamp:
 * 'https://api.allorigins.win/raw?url=' + encodeURIComponent(`https://api.adsb.lol/v2/point/${lat}/${lon}/150?t=${timestamp}`)
 */
export function buildAirplanesLivePointUrl(
  lat: number,
  lon: number,
  radiusNm = 150,
  timestamp: number = Date.now()
): string {
  return (
    'https://api.allorigins.win/raw?url=' +
    encodeURIComponent(`https://api.adsb.lol/v2/point/${lat}/${lon}/${radiusNm}?t=${timestamp}`)
  );
}

/**
 * Sanitizes a user-typed callsign (trims spaces and converts to uppercase).
 */
export function sanitizeCallsign(callsign: string): string {
  return callsign.trim().toUpperCase();
}

/**
 * Builds the AllOrigins-wrapped adsb.lol callsign lookup endpoint URL with cache-busting timestamp:
 * 'https://api.allorigins.win/raw?url=' + encodeURIComponent(`https://api.adsb.lol/v2/callsign/${callsign}?t=${timestamp}`)
 */
export function buildAirplanesLiveCallsignUrl(
  callsign: string,
  timestamp: number = Date.now()
): string {
  const sanitized = sanitizeCallsign(callsign);
  return (
    'https://api.allorigins.win/raw?url=' +
    encodeURIComponent(`https://api.adsb.lol/v2/callsign/${sanitized}?t=${timestamp}`)
  );
}

/**
 * Converts a single raw aircraft object from api.airplanes.live (`data.ac[i]`)
 * into a validated AirborneFlight.
 * Strictly requires valid numeric latitude, longitude, and positive altitude (> 0).
 */
export function parseSingleAirplanesLiveRecord(
  rec: Record<string, unknown>,
  fallbackCallsign = '',
  nowSec: number = Math.floor(Date.now() / 1000)
): AirborneFlight | null {
  const lat = typeof rec.lat === 'number' ? rec.lat : null;
  const lon = typeof rec.lon === 'number' ? rec.lon : null;
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  // Filter out aircraft explicitly on the ground
  if (rec.alt_baro === 'ground' || rec.on_ground === true) {
    return null;
  }

  // Require real numeric altitude from alt_geom or alt_baro
  const hasGeomAlt = typeof rec.alt_geom === 'number' && Number.isFinite(rec.alt_geom);
  const hasBaroAlt = typeof rec.alt_baro === 'number' && Number.isFinite(rec.alt_baro);
  if (!hasGeomAlt && !hasBaroAlt) {
    return null;
  }

  const altFeetRaw = hasGeomAlt
    ? (rec.alt_geom as number)
    : (rec.alt_baro as number);

  if (altFeetRaw <= 0) {
    return null;
  }

  const hex =
    typeof rec.hex === 'string' && rec.hex.trim()
      ? rec.hex.trim().toLowerCase()
      : '';
  if (!hex) {
    return null;
  }

  const gsKnots =
    typeof rec.gs === 'number' && Number.isFinite(rec.gs) && rec.gs >= 0
      ? rec.gs
      : 0;

  const trackDeg =
    typeof rec.track === 'number' && Number.isFinite(rec.track)
      ? ((rec.track % 360) + 360) % 360
      : 0;

  const baroRateFpm =
    typeof rec.baro_rate === 'number' && Number.isFinite(rec.baro_rate)
      ? rec.baro_rate
      : typeof rec.geom_rate === 'number' && Number.isFinite(rec.geom_rate)
      ? rec.geom_rate
      : 0;

  const rawFlight =
    typeof rec.flight === 'string' ? rec.flight.trim().toUpperCase() : '';
  const callsign =
    rawFlight ||
    sanitizeCallsign(fallbackCallsign) ||
    hex.toUpperCase();

  const typeCode =
    typeof rec.t === 'string' && rec.t.trim() ? rec.t.trim().toUpperCase() : '';
  const descText =
    typeof rec.desc === 'string' && rec.desc.trim() ? rec.desc.trim() : '';
  const aircraftModel = descText || typeCode || 'ADS-B Transponder';

  const originCountry =
    typeof rec.r === 'string' && rec.r.trim()
      ? `Reg ${rec.r.trim()}`
      : typeof rec.ownOp === 'string' && rec.ownOp.trim()
      ? rec.ownOp.trim()
      : 'Live ADS-B';

  const altMeters = Math.max(1, feetToMeters(altFeetRaw));
  const velocityMps = knotsToMps(gsKnots);
  const verticalRateMps = Number((baroRateFpm / MPS_TO_FPM).toFixed(1));

  return {
    icao24: hex,
    callsign,
    aircraftModel,
    originCountry,
    timePosition: nowSec,
    lastContact: nowSec,
    longitude: Number(lon.toFixed(6)),
    latitude: Number(lat.toFixed(6)),
    baroAltitudeMeters: hasBaroAlt ? feetToMeters(rec.alt_baro as number) : altMeters,
    geoAltitudeMeters: hasGeomAlt ? feetToMeters(rec.alt_geom as number) : altMeters,
    altitudeMeters: altMeters,
    altitudeFeet: Math.round(altFeetRaw),
    onGround: false,
    velocityMps,
    speedMph: mpsToMph(velocityMps),
    speedKnots: Math.round(gsKnots),
    trueTrackDeg: Number(trackDeg.toFixed(1)),
    verticalRateMps,
    verticalRateFpm: Math.round(baroRateFpm),
    isLiveAdsB: true,
  };
}

/**
 * Parses a response payload from https://api.airplanes.live/v2/point/{lat}/{lon}/150
 * Returns only real airborne flights present in `data.ac`.
 */
export function parseAirplanesLivePointResponse(
  payload: unknown,
  maxFlights = 60,
  nowSec: number = Math.floor(Date.now() / 1000)
): AirborneFlight[] {
  if (!payload || typeof payload !== 'object') return [];
  const acList = (payload as { ac?: unknown[] }).ac;
  if (!Array.isArray(acList) || acList.length === 0) return [];

  const flights: AirborneFlight[] = [];
  const seenHex = new Set<string>();

  for (const item of acList) {
    if (!item || typeof item !== 'object') continue;
    const parsed = parseSingleAirplanesLiveRecord(
      item as Record<string, unknown>,
      '',
      nowSec
    );
    if (!parsed) continue;
    if (seenHex.has(parsed.icao24)) continue;
    seenHex.add(parsed.icao24);
    flights.push(parsed);
  }

  return flights.slice(0, maxFlights);
}

/**
 * Parses a response payload from https://api.airplanes.live/v2/callsign/{callsign}
 * Returns an AirborneFlight only if `data.ac` has real live telemetry with valid lat, lon, and altitude.
 */
export function parseAirplanesLiveCallsignResponse(
  payload: unknown,
  fallbackCallsign = '',
  nowSec: number = Math.floor(Date.now() / 1000)
): AirborneFlight | null {
  if (!payload || typeof payload !== 'object') return null;
  const acList = (payload as { ac?: unknown[] }).ac;
  if (!Array.isArray(acList) || acList.length === 0) return null;

  for (const item of acList) {
    if (!item || typeof item !== 'object') continue;
    const parsed = parseSingleAirplanesLiveRecord(
      item as Record<string, unknown>,
      fallbackCallsign,
      nowSec
    );
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

/**
 * Extrapolates the aircraft's forward geographic coordinate and altitude after `deltaSeconds`
 * using spherical geodesic projection from current (lat, lon), velocity (m/s), and true_track (deg).
 */
export function extrapolateFlightPosition(
  latitudeDeg: number,
  longitudeDeg: number,
  altitudeMeters: number,
  velocityMps: number,
  trueTrackDeg: number,
  verticalRateMps: number,
  deltaSeconds: number
): ExtrapolatedPoint {
  if (deltaSeconds === 0 || velocityMps <= 0) {
    return {
      offsetSeconds: deltaSeconds,
      latitude: latitudeDeg,
      longitude: longitudeDeg,
      altitudeMeters: Math.max(1, altitudeMeters),
    };
  }

  const distanceMeters = velocityMps * deltaSeconds;
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const bearingRad = (trueTrackDeg * Math.PI) / 180;
  const lat1Rad = (latitudeDeg * Math.PI) / 180;
  const lon1Rad = (longitudeDeg * Math.PI) / 180;

  const sinLat1 = Math.sin(lat1Rad);
  const cosLat1 = Math.cos(lat1Rad);
  const sinAngular = Math.sin(angularDistance);
  const cosAngular = Math.cos(angularDistance);

  const sinLat2 = sinLat1 * cosAngular + cosLat1 * sinAngular * Math.cos(bearingRad);
  const lat2Rad = Math.asin(Math.max(-1, Math.min(1, sinLat2)));

  const y = Math.sin(bearingRad) * sinAngular * cosLat1;
  const x = cosAngular - sinLat1 * Math.sin(lat2Rad);
  const lon2Rad = lon1Rad + Math.atan2(y, x);

  const projectedLat = (lat2Rad * 180) / Math.PI;
  const rawLon = (lon2Rad * 180) / Math.PI;
  const projectedLon = ((((rawLon + 180) % 360) + 360) % 360) - 180;

  const clampedVerticalRate = Math.max(-12, Math.min(12, verticalRateMps));
  const projectedAlt = Math.max(1, altitudeMeters + clampedVerticalRate * deltaSeconds);

  return {
    offsetSeconds: deltaSeconds,
    latitude: projectedLat,
    longitude: projectedLon,
    altitudeMeters: projectedAlt,
  };
}

/**
 * Generates an array of forward-extrapolated trajectory sample points for Cesium.SampledPositionProperty.
 */
export function generateTrajectorySamples(
  flight: Pick<AirborneFlight, 'latitude' | 'longitude' | 'altitudeMeters' | 'velocityMps' | 'trueTrackDeg' | 'verticalRateMps'>,
  sampleOffsetsSec: number[] = [0, 2, 5, 8, 10, 14, 18, 25]
): ExtrapolatedPoint[] {
  return sampleOffsetsSec.map((offsetSec) =>
    extrapolateFlightPosition(
      flight.latitude,
      flight.longitude,
      flight.altitudeMeters,
      flight.velocityMps,
      flight.trueTrackDeg,
      flight.verticalRateMps,
      offsetSec
    )
  );
}

/**
 * Computes the local East-North-Up (ENU) window camera position offset and orientation vectors.
 */
export function computeWindowCameraLocalFrame(
  trueTrackDeg: number,
  options: {
    seatSide?: 'right' | 'left';
    seatOffsetMeters?: number;
    seatUpMeters?: number;
    pitchDeg?: number;
    yawFineTuneDeg?: number;
  } = {}
): WindowCameraLocalFrame {
  const seatSide = options.seatSide ?? 'right';
  const seatOffsetMeters = options.seatOffsetMeters ?? 3.2;
  const seatUpMeters = options.seatUpMeters ?? 0.6;
  const pitchDeg = options.pitchDeg ?? -20;
  const yawFineTuneDeg = options.yawFineTuneDeg ?? 0;

  const sideYawOffset = seatSide === 'right' ? 90 : -90;
  const cameraHeadingDeg = (((trueTrackDeg + sideYawOffset + yawFineTuneDeg) % 360) + 360) % 360;

  const seatAzimuthDeg = (((trueTrackDeg + sideYawOffset) % 360) + 360) % 360;
  const seatAzimuthRad = (seatAzimuthDeg * Math.PI) / 180;

  const seatOffsetEast = Math.sin(seatAzimuthRad) * seatOffsetMeters;
  const seatOffsetNorth = Math.cos(seatAzimuthRad) * seatOffsetMeters;
  const seatOffsetUp = seatUpMeters;

  const lookHeadingRad = (cameraHeadingDeg * Math.PI) / 180;
  const pitchRad = (pitchDeg * Math.PI) / 180;

  const cosPitch = Math.cos(pitchRad);
  const sinPitch = Math.sin(pitchRad);
  const sinHeading = Math.sin(lookHeadingRad);
  const cosHeading = Math.cos(lookHeadingRad);

  const directionEast = sinHeading * cosPitch;
  const directionNorth = cosHeading * cosPitch;
  const directionUp = sinPitch;

  const upEast = -sinHeading * sinPitch;
  const upNorth = -cosHeading * sinPitch;
  const upUp = cosPitch;

  return {
    seatOffsetEast,
    seatOffsetNorth,
    seatOffsetUp,
    directionEast,
    directionNorth,
    directionUp,
    upEast,
    upNorth,
    upUp,
    cameraHeadingDeg,
    cameraPitchDeg: pitchDeg,
  };
}
