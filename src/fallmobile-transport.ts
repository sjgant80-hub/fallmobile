/**
 * fallmobile-transport.ts
 *
 * Registers ble-mesh as a FallCarrier transport so estate messages
 * (fold-signed envelopes) route through Bluetooth-mesh transparently.
 *
 * FallCarrier's registered transports must expose:
 *   name   · unique string
 *   send(envelope, target?) → Promise<void>
 *   subscribe(handler) → unsubscribe
 *   peers() → PeerId[]
 *   ready() → Promise<boolean>
 */

import * as ble from './ble-mesh.js';
import type { Peer, IncomingMessage } from './ble-mesh.js';

export interface FallCarrierEnvelope {
  from: string;
  to?: string;
  topic: string;
  payload: any;
  sig?: string;
  ts: number;
}

type EnvHandler = (env: FallCarrierEnvelope, from: string) => void;

interface FallCarrierAPI {
  registerTransport?: (t: any) => void;
  emit?: (topic: string, data: any) => void;
}

let fallcarrier: FallCarrierAPI | null = null;
const handlers: EnvHandler[] = [];
let registered = false;

/** Locate a FallCarrier instance on window and register. */
export async function registerFallMobileTransport(did: string): Promise<boolean> {
  if (registered) return true;

  await ble.init(did);

  ble.onIncomingMessage((msg: IncomingMessage) => {
    try {
      let env: FallCarrierEnvelope;
      if (msg.format === 0x01) {
        // fallmobile JSON
        const text = new TextDecoder().decode(msg.payload);
        env = JSON.parse(text);
      } else if (msg.format === 0x02) {
        // Bitchat wire compat — see spec in README
        env = decodeBitchat(msg.payload, msg.from);
      } else {
        console.warn('[fm-transport] unknown format', msg.format);
        return;
      }
      handlers.forEach(h => h(env, msg.from));
      if (fallcarrier?.emit) {
        fallcarrier.emit(env.topic, { env, from: msg.from });
      }
    } catch (err) {
      console.warn('[fm-transport] decode failed', err);
    }
  });

  // Attempt registration with FallCarrier if present on window
  const fc = (typeof window !== 'undefined' && (window as any).FallCarrier) || null;
  if (fc?.registerTransport) {
    fallcarrier = fc;
    fc.registerTransport({
      name: 'fallmobile-ble',
      send: async (env: FallCarrierEnvelope, target?: string) => sendEnvelope(env, target),
      subscribe: (h: EnvHandler) => {
        handlers.push(h);
        return () => {
          const i = handlers.indexOf(h);
          if (i >= 0) handlers.splice(i, 1);
        };
      },
      peers: () => ble.listPeers().map(p => p.id),
      ready: async () => true
    });
    registered = true;
    console.log('[fm-transport] registered with FallCarrier');
  } else {
    console.log('[fm-transport] FallCarrier not present · standalone mode');
  }

  // Always start advertising + scanning so the app is discoverable
  await ble.startAdvertising({ did });
  await ble.startScan((peer: Peer) => {
    console.log('[fm-transport] peer', peer.did || peer.id, peer.rssi, peer.source);
  });

  return registered;
}

export async function sendEnvelope(env: FallCarrierEnvelope, target?: string): Promise<void> {
  const json = JSON.stringify(env);
  if (target) {
    await ble.sendMessage(target, json, 0x01);
    return;
  }
  // Broadcast · send to all known peers
  const peers = ble.listPeers();
  await Promise.all(peers.map(p => ble.sendMessage(p.id, json, 0x01).catch(() => {})));
}

/** Bitchat wire-compat decoder (tag-length-value envelope). */
function decodeBitchat(payload: Uint8Array, from: string): FallCarrierEnvelope {
  // Minimal decoder — Bitchat's format is documented in their protocol doc.
  // Here we treat the payload as UTF-8 text under topic 'bitchat.msg'.
  const text = new TextDecoder().decode(payload);
  return {
    from,
    topic: 'bitchat.msg',
    payload: { text },
    ts: Date.now()
  };
}

export function status() {
  return {
    registered,
    handlers: handlers.length,
    fallcarrierPresent: !!fallcarrier,
    ble: ble.status()
  };
}

// Expose on window for the shell to introspect
if (typeof window !== 'undefined') {
  (window as any).FallMobileTransport = {
    register: registerFallMobileTransport,
    send: sendEnvelope,
    status,
    peers: () => ble.listPeers()
  };
}
