// Vite's `define` substitutes WORKSPACE_RUNTIME at build time. Each of the
// four Vite configs (cloud / local / electrobun / vscode) emits a different
// literal so the client can pick its API implementation.

declare global {
  const WORKSPACE_RUNTIME: "cloud" | "local" | "electrobun" | "vscode" | "plugin";

  interface Window {
    __WORKSPACE_CONFIG__?: {
      runtime: "cloud" | "local" | "electrobun" | "vscode" | "plugin";
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
