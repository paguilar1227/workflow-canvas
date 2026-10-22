export interface DesktopPreferences { closeToTray: boolean; openAtLogin: boolean; port: number; shareUrl: string }
export interface DesktopInfo { preferences: DesktopPreferences; dataDir: string; version: string; platform: string; localUrl: string; startupWarning?: string; tailscale: { available: boolean; connected: boolean; hostname: string; error?: string } }
export interface DesktopBridge {
  info(): Promise<DesktopInfo>;
  savePreferences(value: DesktopPreferences): Promise<DesktopInfo>;
  enableSharing(port: number): Promise<DesktopInfo>;
  disableSharing(): Promise<DesktopInfo>;
  openDataFolder(): Promise<void>;
  installSkill(harness: 'codex' | 'claude' | 'cursor'): Promise<string>;
  exportPlugin(): Promise<string | null>;
  documentFile(docId: string): Promise<string | null>;
  saveDocument(docId: string, saveAs?: boolean): Promise<string | null>;
  openDocumentFile(): Promise<{ name: string; content: string; token: string } | null>;
  attachDocumentFile(docId: string, token: string): Promise<string | null>;
  onSettings(callback: () => void): () => void;
}
declare global { interface Window { workflowDesktop?: DesktopBridge } }
