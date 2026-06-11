// Created and developed by Jai Singh
import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  // Entry points that knip should start from
  entry: [
    'src/main.tsx',
    'src/routeTree.gen.ts',
    'src/routes/**/*.tsx',
    'src/routes/**/*.ts',
  ],

  // Project file patterns to analyze
  project: ['src/**/*.{ts,tsx}'],

  // Files and directories to ignore entirely
  ignore: [
    // UI component library (re-exported via barrel files, tree-shaken at build)
    'src/components/ui/**',
    // Auto-generated route tree
    'src/routeTree.gen.ts',
    // iOS/Capacitor build artifacts
    'ios/**',
    // Supabase edge functions (deployed separately)
    'supabase/**',
    // Test files (not part of production bundle)
    'tests/**',
    'src/__tests__/**',
    // Workers (loaded dynamically, not statically imported)
    'src/workers/**',
    // Testing utilities
    'src/lib/testing/**',
    // Intentional keeps — features under development or planned for future use
    // Reviewed 2026-02-15 during quality remediation
    'src/features/drone-scanner/**',    // Drone scanning feature (planned Q2 2026)
    'src/features/standard-work/index.ts', // Re-export barrel (used by route)
    'src/lib/presence/**',              // Presence system (planned)
    'src/lib/work-service/**',          // Work service integration (planned)
    'src/components/layout/app-sidebar.tsx',    // Legacy sidebar (migration in progress)
    'src/components/layout/nav-group.tsx',      // Legacy nav (migration in progress)
    'src/components/layout/rbac-nav-group.tsx', // Legacy RBAC nav (migration in progress)
    'src/components/layout/top-nav.tsx',        // Legacy top nav (migration in progress)
  ],

  // Dependencies that are used but knip can't detect (build plugins, CSS, etc.)
  ignoreDependencies: [
    'tailwindcss',
    'tw-animate-css',
    'tailwindcss-animate',
    '@tailwindcss/vite',
    'autoprefixer',
    // Vite plugins
    '@vitejs/plugin-react-swc',
    'vite-plugin-pwa',
    // TanStack router plugin
    '@tanstack/router-plugin',
    '@tanstack/router-cli',
    // Type packages
    '@types/node',
    '@types/react',
    '@types/react-dom',
  ],
};

export default config;

// Created and developed by Jai Singh
