// ---------------------------------------------------------------------------
// NOAA solar position algorithm. Pure arithmetic, no dependencies.
// ---------------------------------------------------------------------------

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

const utcMinutes = (date: Date): number =>
  date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;

/**
 * Solar declination (degrees) and equation of time (minutes) for an instant —
 * the position-independent half of the NOAA algorithm. Shared by solarPosition
 * (which adds an observer's lat/lon) and subsolarPoint (which doesn't need one).
 */
function solarDeclEqTime(date: Date): { declin: number; eqTime: number } {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525.0; // Julian century

  const meanLong = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccent = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  const eqCtr =
    Math.sin(rad(meanAnom)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(rad(2 * meanAnom)) * (0.019993 - 0.000101 * t) +
    Math.sin(rad(3 * meanAnom)) * 0.000289;

  const trueLong = meanLong + eqCtr;
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));

  const meanObliq =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliqCorr = meanObliq + 0.00256 * Math.cos(rad(omega));

  const declin = deg(Math.asin(Math.sin(rad(obliqCorr)) * Math.sin(rad(appLong))));

  const y = Math.pow(Math.tan(rad(obliqCorr / 2)), 2);
  const eqTime =
    4 *
    deg(
      y * Math.sin(2 * rad(meanLong)) -
        2 * eccent * Math.sin(rad(meanAnom)) +
        4 * eccent * y * Math.sin(rad(meanAnom)) * Math.cos(2 * rad(meanLong)) -
        0.5 * y * y * Math.sin(4 * rad(meanLong)) -
        1.25 * eccent * eccent * Math.sin(2 * rad(meanAnom))
    );

  return { declin, eqTime };
}

/**
 * NOAA solar position algorithm. Returns degrees; elevation is negative below
 * the horizon, azimuth is clockwise from north. Geometric — no refraction
 * correction, so visual sunset reads at roughly -0.83 rather than 0.
 */
export function solarPosition(
  lat: number,
  lon: number,
  date: Date
): { elevation: number; azimuth: number } {
  const { declin, eqTime } = solarDeclEqTime(date);

  const trueSolarTime = (utcMinutes(date) + eqTime + 4 * lon + 1440) % 1440;
  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;

  const zenith = deg(
    Math.acos(
      Math.sin(rad(lat)) * Math.sin(rad(declin)) +
        Math.cos(rad(lat)) * Math.cos(rad(declin)) * Math.cos(rad(hourAngle))
    )
  );
  const elevation = 90 - zenith;

  // NOTE: denominator is sin(zenith), not cos(zenith). Getting this wrong pins
  // azimuth to exactly 180 at sunrise/sunset and looks plausible elsewhere.
  let azimuth: number;
  const denom = Math.sin(rad(zenith)) * Math.cos(rad(lat));
  if (Math.abs(denom) > 1e-9) {
    const cosAz = (Math.sin(rad(lat)) * Math.cos(rad(zenith)) - Math.sin(rad(declin))) / denom;
    const az = deg(Math.acos(Math.min(1, Math.max(-1, cosAz))));
    azimuth = hourAngle > 0 ? (az + 180) % 360 : (540 - az) % 360;
  } else {
    azimuth = declin > 0 ? 180 : 0;
  }

  return { elevation, azimuth };
}

/**
 * The point on Earth the sun is directly overhead at `date`. Its latitude is the
 * solar declination; its longitude is where true solar time equals solar noon
 * (720 min). The whole day/night map is shaded from this one point.
 */
export function subsolarPoint(date: Date): { lat: number; lon: number } {
  const { declin, eqTime } = solarDeclEqTime(date);
  let lon = (720 - utcMinutes(date) - eqTime) / 4;
  lon = (((lon + 180) % 360) + 360) % 360 - 180; // normalise to [-180, 180]
  return { lat: declin, lon };
}

/** Casual time-of-day names, from deepest night through the day and back. */
export type SolarPhase =
  | 'Night'
  | 'Morning astronomical twilight'
  | 'Early dawn'
  | 'Dawn'
  | 'Sunrise'
  | 'Morning'
  | 'Afternoon'
  | 'Evening'
  | 'Sunset'
  | 'Dusk'
  | 'Twilight'
  | 'Evening astronomical twilight';

/**
 * A casually-named phase of day from the sun's position. Bands are the standard
 * astronomical twilights (astronomical -18, nautical -12, civil -6, horizon 0),
 * plus two arbitrary thresholds: the sunrise/sunset "golden hour" ends at 6, and
 * the descending afternoon becomes evening below 15. Rising vs. setting is read
 * from the azimuth: the eastern half of the sky (azimuth < 180) is the morning
 * side, so solar noon (azimuth 180) is the morning->afternoon boundary. "0" is
 * the geometric horizon (no refraction), so labels flip a few minutes off visual
 * sunrise/sunset — immaterial at this casual resolution. Reliable for a
 * fixed mid-latitude cam (Blue Hill); not built for polar day/night.
 */
export function solarPhase(elevation: number, azimuth: number): SolarPhase {
  const rising = azimuth < 180; // eastern half of the sky = morning side
  if (elevation < -18) return 'Night';
  if (elevation < -12) return rising ? 'Morning astronomical twilight' : 'Evening astronomical twilight';
  if (elevation < -6) return rising ? 'Early dawn' : 'Twilight';
  if (elevation < 0) return rising ? 'Dawn' : 'Dusk';
  if (elevation < 6) return rising ? 'Sunrise' : 'Sunset';
  if (rising) return 'Morning';
  return elevation >= 15 ? 'Afternoon' : 'Evening';
}
