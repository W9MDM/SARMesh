import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prepareRfConnect = vi.fn().mockResolvedValue(undefined);
const attachRfSession = vi.fn().mockResolvedValue(undefined);
const handleRfConnectFailure = vi.fn().mockResolvedValue(undefined);
const driverConnect = vi.fn().mockResolvedValue('identity-1');

vi.mock('@/renderer/lib/sessions/meshtasticSession', () => ({
  getMeshtasticSession: () => ({ prepareRfConnect, attachRfSession, handleRfConnectFailure }),
}));
vi.mock('@/renderer/lib/sessions/meshcoreSession', () => ({
  getMeshcoreSession: () => ({ connect: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('./useConnect', () => ({ useConnect: () => driverConnect }));

const { useProtocolConnect, resetConnectInFlightForTests } =
  await import('./useProtocolConnection');

/** The hook uses useCallback, so it needs a render to produce its function. */
function getConnect(): ReturnType<typeof useProtocolConnect> {
  return renderHook(() => useProtocolConnect()).result.current;
}

describe('useProtocolConnect duplicate-connect coalescing', () => {
  beforeEach(() => {
    resetConnectInFlightForTests();
    prepareRfConnect.mockClear();
    attachRfSession.mockClear();
    driverConnect.mockClear();
    handleRfConnectFailure.mockClear();
  });

  it('runs a single connect normally', async () => {
    const connect = getConnect();
    await connect('meshtastic', 'tcp', '192.168.50.105:4403');
    expect(prepareRfConnect).toHaveBeenCalledTimes(1);
    expect(attachRfSession).toHaveBeenCalledTimes(1);
  });

  it('ignores a second connect to the same target while one is in flight', async () => {
    // The field failure: five createConnection calls for one click, and the
    // fifth superseded the attach that had already connected.
    let release: (() => void) | undefined;
    prepareRfConnect.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const connect = getConnect();
    const first = connect('meshtastic', 'tcp', '192.168.50.105:4403');
    const second = connect('meshtastic', 'tcp', '192.168.50.105:4403');

    release?.();
    await Promise.all([first, second]);

    // prepareRfConnect bumps the reconnect generation, so calling it twice is
    // exactly what kills the in-flight attach.
    expect(prepareRfConnect).toHaveBeenCalledTimes(1);
    expect(attachRfSession).toHaveBeenCalledTimes(1);
  });

  it('still allows a connect to a different address', async () => {
    const connect = getConnect();
    await connect('meshtastic', 'tcp', '192.168.50.105:4403');
    await connect('meshtastic', 'tcp', '192.168.50.200:4403');
    expect(prepareRfConnect).toHaveBeenCalledTimes(2);
  });

  it('still allows a connect on a different transport', async () => {
    const connect = getConnect();
    await connect('meshtastic', 'tcp', '192.168.50.105:4403');
    await connect('meshtastic', 'http', '192.168.50.105');
    expect(prepareRfConnect).toHaveBeenCalledTimes(2);
  });

  it('releases the guard after a connect finishes, so retry works', async () => {
    const connect = getConnect();
    await connect('meshtastic', 'tcp', '192.168.50.105:4403');
    await connect('meshtastic', 'tcp', '192.168.50.105:4403');
    expect(prepareRfConnect).toHaveBeenCalledTimes(2);
  });

  it('releases the guard after a failure, so the user can retry', async () => {
    driverConnect.mockRejectedValueOnce(new Error('refused'));
    const connect = getConnect();
    await expect(connect('meshtastic', 'tcp', '192.168.50.105:4403')).rejects.toThrow('refused');
    // A stuck guard would make the radio permanently unconnectable.
    await connect('meshtastic', 'tcp', '192.168.50.105:4403');
    expect(prepareRfConnect).toHaveBeenCalledTimes(2);
  });
});
