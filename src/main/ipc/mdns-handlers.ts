import { ipcMain } from 'electron';

import type { MdnsDiscovery } from '../mdns-discovery';
import { assertIpcSender } from '../validate-ipc-sender';

export interface MdnsIpcDeps {
  getMdnsDiscovery: () => MdnsDiscovery;
}

/** Register node-discovery IPC handlers (`mdns:*`). */
export function registerMdnsIpcHandlers(deps: MdnsIpcDeps): void {
  const { getMdnsDiscovery } = deps;

  ipcMain.handle('mdns:start', (event) => {
    assertIpcSender(event, 'mdns:start');
    return getMdnsDiscovery().start();
  });

  ipcMain.handle('mdns:stop', (event) => {
    assertIpcSender(event, 'mdns:stop');
    return getMdnsDiscovery().stop();
  });

  ipcMain.handle('mdns:refresh', (event) => {
    assertIpcSender(event, 'mdns:refresh');
    return getMdnsDiscovery().refresh();
  });

  ipcMain.handle('mdns:getState', (event) => {
    assertIpcSender(event, 'mdns:getState');
    return getMdnsDiscovery().getState();
  });
}
