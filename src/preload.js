'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shelf', {
  init: () => ipcRenderer.invoke('app:init'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  addFolder: () => ipcRenderer.invoke('library:addFolder'),
  removeFolder: (folder) => ipcRenderer.invoke('library:removeFolder', folder),
  scan: () => ipcRenderer.invoke('library:scan'),
  hiddenGames: () => ipcRenderer.invoke('library:hidden'),
  fetchMeta: (id) => ipcRenderer.invoke('meta:fetch', id),
  boxartCandidates: (id, query) => ipcRenderer.invoke('meta:boxartCandidates', id, query),
  fetchAllMeta: (onlyMissing) => ipcRenderer.invoke('meta:fetchAll', { onlyMissing }),
  refreshBoxart: (id) => ipcRenderer.invoke('art:refresh', id),
  refreshAllBoxart: (reloadIndex) => ipcRenderer.invoke('art:refreshAll', { reloadIndex }),
  updateGame: (id, patch) => ipcRenderer.invoke('game:update', id, patch),
  removeGame: (id) => ipcRenderer.invoke('game:remove', id),
  restoreGame: (id) => ipcRenderer.invoke('game:restore', id),
  setCover: (id, file) => ipcRenderer.invoke('media:setCover', id, file),
  clearCover: (id) => ipcRenderer.invoke('media:clearCover', id),
  addScreenshots: (id, files) => ipcRenderer.invoke('media:addShots', id, files),
  removeScreenshot: (id, file) => ipcRenderer.invoke('media:removeShot', id, file),
  previewConfig: (id) => ipcRenderer.invoke('game:preview', id),
  launch: (id) => ipcRenderer.invoke('game:launch', id),
  openFolder: (id) => ipcRenderer.invoke('game:openFolder', id),
  openHint: (id, file) => ipcRenderer.invoke('game:openHint', id, file),
  openConfigFolder: () => ipcRenderer.invoke('game:openConfigFolder'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  pickFile: (opts) => ipcRenderer.invoke('dialog:pickFile', opts),
  on: (channel, fn) => {
    const allowed = ['game:changed', 'game:exited', 'meta:progress', 'meta:halted', 'art:progress', 'library:changed', 'library:blocked'];
    if (!allowed.includes(channel)) return () => {};
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
