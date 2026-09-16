import type NodePath from 'node:path';

/* eslint-disable no-secrets/no-secrets */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above imports, so the fixture path is built
// in a hoisted block rather than from the module-level `path` import.
const { HOISTED_USER_DATA } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require('node:path') as typeof NodePath;
  return { HOISTED_USER_DATA: nodePath.join('/tmp', 'test-tak') };
});

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => HOISTED_USER_DATA) },
  shell: { showItemInFolder: vi.fn() },
}));

vi.mock('fs', () => ({
  default: { writeFileSync: vi.fn(), renameSync: vi.fn(), rmSync: vi.fn() },
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock('os', () => ({
  default: {
    networkInterfaces: vi.fn(() => ({
      eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.10' }],
    })),
  },
}));

vi.mock('node-forge', () => {
  const stubAsn1 = { getBytes: () => 'fakeder' };
  return {
    default: {},
    pki: {
      certificateFromPem: vi.fn(() => ({})),
      privateKeyFromPem: vi.fn(() => ({})),
    },
    pkcs12: { toPkcs12Asn1: vi.fn(() => stubAsn1) },
    asn1: { toDer: vi.fn(() => stubAsn1) },
    md: { sha256: { create: vi.fn() } },
  };
});

const { mockZipInstance, fileCallArgs } = vi.hoisted(() => {
  const fileCallArgs: [string, unknown][] = [];
  const mockFolder = () => ({
    file: (name: string, content: unknown) => {
      fileCallArgs.push([name, content]);
    },
  });
  const mockZipInstance = {
    folder: vi.fn(mockFolder),
    file: vi.fn((name: string, content: unknown) => {
      fileCallArgs.push([name, content]);
    }),
    generateAsync: vi.fn().mockResolvedValue(Buffer.from('zip-content')),
  };
  return { mockZipInstance, fileCallArgs };
});

vi.mock('jszip', () => ({
  default: vi.fn().mockImplementation(function (this: any) {
    return mockZipInstance;
  }),
}));

import path from 'node:path';

import { shell } from 'electron';
import fs from 'fs';

import type { CertBundle } from './certificate-manager';
import { generateDataPackage } from './data-package';

/** Matches the mocked `app.getPath('userData')` below. */
const USER_DATA = path.join('/tmp', 'test-tak');
const PACKAGE_PATH = path.join(USER_DATA, 'tak-package.zip');
const PACKAGE_TMP_PATH = `${PACKAGE_PATH}.tmp`;

const STUB_CERTS: CertBundle = {
  caCert: '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----',
  caKey: '-----BEGIN RSA PRIVATE KEY-----\ncakey\n-----END RSA PRIVATE KEY-----',
  serverCert: '-----BEGIN CERTIFICATE-----\nserver\n-----END CERTIFICATE-----',
  serverKey: '-----BEGIN RSA PRIVATE KEY-----\nserverkey\n-----END RSA PRIVATE KEY-----',
  clientCert: '-----BEGIN CERTIFICATE-----\nclient\n-----END CERTIFICATE-----',
  clientKey: '-----BEGIN RSA PRIVATE KEY-----\nclientkey\n-----END RSA PRIVATE KEY-----',
};

const STUB_SETTINGS = {
  enabled: true,
  port: 8089,
  serverName: 'sarmesh',
  requireClientCert: true,
  autoStart: false,
};

describe('generateDataPackage', () => {
  beforeEach(() => {
    fileCallArgs.length = 0;
    vi.mocked(fs.writeFileSync).mockClear();
    vi.mocked(fs.renameSync).mockClear();
    vi.mocked(fs.rmSync).mockClear();
    vi.mocked(shell.showItemInFolder).mockClear();
    mockZipInstance.folder.mockClear();
    mockZipInstance.file.mockClear();
    mockZipInstance.generateAsync.mockClear();
    mockZipInstance.generateAsync.mockResolvedValue(Buffer.from('zip-content'));
  });

  it('writes the zip to {userData}/tak-package.zip and returns the path', async () => {
    const result = await generateDataPackage(STUB_CERTS, STUB_SETTINGS);
    expect(result).toBe(PACKAGE_PATH);
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(PACKAGE_TMP_PATH, expect.any(Buffer));
    expect(vi.mocked(fs.renameSync)).toHaveBeenCalledWith(PACKAGE_TMP_PATH, PACKAGE_PATH);
  });

  it('calls shell.showItemInFolder with the output path', async () => {
    await generateDataPackage(STUB_CERTS, STUB_SETTINGS);
    expect(vi.mocked(shell.showItemInFolder)).toHaveBeenCalledWith(PACKAGE_PATH);
  });

  it('still returns the package path when showing the folder fails', async () => {
    vi.mocked(shell.showItemInFolder).mockImplementationOnce(() => {
      throw new Error('native shell failed');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(generateDataPackage(STUB_CERTS, STUB_SETTINGS)).resolves.toBe(PACKAGE_PATH);
    expect(warnSpy).toHaveBeenCalledWith(
      '[TAK] show data package in folder failed:',
      'native shell failed',
    );

    warnSpy.mockRestore();
  });

  it('connection.pref contains the correct port', async () => {
    await generateDataPackage(STUB_CERTS, { ...STUB_SETTINGS, port: 9999 });
    const prefEntry = fileCallArgs.find(([name]) => name === 'connection.pref');
    expect(prefEntry).toBeDefined();
    expect(prefEntry![1]).toContain('9999');
  });
});
