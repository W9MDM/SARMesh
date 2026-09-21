import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PacketMonitorRecord } from '@/shared/packet-monitor-types';

import { PacketMonitorPanel } from './PacketMonitorPanel';

const NOW = 1_700_000_000_000;

const PACKETS: PacketMonitorRecord[] = [
  {
    id: 1,
    ts: NOW - 60_000,
    protocol: 'meshtastic',
    direction: 'rx',
    fromNode: 0xa03516ec,
    portnum: 67,
    snr: 6.25,
    viaMqtt: false,
    size: 58,
  },
  {
    id: 2,
    ts: NOW - 120_000,
    protocol: 'meshtastic',
    direction: 'rx',
    fromNode: 0x9e6932e9,
    portnum: 1,
    snr: -3.5,
    viaMqtt: true,
    size: 41,
  },
];

function api() {
  return window.electronAPI.packetMonitor;
}

describe('PacketMonitorPanel', () => {
  beforeEach(() => {
    vi.mocked(api().getSettings).mockResolvedValue({ enabled: true, retentionHours: 12 });
    vi.mocked(api().setSettings).mockImplementation((next) => Promise.resolve(next));
    vi.mocked(api().query).mockResolvedValue(PACKETS);
    vi.mocked(api().stats).mockResolvedValue({
      rowCount: 2,
      oldestMs: NOW - 120_000,
      newestMs: NOW - 60_000,
      fileBytes: 24_576,
    });
    vi.mocked(api().clear).mockResolvedValue(2);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists captured packets with their node, port and size', async () => {
    render(<PacketMonitorPanel />);
    await waitFor(() => {
      expect(screen.getByText('!a03516ec')).toBeInTheDocument();
    });
    expect(screen.getByText('!9e6932e9')).toBeInTheDocument();
    expect(screen.getByText('58')).toBeInTheDocument();
  });

  it('distinguishes RF from MQTT, which decides whether a node can be asked anything', async () => {
    render(<PacketMonitorPanel />);
    await waitFor(() => {
      expect(screen.getByText('RF')).toBeInTheDocument();
    });
    expect(screen.getByText('MQTT')).toBeInTheDocument();
  });

  it('shows how much is stored and how far back it goes', async () => {
    render(<PacketMonitorPanel />);
    await waitFor(() => {
      expect(screen.getByText(/2 packets stored/)).toBeInTheDocument();
    });
    expect(screen.getByText(/24\.0 KB on disk/)).toBeInTheDocument();
  });

  it('says capture is on when it is', async () => {
    render(<PacketMonitorPanel />);
    await waitFor(() => {
      expect(screen.getByText('Capturing')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Stop capture' })).toBeInTheDocument();
  });

  it('reports capture off rather than looking like an empty mesh', async () => {
    vi.mocked(api().getSettings).mockResolvedValue({ enabled: false, retentionHours: 12 });
    vi.mocked(api().query).mockResolvedValue([]);
    render(<PacketMonitorPanel />);
    await waitFor(() => {
      expect(screen.getByText('Not capturing')).toBeInTheDocument();
    });
    expect(screen.getByText(/Capture is off, so nothing is being recorded/)).toBeInTheDocument();
  });

  it('queries only the selected window', async () => {
    render(<PacketMonitorPanel />);
    await waitFor(() => {
      expect(api().query).toHaveBeenCalled();
    });
    const firstCall = vi.mocked(api().query).mock.calls[0]?.[0];
    expect(firstCall?.sinceMs).toBeDefined();
    expect(firstCall?.limit).toBe(2000);
  });

  it('filters the visible rows', async () => {
    render(<PacketMonitorPanel />);
    await waitFor(() => {
      expect(screen.getByText('!a03516ec')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: '9e6932e9' } });
    expect(screen.getByText('!9e6932e9')).toBeInTheDocument();
    expect(screen.queryByText('!a03516ec')).not.toBeInTheDocument();
  });

  it('clamps an absurd retention window before saving', async () => {
    render(<PacketMonitorPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText('Keep packets for')).toBeInTheDocument();
    });
    const input = screen.getByLabelText('Keep packets for');
    fireEvent.change(input, { target: { value: '99999' } });
    fireEvent.blur(input, { target: { value: '99999' } });
    await waitFor(() => {
      expect(api().setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ retentionHours: 168 }),
      );
    });
  });

  it('warns that captured frames are stored unencrypted', async () => {
    render(<PacketMonitorPanel />);
    await waitFor(() => {
      expect(screen.getByText(/stored unencrypted in packet-monitor\.db/)).toBeInTheDocument();
    });
  });
});
