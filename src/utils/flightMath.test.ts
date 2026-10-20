import test from 'node:test';
import assert from 'node:assert/strict';
import {
  metersToFeet,
  mpsToMph,
  mpsToKnots,
  mpsToFpm,
  sanitizeCallsign,
  buildAirplanesLivePointUrl,
  buildAirplanesLiveCallsignUrl,
  parseAirplanesLivePointResponse,
  parseAirplanesLiveCallsignResponse,
  extrapolateFlightPosition,
  generateTrajectorySamples,
  computeWindowCameraLocalFrame,
  METRO_SECTORS,
} from './flightMath.ts';

test('unit conversions convert meters to feet and m/s to mph accurately', () => {
  assert.equal(metersToFeet(1000), 3281);
  assert.equal(metersToFeet(0), 0);
  assert.equal(mpsToMph(100), 224);
  assert.equal(mpsToMph(0), 0);
  assert.equal(mpsToKnots(100), 194);
  assert.equal(mpsToFpm(5), 984);
});

test('buildAirplanesLivePointUrl uses 150 NM radius and buildAirplanesLiveCallsignUrl formats AllOrigins proxy endpoint properly', () => {
  const nyc = METRO_SECTORS[0];
  const pointUrl = buildAirplanesLivePointUrl(nyc.centerLat, nyc.centerLon, 150, 1700000000000);
  assert.equal(
    pointUrl,
    'https://api.allorigins.win/raw?url=' +
      encodeURIComponent('https://api.adsb.lol/v2/point/40.7128/-74.006/150?t=1700000000000')
  );

  assert.equal(sanitizeCallsign('  swa123 '), 'SWA123');
  const callsignUrl = buildAirplanesLiveCallsignUrl('  dal418 ', 1700000000000);
  assert.equal(
    callsignUrl,
    'https://api.allorigins.win/raw?url=' +
      encodeURIComponent('https://api.adsb.lol/v2/callsign/DAL418?t=1700000000000')
  );
});

test('parseAirplanesLivePointResponse filters grounded or incomplete aircraft and only parses real airborne records', () => {
  const mockPointPayload = {
    ac: [
      {
        hex: 'a1b2c3',
        flight: 'DAL418  ',
        desc: 'AIRBUS A321NEO',
        r: 'N301DN',
        lat: 40.7128,
        lon: -74.006,
        alt_baro: 3200,
        alt_geom: 3300,
        gs: 195,
        track: 32,
        baro_rate: 400,
      },
      {
        hex: 'f00001',
        flight: 'UAL100  ',
        lat: 40.6413,
        lon: -73.778,
        alt_baro: 'ground',
        gs: 8,
      },
      {
        hex: 'f00002',
        flight: 'MISSING_ALT',
        lat: 40.6413,
        lon: -73.778,
      },
    ],
  };

  const flights = parseAirplanesLivePointResponse(mockPointPayload, 40, 1700000000);
  assert.equal(flights.length, 1);
  assert.equal(flights[0].callsign, 'DAL418');
  assert.equal(flights[0].altitudeFeet, 3300);
  assert.equal(flights[0].speedKnots, 195);
  assert.equal(flights[0].trueTrackDeg, 32);
  assert.equal(flights[0].isLiveAdsB, true);
});

test('parseAirplanesLiveCallsignResponse parses airborne aircraft and returns null when ac is empty, grounded, or missing telemetry', () => {
  const validPayload = {
    ac: [
      {
        hex: 'a4b5c6',
        flight: 'SWA123  ',
        t: 'B738',
        desc: 'Boeing 737-800',
        r: 'N8642A',
        lat: 37.7749,
        lon: -122.4194,
        alt_baro: 4200,
        alt_geom: 4350,
        gs: 210,
        track: 185,
        baro_rate: -450,
      },
    ],
  };

  const flight = parseAirplanesLiveCallsignResponse(validPayload, 'SWA123', 1700000000);
  assert.ok(flight);
  assert.equal(flight.callsign, 'SWA123');
  assert.equal(flight.altitudeFeet, 4350);
  assert.equal(flight.speedKnots, 210);
  assert.equal(flight.trueTrackDeg, 185);

  const groundedPayload = {
    ac: [
      {
        hex: 'a4b5c6',
        flight: 'SWA123',
        lat: 37.6188,
        lon: -122.375,
        alt_baro: 'ground',
        gs: 12,
      },
    ],
  };
  assert.equal(parseAirplanesLiveCallsignResponse(groundedPayload, 'SWA123'), null);
  assert.equal(parseAirplanesLiveCallsignResponse({ ac: [] }, 'UNKNOWN99'), null);
  assert.equal(parseAirplanesLiveCallsignResponse({}, 'UNKNOWN99'), null);
});

test('extrapolateFlightPosition projects aircraft forward along true_track heading', () => {
  const northProj = extrapolateFlightPosition(40.7128, -74.006, 1000, 100, 0, 0, 10);
  assert.ok(northProj.latitude > 40.7128);
  assert.ok(Math.abs(northProj.longitude - -74.006) < 1e-6);
  assert.equal(northProj.altitudeMeters, 1000);
});

test('generateTrajectorySamples produces monotonically advancing sample points', () => {
  const sampleFlight = {
    latitude: 40.7128,
    longitude: -74.006,
    altitudeMeters: 1200,
    velocityMps: 95,
    trueTrackDeg: 45,
    verticalRateMps: 0,
  };
  const samples = generateTrajectorySamples(sampleFlight, [0, 5, 10, 20]);
  assert.equal(samples.length, 4);
  assert.equal(samples[0].offsetSeconds, 0);
  assert.equal(samples[2].offsetSeconds, 10);
  assert.notEqual(samples[0].latitude, samples[2].latitude);
});

test('computeWindowCameraLocalFrame offsets camera +90 degrees right and -20 degrees pitch', () => {
  const frameNorth = computeWindowCameraLocalFrame(0, { seatSide: 'right', pitchDeg: -20, seatOffsetMeters: 3.0 });
  assert.equal(frameNorth.cameraHeadingDeg, 90);
  assert.equal(frameNorth.cameraPitchDeg, -20);
  assert.ok(Math.abs(frameNorth.seatOffsetEast - 3.0) < 1e-6);
  assert.ok(Math.abs(frameNorth.seatOffsetNorth) < 1e-6);
});
