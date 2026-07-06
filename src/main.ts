/**
 * main.ts · FallMobile entry point
 * Boots BLE mesh, registers FallCarrier transport, wires status UI.
 */

import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import { registerFallMobileTransport, status as transportStatus } from './fallmobile-transport.js';
import * as ble from './ble-mesh.js';

async function loadOrCreateDID(): Promise<string> {
  const { value } = await Preferences.get({ key: 'fallmobile.did' });
  if (value) return value;
  const fresh = 'did:fm:' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  await Preferences.set({ key: 'fallmobile.did', value: fresh });
  return fresh;
}

async function bootstrap() {
  console.log('[fallmobile] boot');

  if (Capacitor.isNativePlatform()) {
    try {
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: '#1a1a1e' });
    } catch {}
  }

  const did = await loadOrCreateDID();
  (window as any).__fallmobile_did = did;
  console.log('[fallmobile] DID', did);

  try {
    await registerFallMobileTransport(did);
  } catch (err) {
    console.error('[fallmobile] transport register failed', err);
  }

  // Update mesh indicator
  const indicator = document.getElementById('mesh-indicator');
  const meshLabel = document.getElementById('mesh-label');
  setInterval(() => {
    const s = transportStatus();
    if (indicator) {
      indicator.classList.toggle('on', s.ble.advertising || s.ble.scanning);
    }
    if (meshLabel) {
      meshLabel.textContent = `${s.ble.peers} peer${s.ble.peers === 1 ? '' : 's'}`;
    }
  }, 2000);

  // Hardware back button handling on Android
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) history.back();
    else App.exitApp();
  });

  App.addListener('appStateChange', ({ isActive }) => {
    console.log('[fallmobile] active=', isActive);
  });

  if (Capacitor.isNativePlatform()) {
    try { await SplashScreen.hide(); } catch {}
  }

  // Expose helpers on window for the shell HTML
  (window as any).FallMobile = {
    did,
    ble,
    transport: transportStatus,
    peers: () => ble.listPeers(),
    send: (msg: string, target?: string) =>
      target
        ? ble.sendMessage(target, msg)
        : Promise.all(ble.listPeers().map(p => ble.sendMessage(p.id, msg).catch(() => {})))
  };

  document.dispatchEvent(new CustomEvent('fallmobile:ready', { detail: { did } }));
}

document.addEventListener('DOMContentLoaded', () => { bootstrap().catch(console.error); });
