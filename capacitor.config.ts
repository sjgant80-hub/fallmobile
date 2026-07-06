import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ainativesolutions.fallmobile',
  appName: 'FallMobile',
  webDir: 'www',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https'
  },
  android: {
    backgroundColor: '#1a1a1e',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false
  },
  ios: {
    backgroundColor: '#1a1a1e',
    contentInset: 'always',
    scrollEnabled: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#1a1a1e',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false
    },
    BluetoothLe: {
      displayStrings: {
        scanning: 'Scanning for FallMobile peers...',
        cancel: 'Cancel',
        availableDevices: 'Nearby FallMobile peers',
        noDeviceFound: 'No peers found in range'
      }
    }
  }
};

export default config;
