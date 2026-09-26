/** Shared RF reconnect policy constants for Meshtastic and MeshCore runtimes. */
export const RF_MAX_RECONNECT_ATTEMPTS = 5;

/** BLE gets a longer attempt budget for spotty civilian RF conditions. */
export const RF_MAX_RECONNECT_ATTEMPTS_BLE = 8;

/**
 * Serial also gets a longer budget so gesture-free `getPorts()` rediscovery
 * (via reconnectSerial) can wait out USB re-enumeration before escalating.
 */
export const RF_MAX_RECONNECT_ATTEMPTS_SERIAL = 8;

/**
 * Network transports never stop trying.
 *
 * A TCP/HTTP node is a fixed host on the LAN — typically mains-powered over
 * Wi-Fi — so a dropped link means "rebooting" or "the AP blipped", not "the
 * radio is gone". The five-attempt budget with exponential backoff gave up
 * after roughly a minute, which is less time than a Meshtastic reboot takes:
 * the app latched off about thirty seconds before the radio came back, then
 * sat disconnected until a human noticed. That is the same silent failure as
 * a link that looks connected but stores nothing, and on a search-and-rescue
 * console it is the expensive kind.
 *
 * Backoff is capped (see DEFAULT_MAX_DELAY_MS), so retrying indefinitely costs
 * one connect attempt every 32 seconds. A user disconnect still cancels the
 * cycle, so this only persists while the app believes it should be connected.
 */
export const RF_MAX_RECONNECT_ATTEMPTS_NETWORK = Number.POSITIVE_INFINITY;

/** Transports that reach the radio over IP rather than a local link. */
function isNetworkTransport(transport: string | null | undefined): boolean {
  return transport === 'tcp' || transport === 'http' || transport === 'network';
}

/** Resolve reconnect attempt budget for the active transport. */
export function rfMaxReconnectAttemptsForTransport(transport: string | null | undefined): number {
  if (transport === 'ble') return RF_MAX_RECONNECT_ATTEMPTS_BLE;
  if (transport === 'serial') return RF_MAX_RECONNECT_ATTEMPTS_SERIAL;
  if (isNetworkTransport(transport)) return RF_MAX_RECONNECT_ATTEMPTS_NETWORK;
  return RF_MAX_RECONNECT_ATTEMPTS;
}
