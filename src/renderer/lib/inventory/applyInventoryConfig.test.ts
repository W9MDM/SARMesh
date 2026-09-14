import { describe, expect, it, vi } from 'vitest';

import { DEVICE_ROLE_OPTIONS, REGION_OPTIONS } from '../meshtastic/protobufEnumOptions';
import {
  type ApplyActions,
  applyInventoryConfig,
  decodePsk,
  enumValueByName,
} from './applyInventoryConfig';

function actions(overrides: Partial<ApplyActions> = {}): ApplyActions & {
  setConfig: ReturnType<typeof vi.fn>;
  setDeviceChannel: ReturnType<typeof vi.fn>;
  setOwner: ReturnType<typeof vi.fn>;
  commitConfig: ReturnType<typeof vi.fn>;
} {
  return {
    setConfig: vi.fn().mockResolvedValue(undefined),
    setDeviceChannel: vi.fn().mockResolvedValue(undefined),
    setOwner: vi.fn().mockResolvedValue(undefined),
    commitConfig: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as never;
}

describe('enumValueByName', () => {
  it('maps a proto enum name to its wire value', () => {
    const us = REGION_OPTIONS.find((o) => o.enumName === 'US');
    expect(enumValueByName(REGION_OPTIONS, 'US')).toBe(us?.value);
  });

  it('ignores an unknown name rather than writing a wrong value', () => {
    // An old register against newer firmware must degrade to "leave it alone".
    expect(enumValueByName(REGION_OPTIONS, 'ATLANTIS')).toBeUndefined();
    expect(enumValueByName(DEVICE_ROLE_OPTIONS, undefined)).toBeUndefined();
  });
});

describe('decodePsk', () => {
  it('decodes base64 to the bytes the radio expects', () => {
    expect([...decodePsk('AQ==')]).toEqual([1]);
  });

  it('treats an empty PSK as no encryption rather than throwing', () => {
    expect(decodePsk('')).toHaveLength(0);
  });
});

describe('applyInventoryConfig', () => {
  it('commits once at the end, so the radio reboots a single time', async () => {
    const a = actions();
    const outcome = await applyInventoryConfig(
      {
        owner: { longName: 'Team One' },
        lora: { region: 'US', modemPreset: 'LONG_FAST' },
        device: { role: 'CLIENT' },
        channels: [
          {
            index: 0,
            name: 'SAR',
            psk: 'AQ==',
            role: 'PRIMARY',
            uplinkEnabled: false,
            downlinkEnabled: false,
          },
        ],
      },
      undefined,
      a,
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.rebooted).toBe(true);
    expect(a.commitConfig).toHaveBeenCalledTimes(1);
  });

  it('merges onto the live slice so unrelated fields are not blanked', async () => {
    const a = actions();
    await applyInventoryConfig({ lora: { hopLimit: 5 } }, { lora: { region: 3, txPower: 20 } }, a);

    const payload = a.setConfig.mock.calls[0]?.[0] as {
      payloadVariant: { value: Record<string, unknown> };
    };
    expect(payload.payloadVariant.value.hopLimit).toBe(5);
    // txPower was not in the change and must survive it.
    expect(payload.payloadVariant.value.txPower).toBe(20);
  });

  it('enables usePreset when a modem preset is set, or the preset is ignored', async () => {
    const a = actions();
    await applyInventoryConfig({ lora: { modemPreset: 'LONG_FAST' } }, undefined, a);

    const payload = a.setConfig.mock.calls[0]?.[0] as {
      payloadVariant: { value: Record<string, unknown> };
    };
    expect(payload.payloadVariant.value.usePreset).toBe(true);
  });

  it('stops at the first failure instead of pushing the rest at a broken link', async () => {
    const a = actions({
      setConfig: vi.fn().mockRejectedValue(new Error('transport closed')),
    });
    const outcome = await applyInventoryConfig(
      {
        lora: { region: 'US' },
        channels: [
          {
            index: 0,
            name: 'SAR',
            psk: '',
            role: 'PRIMARY',
            uplinkEnabled: false,
            downlinkEnabled: false,
          },
        ],
      },
      undefined,
      a,
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.rebooted).toBe(false);
    expect(a.setDeviceChannel).not.toHaveBeenCalled();
    expect(a.commitConfig).not.toHaveBeenCalled();
    expect(outcome.steps.at(-1)?.error).toBe('transport closed');
  });

  it('does nothing and does not reboot when the change is empty', async () => {
    const a = actions();
    const outcome = await applyInventoryConfig({}, undefined, a);

    expect(outcome.ok).toBe(true);
    expect(outcome.rebooted).toBe(false);
    expect(a.commitConfig).not.toHaveBeenCalled();
  });

  it('skips an unknown region rather than writing a wrong one', async () => {
    const a = actions();
    const outcome = await applyInventoryConfig({ lora: { region: 'ATLANTIS' } }, undefined, a);

    expect(a.setConfig).not.toHaveBeenCalled();
    expect(outcome.rebooted).toBe(false);
  });
});
