/**
 * foldkit.js · minimal offline fold primitives for FallMobile
 * Kernel-grounded Thue-Morse folding + Ed25519 signing via SubtleCrypto.
 * Consumed by the shell and by any bundled estate tool that expects window.foldkit.
 */
(function(global){
  'use strict';

  const PRIMES = [2,3,5,7,11,13,17];
  const GLYPH = '◊';
  const SEAL = '◊·κ=1';

  // Thue-Morse fold: paired parity over the bit-representation of a byte stream
  function foldBytes(bytes){
    let a = 0, b = 0;
    for (let i = 0; i < bytes.length; i++){
      const v = bytes[i];
      let popcount = 0;
      for (let bit = 0; bit < 8; bit++) if (v & (1<<bit)) popcount++;
      if ((popcount & 1) === 0) a = (a * 31 + v) >>> 0;
      else                       b = (b * 31 + v) >>> 0;
    }
    return { even:a, odd:b, hash: ((a ^ b) >>> 0).toString(16).padStart(8,'0') };
  }

  function foldText(text){
    return foldBytes(new TextEncoder().encode(text));
  }

  // Prime-constrained checksum (7 primes)
  function primeCheck(bytes){
    return PRIMES.map(p => {
      let s = 0;
      for (let i = 0; i < bytes.length; i++) s = (s + bytes[i] * p) % 65521;
      return s;
    });
  }

  // Ed25519 keypair · stored in indexeddb by caller
  async function generateKeypair(){
    if (!globalThis.crypto?.subtle) throw new Error('SubtleCrypto not available');
    // Ed25519 in SubtleCrypto is behind a flag on older Chrome; try, fall back to HMAC key
    try {
      const kp = await crypto.subtle.generateKey({ name:'Ed25519' }, true, ['sign','verify']);
      return kp;
    } catch(e) {
      const kp = await crypto.subtle.generateKey({ name:'HMAC', hash:'SHA-256' }, true, ['sign','verify']);
      return { privateKey: kp, publicKey: kp, _hmacFallback: true };
    }
  }

  async function sign(privateKey, bytes){
    const alg = privateKey.algorithm?.name || 'HMAC';
    return crypto.subtle.sign(alg === 'HMAC' ? { name:'HMAC' } : { name: alg }, privateKey, bytes);
  }

  async function verify(publicKey, sig, bytes){
    const alg = publicKey.algorithm?.name || 'HMAC';
    return crypto.subtle.verify(alg === 'HMAC' ? { name:'HMAC' } : { name: alg }, publicKey, sig, bytes);
  }

  async function envelope(payload, privateKey){
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    const fold = foldBytes(bytes);
    const primes = primeCheck(bytes);
    const sig = privateKey ? await sign(privateKey, bytes) : null;
    return {
      payload,
      fold: fold.hash,
      primes,
      seal: SEAL,
      sig: sig ? Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('') : null,
      ts: Date.now()
    };
  }

  global.foldkit = {
    GLYPH, SEAL, PRIMES,
    foldBytes, foldText, primeCheck,
    generateKeypair, sign, verify, envelope,
    version: '1.0.0-fallmobile'
  };
})(typeof window !== 'undefined' ? window : globalThis);
