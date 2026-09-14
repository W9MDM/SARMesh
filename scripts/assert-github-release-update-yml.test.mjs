import { describe, expect, it } from 'vitest';

import {
  assertAllChannelYmlUrlsAreReleaseAssets,
  assertYmlUrlsAreReleaseAssets,
  collectReleaseAssetNames,
} from './assert-github-release-update-yml.mjs';

const WIN_YML = `version: 5.36.0
files:
  - url: SARMesh-Setup-5.36.0.exe
  - url: SARMesh-Setup-5.36.0-arm64.exe
path: SARMesh-Setup-5.36.0.exe
`;

const MAC_YML = `files:
  - url: SARMesh-5.36.0-mac.zip
path: SARMesh-5.36.0-mac.zip
`;

const LINUX_YML = `files:
  - url: SARMesh-5.36.0.AppImage
path: SARMesh-5.36.0.AppImage
`;

const LINUX_ARM_YML = `files:
  - url: SARMesh-5.36.0-arm64.AppImage
path: SARMesh-5.36.0-arm64.AppImage
`;

describe('collectReleaseAssetNames', () => {
  it('keeps string names only', () => {
    expect(
      collectReleaseAssetNames([{ name: 'latest.yml' }, { name: 1 }, { name: 'a.exe' }]),
    ).toEqual(['latest.yml', 'a.exe']);
  });
});

describe('assertYmlUrlsAreReleaseAssets', () => {
  it('passes when every url is an asset name', () => {
    expect(
      assertYmlUrlsAreReleaseAssets('latest.yml', WIN_YML, [
        'latest.yml',
        'SARMesh-Setup-5.36.0.exe',
        'SARMesh-Setup-5.36.0-arm64.exe',
      ]),
    ).toEqual({
      yml: 'latest.yml',
      urls: ['SARMesh-Setup-5.36.0.exe', 'SARMesh-Setup-5.36.0-arm64.exe'],
    });
  });

  it('fails on the v5.36.0 hyphenated-vs-dotted mismatch', () => {
    expect(() =>
      assertYmlUrlsAreReleaseAssets('latest.yml', WIN_YML, [
        'latest.yml',
        'SARMesh.Setup.5.36.0.exe',
        'SARMesh.Setup.5.36.0-arm64.exe',
      ]),
    ).toThrow(/urls not present as release assets/);
  });
});

describe('assertAllChannelYmlUrlsAreReleaseAssets', () => {
  it('checks win/mac/linux channel files against one asset list', () => {
    const result = assertAllChannelYmlUrlsAreReleaseAssets(
      {
        'latest.yml': WIN_YML,
        'latest-mac.yml': MAC_YML,
        'latest-linux.yml': LINUX_YML,
        'latest-linux-arm64.yml': LINUX_ARM_YML,
      },
      [
        'latest.yml',
        'latest-mac.yml',
        'latest-linux.yml',
        'latest-linux-arm64.yml',
        'SARMesh-Setup-5.36.0.exe',
        'SARMesh-Setup-5.36.0-arm64.exe',
        'SARMesh-5.36.0-mac.zip',
        'SARMesh-5.36.0.AppImage',
        'SARMesh-5.36.0-arm64.AppImage',
      ],
    );
    expect(result.checked).toEqual([
      'latest.yml',
      'latest-mac.yml',
      'latest-linux.yml',
      'latest-linux-arm64.yml',
    ]);
  });

  it('fails when no channel yml assets were uploaded', () => {
    expect(() => assertAllChannelYmlUrlsAreReleaseAssets({}, ['a.exe'])).toThrow(
      /No update channel yml assets/,
    );
  });
});
