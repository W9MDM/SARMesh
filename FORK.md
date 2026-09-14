# About this fork

SARMesh is a fork of [Colorado-Mesh/mesh-client](https://github.com/Colorado-Mesh/mesh-client),
taken at version **5.36.0**, commit
[`8b98bc6`](https://github.com/Colorado-Mesh/mesh-client/commit/8b98bc6e88a574a25c29aac69672fdc21281b75e)
(2026-09-14).

## Licence

Mesh-Client is published under **GPL-3.0-or-later**, and SARMesh remains under
GPL-3.0-or-later. The original copyright of the Mesh-Client Contributors is
retained in [`LICENSE`](LICENSE) and [`copyright`](copyright); this fork adds
its own copyright over the changes it makes, it does not replace theirs.

If you distribute SARMesh, in binary form or otherwise, you must pass on the
same freedoms: source availability, the GPL text, and these notices.

## Credit

The overwhelming majority of this codebase is the work of the Mesh-Client
Contributors — Joey Stanford, dude.eth, megabear (KD5IHC), Soord, WB3IHY,
Letark, FuzzyChaos, M3SHGH0ST and M0Rf30 among them. The multi-protocol
transport layer, SQLite persistence, routing diagnostics, flasher and the
sixteen-language UI are all theirs. SARMesh is a search-and-rescue-specific
skin and extension on top of that work, not a rewrite of it.

Upstream is worth supporting directly:
<https://github.com/Colorado-Mesh/mesh-client>.

## Why fork rather than contribute upstream

Mesh-Client is deliberately a general-purpose client "for everyone, everywhere",
and explicitly not gated at licensed amateur operators. SARMesh makes the
opposite set of tradeoffs: it assumes a search and rescue team with an incident
commander, accountable equipment, and a mapping provider (CalTopo/SARTopo) that
expects APRS. Those assumptions would be wrong for upstream's audience.

Where a change here is genuinely general-purpose, it should be offered upstream
rather than kept in this fork.

## What SARMesh changes

Additions:

- **APRS bridge** (`src/main/aprs/`, `src/main/ipc/aprs-handlers.ts`,
  `src/renderer/components/AprsBridgePanel.tsx`) — re-broadcasts mesh positions
  as APRS so CalTopo / SARTopo can plot field teams. Three sinks: a local
  APRS-IS server, KISS over TCP, and optional public APRS-IS.
- **Radio inventory** (`src/main/inventory/`,
  `src/main/ipc/inventory-handlers.ts`,
  `src/renderer/components/InventoryPanel.tsx`) — an accountable asset register
  that retains each radio's configuration, plus desired-state configuration
  that is queued in batch and applied automatically the next time each radio
  connects.

Modifications:

- Rebranded from Mesh-Client to SARMesh (application name, identifiers,
  packaging metadata, window chrome).

Everything else is upstream's, unchanged.
