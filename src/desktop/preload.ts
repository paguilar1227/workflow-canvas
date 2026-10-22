import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../shared/desktop';
const bridge: DesktopBridge = {
  info: () => ipcRenderer.invoke('desktop:info'),
  savePreferences: (value) => ipcRenderer.invoke('desktop:save', value),
  enableSharing: (port) => ipcRenderer.invoke('desktop:share', port),
  disableSharing: () => ipcRenderer.invoke('desktop:unshare'),
  openDataFolder: () => ipcRenderer.invoke('desktop:data'),
  installSkill: (harness) => ipcRenderer.invoke('desktop:skill', harness),
  exportPlugin: () => ipcRenderer.invoke('desktop:plugin'),
  documentFile: (id) => ipcRenderer.invoke('desktop:document-file', id),
  saveDocument: (id, saveAs) => ipcRenderer.invoke('desktop:save-document', id, saveAs),
  attachDocumentFile: (id, token) => ipcRenderer.invoke('desktop:attach-document', id, token),
  openDocumentFile: () => ipcRenderer.invoke('desktop:open-document'),
  onSettings: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('desktop:settings', handler);
    return () => ipcRenderer.removeListener('desktop:settings', handler);
  },
};
contextBridge.exposeInMainWorld('workflowDesktop', bridge);
