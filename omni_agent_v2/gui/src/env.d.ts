// Created and developed by Jai Singh
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENT_URL?: string;
}

declare global {
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    __OMNIFRAME_AGENT_URL__?: string;
  }
}

export {};

// Created and developed by Jai Singh
