import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.omniframe.rf',
  appName: 'OmniFrame RF',
  webDir: 'dist',
  server: {
    url: undefined,
    cleartext: true,
    androidScheme: 'https'
  }
};

export default config;
