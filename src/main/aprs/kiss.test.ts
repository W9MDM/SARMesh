import { describe, expect, it } from 'vitest';

import { kissWrap, tnc2ToAx25 } from './kiss';

/** Decode a 7-byte AX.25 address back to `CALL[-SSID]` for assertions. */
function decodeAddress(
  frame: Buffer,
  index: number,
): { call: string; ssid: number; last: boolean } {
  const start = index * 7;
  const call = [...frame.subarray(start, start + 6)]
    .map((b) => String.fromCharCode(b >> 1))
    .join('')
    .trimEnd();
  const ssidByte = frame[start + 6] ?? 0;
  return { call, ssid: (ssidByte >> 1) & 0x0f, last: (ssidByte & 0x01) === 1 };
}

describe('tnc2ToAx25', () => {
  const frame = 'TEAM1>APZSAR,TCPIP*:@141705z3944.35N/10459.42W[';

  it('places destination first and source second, per AX.25', () => {
    const ax25 = tnc2ToAx25(frame);
    expect(decodeAddress(ax25, 0).call).toBe('APZSAR');
    expect(decodeAddress(ax25, 1).call).toBe('TEAM1');
  });

  it('marks the final address with the end-of-address bit', () => {
    const ax25 = tnc2ToAx25(frame);
    expect(decodeAddress(ax25, 0).last).toBe(false);
    // TCPIP* is stripped, so the source is the last address.
    expect(decodeAddress(ax25, 1).last).toBe(true);
  });

  it('appends the UI control byte and no-layer-3 PID before the payload', () => {
    const ax25 = tnc2ToAx25(frame);
    expect(ax25[14]).toBe(0x03);
    expect(ax25[15]).toBe(0xf0);
    expect(ax25.subarray(16).toString('latin1')).toBe('@141705z3944.35N/10459.42W[');
  });

  it('strips internet-only path elements that have no meaning on RF', () => {
    const ax25 = tnc2ToAx25('N0CALL>APZSAR,TCPIP*,qAC,NOGATE:test');
    // dest + source only: 2 addresses, 14 bytes, then control/PID.
    expect(ax25[14]).toBe(0x03);
    expect(decodeAddress(ax25, 1).last).toBe(true);
  });

  it('keeps real digipeaters and preserves the has-been-repeated flag', () => {
    const ax25 = tnc2ToAx25('N0CALL>APZSAR,WIDE1-1*:test');
    const digi = decodeAddress(ax25, 2);
    expect(digi.call).toBe('WIDE1');
    expect(digi.ssid).toBe(1);
    expect(digi.last).toBe(true);
    // bit 7 of the SSID byte is the has-been-repeated flag.
    expect(((ax25[20] ?? 0) & 0x80) !== 0).toBe(true);
  });

  it('parses the SSID out of the source callsign', () => {
    const ax25 = tnc2ToAx25('KD0ABC-9>APZSAR:test');
    expect(decodeAddress(ax25, 1)).toMatchObject({ call: 'KD0ABC', ssid: 9 });
  });

  it('rejects frames with no information field or destination', () => {
    expect(() => tnc2ToAx25('TEAM1>APZSAR')).toThrow(/information field/);
    expect(() => tnc2ToAx25('TEAM1:test')).toThrow(/destination/);
  });
});

describe('kissWrap', () => {
  it('delimits the frame with FEND and a data-command byte', () => {
    const wrapped = kissWrap(Buffer.from([0x01, 0x02]));
    expect(wrapped[0]).toBe(0xc0);
    expect(wrapped[1]).toBe(0x00);
    expect(wrapped.at(-1)).toBe(0xc0);
  });

  it('escapes FEND and FESC so they cannot terminate the frame early', () => {
    const wrapped = kissWrap(Buffer.from([0xc0, 0xdb]));
    // FEND -> FESC TFEND, FESC -> FESC TFESC
    expect([...wrapped.subarray(2, 6)]).toEqual([0xdb, 0xdc, 0xdb, 0xdd]);
  });

  it('encodes the port number in the high nibble of the command byte', () => {
    expect(kissWrap(Buffer.from([0x01]), 2)[1]).toBe(0x20);
  });
});
