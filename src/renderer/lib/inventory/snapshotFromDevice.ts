/**
 * Turning what a connected radio reports into a retained snapshot.
 *
 * The inverse of applyInventoryConfig: enum values arrive as wire numbers and
 * are stored as proto names, so the register stays readable and survives a
 * protobuf renumbering.
 */
import type { InventoryChannel, NodeConfigSnapshot } from '@/shared/inventory-types';

import {
  DEVICE_ROLE_OPTIONS,
  MODEM_PRESET_OPTIONS,
  type ProtobufEnumOption,
  REGION_OPTIONS,
} from '../meshtastic/protobufEnumOptions';

/** Channel roles as the radio reports them. */
const CHANNEL_ROLE_NAME: Record<number, InventoryChannel['role']> = {
  0: 'DISABLED',
  1: 'PRIMARY',
  2: 'SECONDARY',
};

/** Wire value to proto enum name; undefined when the value is unknown to us. */
export function enumNameByValue(options: ProtobufEnumOption[], value: unknown): string | undefined {
  if (typeof value !== 'number') return undefined;
  return options.find((option) => option.value === value)?.enumName;
}

/** Raw channel as the runtime holds it. */
export interface DeviceChannel {
  index: number;
  name: string;
  role: number;
  psk: Uint8Array;
  uplinkEnabled: boolean;
  downlinkEnabled: boolean;
}

export function encodePsk(psk: Uint8Array | undefined): string {
  if (!psk || psk.length === 0) return '';
  let binary = '';
  for (const byte of psk) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface SnapshotInput {
  /** Config slices keyed by protobuf case (`lora`, `device`, `position`). */
  configSlices: Record<string, unknown> | undefined;
  channels: DeviceChannel[] | undefined;
  firmwareVersion?: string;
  ownerLongName?: string;
  ownerShortName?: string;
}

function slice(input: SnapshotInput, key: string): Record<string, unknown> | undefined {
  const value = input.configSlices?.[key];
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Build a snapshot of the radio's current configuration.
 *
 * Only fields the register can write back are captured — recording settings we
 * could never re-apply would make a "restore this radio" promise we cannot keep.
 */
export function snapshotFromDevice(input: SnapshotInput): NodeConfigSnapshot {
  const lora = slice(input, 'lora');
  const device = slice(input, 'device');
  const position = slice(input, 'position');

  const snapshot: NodeConfigSnapshot = { capturedAt: Date.now() };

  if (input.firmwareVersion) snapshot.firmwareVersion = input.firmwareVersion;

  if (input.ownerLongName ?? input.ownerShortName) {
    snapshot.owner = {
      longName: input.ownerLongName,
      shortName: input.ownerShortName,
    };
  }

  if (lora) {
    snapshot.lora = {
      region: enumNameByValue(REGION_OPTIONS, lora.region),
      modemPreset: enumNameByValue(MODEM_PRESET_OPTIONS, lora.modemPreset),
      hopLimit: num(lora.hopLimit),
      txEnabled: bool(lora.txEnabled),
    };
  }

  if (device) {
    snapshot.device = { role: enumNameByValue(DEVICE_ROLE_OPTIONS, device.role) };
  }

  if (position) {
    snapshot.position = {
      positionBroadcastSecs: num(position.positionBroadcastSecs),
      smartPositionEnabled: bool(position.positionBroadcastSmartEnabled),
    };
  }

  if (input.channels && input.channels.length > 0) {
    snapshot.channels = input.channels
      // A disabled slot carries no settings worth retaining.
      .filter((channel) => CHANNEL_ROLE_NAME[channel.role] !== 'DISABLED')
      .map((channel) => ({
        index: channel.index,
        name: channel.name,
        psk: encodePsk(channel.psk),
        role: CHANNEL_ROLE_NAME[channel.role] ?? 'DISABLED',
        uplinkEnabled: channel.uplinkEnabled,
        downlinkEnabled: channel.downlinkEnabled,
      }));
  }

  return snapshot;
}
