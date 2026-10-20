/**
 * YS-WebFLY — Real-Time 3D Airplane Window Simulator & 2D Moving Map Engine
 * 100% Free Zero-Cost Architecture:
 * - CesiumJS 3D Globe with Cesium.createOsmBuildingsAsync() & Cesium.createWorldTerrainAsync()
 * - Free OpenStreetMap / Carto dark & aerial raster tiles
 * - Smooth frame-by-frame interpolation via Cesium.SampledPositionProperty
 * - 3D Window Camera Rig (eastNorthUpToFixedFrame) + 2D Top-Down Moving Map Tracker
 */

import {
  type AirborneFlight,
  computeWindowCameraLocalFrame,
  extrapolateFlightPosition,
  generateTrajectorySamples,
  metersToFeet,
  mpsToMph,
} from '../utils/flightMath';

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Cesium?: any;
  }
}

export type ViewMode = '3d' | '2d';

export interface WindowRigSettings {
  seatSide: 'right' | 'left';
  pitchDeg: number;
  yawFineTuneDeg: number;
  seatOffsetMeters: number;
}

export interface LiveInterpolatedTelemetry {
  latitude: number;
  longitude: number;
  altitudeMeters: number;
  altitudeFeet: number;
  speedMps: number;
  speedMph: number;
  trueTrackDeg: number;
  cameraHeadingDeg: number;
  cameraPitchDeg: number;
}

export interface EngineStatus {
  mode: 'cesium-osm-3d' | 'cesium-2d-map' | 'canvas-fallback';
  tilesLoaded: boolean;
  statusMessage: string;
}

// User-provided Cesium Ion Access Token for World Terrain, OSM 3D Buildings & Ion Imagery
export const CESIUM_ION_TOKEN =
  import.meta.env.VITE_CESIUM_ION_TOKEN ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6Ik84SUlMZGdEMF9MTVFRM0MiLCJqdGkiOiI4MWJhMDhiYy01MGYwLTQzYzItYWRiNy02MDUwNjVjMGM5MDciLCJpZCI6NTMwODk5LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3OTI0ODUxOTl9.umz0zO45DqpcnmyHEeh8Lx67YF64lnSx0U7wrkY9WjI';

// Create a crisp data-URI SVG airplane icon for 2D Moving Map mode
const AIRPLANE_2D_SVG_URI = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#38bdf8" stroke="#082f49" stroke-width="1.2">
    <path d="M12 2L14.2 9.2L21.5 11.5V13.5L14.2 12.2L13.8 18.5L16.8 20.5V22L12 20.8L7.2 22V20.5L10.2 18.5L9.8 12.2L2.5 13.5V11.5L9.8 9.2L12 2Z"/>
  </svg>`
)}`;

export class CesiumWindowEngine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private viewer: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private aircraftEntity: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private flightPathEntity: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sampledPosition: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private osmBuildingsTileset: any = null;
  private preUpdateRemoveCallback: (() => void) | null = null;

  private activeFlight: AirborneFlight | null = null;
  private viewMode: ViewMode = '3d';
  private rigSettings: WindowRigSettings = {
    seatSide: 'right',
    pitchDeg: -20,
    yawFineTuneDeg: 0,
    seatOffsetMeters: 3.2,
  };

  private isLockedToFlight = false;
  private isHeadless = false;
  private lastTelemetryEmitMs = 0;
  private onTelemetryFrame?: (telemetry: LiveInterpolatedTelemetry) => void;
  private onStatusChange?: (status: EngineStatus) => void;

  // Fallback 2.5D / 2D Canvas animation when WebGL is unavailable
  private fallbackCanvas: HTMLCanvasElement | null = null;
  private fallbackRafId: number | null = null;
  private fallbackStartTimeMs = performance.now();

  constructor(callbacks?: {
    onTelemetryFrame?: (telemetry: LiveInterpolatedTelemetry) => void;
    onStatusChange?: (status: EngineStatus) => void;
  }) {
    this.onTelemetryFrame = callbacks?.onTelemetryFrame;
    this.onStatusChange = callbacks?.onStatusChange;
    this.isHeadless =
      typeof navigator !== 'undefined' &&
      (Boolean(navigator.webdriver) || /HeadlessChrome/i.test(navigator.userAgent));
  }

  public async initialize(container: HTMLElement): Promise<void> {
    const Cesium = window.Cesium;
    if (!Cesium) {
      this.initCanvasFallback(container, 'CesiumJS CDN unavailable — 3D Horizon Active');
      return;
    }

    try {
      // Configure Cesium Ion access token before creating Viewer & loading 3D assets
      if (Cesium.Ion) {
        Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;
      }

      // 1. Initialize Cesium.Viewer with timeline, animation, baseLayerPicker disabled
      this.viewer = new Cesium.Viewer(container, {
        timeline: false,
        animation: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        shouldAnimate: true,
        requestRenderMode: false,
        contextOptions: {
          webgl: {
            alpha: false,
            antialias: !this.isHeadless,
            powerPreference: 'high-performance',
            failIfMajorPerformanceCaveat: false,
          },
        },
      });

      const scene = this.viewer.scene;
      scene.globe.show = true;
      scene.globe.baseColor = Cesium.Color.fromCssColorString('#0c1626');
      scene.globe.depthTestAgainstTerrain = true;
      scene.skyBox.show = true;
      if (scene.skyAtmosphere) {
        scene.skyAtmosphere.show = true;
        scene.skyAtmosphere.hueShift = -0.02;
        scene.skyAtmosphere.saturationShift = 0.05;
        scene.skyAtmosphere.brightnessShift = 0.04;
      }
      scene.fog.enabled = true;
      scene.fog.density = 0.00014;
      scene.backgroundColor = Cesium.Color.fromCssColorString('#08101d');

      if (this.isHeadless) {
        this.viewer.resolutionScale = 1.0;
        if (scene.postProcessStages?.fxaa) {
          scene.postProcessStages.fxaa.enabled = false;
        }
      } else {
        this.viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2);
      }

      // Configure real-time clock for smooth SampledPositionProperty interpolation
      this.viewer.clock.shouldAnimate = true;
      this.viewer.clock.multiplier = 1.0;
      this.viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK_MULTIPLIER;

      // 2. Load Cesium Ion Imagery / OpenStreetMap + World Terrain + OSM 3D Buildings
      await this.setupFreeGlobeAndOsmBuildings();

      // 3. Register frame-by-frame camera updater for both 3D Window View and 2D Moving Map
      this.preUpdateRemoveCallback = scene.preUpdate.addEventListener(() => {
        this.updateCameraRigOnFrame();
      });

      // Ensure morph completion re-applies camera lock cleanly
      scene.morphComplete.addEventListener(() => {
        this.updateCameraRigOnFrame(true);
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.initCanvasFallback(container, `3D Synthetic Horizon Active (${reason.slice(0, 42)})`);
    }
  }

  private async setupFreeGlobeAndOsmBuildings(): Promise<void> {
    const Cesium = window.Cesium;
    if (!Cesium || !this.viewer) return;

    // A. Ensure base imagery is present (uses Cesium Ion default aerial imagery or OpenStreetMap fallback)
    try {
      if (this.viewer.imageryLayers.length === 0 && Cesium.OpenStreetMapImageryProvider) {
        const osmProvider = new Cesium.OpenStreetMapImageryProvider({
          url: 'https://tile.openstreetmap.org/',
        });
        const layer = this.viewer.imageryLayers.addImageryProvider(osmProvider);
        layer.brightness = 0.84;
        layer.contrast = 1.12;
        layer.saturation = 0.9;
      }
    } catch {
      // Keep default imagery
    }

    // B & C. Cesium World Terrain (Cesium.createWorldTerrainAsync) & OSM Buildings (Cesium.createOsmBuildingsAsync)
    try {
      if (typeof Cesium.createWorldTerrainAsync === 'function') {
        const terrainProvider = await Cesium.createWorldTerrainAsync();
        if (this.viewer && !this.viewer.isDestroyed()) {
          this.viewer.terrainProvider = terrainProvider;
        }
      }
    } catch {
      // Fallback to WGS84 ellipsoid if terrain endpoint is unreachable
    }

    try {
      if (typeof Cesium.createOsmBuildingsAsync === 'function') {
        const osmBuildings = await Cesium.createOsmBuildingsAsync();
        if (this.viewer && !this.viewer.isDestroyed()) {
          this.osmBuildingsTileset = this.viewer.scene.primitives.add(osmBuildings);
          this.osmBuildingsTileset.show = this.viewMode === '3d';
        }
      }
    } catch {
      // Continue with OSM raster globe if 3D tileset is unavailable
    }

    this.onStatusChange?.({
      mode: this.viewMode === '3d' ? 'cesium-osm-3d' : 'cesium-2d-map',
      tilesLoaded: true,
      statusMessage:
        this.viewMode === '3d' ? '3D Window View · OSM Buildings' : '2D Moving Map Tracker',
    });
  }

  /**
   * Positions the camera over the selected metropolitan sector when no live aircraft is locked.
   */
  public focusSector(centerLat: number, centerLon: number): void {
    const Cesium = window.Cesium;
    if (!Cesium || !this.viewer) return;

    try {
      this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      if (this.viewMode === '2d') {
        this.viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 24000),
          orientation: {
            heading: 0,
            pitch: -Cesium.Math.PI_OVER_TWO,
            roll: 0,
          },
        });
      } else {
        this.viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat - 0.035, 1650),
          orientation: {
            heading: Cesium.Math.toRadians(15),
            pitch: Cesium.Math.toRadians(-18),
            roll: 0,
          },
        });
      }
    } catch {
      // Ignore transient camera state error
    }
  }

  /**
   * Clears any locked aircraft when switching to a sector with no active flights.
   */
  public clearFlightLock(centerLat?: number, centerLon?: number): void {
    this.activeFlight = null;
    this.isLockedToFlight = false;
    this.sampledPosition = null;

    const Cesium = window.Cesium;
    if (Cesium && this.viewer) {
      try {
        this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      } catch {
        // Ignore
      }
      if (this.aircraftEntity) {
        this.viewer.entities.remove(this.aircraftEntity);
        this.aircraftEntity = null;
      }
      if (this.flightPathEntity) {
        this.viewer.entities.remove(this.flightPathEntity);
        this.flightPathEntity = null;
      }
    }

    if (typeof centerLat === 'number' && typeof centerLon === 'number') {
      this.focusSector(centerLat, centerLon);
    }
  }

  /**
   * Switches between 3D Window View and 2D Moving Map Mode.
   * - 3D Mode: Usesviewer.scene.morphTo3D(1.0), shows 3D OSM buildings, and locks first-person window seat rig.
   * - 2D Mode: Uses viewer.scene.morphTo2D(1.0), hides 3D buildings for performance, and displays top-down
   *   overhead flight tracker with airplane icon and trajectory path.
   */
  public setViewMode(mode: ViewMode): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;

    const Cesium = window.Cesium;
    if (Cesium && this.viewer) {
      const is2D = mode === '2d';

      // Release any active camera lookAtTransform before morphing or switching perspective
      try {
        this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      } catch {
        // Ignore if transform already identity
      }

      // Show or hide 3D building primitives for performance in 2D mode
      if (this.osmBuildingsTileset) {
        this.osmBuildingsTileset.show = !is2D;
      }

      // Toggle 2D airplane icon & trajectory path visibility
      if (this.aircraftEntity?.billboard) {
        this.aircraftEntity.billboard.show = is2D;
      }
      if (this.aircraftEntity?.label) {
        this.aircraftEntity.label.show = is2D;
      }
      if (this.flightPathEntity) {
        this.flightPathEntity.show = is2D;
      }

      // Trigger Cesium scene morph between 2D and 3D (use 0.0 duration in headless for instant deterministic switch, 1.0s in interactive browser)
      const morphDuration = this.isHeadless ? 0.0 : 1.0;
      try {
        if (is2D && typeof this.viewer.scene.morphTo2D === 'function') {
          this.viewer.scene.morphTo2D(morphDuration);
        } else if (!is2D && typeof this.viewer.scene.morphTo3D === 'function') {
          this.viewer.scene.morphTo3D(morphDuration);
        }
      } catch {
        // Fallback if scene morph is mid-transition
      }

      this.updateCameraRigOnFrame(true);
    }

    this.onStatusChange?.({
      mode: this.fallbackCanvas
        ? 'canvas-fallback'
        : mode === '3d'
        ? 'cesium-osm-3d'
        : 'cesium-2d-map',
      tilesLoaded: true,
      statusMessage:
        mode === '3d' ? '3D Window View · OSM Buildings' : '2D Moving Map Tracker',
    });
  }

  public getViewMode(): ViewMode {
    return this.viewMode;
  }

  /**
   * Updates or creates the tracked aircraft entity using Cesium.SampledPositionProperty
   * and feeds forward-extrapolated positions so switching planes or modes never causes jitter.
   */
  public lockToFlight(flight: AirborneFlight): void {
    this.activeFlight = flight;
    this.isLockedToFlight = true;

    const Cesium = window.Cesium;
    if (!Cesium || !this.viewer) {
      this.emitFallbackTelemetry();
      return;
    }

    const nowJulian = Cesium.JulianDate.now();
    this.viewer.clock.currentTime = Cesium.JulianDate.clone(nowJulian);
    this.viewer.clock.shouldAnimate = true;

    // Create fresh SampledPositionProperty when switching aircraft so old coordinates never blend across cities
    this.sampledPosition = new Cesium.SampledPositionProperty();
    this.sampledPosition.setInterpolationOptions({
      interpolationDegree: 1,
      interpolationAlgorithm: Cesium.LinearApproximation,
    });
    this.sampledPosition.forwardExtrapolationType = Cesium.ExtrapolationType.EXTRAPOLATE;
    this.sampledPosition.forwardExtrapolationDuration = 30.0;
    this.sampledPosition.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;

    // Feed extrapolated forward trajectory points into SampledPositionProperty
    const samples = generateTrajectorySamples(flight, [0, 2, 5, 8, 10, 14, 18, 25, 35]);
    for (const sample of samples) {
      const sampleTime = Cesium.JulianDate.addSeconds(
        nowJulian,
        sample.offsetSeconds,
        new Cesium.JulianDate()
      );
      const cartesianPos = Cesium.Cartesian3.fromDegrees(
        sample.longitude,
        sample.latitude,
        sample.altitudeMeters
      );
      this.sampledPosition.addSample(sampleTime, cartesianPos);
    }

    // Build past + future trajectory line for 2D Moving Map mode
    const pastPoint = extrapolateFlightPosition(
      flight.latitude,
      flight.longitude,
      flight.altitudeMeters,
      flight.velocityMps,
      (flight.trueTrackDeg + 180) % 360,
      0,
      120
    );
    const futurePoint = extrapolateFlightPosition(
      flight.latitude,
      flight.longitude,
      flight.altitudeMeters,
      flight.velocityMps,
      flight.trueTrackDeg,
      0,
      180
    );

    const pathPositions = Cesium.Cartesian3.fromDegreesArrayHeights([
      pastPoint.longitude,
      pastPoint.latitude,
      flight.altitudeMeters,
      flight.longitude,
      flight.latitude,
      flight.altitudeMeters,
      futurePoint.longitude,
      futurePoint.latitude,
      flight.altitudeMeters,
    ]);

    const is2D = this.viewMode === '2d';
    // Cesium billboard rotation is counter-clockwise in radians from North
    const rotationRad = -Cesium.Math.toRadians(flight.trueTrackDeg);

    if (!this.aircraftEntity) {
      this.aircraftEntity = this.viewer.entities.add({
        id: 'ys-webfly-active-aircraft',
        name: flight.callsign,
        position: this.sampledPosition,
        orientation: new Cesium.VelocityOrientationProperty(this.sampledPosition),
        billboard: {
          image: AIRPLANE_2D_SVG_URI,
          show: is2D,
          scale: 1.0,
          rotation: rotationRad,
          alignedAxis: Cesium.Cartesian3.UNIT_Z,
        },
        label: {
          text: `${flight.callsign} · ${flight.altitudeFeet.toLocaleString()} ft`,
          show: is2D,
          font: '600 12px "JetBrains Mono", monospace',
          fillColor: Cesium.Color.fromCssColorString('#f8fafc'),
          outlineColor: Cesium.Color.fromCssColorString('#020617'),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -32),
        },
      });
    } else {
      this.aircraftEntity.name = flight.callsign;
      this.aircraftEntity.position = this.sampledPosition;
      this.aircraftEntity.orientation = new Cesium.VelocityOrientationProperty(
        this.sampledPosition
      );
      if (this.aircraftEntity.billboard) {
        this.aircraftEntity.billboard.show = is2D;
        this.aircraftEntity.billboard.rotation = rotationRad;
      }
      if (this.aircraftEntity.label) {
        this.aircraftEntity.label.show = is2D;
        this.aircraftEntity.label.text = `${flight.callsign} · ${flight.altitudeFeet.toLocaleString()} ft`;
      }
    }

    if (!this.flightPathEntity) {
      this.flightPathEntity = this.viewer.entities.add({
        id: 'ys-webfly-flight-path',
        show: is2D,
        polyline: {
          positions: pathPositions,
          width: 3,
          material: Cesium.Color.fromCssColorString('#38bdf8').withAlpha(0.85),
        },
      });
    } else {
      this.flightPathEntity.show = is2D;
      this.flightPathEntity.polyline.positions = pathPositions;
    }

    // Immediately snap camera to the newly locked flight
    this.updateCameraRigOnFrame(true);
  }

  public updateRigSettings(partial: Partial<WindowRigSettings>): void {
    this.rigSettings = {
      ...this.rigSettings,
      ...partial,
    };
    this.updateCameraRigOnFrame(true);
  }

  public getRigSettings(): WindowRigSettings {
    return { ...this.rigSettings };
  }

  /**
   * Frame-by-frame camera controller:
   * - In 3D Mode: Locks camera to aircraft's local East-North-Up (ENU) reference frame
   *   offset to the passenger window seat (+90° right or -90° left, -20° pitch).
   * - In 2D Mode: Positions camera top-down overhead tracking the interpolated aircraft position.
   */
  private updateCameraRigOnFrame(forceTelemetryEmit = false): void {
    const Cesium = window.Cesium;
    if (!Cesium || !this.viewer || !this.isLockedToFlight || !this.activeFlight || !this.sampledPosition) {
      return;
    }

    const currentTime = this.viewer.clock.currentTime;
    const currentPosition = this.sampledPosition.getValue(currentTime);
    if (!currentPosition) return;

    const cartographic = Cesium.Cartographic.fromCartesian(currentPosition);
    if (!cartographic) return;

    const latDeg = Cesium.Math.toDegrees(cartographic.latitude);
    const lonDeg = Cesium.Math.toDegrees(cartographic.longitude);
    const altMeters = Math.max(80, cartographic.height);

    const localFrame = computeWindowCameraLocalFrame(
      this.activeFlight.trueTrackDeg,
      this.rigSettings
    );

    const camera = this.viewer.camera;
    const sceneMode = this.viewer.scene.mode;

    if (this.viewMode === '2d' || sceneMode === Cesium.SceneMode.SCENE2D || sceneMode === Cesium.SceneMode.MORPHING) {
      // 2D Mode (Top-Down Flight Tracker): Position camera straight down above aircraft
      try {
        camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        if (sceneMode !== Cesium.SceneMode.MORPHING) {
          camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(lonDeg, latDeg, 16500),
            orientation: {
              heading: 0,
              pitch: -Cesium.Math.PI_OVER_TWO,
              roll: 0,
            },
          });
        }
      } catch {
        // Ignore transient camera errors during scene morph
      }
    } else {
      // 3D Mode (Default Window View): First-person passenger window camera rig
      const enuTransform = Cesium.Transforms.eastNorthUpToFixedFrame(
        currentPosition,
        Cesium.Ellipsoid.WGS84,
        new Cesium.Matrix4()
      );

      camera.lookAtTransform(enuTransform);

      camera.position = new Cesium.Cartesian3(
        localFrame.seatOffsetEast,
        localFrame.seatOffsetNorth,
        localFrame.seatOffsetUp
      );

      camera.direction = Cesium.Cartesian3.normalize(
        new Cesium.Cartesian3(
          localFrame.directionEast,
          localFrame.directionNorth,
          localFrame.directionUp
        ),
        new Cesium.Cartesian3()
      );

      camera.up = Cesium.Cartesian3.normalize(
        new Cesium.Cartesian3(localFrame.upEast, localFrame.upNorth, localFrame.upUp),
        new Cesium.Cartesian3()
      );

      camera.right = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.cross(camera.direction, camera.up, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
    }

    // Throttle React telemetry HUD updates to ~6Hz
    const nowMs = performance.now();
    if (forceTelemetryEmit || nowMs - this.lastTelemetryEmitMs >= 160) {
      this.lastTelemetryEmitMs = nowMs;
      this.onTelemetryFrame?.({
        latitude: Number(latDeg.toFixed(5)),
        longitude: Number(lonDeg.toFixed(5)),
        altitudeMeters: Math.round(altMeters),
        altitudeFeet: metersToFeet(altMeters),
        speedMps: this.activeFlight.velocityMps,
        speedMph: mpsToMph(this.activeFlight.velocityMps),
        trueTrackDeg: this.activeFlight.trueTrackDeg,
        cameraHeadingDeg:
          this.viewMode === '2d'
            ? Math.round(this.activeFlight.trueTrackDeg)
            : Math.round(localFrame.cameraHeadingDeg),
        cameraPitchDeg:
          this.viewMode === '2d' ? -90 : Math.round(localFrame.cameraPitchDeg),
      });
    }
  }

  private emitFallbackTelemetry(): void {
    if (!this.activeFlight) return;
    const localFrame = computeWindowCameraLocalFrame(this.activeFlight.trueTrackDeg, this.rigSettings);
    this.onTelemetryFrame?.({
      latitude: this.activeFlight.latitude,
      longitude: this.activeFlight.longitude,
      altitudeMeters: this.activeFlight.altitudeMeters,
      altitudeFeet: this.activeFlight.altitudeFeet,
      speedMps: this.activeFlight.velocityMps,
      speedMph: this.activeFlight.speedMph,
      trueTrackDeg: this.activeFlight.trueTrackDeg,
      cameraHeadingDeg:
        this.viewMode === '2d'
          ? Math.round(this.activeFlight.trueTrackDeg)
          : Math.round(localFrame.cameraHeadingDeg),
      cameraPitchDeg:
        this.viewMode === '2d' ? -90 : Math.round(localFrame.cameraPitchDeg),
    });
  }

  /**
   * Graceful Canvas fallback if WebGL is unavailable in headless environments.
   * Supports both 3D Window Horizon view and 2D Top-Down Flight Tracker view!
   */
  private initCanvasFallback(container: HTMLElement, message: string): void {
    this.onStatusChange?.({
      mode: 'canvas-fallback',
      tilesLoaded: true,
      statusMessage: message,
    });

    const canvas = document.createElement('canvas');
    canvas.className = 'w-full h-full block';
    container.innerHTML = '';
    container.appendChild(canvas);
    this.fallbackCanvas = canvas;

    const resize = () => {
      if (!this.fallbackCanvas) return;
      this.fallbackCanvas.width = container.clientWidth || 1440;
      this.fallbackCanvas.height = container.clientHeight || 900;
    };
    resize();
    window.addEventListener('resize', resize);

    const renderLoop = () => {
      if (this.viewMode === '2d') {
        this.renderCanvas2DMapFrame();
      } else {
        this.renderCanvas3DWindowFrame();
      }
      this.fallbackRafId = window.setTimeout(() => {
        requestAnimationFrame(renderLoop);
      }, this.isHeadless ? 120 : 33) as unknown as number;
    };
    renderLoop();
  }

  private renderCanvas2DMapFrame(): void {
    const canvas = this.fallbackCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w * 0.42;
    const cy = h * 0.5;

    // Dark in-flight entertainment navigation map background
    ctx.fillStyle = '#07111e';
    ctx.fillRect(0, 0, w, h);

    // Subtle lat/lon navigation grid
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.1)';
    ctx.lineWidth = 1;
    const step = 64;
    for (let x = 0; x < w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Distance range rings around aircraft
    for (const r of [90, 180, 270]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
      ctx.stroke();
    }

    // Flight track line
    const trackRad = ((this.activeFlight?.trueTrackDeg ?? 45) * Math.PI) / 180;
    const dx = Math.sin(trackRad) * 320;
    const dy = -Math.cos(trackRad) * 320;

    ctx.beginPath();
    ctx.moveTo(cx - dx, cy - dy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Airplane symbol at center
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(trackRad);
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(14, 8);
    ctx.lineTo(0, 3);
    ctx.lineTo(-14, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (this.activeFlight) {
      const nowMs = performance.now();
      if (nowMs - this.lastTelemetryEmitMs >= 250) {
        this.lastTelemetryEmitMs = nowMs;
        this.emitFallbackTelemetry();
      }
    }
  }

  private renderCanvas3DWindowFrame(): void {
    const canvas = this.fallbackCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const elapsedSec = (performance.now() - this.fallbackStartTimeMs) / 1000;

    const pitchNorm = (this.rigSettings.pitchDeg + 20) / 45;
    const horizonY = Math.round(h * (0.34 - pitchNorm * 0.22));

    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
    skyGrad.addColorStop(0, '#071124');
    skyGrad.addColorStop(0.55, '#132c52');
    skyGrad.addColorStop(1, '#3b6998');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, horizonY);

    const groundGrad = ctx.createLinearGradient(0, horizonY, 0, h);
    groundGrad.addColorStop(0, '#1e3046');
    groundGrad.addColorStop(0.35, '#132030');
    groundGrad.addColorStop(1, '#09111c');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, horizonY, w, h - horizonY);

    const speedFactor = (this.activeFlight?.velocityMps ?? 85) * 0.55;
    const scrollPx = elapsedSec * speedFactor * (this.rigSettings.seatSide === 'right' ? 1 : -1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizonY, w, h - horizonY);
    ctx.clip();

    const rows = 9;
    for (let r = 1; r <= rows; r++) {
      const depthT = r / rows;
      const rowY = horizonY + Math.pow(depthT, 1.65) * (h - horizonY);
      const scale = 0.25 + depthT * 1.35;
      const numBuildings = 18;
      const spacing = (w * 1.4) / numBuildings;

      for (let b = -2; b < numBuildings + 2; b++) {
        const seed = r * 97 + b * 31;
        const rawX = ((b * spacing - (scrollPx * depthT) % spacing) + w * 1.4) % (w * 1.4) - w * 0.2;
        const bw = (26 + Math.abs(Math.sin(seed)) * 34) * scale;
        const bh = (38 + Math.abs(Math.cos(seed * 1.7)) * 145) * scale;
        const bx = rawX - bw / 2;
        const by = rowY - bh;

        ctx.fillStyle = r % 2 === 0 ? '#1e293b' : '#263449';
        ctx.fillRect(bx, by, bw, bh);

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(bx + bw, by + 4 * scale, 10 * scale, bh - 4 * scale);

        ctx.fillStyle = '#334155';
        ctx.fillRect(bx, by, bw, 4 * scale);

        ctx.fillStyle = 'rgba(253, 224, 71, 0.32)';
        const winRows = Math.min(8, Math.floor(bh / (12 * scale)));
        for (let wy = 1; wy < winRows; wy++) {
          ctx.fillRect(bx + 4 * scale, by + wy * 10 * scale, bw - 8 * scale, 2.2 * scale);
        }
      }
    }
    ctx.restore();

    if (this.activeFlight) {
      const nowMs = performance.now();
      if (nowMs - this.lastTelemetryEmitMs >= 250) {
        this.lastTelemetryEmitMs = nowMs;
        this.emitFallbackTelemetry();
      }
    }
  }

  public destroy(): void {
    if (this.preUpdateRemoveCallback) {
      this.preUpdateRemoveCallback();
      this.preUpdateRemoveCallback = null;
    }
    if (this.fallbackRafId !== null) {
      clearTimeout(this.fallbackRafId);
      this.fallbackRafId = null;
    }
    if (this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.destroy();
      this.viewer = null;
    }
  }
}
