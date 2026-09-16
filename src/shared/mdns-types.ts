/**
 * Meshtastic node discovery over mDNS.
 *
 * Meshtastic firmware advertises itself on the local link:
 *
 *   MDNS.addService("meshtastic", "tcp", SERVER_API_DEFAULT_PORT)   // _meshtastic._tcp :4403
 *   MDNS.addServiceTxt(..., "shortname", owner.short_name)
 *   MDNS.addServiceTxt(..., "id",        nodeDB->getNodeId())
 *   MDNS.addServiceTxt(..., "pio_env",   APP_ENV)
 *
 * so a browse yields the address AND the radio's identity, which is why the
 * picker can show "SAR-014 · Alpha Team" rather than a bare IP.
 *
 * Scope: mDNS is link-local multicast (224.0.0.251 / ff02::fb, TTL 1). It finds
 * every node on the same VLAN / broadcast domain and nothing beyond a router.
 * Crossing VLANs needs an mDNS reflector on the network gear.
 */

/** The service Meshtastic firmware registers. */
export const MESHTASTIC_MDNS_TYPE = 'meshtastic';
export const MESHTASTIC_MDNS_PROTOCOL = 'tcp';
export const MESHTASTIC_TCP_PORT = 4403;

export interface DiscoveredNode {
  /** Best address to connect to — IPv4 preferred, since some radios do not do v6. */
  host: string;
  port: number;
  /** All addresses advertised, for diagnostics on a multi-homed network. */
  addresses: string[];
  /** mDNS instance name, e.g. `Meshtastic-a1b2`. */
  instance: string;
  /** `.local` hostname, kept so a user can still prefer name over IP. */
  hostname?: string;
  /** From the `id` TXT record: `!a1b2c3d4`. Undefined on older firmware. */
  nodeId?: string;
  /** Numeric form of `nodeId`, for matching against the inventory register. */
  nodeNum?: number;
  /** From the `shortname` TXT record. */
  shortName?: string;
  /** From the `pio_env` TXT record, e.g. `tbeam`, `rak4631`. */
  hardware?: string;
  /** When this node was last seen in a browse, epoch ms. */
  lastSeen: number;
}

export interface DiscoveryState {
  browsing: boolean;
  nodes: DiscoveredNode[];
  /** Set when the browser could not start — usually a firewall blocking UDP 5353. */
  error?: string;
}

export const IDLE_DISCOVERY_STATE: DiscoveryState = { browsing: false, nodes: [] };

/** `!a1b2c3d4` (or bare hex) to the numeric node id the register keys on. */
export function nodeIdToNum(id: string | undefined): number | undefined {
  if (!id) return undefined;
  const hex = id.trim().replace(/^!/, '');
  if (!/^[0-9a-fA-F]{1,8}$/.test(hex)) return undefined;
  const n = Number.parseInt(hex, 16);
  return Number.isFinite(n) ? n >>> 0 : undefined;
}
