import { meshtasticNodeLacksDisplayIdentity } from '@/shared/nodeNameUtils';

import type { MeshNode } from '../types';

export interface ShouldRequestNodeInfoOptions {
  /** The node we would ask. */
  nodeNum: number;
  /** What we already know about it, if anything. */
  existing: MeshNode | undefined;
  /** Our own node number — never ask ourselves. */
  myNodeNum: number;
  /** True while the radio is still being configured. */
  isConfiguring: boolean;
  /** Epoch ms of the last request we sent this node, if any. */
  lastRequestAtMs: number | undefined;
  nowMs: number;
  minIntervalMs: number;
  /**
   * Missing-key recovery re-asks a node we *can* already name, because we need
   * its public key rather than its name.
   */
  ignoreDisplayIdentity?: boolean;
}

/**
 * Whether to transmit a NODEINFO request for a node.
 *
 * Every `true` here costs airtime on a shared LoRa channel, so each rejection
 * below is a case where the request would be wasted.
 */
export function shouldRequestNodeInfo(options: ShouldRequestNodeInfoOptions): boolean {
  const { nodeNum, existing, myNodeNum, isConfiguring } = options;

  if (nodeNum === 0 || nodeNum === myNodeNum) return false;
  // Requests during config sync compete with the NodeDB download.
  if (isConfiguring) return false;

  // A node heard only through MQTT is not on our RF mesh: the request cannot
  // reach it, and its identity will arrive over MQTT instead. Asking anyway is
  // pure airtime on a channel that is frequently already saturated.
  if (existing?.heard_via_mqtt_only === true) return false;

  if (!options.ignoreDisplayIdentity) {
    if (existing && !meshtasticNodeLacksDisplayIdentity(existing, nodeNum)) return false;
  }

  const last = options.lastRequestAtMs ?? 0;
  if (options.nowMs - last < options.minIntervalMs) return false;

  return true;
}
