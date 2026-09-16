/**
 * Browses the local link for Meshtastic radios advertising `_meshtastic._tcp`.
 *
 * Runs in the main process because mDNS needs a raw UDP multicast socket. Doing
 * our own browse (rather than resolving `meshtastic.local` through the OS) is
 * also what makes this work on Windows, where `.local` resolution is unreliable
 * — the app already warns users about exactly that. We hand the UI a resolved
 * IP, so the OS resolver never enters the picture.
 */
import { EventEmitter } from 'node:events';

import { Bonjour, type Browser, type Service } from 'bonjour-service';

import type { DiscoveredNode, DiscoveryState } from '../shared/mdns-types';
import {
  MESHTASTIC_MDNS_PROTOCOL,
  MESHTASTIC_MDNS_TYPE,
  MESHTASTIC_TCP_PORT,
  nodeIdToNum,
} from '../shared/mdns-types';
import { sanitizeLogMessage } from './log-service';

/** Drop a node not seen for this long; radios re-announce periodically. */
const STALE_AFTER_MS = 5 * 60 * 1000;

/** IPv4 is preferred: not every radio build answers on v6. */
function pickHost(addresses: string[] | undefined): string | undefined {
  if (!addresses?.length) return undefined;
  const v4 = addresses.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
  return v4 ?? addresses[0];
}

/** TXT values arrive as string | Buffer | true depending on the record. */
function txt(service: Service, key: string): string | undefined {
  const raw = (service.txt as Record<string, unknown> | undefined)?.[key];
  let value: string;
  if (Buffer.isBuffer(raw)) value = raw.toString('utf8');
  else if (typeof raw === 'string') value = raw;
  else if (typeof raw === 'number') value = String(raw);
  // `true` is a valueless TXT key, and anything else is not a value we can use.
  else return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export class MdnsDiscovery extends EventEmitter {
  private bonjour: Bonjour | null = null;
  private browser: Browser | null = null;
  private readonly nodes = new Map<string, DiscoveredNode>();
  private lastError: string | undefined;
  private sweepTimer: NodeJS.Timeout | null = null;

  getState(): DiscoveryState {
    return {
      browsing: this.browser !== null,
      nodes: [...this.nodes.values()].sort((a, b) =>
        (a.shortName ?? a.instance).localeCompare(b.shortName ?? b.instance),
      ),
      error: this.lastError,
    };
  }

  start(): DiscoveryState {
    if (this.browser) return this.getState();
    this.lastError = undefined;

    try {
      this.bonjour = new Bonjour();
      this.browser = this.bonjour.find(
        { type: MESHTASTIC_MDNS_TYPE, protocol: MESHTASTIC_MDNS_PROTOCOL },
        (service) => {
          this.onService(service);
        },
      );
      // A radio that goes away stops announcing; bonjour-service also emits
      // 'down', but a periodic prune covers a node that simply vanished.
      this.sweepTimer = setInterval(() => {
        this.prune();
      }, 60_000);
      this.browser.on('down', (service: Service) => {
        if (this.nodes.delete(service.name)) this.emit('state', this.getState());
      });
    } catch (err) {
      // The usual cause is a firewall blocking inbound UDP 5353, which the UI
      // needs to say out loud rather than showing an empty list forever.
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error('[mdns] browse failed to start:', sanitizeLogMessage(this.lastError));
      this.stop();
    }

    this.emit('state', this.getState());
    return this.getState();
  }

  stop(): DiscoveryState {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    try {
      this.browser?.stop();
      this.bonjour?.destroy();
    } catch {
      // catch-no-log-ok: teardown races are benign; state is reset regardless
    }
    this.browser = null;
    this.bonjour = null;
    this.emit('state', this.getState());
    return this.getState();
  }

  /** Re-issue the multicast query so radios answer again immediately. */
  refresh(): DiscoveryState {
    this.browser?.update();
    return this.getState();
  }

  private onService(service: Service): void {
    const host = pickHost(service.addresses);
    if (!host) return;

    const nodeId = txt(service, 'id');
    const node: DiscoveredNode = {
      host,
      port: service.port || MESHTASTIC_TCP_PORT,
      addresses: service.addresses ?? [],
      instance: service.name,
      hostname: service.host,
      nodeId,
      nodeNum: nodeIdToNum(nodeId),
      shortName: txt(service, 'shortname'),
      hardware: txt(service, 'pio_env'),
      lastSeen: Date.now(),
    };

    this.nodes.set(service.name, node);
    this.emit('found', node);
    this.emit('state', this.getState());
  }

  private prune(): void {
    const cutoff = Date.now() - STALE_AFTER_MS;
    let removed = false;
    for (const [key, node] of this.nodes) {
      if (node.lastSeen < cutoff) {
        this.nodes.delete(key);
        removed = true;
      }
    }
    if (removed) this.emit('state', this.getState());
  }
}
