/**
 * APRS position-report encoding.
 *
 * Uncompressed position reports in TNC2 monitor format, which is what APRS-IS
 * speaks on the wire and what CalTopo Desktop, APRSIS32, YAAC and Xastir all
 * parse. Reference: APRS Protocol Reference 1.0.1, chapter 6.
 */
import type { AprsTrackedClient } from '../../shared/aprs-types';
import { resolveSymbol } from '../../shared/tracker-types';

/**
 * Our APRS "tocall" (destination). `APZ` is the reserved prefix for
 * experimental / unregistered applications, so SARMesh is identifiable without
 * colliding with a registered vendor.
 */
export const SARMESH_TOCALL = 'APZSAR';

/** Digipeat path for packets injected straight into APRS-IS, never over RF. */
export const TCPIP_PATH = 'TCPIP*';

/** Metres per second to knots. */
const MS_TO_KNOTS = 1.943844;
/** Metres to feet. */
const M_TO_FEET = 3.28084;

export interface AprsPositionInput {
  callsign: string;
  latitude: number;
  longitude: number;
  /** Metres above MSL. */
  altitude?: number;
  /** Metres per second. */
  groundSpeed?: number;
  /** Degrees true. */
  groundTrack?: number;
  symbolTable: string;
  symbolCode: string;
  comment?: string;
  /** Fix time; defaults to now. Encoded as a zulu day/hour/minute stamp. */
  time?: Date;
}

/**
 * APRS callsigns are uppercase alphanumeric with an optional `-SSID` suffix and
 * a hard 9-character ceiling. Whatever the operator types is coerced rather
 * than rejected, so a tactical label like "Team 1" still beacons.
 */
export function sanitizeCallsign(raw: string): string {
  const upper = raw.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const [base = '', ssid] = upper.split('-', 2);
  const trimmedBase = base.slice(0, 6) || 'NOCALL';
  if (ssid === undefined || ssid === '') return trimmedBase;
  return `${trimmedBase}-${ssid.slice(0, 2)}`;
}

/** `DDMM.hhN` — two-digit degrees, minutes to hundredths, hemisphere. */
export function encodeLatitude(lat: number): string {
  const hemisphere = lat < 0 ? 'S' : 'N';
  const abs = Math.min(Math.abs(lat), 90);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  return String(degrees).padStart(2, '0') + minutes.toFixed(2).padStart(5, '0') + hemisphere;
}

/** `DDDMM.hhW` — three-digit degrees, minutes to hundredths, hemisphere. */
export function encodeLongitude(lon: number): string {
  const hemisphere = lon < 0 ? 'W' : 'E';
  const abs = Math.min(Math.abs(lon), 180);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  return String(degrees).padStart(3, '0') + minutes.toFixed(2).padStart(5, '0') + hemisphere;
}

/** `DDHHMMz` zulu day/hour/minute timestamp. */
export function encodeTimestampDHM(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${dd}${hh}${mm}z`;
}

/**
 * `CCC/SSS` course and speed. APRS wants degrees true and knots. A course of 0
 * is encoded as 360, because 000 means "no course data".
 */
function encodeCourseSpeed(trackDeg?: number, speedMs?: number): string {
  if (trackDeg === undefined && speedMs === undefined) return '';
  const knots = Math.round((speedMs ?? 0) * MS_TO_KNOTS);
  let course = Math.round(trackDeg ?? 0);
  course = ((course % 360) + 360) % 360;
  if (course === 0) course = 360;
  return `${String(course).padStart(3, '0')}/${String(Math.min(knots, 999)).padStart(3, '0')}`;
}

/** `/A=aaaaaa` altitude in feet, six digits, negatives clamped to zero. */
function encodeAltitude(altitudeMetres?: number): string {
  if (altitudeMetres === undefined) return '';
  const feet = Math.round(altitudeMetres * M_TO_FEET);
  const clamped = Math.max(0, Math.min(feet, 999999));
  return `/A=${String(clamped).padStart(6, '0')}`;
}

/**
 * Comments may not contain `|` or `~` (reserved for telemetry) nor any control
 * character, and the whole report must stay inside the APRS length limit.
 */
function sanitizeComment(comment: string): string {
  return (
    comment
      .replace(/[|~]/g, '-')
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f]/g, ' ')
      .trim()
  );
}

/**
 * Build the APRS information field for a position report with timestamp and
 * messaging capability (`@`).
 */
export function buildPositionInfoField(input: AprsPositionInput): string {
  const time = encodeTimestampDHM(input.time ?? new Date());
  const lat = encodeLatitude(input.latitude);
  const lon = encodeLongitude(input.longitude);
  const table = input.symbolTable || '/';
  const code = input.symbolCode || '[';
  const courseSpeed = encodeCourseSpeed(input.groundTrack, input.groundSpeed);
  const altitude = encodeAltitude(input.altitude);
  const comment = input.comment ? ` ${sanitizeComment(input.comment)}` : '';

  const field = `@${time}${lat}${table}${lon}${code}${courseSpeed}${altitude}${comment}`;
  // Hard cap so a long operator comment cannot produce an illegal frame.
  return field.slice(0, 256);
}

/** Assemble a full TNC2 monitor-format frame: `SRC>TOCALL,PATH:<info>`. */
export function buildTnc2Frame(input: AprsPositionInput, path = TCPIP_PATH): string {
  return `${sanitizeCallsign(input.callsign)}>${SARMESH_TOCALL},${path}:${buildPositionInfoField(input)}`;
}

/** Bridge from a roster entry plus a decoded position to an APRS frame. */
export function frameForTrackedClient(
  client: AprsTrackedClient,
  position: { latitude: number; longitude: number; altitude?: number; time: number },
  commentSuffix: string,
): string {
  const comment = [client.team, client.comment, commentSuffix]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' ');

  const { symbolTable, symbolCode } = resolveSymbol(
    client.trackerType,
    client.symbolTable,
    client.symbolCode,
  );

  return buildTnc2Frame({
    callsign: client.callsign,
    latitude: position.latitude,
    longitude: position.longitude,
    altitude: position.altitude,
    symbolTable,
    symbolCode,
    comment,
    time: new Date(position.time),
  });
}

/**
 * A `#`-prefixed APRS-IS server comment line. Clients ignore these except for
 * the login handshake, but they keep idle sockets alive.
 */
export function serverComment(text: string): string {
  return `# ${text}`;
}
