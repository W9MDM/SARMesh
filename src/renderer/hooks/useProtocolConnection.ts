import { useCallback, useMemo } from 'react';

import { meshcoreConnectionType, protocolTransportParams } from '../lib/protocolTransportParams';
import type { RfConnectAutomaticFn, RfConnectFn } from '../lib/rfConnectionTypes';
import { rfConnectionTransportOpts } from '../lib/rfConnectionTypes';
import { getMeshcoreSession } from '../lib/sessions/meshcoreSession';
import { getMeshtasticSession } from '../lib/sessions/meshtasticSession';
import { getReticulumSession } from '../lib/sessions/reticulumSession';
import type { ConnectionType, DeviceState, MeshProtocol, MQTTStatus } from '../lib/types';
import { useConnect } from './useConnect';
import { useConnectionByProtocol } from './useConnectionByProtocol';

const INITIAL_DEVICE_STATE: DeviceState = {
  status: 'disconnected',
  myNodeNum: 0,
  connectionType: null,
};

export interface ProtocolConnectionActions {
  state: DeviceState;
  mqttStatus: MQTTStatus;
  connect: RfConnectFn;
  connectAutomatic: RfConnectAutomaticFn;
  disconnect: () => Promise<void>;
}

function deviceStateFromConnection(conn: ReturnType<typeof useConnectionByProtocol>): DeviceState {
  if (!conn) return INITIAL_DEVICE_STATE;
  return {
    status: conn.status,
    myNodeNum: conn.myNodeNum,
    connectionType: conn.connectionType,
    reconnectAttempt: conn.reconnectAttempt,
    lastDataReceived: conn.lastDataReceivedAt?.getTime(),
    firmwareVersion: conn.firmwareVersion,
    manufacturerModel: conn.manufacturerModel,
    batteryPercent: conn.batteryPercent,
    batteryCharging: conn.batteryCharging,
    connectionLoss: conn.connectionLoss,
    serialNeedsReselect: conn.serialNeedsReselect,
  };
}

/**
 * RF connect: MeshCore uses the runtime session `connect()` (full success path including TCP
 * burst-complete deferred reconnect). Meshtastic keeps prepare → ConnectionDriver → attach
 * ([#375](https://github.com/Colorado-Mesh/mesh-client/issues/375)).
 */
/**
 * Connect attempts already in flight, keyed by protocol + transport + target.
 *
 * Module scope on purpose: the duplicate calls this guards against come from
 * different components (cold-start auto-connect, the saved-device reconnect and
 * the Connect button), so a hook-local ref would not see its rival.
 */
const connectInFlight = new Set<string>();

function connectTargetKey(
  protocol: MeshProtocol,
  type: ConnectionType,
  httpAddress?: string,
  blePeripheralId?: string,
): string {
  return `${protocol}|${type}|${httpAddress ?? ''}|${blePeripheralId ?? ''}`;
}

/** Test seam. */
export function resetConnectInFlightForTests(): void {
  connectInFlight.clear();
}

export function useProtocolConnect(): (
  protocol: MeshProtocol,
  type: ConnectionType,
  httpAddress?: string,
  blePeripheralId?: string,
) => Promise<void> {
  const driverConnect = useConnect();

  return useCallback(
    async (
      protocol: MeshProtocol,
      type: ConnectionType,
      httpAddress?: string,
      blePeripheralId?: string,
    ) => {
      // A second connect to the SAME target while one is still configuring is
      // never useful: prepareRfConnect bumps the reconnect generation, so the
      // in-flight attach dies with "Attach superseded during configure" — and
      // that attach may already be connected and pulling history. Observed in
      // the field as five createConnection calls for one click, one successful
      // connect, and a session that lasted nine seconds.
      //
      // Only identical targets are coalesced. Connecting to a *different* radio
      // or transport must still supersede, which is what that generation bump
      // is for.
      const key = connectTargetKey(protocol, type, httpAddress, blePeripheralId);
      if (connectInFlight.has(key)) {
        console.debug(`[useProtocolConnect] connect already in flight for ${key} — ignoring`);
        return;
      }
      connectInFlight.add(key);
      try {
        await runProtocolConnect(protocol, type, httpAddress, blePeripheralId, driverConnect);
      } finally {
        connectInFlight.delete(key);
      }
    },
    [driverConnect],
  );
}

async function runProtocolConnect(
  protocol: MeshProtocol,
  type: ConnectionType,
  httpAddress: string | undefined,
  blePeripheralId: string | undefined,
  driverConnect: ReturnType<typeof useConnect>,
): Promise<void> {
  {
    if (protocol === 'meshcore') {
      // Delegate to runtime connect — do not reassemble prepare/driver/attach here (Neal OpenHop:
      // that skipped session params + TCP deferred-reconnect after #792 / burst-complete).
      const mcType = meshcoreConnectionType(type);
      await getMeshcoreSession().connect(mcType, httpAddress, blePeripheralId);
      return;
    }

    if (protocol === 'reticulum') {
      await getReticulumSession().connect();
      return;
    }

    const params = protocolTransportParams(
      protocol,
      rfConnectionTransportOpts(type, { httpAddress, blePeripheralId }),
    );
    const meshtastic = getMeshtasticSession();
    await meshtastic.prepareRfConnect(type, httpAddress, blePeripheralId);
    let driverIdentityId: string | undefined;
    try {
      driverIdentityId = await driverConnect('meshtastic', params);
      await meshtastic.attachRfSession(driverIdentityId, type);
    } catch (err) {
      await meshtastic.handleRfConnectFailure(driverIdentityId, err);
      throw err;
    }
  }
}

/** RF disconnect: runtime session cleanup, then driver transport teardown. */
export function useProtocolDisconnect() {
  return useCallback(async (protocol: MeshProtocol) => {
    if (protocol === 'meshcore') {
      await getMeshcoreSession().finalizeDriverDisconnect({ disconnectDriver: true });
    } else if (protocol === 'reticulum') {
      await getReticulumSession().finalizeDriverDisconnect();
    } else {
      await getMeshtasticSession().finalizeDriverDisconnect({ disconnectDriver: true });
    }
  }, []);
}

/** ConnectionPanel + header state for one protocol tab. */
export function useProtocolConnectionActions(protocol: MeshProtocol): ProtocolConnectionActions {
  const connect = useProtocolConnect();
  const disconnect = useProtocolDisconnect();
  const storeConn = useConnectionByProtocol(protocol);

  const connectAutomatic = useCallback(
    (
      type: ConnectionType,
      httpAddress?: string,
      lastSerialPortId?: string | null,
      blePeripheralId?: string,
    ) => {
      if (protocol === 'meshcore') {
        const meshType = type === 'http' ? 'http' : type;
        if (meshType !== 'ble' && meshType !== 'serial' && meshType !== 'http') {
          return Promise.reject(new Error(`MeshCore connectAutomatic: unsupported type ${type}`));
        }
        return getMeshcoreSession().connectAutomatic(
          meshType,
          httpAddress,
          lastSerialPortId ?? null,
        );
      }
      if (protocol === 'reticulum') {
        return getReticulumSession().connectAutomatic();
      }
      return getMeshtasticSession().connectAutomatic(
        type,
        httpAddress,
        lastSerialPortId ?? null,
        blePeripheralId,
      );
    },
    [protocol],
  ) as RfConnectAutomaticFn;

  const connectForProtocol = useCallback(
    (type: ConnectionType, httpAddress?: string, blePeripheralId?: string) =>
      connect(protocol, type, httpAddress, blePeripheralId),
    [connect, protocol],
  ) as RfConnectFn;

  const disconnectForProtocol = useCallback(() => disconnect(protocol), [disconnect, protocol]);

  const state = useMemo(() => deviceStateFromConnection(storeConn), [storeConn]);

  const mqttStatus: MQTTStatus = storeConn?.mqttStatus ?? 'disconnected';

  return useMemo(
    () => ({
      state,
      mqttStatus,
      connect: connectForProtocol,
      connectAutomatic,
      disconnect: disconnectForProtocol,
    }),
    [state, mqttStatus, connectForProtocol, connectAutomatic, disconnectForProtocol],
  );
}
