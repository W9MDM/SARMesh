/**
 * Writing a queued configuration onto a connected radio.
 *
 * The register (main process) stores *what* to apply; this is *how*. It lives
 * in the renderer because that is where the MeshDevice handle is, and it goes
 * through the same runtime actions the Radio panel uses, so a queued change and
 * a hand-edited one take identical paths to the radio.
 */
import type { InventoryChannel, InventoryConfig } from '@/shared/inventory-types';

import { mergeMeshtasticConfigApplyValue } from '../meshtastic/meshtasticConfigApply';
import {
  DEVICE_ROLE_OPTIONS,
  MODEM_PRESET_OPTIONS,
  type ProtobufEnumOption,
  REGION_OPTIONS,
} from '../meshtastic/protobufEnumOptions';

/** The subset of the runtime's actions this needs. */
export interface ApplyActions {
  setConfig: (payload: {
    payloadVariant: { case: string; value: Record<string, unknown> };
  }) => Promise<void>;
  setDeviceChannel: (channel: {
    index: number;
    role: number;
    settings: {
      name: string;
      psk: Uint8Array;
      uplinkEnabled: boolean;
      downlinkEnabled: boolean;
    };
  }) => Promise<void>;
  setOwner: (owner: { longName?: string; shortName?: string }) => Promise<void>;
  commitConfig: () => Promise<void>;
}

/** Live config slices read off the radio, merged onto so partials do not blank fields. */
export type ConfigSlices = Record<string, unknown> | undefined;

export interface ApplyStep {
  label: string;
  ok: boolean;
  error?: string;
}

export interface ApplyOutcome {
  steps: ApplyStep[];
  ok: boolean;
  /** True when settings were committed, which reboots the radio. */
  rebooted: boolean;
}

/** Channel roles are numeric on the wire. */
const CHANNEL_ROLE: Record<InventoryChannel['role'], number> = {
  DISABLED: 0,
  PRIMARY: 1,
  SECONDARY: 2,
};

/**
 * Names are stored rather than numbers so a register stays readable and
 * survives protobuf renumbering. An unknown name is ignored rather than
 * throwing, so an old profile against new firmware degrades to "leave it alone"
 * instead of writing a wrong value.
 */
export function enumValueByName(
  options: ProtobufEnumOption[],
  name: string | undefined,
): number | undefined {
  if (!name) return undefined;
  return options.find((option) => option.enumName === name)?.value;
}

/** Base64 PSK to the raw bytes the radio expects. An empty PSK means no encryption. */
export function decodePsk(psk: string): Uint8Array {
  if (!psk) return new Uint8Array(0);
  const binary = atob(psk);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Apply a configuration to the connected radio.
 *
 * Settings are committed once at the end rather than per section, so the radio
 * reboots a single time no matter how much the change covers.
 */
export async function applyInventoryConfig(
  config: InventoryConfig,
  slices: ConfigSlices,
  actions: ApplyActions,
): Promise<ApplyOutcome> {
  const steps: ApplyStep[] = [];
  let touched = false;

  const run = async (label: string, task: () => Promise<void>): Promise<boolean> => {
    try {
      await task();
      steps.push({ label, ok: true });
      return true;
    } catch (err) {
      steps.push({ label, ok: false, error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  };

  const setSection = (section: string, value: Record<string, unknown>) => async () => {
    // Merge onto the live slice: sending a bare partial would clear the fields
    // this change does not mention.
    const merged = mergeMeshtasticConfigApplyValue(slices?.[section], value);
    await actions.setConfig({ payloadVariant: { case: section, value: merged } });
  };

  if (config.owner && (config.owner.longName || config.owner.shortName)) {
    const owner = config.owner;
    touched = true;
    if (!(await run('owner', () => actions.setOwner({ ...owner })))) {
      return { steps, ok: false, rebooted: false };
    }
  }

  if (config.lora) {
    const value: Record<string, unknown> = {};
    const region = enumValueByName(REGION_OPTIONS, config.lora.region);
    if (region !== undefined) value.region = region;
    const preset = enumValueByName(MODEM_PRESET_OPTIONS, config.lora.modemPreset);
    if (preset !== undefined) {
      value.modemPreset = preset;
      // A preset only takes effect when the radio is told to use presets.
      value.usePreset = true;
    }
    if (config.lora.hopLimit !== undefined) value.hopLimit = config.lora.hopLimit;
    if (config.lora.txEnabled !== undefined) value.txEnabled = config.lora.txEnabled;

    if (Object.keys(value).length > 0) {
      touched = true;
      if (!(await run('lora', setSection('lora', value)))) {
        return { steps, ok: false, rebooted: false };
      }
    }
  }

  if (config.device?.role !== undefined) {
    const role = enumValueByName(DEVICE_ROLE_OPTIONS, config.device.role);
    if (role !== undefined) {
      touched = true;
      if (!(await run('device', setSection('device', { role })))) {
        return { steps, ok: false, rebooted: false };
      }
    }
  }

  if (config.position) {
    const value: Record<string, unknown> = {};
    if (config.position.positionBroadcastSecs !== undefined) {
      value.positionBroadcastSecs = config.position.positionBroadcastSecs;
    }
    if (config.position.smartPositionEnabled !== undefined) {
      value.positionBroadcastSmartEnabled = config.position.smartPositionEnabled;
    }
    if (Object.keys(value).length > 0) {
      touched = true;
      if (!(await run('position', setSection('position', value)))) {
        return { steps, ok: false, rebooted: false };
      }
    }
  }

  for (const channel of config.channels ?? []) {
    touched = true;
    const ok = await run(`channel ${channel.index}`, () =>
      actions.setDeviceChannel({
        index: channel.index,
        role: CHANNEL_ROLE[channel.role],
        settings: {
          name: channel.name,
          psk: decodePsk(channel.psk),
          uplinkEnabled: channel.uplinkEnabled,
          downlinkEnabled: channel.downlinkEnabled,
        },
      }),
    );
    if (!ok) return { steps, ok: false, rebooted: false };
  }

  if (!touched) return { steps, ok: true, rebooted: false };

  const committed = await run('commit', () => actions.commitConfig());
  return { steps, ok: committed, rebooted: committed };
}
