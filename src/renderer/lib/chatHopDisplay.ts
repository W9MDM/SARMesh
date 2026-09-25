/**
 * How many hops a chat message travelled, and how confident we are about it.
 *
 * The exact figure comes from the packet itself (Meshtastic `hopStart −
 * hopLimit`), but that is only available when the *originating* firmware fills
 * in `hop_start`, which Meshtastic added in 2.3.0. In a real mixed-firmware
 * mesh that is the minority of traffic: of 1040 stored messages on the
 * reporting instance, 114 carried a per-message hop count — about one in eight.
 *
 * Rather than show nothing for the other seven, fall back to how far away the
 * sender is known to be, which the node table tracks for two thirds of nodes.
 * That is a different fact — the sender's current distance, not the path this
 * particular message took — so it is flagged as approximate and the UI marks
 * it, instead of quietly presenting a guess as a measurement.
 */
export interface ChatHopDisplay {
  hops: number;
  /** True when this is the sender's current distance, not this message's path. */
  approximate: boolean;
}

function asHopCount(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const hops = Math.trunc(value);
  // A negative hop count means the hop fields disagreed; treat it as unknown.
  return hops >= 0 ? hops : null;
}

/**
 * @param rxHops hops this message actually travelled, when the packet said so
 * @param senderHopsAway the sender's last known distance from the node table
 */
export function resolveChatHopDisplay(
  rxHops: number | null | undefined,
  senderHopsAway: number | null | undefined,
): ChatHopDisplay | null {
  const exact = asHopCount(rxHops);
  if (exact !== null) return { hops: exact, approximate: false };

  const approximate = asHopCount(senderHopsAway);
  if (approximate !== null) return { hops: approximate, approximate: true };

  return null;
}
