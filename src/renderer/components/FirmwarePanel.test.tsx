import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FirmwarePanel } from './FirmwarePanel';

const RELEASES = {
  releases: {
    stable: [{ id: 'v2.8.0', title: '2.8.0' }],
    alpha: [],
  },
};

const TARGETS = [
  {
    platformioTarget: 'tbeam',
    displayName: 'T-Beam',
    hwModel: 4,
    architecture: 'esp32',
    partitionScheme: 'default',
  },
  {
    platformioTarget: 'rak4631',
    displayName: 'RAK4631',
    hwModel: 9,
    architecture: 'nrf52840',
  },
  {
    platformioTarget: 'heltec-v3',
    displayName: 'Heltec V3',
    hwModel: 43,
    architecture: 'esp32s3',
    partitionScheme: '8MB',
  },
];

/** No manifest: exercises the partition-scheme fallback path. */
function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('/github/firmware/list')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(RELEASES) });
      }
      if (url.includes('/resource/deviceHardware')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(TARGETS) });
      }
      // .mt.json manifest
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    }),
  );
}

describe('FirmwarePanel', () => {
  beforeEach(() => {
    installFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('preselects the board a discovered radio reported over mDNS', async () => {
    render(<FirmwarePanel detectedPioEnv="heltec-v3" />);
    await waitFor(() => {
      expect(screen.getByLabelText('Board')).toHaveValue('heltec-v3');
    });
    expect(screen.getByText(/Detected from the radio: heltec-v3/)).toBeInTheDocument();
  });

  it('defaults to Update, which keeps the node database', async () => {
    render(<FirmwarePanel detectedPioEnv="tbeam" />);
    await waitFor(() => {
      expect(screen.getByLabelText(/^Update/)).toBeChecked();
    });
    expect(screen.getByText(/Channels, keys and the node database are kept/)).toBeInTheDocument();
  });

  it('writes one image at 0x010000 for an update', async () => {
    render(<FirmwarePanel detectedPioEnv="tbeam" />);
    await waitFor(() => {
      expect(screen.getByText('firmware-tbeam-2.8.0-update.bin')).toBeInTheDocument();
    });
    expect(screen.getByText('0x010000')).toBeInTheDocument();
  });

  it('shows the three-image plan with 4MB offsets for a clean install', async () => {
    render(<FirmwarePanel detectedPioEnv="tbeam" />);
    await waitFor(() => {
      expect(screen.getByLabelText(/^Clean install/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText(/^Clean install/));

    expect(screen.getByText('firmware-tbeam-2.8.0.bin')).toBeInTheDocument();
    expect(screen.getByText('0x000000')).toBeInTheDocument();
    expect(screen.getByText('bleota.bin')).toBeInTheDocument();
    expect(screen.getByText('0x260000')).toBeInTheDocument();
    expect(screen.getByText('littlefs-2.8.0.bin')).toBeInTheDocument();
    expect(screen.getByText('0x300000')).toBeInTheDocument();
  });

  it('uses the 8MB offsets for an 8MB board', async () => {
    render(<FirmwarePanel detectedPioEnv="heltec-v3" />);
    await waitFor(() => {
      expect(screen.getByLabelText(/^Clean install/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText(/^Clean install/));
    expect(screen.getByText('0x340000')).toBeInTheDocument();
    expect(screen.getByText('0x670000')).toBeInTheDocument();
  });

  it('warns that a clean install loses the node database', async () => {
    render(<FirmwarePanel detectedPioEnv="tbeam" />);
    await waitFor(() => {
      expect(screen.getByText(/Channels, keys and the node database are lost/)).toBeInTheDocument();
    });
  });

  it('says where the offsets came from', async () => {
    render(<FirmwarePanel detectedPioEnv="tbeam" />);
    // Update mode writes at the application offset.
    await waitFor(() => {
      expect(screen.getByText(/Application offset for an in-place update/)).toBeInTheDocument();
    });
    // A clean install on a release with no manifest falls back to the board table.
    fireEvent.click(screen.getByLabelText(/^Clean install/));
    expect(screen.getByText(/this release ships no manifest/)).toBeInTheDocument();
  });

  it('refuses to serial-flash a UF2 board and explains the drag-and-drop instead', async () => {
    render(<FirmwarePanel detectedPioEnv="rak4631" />);
    await waitFor(() => {
      expect(screen.getByText(/copying a \.uf2 file to its bootloader drive/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Flash radio' })).toBeDisabled();
  });

  it('always shows the do-not-unplug warning', async () => {
    render(<FirmwarePanel detectedPioEnv="tbeam" />);
    await waitFor(() => {
      expect(screen.getByText(/Do not unplug the radio/)).toBeInTheDocument();
    });
  });

  it('surfaces a catalog outage instead of an empty board list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) })),
    );
    render(<FirmwarePanel />);
    await waitFor(() => {
      expect(screen.getByText(/503/)).toBeInTheDocument();
    });
  });
});
