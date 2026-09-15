import { describe, expect, it } from 'vitest';

import { REGION_OPTIONS } from '../meshtastic/protobufEnumOptions';
import { encodePsk, enumNameByValue, snapshotFromDevice } from './snapshotFromDevice';

const US = REGION_OPTIONS.find((o) => o.enumName === 'US')!;

describe('enumNameByValue', () => {
  it('maps a wire value back to its proto name', () => {
    expect(enumNameByValue(REGION_OPTIONS, US.value)).toBe('US');
  });

  it('returns undefined for a value this build does not know', () => {
    expect(enumNameByValue(REGION_OPTIONS, 9999)).toBeUndefined();
    expect(enumNameByValue(REGION_OPTIONS, undefined)).toBeUndefined();
  });
});

describe('encodePsk', () => {
  it('round-trips through base64', () => {
    expect(encodePsk(new Uint8Array([1]))).toBe('AQ==');
  });

  it('treats an absent or empty key as no encryption', () => {
    expect(encodePsk(undefined)).toBe('');
    expect(encodePsk(new Uint8Array(0))).toBe('');
  });
});

describe('snapshotFromDevice', () => {
  it('stores enums by name so the register survives renumbering', () => {
    const snapshot = snapshotFromDevice({
      configSlices: { lora: { region: US.value, hopLimit: 3 } },
      channels: undefined,
    });
    expect(snapshot.lora?.region).toBe('US');
    expect(snapshot.lora?.hopLimit).toBe(3);
  });

  it('captures channels with their PSK encoded, skipping disabled slots', () => {
    const snapshot = snapshotFromDevice({
      configSlices: undefined,
      channels: [
        {
          index: 0,
          name: 'SAR',
          role: 1,
          psk: new Uint8Array([1]),
          uplinkEnabled: false,
          downlinkEnabled: true,
        },
        {
          index: 1,
          name: '',
          role: 0,
          psk: new Uint8Array(0),
          uplinkEnabled: false,
          downlinkEnabled: false,
        },
      ],
    });

    expect(snapshot.channels).toHaveLength(1);
    expect(snapshot.channels?.[0]).toMatchObject({
      index: 0,
      name: 'SAR',
      psk: 'AQ==',
      role: 'PRIMARY',
      downlinkEnabled: true,
    });
  });

  it('omits sections the radio has not reported rather than inventing defaults', () => {
    const snapshot = snapshotFromDevice({ configSlices: {}, channels: [] });
    expect(snapshot.lora).toBeUndefined();
    expect(snapshot.device).toBeUndefined();
    expect(snapshot.owner).toBeUndefined();
    expect(snapshot.capturedAt).toBeGreaterThan(0);
  });

  it('records the owner when a name is known', () => {
    const snapshot = snapshotFromDevice({
      configSlices: undefined,
      channels: undefined,
      ownerLongName: 'Team One',
      ownerShortName: 'T1',
      firmwareVersion: '2.7.26',
    });
    expect(snapshot.owner).toEqual({ longName: 'Team One', shortName: 'T1' });
    expect(snapshot.firmwareVersion).toBe('2.7.26');
  });

  it('round-trips a region through capture and re-apply', () => {
    // The register is only useful if what it reads back can be written again.
    const snapshot = snapshotFromDevice({
      configSlices: { lora: { region: US.value } },
      channels: undefined,
    });
    expect(REGION_OPTIONS.find((o) => o.enumName === snapshot.lora?.region)?.value).toBe(US.value);
  });
});
