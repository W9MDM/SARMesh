import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { InventoryNode } from '@/shared/inventory-types';
import type { DiscoveredNode } from '@/shared/mdns-types';

import DiscoveredNodePicker from './DiscoveredNodePicker';

function node(overrides: Partial<DiscoveredNode> = {}): DiscoveredNode {
  return {
    host: '192.168.20.41',
    port: 4403,
    addresses: ['192.168.20.41'],
    instance: 'Meshtastic-c3d4',
    nodeId: '!a1b2c3d4',
    nodeNum: 0xa1b2c3d4,
    shortName: 'ALFA',
    hardware: 'tbeam',
    lastSeen: 1_700_000_000_000,
    ...overrides,
  };
}

const roster: InventoryNode[] = [
  {
    nodeId: 0xa1b2c3d4,
    assetTag: 'SAR-014',
    status: 'in-service',
    pendingChanges: [],
    history: [],
  },
];

describe('DiscoveredNodePicker', () => {
  it('lists a found radio with its short name, hardware and address', () => {
    render(
      <DiscoveredNodePicker nodes={[node()]} browsing onSelect={vi.fn()} onRefresh={vi.fn()} />,
    );
    expect(screen.getByText('ALFA')).toBeInTheDocument();
    expect(screen.getByText('tbeam')).toBeInTheDocument();
    expect(screen.getByText('192.168.20.41:4403')).toBeInTheDocument();
  });

  it('labels a radio that is in the register', () => {
    render(
      <DiscoveredNodePicker
        nodes={[node()]}
        browsing
        inventory={roster}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText('SAR-014')).toBeInTheDocument();
  });

  it('does not label a radio the register has never seen', () => {
    render(
      <DiscoveredNodePicker
        nodes={[node({ nodeNum: 0x0bad0bad, nodeId: '!0bad0bad' })]}
        browsing
        inventory={roster}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.queryByText('SAR-014')).not.toBeInTheDocument();
  });

  it('hands back host:port for the TCP form', () => {
    const onSelect = vi.fn();
    render(
      <DiscoveredNodePicker nodes={[node()]} browsing onSelect={onSelect} onRefresh={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ALFA/ }));
    expect(onSelect).toHaveBeenCalledWith('192.168.20.41:4403');
  });

  it('hands back a bare host for the HTTP form, whose server is on 80/443', () => {
    const onSelect = vi.fn();
    render(
      <DiscoveredNodePicker
        nodes={[node()]}
        browsing
        includePort={false}
        onSelect={onSelect}
        onRefresh={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ALFA/ }));
    expect(onSelect).toHaveBeenCalledWith('192.168.20.41');
  });

  it('falls back to the mDNS instance name when the radio sent no shortname', () => {
    render(
      <DiscoveredNodePicker
        nodes={[node({ shortName: undefined })]}
        browsing
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText('Meshtastic-c3d4')).toBeInTheDocument();
  });

  it('says it is searching while the browse is live and empty', () => {
    render(<DiscoveredNodePicker nodes={[]} browsing onSelect={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByText('Searching for radios…')).toBeInTheDocument();
  });

  it('surfaces a blocked multicast socket rather than an empty list', () => {
    render(
      <DiscoveredNodePicker
        nodes={[]}
        browsing={false}
        error="EACCES"
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText(/EACCES/)).toBeInTheDocument();
    expect(screen.getByText(/UDP 5353/)).toBeInTheDocument();
  });

  it('rescans on request', () => {
    const onRefresh = vi.fn();
    render(<DiscoveredNodePicker nodes={[]} browsing onSelect={vi.fn()} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
