/**
 * ble-mesh.ts · FallMobile
 * Wraps @capacitor-community/bluetooth-le to expose a mesh-shaped API:
 *   startAdvertising · startScan · sendMessage · onIncomingMessage
 *
 * Service UUID chosen for FallMobile mesh:
 *   f0110000-1a1e-4a1e-8a1e-fa11ba11ba11
 * Characteristics:
 *   f0110001-...  · READ + NOTIFY  · peer DID + presence
 *   f0110002-...  · WRITE          · incoming message payload
 *
 * Bitchat wire-compat: when Bitchat's service UUID is present in scan results
 * we also surface those peers under the same interface; message envelopes
 * carry a `format` byte so both apps can decode.
 */

import {
  BleClient,
  ScanResult,
  numbersToDataView,
  dataViewToNumbers,
  numberToUUID
} from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';

export const FALLMOBILE_SERVICE_UUID    = 'f0110000-1a1e-4a1e-8a1e-fa11ba11ba11';
export const FALLMOBILE_CHAR_PRESENCE   = 'f0110001-1a1e-4a1e-8a1e-fa11ba11ba11';
export const FALLMOBILE_CHAR_MESSAGE    = 'f0110002-1a1e-4a1e-8a1e-fa11ba11ba11';

// Bitchat public UUID (from bitchat-android / iOS README)
export const BITCHAT_SERVICE_UUID       = 'f47b5e2d-4a9e-4c5a-9b3f-8e1d2c3a4b5c';

export type PeerId = string;

export interface Peer {
  id: PeerId;
  did?: string;
  name?: string;
  rssi: number;
  lastSeen: number;
  source: 'fallmobile' | 'bitchat' | 'unknown';
}

export interface IncomingMessage {
  from: PeerId;
  payload: Uint8Array;
  format: number;   // 0x01 = fallmobile-json  0x02 = bitchat-compat
  timestamp: number;
}

type IncomingHandler = (msg: IncomingMessage) => void;
type PeerHandler = (peer: Peer) => void;

let initialized = false;
let advertising = false;
let scanning = false;
const knownPeers = new Map<PeerId, Peer>();
const incomingHandlers: IncomingHandler[] = [];
const peerHandlers: PeerHandler[] = [];
let myDID = 'anon';

/** Ensure BleClient is initialized once. Requests permissions if needed. */
export async function init(did?: string): Promise<void> {
  if (initialized) return;
  if (did) myDID = did;

  if (!Capacitor.isNativePlatform()) {
    console.warn('[ble-mesh] not native · running in web-shim mode');
    initialized = true;
    return;
  }

  await BleClient.initialize({ androidNeverForLocation: false });
  initialized = true;
  console.log('[ble-mesh] initialised · DID=', myDID);
}

/** Encode a small DID + optional message into a BLE advertisement payload. */
function buildAdvPayload(did: string, msg?: string): number[] {
  const enc = new TextEncoder();
  const didBytes = enc.encode(did.slice(0, 20));
  const msgBytes = msg ? enc.encode(msg.slice(0, 40)) : new Uint8Array(0);
  const header = new Uint8Array([0x01, didBytes.length, msgBytes.length]);
  const combined = new Uint8Array(header.length + didBytes.length + msgBytes.length);
  combined.set(header, 0);
  combined.set(didBytes, header.length);
  combined.set(msgBytes, header.length + didBytes.length);
  return Array.from(combined);
}

/**
 * Start advertising presence (and optional short broadcast) so other
 * FallMobile / Bitchat peers can discover us.
 * NOTE: On iOS, background advertising is restricted; foreground works.
 */
export async function startAdvertising(payload?: { did?: string; message?: string }): Promise<void> {
  await init(payload?.did);
  if (advertising) return;

  const did = payload?.did ?? myDID;
  const msg = payload?.message;

  if (!Capacitor.isNativePlatform()) {
    console.log('[ble-mesh][shim] would advertise', { did, msg });
    advertising = true;
    return;
  }

  // Capacitor community BLE plugin doesn't ship advertise() on all platforms;
  // the native shim provided in android/ios/ code hooks the peripheral role.
  // Here we use the plugin's runtime hook via a custom bridge method.
  try {
    // @ts-expect-error · bridged native method registered in FallMobileMeshPlugin
    await BleClient.startAdvertise?.({
      serviceUuid: FALLMOBILE_SERVICE_UUID,
      manufacturerData: buildAdvPayload(did, msg),
      includeDeviceName: false,
      connectable: true
    });
    advertising = true;
    console.log('[ble-mesh] advertising', { did, msg });
  } catch (err) {
    console.warn('[ble-mesh] advertise failed', err);
  }
}

export async function stopAdvertising(): Promise<void> {
  if (!advertising) return;
  try {
    // @ts-expect-error · bridged
    await BleClient.stopAdvertise?.();
  } catch {}
  advertising = false;
}

/** Start scanning for FallMobile + Bitchat peers. Callback fires per unique peer. */
export async function startScan(cb: PeerHandler): Promise<void> {
  await init();
  peerHandlers.push(cb);
  if (scanning) return;

  if (!Capacitor.isNativePlatform()) {
    console.log('[ble-mesh][shim] would scan');
    scanning = true;
    return;
  }

  await BleClient.requestLEScan(
    {
      services: [FALLMOBILE_SERVICE_UUID, BITCHAT_SERVICE_UUID],
      allowDuplicates: false
    },
    (result: ScanResult) => handleScanResult(result)
  );
  scanning = true;
  console.log('[ble-mesh] scanning');
}

function handleScanResult(result: ScanResult): void {
  const uuids = result.uuids ?? [];
  const source: Peer['source'] =
    uuids.includes(FALLMOBILE_SERVICE_UUID) ? 'fallmobile' :
    uuids.includes(BITCHAT_SERVICE_UUID)    ? 'bitchat'    :
    'unknown';

  const peer: Peer = {
    id: result.device.deviceId,
    name: result.device.name ?? result.localName,
    rssi: result.rssi ?? -100,
    lastSeen: Date.now(),
    source
  };

  // Extract DID from manufacturer data if present (fallmobile format)
  if (source === 'fallmobile' && result.manufacturerData) {
    try {
      const first = Object.values(result.manufacturerData)[0] as DataView | undefined;
      if (first) {
        const bytes = dataViewToNumbers(first);
        if (bytes[0] === 0x01) {
          const didLen = bytes[1];
          const didBytes = new Uint8Array(bytes.slice(3, 3 + didLen));
          peer.did = new TextDecoder().decode(didBytes);
        }
      }
    } catch (e) {
      console.warn('[ble-mesh] adv parse failed', e);
    }
  }

  knownPeers.set(peer.id, peer);
  peerHandlers.forEach(h => h(peer));
}

export async function stopScan(): Promise<void> {
  if (!scanning) return;
  try { await BleClient.stopLEScan(); } catch {}
  scanning = false;
}

export function listPeers(): Peer[] {
  return Array.from(knownPeers.values()).sort((a, b) => b.rssi - a.rssi);
}

/** Connect to peer and write a message to their FallMobile message characteristic. */
export async function sendMessage(peerId: PeerId, msg: string | Uint8Array, format: number = 0x01): Promise<void> {
  await init();
  const bytes = typeof msg === 'string' ? new TextEncoder().encode(msg) : msg;
  const framed = new Uint8Array(bytes.length + 1);
  framed[0] = format;
  framed.set(bytes, 1);

  if (!Capacitor.isNativePlatform()) {
    console.log('[ble-mesh][shim] would send', peerId, msg);
    return;
  }

  try {
    await BleClient.connect(peerId, () => {
      console.log('[ble-mesh] peer disconnected', peerId);
    });
    const dv = numbersToDataView(Array.from(framed));
    await BleClient.write(peerId, FALLMOBILE_SERVICE_UUID, FALLMOBILE_CHAR_MESSAGE, dv);
    await BleClient.disconnect(peerId);
  } catch (err) {
    console.warn('[ble-mesh] send failed', err);
    throw err;
  }
}

/** Listen for messages incoming to our message characteristic (server role). */
export function onIncomingMessage(fn: IncomingHandler): () => void {
  incomingHandlers.push(fn);
  return () => {
    const i = incomingHandlers.indexOf(fn);
    if (i >= 0) incomingHandlers.splice(i, 1);
  };
}

/** Called by the native bridge when a peer writes to our message char. */
export function _dispatchIncoming(from: PeerId, raw: Uint8Array): void {
  const format = raw[0] ?? 0x01;
  const payload = raw.slice(1);
  const msg: IncomingMessage = { from, payload, format, timestamp: Date.now() };
  incomingHandlers.forEach(h => h(msg));
}

/** Expose _dispatchIncoming on window so native code can call in. */
if (typeof window !== 'undefined') {
  (window as any).__fallmobile_incoming = _dispatchIncoming;
}

export function status() {
  return {
    initialized,
    advertising,
    scanning,
    peers: knownPeers.size,
    did: myDID
  };
}
