/**
 * Sculpted aircraft cabin window frame, wingtip perspective silhouette, and interactive shade overlay.
 * Uses pure SVG/CSS with zero backdrop-filter so WebGL rendering never stalls.
 */

interface AirplaneWindowFrameProps {
  visible: boolean;
  shadePercent: number; // 0 = fully open, 85 = mostly lowered
  seatSide: 'right' | 'left';
}

export function AirplaneWindowFrame({
  visible,
  shadePercent,
  seatSide,
}: AirplaneWindowFrameProps) {
  if (!visible) {
    return null;
  }

  const clampedShade = Math.max(0, Math.min(85, shadePercent));

  return (
    <div
      className="pointer-events-none fixed inset-0 z-10 overflow-hidden select-none"
      aria-hidden="true"
    >
      {/* Single composite SVG so the wingtip and window shade are cleanly clipped inside the window aperture */}
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
      >
        <defs>
          <clipPath id="windowApertureClip">
            <rect x="68" y="54" width="1304" height="792" rx="182" ry="182" />
          </clipPath>

          <linearGradient id="wingSurface" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#cbd5e1" stopOpacity="0.88" />
            <stop offset="60%" stopColor="#64748b" stopOpacity="0.92" />
            <stop offset="100%" stopColor="#1e293b" stopOpacity="0.96" />
          </linearGradient>

          <linearGradient id="wingletTip" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#475569" />
            <stop offset="100%" stopColor="#0ea5e9" />
          </linearGradient>

          <radialGradient id="cabinWallVignette" cx="50%" cy="50%" r="65%">
            <stop offset="72%" stopColor="#0f172a" stopOpacity="0" />
            <stop offset="90%" stopColor="#0b1120" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#050811" stopOpacity="0.88" />
          </radialGradient>

          <linearGradient id="bezelRim" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#334155" stopOpacity="0.75" />
            <stop offset="50%" stopColor="#1e293b" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#0f172a" stopOpacity="0.85" />
          </linearGradient>
        </defs>

        {/* Exterior wing silhouette & pull-down shade clipped strictly inside window aperture */}
        <g clipPath="url(#windowApertureClip)">
          <g
            transform={
              seatSide === 'left' ? 'translate(1440, 0) scale(-1, 1)' : undefined
            }
          >
            {/* Swept commercial airliner wing edge entering from aft side */}
            <path
              d="M 50 615 L 395 492 L 418 499 L 50 725 Z"
              fill="url(#wingSurface)"
            />
            {/* Winglet raked tip */}
            <path
              d="M 387 494 L 421 438 L 430 442 L 415 499 Z"
              fill="url(#wingletTip)"
            />
            {/* Flap track fairing details */}
            <path
              d="M 145 582 L 185 568 L 179 602 L 138 615 Z"
              fill="#334155"
              opacity="0.88"
            />
            <path
              d="M 265 538 L 298 527 L 292 555 L 258 565 Z"
              fill="#334155"
              opacity="0.88"
            />
          </g>

          {/* Pull-down cabin window shade */}
          {clampedShade > 0 && (
            <g>
              <rect
                x="68"
                y="54"
                width="1304"
                height={(792 * clampedShade) / 100}
                fill="#1e293b"
                fillOpacity="0.96"
              />
              <line
                x1="68"
                y1={54 + (792 * clampedShade) / 100}
                x2="1372"
                y2={54 + (792 * clampedShade) / 100}
                stroke="#475569"
                strokeWidth="6"
              />
            </g>
          )}
        </g>

        {/* Outer cabin wall cutout with rounded stadium window aperture */}
        <path
          fillRule="evenodd"
          d="M 0 0 H 1440 V 900 H 0 Z M 250 54 C 145 54 68 131 68 236 V 664 C 68 769 145 846 250 846 H 1190 C 1295 846 1372 769 1372 664 V 236 C 1372 131 1295 54 1190 54 Z"
          fill="#070b14"
          fillOpacity="0.92"
        />

        {/* Inner window acrylic bezel rim */}
        <rect
          x="68"
          y="54"
          width="1304"
          height="792"
          rx="182"
          ry="182"
          fill="url(#cabinWallVignette)"
          stroke="url(#bezelRim)"
          strokeWidth="14"
        />

        {/* Tiny pressurization breather hole at bottom center of inner pane */}
        <circle cx="720" cy="828" r="2.5" fill="#94a3b8" fillOpacity="0.45" />
      </svg>
    </div>
  );
}
