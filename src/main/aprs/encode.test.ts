import { describe, expect, it } from 'vitest';

import {
  buildTnc2Frame,
  encodeLatitude,
  encodeLongitude,
  encodeTimestampDHM,
  frameForTrackedClient,
  sanitizeCallsign,
  SARMESH_TOCALL,
} from './encode';

describe('sanitizeCallsign', () => {
  it('uppercases and strips characters APRS does not allow', () => {
    expect(sanitizeCallsign('Team 1')).toBe('TEAM1');
    expect(sanitizeCallsign('kd0abc-9')).toBe('KD0ABC-9');
    expect(sanitizeCallsign('k9/rescue!')).toBe('K9RESC');
  });

  it('caps the base at six characters and the SSID at two', () => {
    expect(sanitizeCallsign('LONGCALLSIGN-123')).toBe('LONGCA-12');
  });

  it('falls back to NOCALL rather than emitting an empty source', () => {
    expect(sanitizeCallsign('!!!')).toBe('NOCALL');
    expect(sanitizeCallsign('')).toBe('NOCALL');
  });
});

describe('coordinate encoding', () => {
  it('encodes latitude as DDMM.hhN', () => {
    expect(encodeLatitude(39.7392)).toBe('3944.35N');
    expect(encodeLatitude(-33.8688)).toBe('3352.13S');
    // Below 10 degrees the degree field must stay two characters.
    expect(encodeLatitude(9.5)).toBe('0930.00N');
  });

  it('encodes longitude as DDDMM.hhW', () => {
    expect(encodeLongitude(-104.9903)).toBe('10459.42W');
    expect(encodeLongitude(151.2093)).toBe('15112.56E');
    // Below 100 degrees the degree field must stay three characters.
    expect(encodeLongitude(-7.25)).toBe('00715.00W');
  });

  it('clamps out-of-range coordinates instead of emitting a malformed field', () => {
    expect(encodeLatitude(120)).toBe('9000.00N');
    expect(encodeLongitude(-400)).toBe('18000.00W');
  });
});

describe('encodeTimestampDHM', () => {
  it('formats a zulu day/hour/minute stamp', () => {
    expect(encodeTimestampDHM(new Date(Date.UTC(2026, 8, 14, 17, 5)))).toBe('141705z');
  });
});

describe('buildTnc2Frame', () => {
  const at = new Date(Date.UTC(2026, 8, 14, 17, 5));

  it('builds a complete position report', () => {
    const frame = buildTnc2Frame({
      callsign: 'TEAM1',
      latitude: 39.7392,
      longitude: -104.9903,
      altitude: 1609,
      groundSpeed: 1.5,
      groundTrack: 90,
      symbolTable: '/',
      symbolCode: '[',
      comment: 'ground team',
      time: at,
    });

    expect(frame).toBe(
      `TEAM1>${SARMESH_TOCALL},TCPIP*:@141705z3944.35N/10459.42W[090/003/A=005279 ground team`,
    );
  });

  it('converts metres per second to knots and metres to feet', () => {
    // 10 m/s is 19 knots; 100 m is 328 ft.
    const frame = buildTnc2Frame({
      callsign: 'T',
      latitude: 0.5,
      longitude: 0.5,
      altitude: 100,
      groundSpeed: 10,
      groundTrack: 180,
      symbolTable: '/',
      symbolCode: '>',
      time: at,
    });
    expect(frame).toContain('180/019');
    expect(frame).toContain('/A=000328');
  });

  it('encodes a course of zero as 360, since 000 means "no course data"', () => {
    const frame = buildTnc2Frame({
      callsign: 'T',
      latitude: 1,
      longitude: 1,
      groundTrack: 0,
      groundSpeed: 5,
      symbolTable: '/',
      symbolCode: '>',
      time: at,
    });
    expect(frame).toContain('360/010');
  });

  it('omits course/speed and altitude when they are unknown', () => {
    const frame = buildTnc2Frame({
      callsign: 'T',
      latitude: 1,
      longitude: 1,
      symbolTable: '/',
      symbolCode: '[',
      time: at,
    });
    expect(frame).toBe(`T>${SARMESH_TOCALL},TCPIP*:@141705z0100.00N/00100.00E[`);
  });

  it('replaces characters APRS reserves for telemetry in the comment', () => {
    const frame = buildTnc2Frame({
      callsign: 'T',
      latitude: 1,
      longitude: 1,
      symbolTable: '/',
      symbolCode: '[',
      comment: 'a|b~c',
      time: at,
    });
    expect(frame.endsWith('a-b-c')).toBe(true);
  });

  it('keeps the frame within the APRS length limit', () => {
    const frame = buildTnc2Frame({
      callsign: 'T',
      latitude: 1,
      longitude: 1,
      symbolTable: '/',
      symbolCode: '[',
      comment: 'x'.repeat(500),
      time: at,
    });
    // Source + '>' + tocall + ',TCPIP*:' prefix, then a 256-byte info field.
    expect(frame.length).toBeLessThanOrEqual('T>APZSAR,TCPIP*:'.length + 256);
  });
});

describe('frameForTrackedClient', () => {
  it('joins team, comment and suffix into the APRS comment', () => {
    const frame = frameForTrackedClient(
      {
        nodeId: 1,
        callsign: 'TEAM1',
        team: 'Alpha',
        trackerType: 'ground-team',
        symbolTable: '/',
        symbolCode: '[',
        enabled: true,
        comment: 'K9',
      },
      { latitude: 39.7392, longitude: -104.9903, time: Date.UTC(2026, 8, 14, 17, 5) },
      'via SARMesh',
    );
    expect(frame).toContain('Alpha K9 via SARMesh');
  });

  it('skips absent comment parts rather than leaving gaps', () => {
    const frame = frameForTrackedClient(
      {
        nodeId: 1,
        callsign: 'TEAM1',
        trackerType: 'ground-team',
        symbolTable: '/',
        symbolCode: '[',
        enabled: true,
      },
      { latitude: 1, longitude: 1, time: Date.UTC(2026, 8, 14, 17, 5) },
      'via SARMesh',
    );
    expect(frame.endsWith('via SARMesh')).toBe(true);
    expect(frame).not.toContain('  ');
  });
});
