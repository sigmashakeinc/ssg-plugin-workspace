// Vite's `define` substitutes WORKSPACE_RUNTIME at build time. The three Vite
// configs (cloud / vscode / plugin) emit a different literal so the client can
// pick its API implementation; the local runtime is selected at runtime when
// the plugin shell synthesizes __WORKSPACE_CONFIG__.

declare global {
  const WORKSPACE_RUNTIME: "cloud" | "local" | "vscode" | "plugin";

  interface Window {
    __WORKSPACE_CONFIG__?: {
      runtime: "cloud" | "local" | "vscode" | "plugin";
      port?: number;
      token?: string;
      root?: string;
    };
    __SSG_PLUGIN_CONFIG__?: {
      id: string;
      port: number;
      token: string;
      origin: string;
    };
  }
}

declare module "*.css";

export {};
