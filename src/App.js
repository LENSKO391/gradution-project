import { useEffect, useState } from 'react';
import { Lock, User, Mail, Eye, EyeOff, LogOut, Key, FileText, Image, Type, Shield, Database, Clock, Box, Copy, Check } from 'lucide-react';
import * as XLSX from 'xlsx';
import { HistoryStore } from './HistoryStore';
import { HistoryPanel } from './HistoryPanel';
import { TabBtn, ModeToggle, Notice, SubmitBtn } from './components/UIComponents';
import { googleSignIn, registerWithEmail, loginWithEmail, resetPassword,auth } from './FirebaseAuth';
import { onAuthStateChanged } from 'firebase/auth';
// ─── Utility helpers ──────────────────────────────────────────────────────────

// ─── PRNG Key Generator ───────────────────────────────────────────────────────
const PRNG_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*-_=+';
const generateRandomKey = (length = 24) => {
  const arr = new Uint8Array(length * 2);
  crypto.getRandomValues(arr);
  let key = '';
  for (let i = 0; i < arr.length && key.length < length; i++) {
    const idx = arr[i] % PRNG_CHARSET.length;
    key += PRNG_CHARSET[idx];
  }
  return key;
};

const toB64 = (buf) => { const bytes = new Uint8Array(buf); let bin = ''; const C = 8192; for (let i = 0; i < bytes.length; i += C) bin += String.fromCharCode(...bytes.subarray(i, i + C)); return btoa(bin); };
const fromB64 = (str) => { const c = str.replace(/[^A-Za-z0-9+/]/g, ''); return Uint8Array.from(atob(c + '='.repeat((4 - c.length % 4) % 4)), ch => ch.charCodeAt(0)); };

// ─── OOP Core Classes ─────────────────────────────────────────────────────────

class CryptoEngine {
  static AES_ITERATIONS = 250000;

  static async deriveKey({ password, salt, iterations = CryptoEngine.AES_ITERATIONS }) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  static async encrypt({ plainBytes, password }) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await CryptoEngine.deriveKey({ password, salt });
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBytes);
    return { ciphertext: toB64(cipher), salt: toB64(salt), iv: toB64(iv), algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: CryptoEngine.AES_ITERATIONS, version: 1 };
  }

  static async decrypt({ payload, password }) {
    const { ciphertext, salt, iv, iterations } = payload;
    if (!ciphertext || !salt || !iv) throw new Error('Invalid payload: missing ciphertext, salt, or iv.');
    const key = await CryptoEngine.deriveKey({ password, salt: fromB64(salt), iterations: iterations || CryptoEngine.AES_ITERATIONS });
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ciphertext)));
  }
}

class AccountManager {
  static ACCOUNTS_KEY = 'encryptionSystemAccounts';
  static USER_KEY = 'encryptionSystemLoggedInUser';

  static #read(key, fallback) { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; } }
  static #write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.error(`Could not save ${key}`, e); } }

  constructor() { this.accounts = AccountManager.#read(AccountManager.ACCOUNTS_KEY, []); }

  #save() { AccountManager.#write(AccountManager.ACCOUNTS_KEY, this.accounts); }

  find({ email }) { return this.accounts.find(a => a.email === email) || null; }

  register({ name, email, password, historyPin = '' }) {
    if (!name || !email || !password) throw new Error('Please fill in all fields.');
    if (this.accounts.some(a => a.email === email)) throw new Error('An account with this email already exists.');
    const account = { name, email, password, historyPin };
    this.accounts.push(account);
    this.#save();
    return account;
  }

  login({ email, password }) {
    const account = this.accounts.find(a => a.email === email && a.password === password);
    if (!account) throw new Error('Invalid email or password.');
    return { email: account.email, name: account.name, historyPin: account.historyPin };
  }

  changePassword({ email, oldPassword, newPassword }) {
    const idx = this.accounts.findIndex(a => a.email === email);
    if (idx < 0) throw new Error('User account not found.');
    if (this.accounts[idx].password !== oldPassword) throw new Error('Incorrect old password.');
    this.accounts[idx].password = newPassword;
    this.#save();
  }

  persistSession({ user }) { AccountManager.#write(AccountManager.USER_KEY, user); }
  clearSession() { localStorage.removeItem(AccountManager.USER_KEY); }
  getSession() { return AccountManager.#read(AccountManager.USER_KEY, null); }
}

class FileProcessor {
  static isText(f) { return f && (f.type === 'text/plain' || f.name.toLowerCase().endsWith('.txt')); }
  static isImage(f) { return f && (f.type === 'image/png' || f.type === 'image/jpeg' || /\.(png|jpe?g)$/i.test(f.name)); }
  static is3D(f) { return f && /\.(obj|stl)$/i.test(f.name); }
  static isCsv(f) { return f && (f.type === 'text/csv' || f.name.toLowerCase().endsWith('.csv')); }
  static isXlsx(f) { return f && (f.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || f.name.toLowerCase().endsWith('.xlsx')); }
  static isDataset(f) { return FileProcessor.isCsv(f) || FileProcessor.isXlsx(f); }

  static decryptedName(name) {
    return name.endsWith('.encrypted.txt') ? `${name.replace('.encrypted.txt', '')}.decrypted.txt` : `${name}.decrypted.txt`;
  }

  // FIX: was `name.replace(...) || fallback` — replace() returns the original string when no match
  // (truthy), so the fallback was unreachable. Now uses an explicit includes() check.
  static decryptedImageName(name) {
    // Strip .encrypted from name if present, then restore original extension or use .png
    const noExt = name.replace(/\.encrypted\.png$/i, '');
    if (noExt !== name) return `${noExt}.decrypted.png`;
    if (name.toLowerCase().endsWith('.png')) {
      return `${name.slice(0, -4)}.decrypted.png`;
    }
    return `${name}.decrypted.png`;
  }

  static decrypted3DName(name) {
    if (name.includes('.encrypted.')) {
      return name.replace('.encrypted.', '.decrypted.');
    }
    return `${name}.decrypted`;
  }

  static decryptedDatasetName(name, originalName = '') {
    if (originalName) {
      const extIdx = originalName.lastIndexOf('.');
      if (extIdx !== -1) return `${originalName.substring(0, extIdx)}.decrypted${originalName.substring(extIdx)}`;
      return `${originalName}.decrypted`;
    }
    if (name.endsWith('.encrypted.csv')) {
      const original = name.replace('.encrypted.csv', '');
      const dot = original.lastIndexOf('.');
      return dot !== -1 ? `${original.substring(0, dot)}.decrypted${original.substring(dot)}` : `${original}.decrypted`;
    }
    return `${name}.decrypted`;
  }

  static async #triggerDownload(blob, name) {
    if (window.showSaveFilePicker) {
      try { const h = await window.showSaveFilePicker({ suggestedName: name }); const w = await h.createWritable(); await w.write(blob); await w.close(); return; }
      catch (err) { if (err.name !== 'AbortError') console.error(err); }
    }
    if (window.navigator?.msSaveOrOpenBlob) { window.navigator.msSaveOrOpenBlob(blob, name); return; }
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name, style: 'display:none' });
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  static async download({ text, name, mimeType = 'text/plain;charset=utf-8' }) {
    return FileProcessor.#triggerDownload(new Blob([text], { type: mimeType }), name);
  }

  static async downloadBytes({ bytes, name, mimeType = 'application/octet-stream' }) {
    return FileProcessor.#triggerDownload(new Blob([bytes], { type: mimeType }), name);
  }

  static async readText(file) {
    return file.text();
  }

  static async readArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsArrayBuffer(file);
    });
  }
static async distortSTL(bytes, password) {
  if (bytes.length < 84) throw new Error('STL file is too small or corrupt.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triCount = view.getUint32(80, true);
  const expectedSize = 84 + triCount * 50;
  if (triCount === 0) throw new Error('STL file contains no triangles.');
  if (expectedSize > bytes.length) {
    const sample = new TextDecoder().decode(bytes.slice(0, 256));
    if (sample.toLowerCase().includes('solid') && sample.includes('facet'))
      throw new Error('ASCII STL format detected. Please re-export as Binary STL.');
    throw new Error(`STL file appears truncated (needs ${expectedSize} bytes, got ${bytes.length}).`);
  }
  
  // Copy the entire file
  const distorted = new Uint8Array(expectedSize);
  distorted.set(bytes.subarray(0, expectedSize));
  
  // Derive keystream from password
  const salt = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
  const key = await CryptoEngine.deriveKey({ password, salt, iterations: 1000 });
  const keystreamLen = Math.max(65536, triCount * 36); // 36 bytes per triangle (9 floats × 4)
  const zeroArray = new Uint8Array(keystreamLen);
  const keystream = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: new Uint8Array(12) }, key, zeroArray
  ));
  
  let keystreamPos = 0;
  
  for (let t = 0; t < triCount; t++) {
    const triOffset = 84 + t * 50;
    
    // Distort vertex coordinates only (12-48 bytes in each triangle)
    for (let v = 0; v < 3; v++) {
      for (let c = 0; c < 3; c++) {
        const floatOffset = triOffset + 12 + v * 12 + c * 4;
        
        // Read current float value
        const originalFloat = view.getFloat32(floatOffset, true);
        
        // Get deterministic noise value between -0.3 and +0.3 of original magnitude
        const noiseVal = (keystream[keystreamPos % keystream.length] / 255) * 0.6 - 0.3;
        let newFloat = originalFloat + (originalFloat * noiseVal);
        
        // Clamp to reasonable range (avoid exploding values)
        newFloat = Math.max(-1000, Math.min(1000, newFloat));
        
        // Write back distorted float
        const bytes = new Uint8Array(4);
        new DataView(bytes.buffer).setFloat32(0, newFloat, true);
        for (let b = 0; b < 4; b++) {
          distorted[floatOffset + b] = bytes[b];
        }
        keystreamPos++;
      }
    }
  }
  
  return distorted;
}
  // ── CRC / Adler helpers ───────────────────────────────────────────────────

  static _crc32Table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c; }
    return t;
  })();

  static _crc32(buf, offset = 0, length = buf.length - offset) {
    let crc = 0xFFFFFFFF;
    for (let i = offset; i < offset + length; i++) crc = FileProcessor._crc32Table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  static _adler32(buf) {
    let a = 1, b = 0;
    for (let i = 0; i < buf.length; i++) { a = (a + buf[i]) % 65521; b = (b + a) % 65521; }
    return ((b << 16) | a) >>> 0;
  }

  static _u32be(n) { return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF]; }

  static _chunk(type, data) {
    const typeBytes = [...type].map(c => c.charCodeAt(0));
    const crcInput = new Uint8Array([...typeBytes, ...data]);
    return new Uint8Array([...FileProcessor._u32be(data.length), ...typeBytes, ...data, ...FileProcessor._u32be(FileProcessor._crc32(crcInput))]);
  }

  static _zlibStore(raw) {
    const BSIZE = 65535;
    const parts = [new Uint8Array([0x78, 0x01])]; // zlib header
    for (let i = 0; i < raw.length || i === 0; i += BSIZE) {
      const slice = raw.slice(i, i + BSIZE), last = (i + BSIZE >= raw.length) ? 1 : 0;
      parts.push(new Uint8Array([last, slice.length & 0xFF, (slice.length >> 8) & 0xFF, (~slice.length) & 0xFF, ((~slice.length) >> 8) & 0xFF]), slice);
    }
    parts.push(new Uint8Array(FileProcessor._u32be(FileProcessor._adler32(raw))));
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let off = 0; for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }

  static _buildPNG(width, height, rgbaPixels) {
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    // color type 2 = RGB (no alpha — avoids premultiplied alpha issues)
    const ihdr = new Uint8Array([...FileProcessor._u32be(width), ...FileProcessor._u32be(height), 8, 2, 0, 0, 0]);
    const rowBytes = width * 3;
    const rawRows = new Uint8Array(height * (1 + rowBytes));
    for (let y = 0; y < height; y++) {
      rawRows[y * (1 + rowBytes)] = 0;
      for (let x = 0; x < width; x++) {
        const src = (y * width + x) * 4, dst = y * (1 + rowBytes) + 1 + x * 3;
        rawRows[dst] = rgbaPixels[src]; rawRows[dst + 1] = rgbaPixels[src + 1]; rawRows[dst + 2] = rgbaPixels[src + 2];
      }
    }
    const chunks = [sig, FileProcessor._chunk('IHDR', Array.from(ihdr)), FileProcessor._chunk('IDAT', Array.from(FileProcessor._zlibStore(rawRows))), FileProcessor._chunk('IEND', [])];
    const png = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
    let off = 0; for (const c of chunks) { png.set(c, off); off += c.length; }
    return png;
  }

  static _parsePNG(bytes) {
    // FIX: was using a fragile `buf.buffer ? buf.buffer : buf` ternary that could
    // silently pass a plain ArrayBuffer as DataView data — now always wraps in Uint8Array first.
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error('Not a valid PNG file.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let off = 8, width = 0, height = 0, colorType = 0;
    const idatChunks = [];
    while (off < bytes.length) {
      const len = view.getUint32(off); off += 4;
      const type = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]); off += 4;
      const data = bytes.slice(off, off + len); off += len + 4; // +4 skips CRC
      if (type === 'IHDR') {
        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        width = dv.getUint32(0, false); height = dv.getUint32(4, false);
        // FIX: color type is at byte index 8 of IHDR data (bit depth=8, color type=9 in spec).
        // Previous code read data[9] which is actually the compression method byte, always 0,
        // causing the parser to always treat output as RGB (3ch) even when colorType should be RGBA (4ch).
        colorType = data[8];
      } else if (type === 'IDAT') {
        idatChunks.push(data);
      } else if (type === 'IEND') break;
    }
    const idat = new Uint8Array(idatChunks.reduce((s, c) => s + c.length, 0));
    let idatOff = 0; for (const c of idatChunks) { idat.set(c, idatOff); idatOff += c.length; }

    const channels = colorType === 2 ? 3 : 4;
    const rowBytes = width * channels;
    const rawRows = new Uint8Array(height * (1 + rowBytes));
    let pos = 2, rawOff = 0; // skip 2-byte zlib header
    while (pos < idat.length - 4) {
      const last = idat[pos++], blen = idat[pos] | (idat[pos + 1] << 8); pos += 4; // skip len + ~len
      rawRows.set(idat.slice(pos, pos + blen), rawOff); rawOff += blen; pos += blen;
      if (last) break;
    }
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const rowStart = y * (1 + rowBytes) + 1;
      for (let x = 0; x < width; x++) {
        const src = rowStart + x * channels, dst = (y * width + x) * 4;
        rgba[dst] = rawRows[src]; rgba[dst + 1] = rawRows[src + 1]; rgba[dst + 2] = rawRows[src + 2]; rgba[dst + 3] = 255;
      }
    }
    return { width, height, rgba };
  }
static async getImageData(file) {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, img.width, img.height));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
/* eslint-disable no-undef */
// ── PNG custom-chunk approach ─────────────────────────────────────────────────
// Encrypted payload is stored verbatim in a private ancillary PNG chunk ('enCr').
// Pixel data is distorted visually using the password-derived keystream so the
// output looks scrambled but the payload bytes are never touched by compression.

static async encodeToDistortedPng(dataBytes, originalFile, password) {
  // 1. Derive keystream for visual distortion
  const distortionSalt = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
  const distortionKey = await CryptoEngine.deriveKey({ password, salt: distortionSalt, iterations: 1000 });

  let width, height, rgba;
  if (originalFile && FileProcessor.isImage(originalFile)) {
    const img = await new Promise((res) => {
      const i = new window.Image();
      i.onload = () => res(i);
      i.src = URL.createObjectURL(originalFile);
    });
    width = img.width;
    height = img.height;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    rgba = new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer);
  } else {
    width = 256; height = 256;
    rgba = new Uint8Array(width * height * 4).fill(128);
  }

  // 2. Apply keystream distortion to all pixels
  const zeroArray = new Uint8Array(Math.max(65536, width * height * 4));
  const keystream = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, distortionKey, zeroArray));
  for (let p = 0; p < width * height; p++) {
    const ri = p * 4, ki = p % keystream.length;
    rgba[ri]     ^= keystream[ki];
    rgba[ri + 1] ^= keystream[(ki + 1) % keystream.length];
    rgba[ri + 2] ^= keystream[(ki + 2) % keystream.length];
  }

  // 3. Build PNG with a private ancillary chunk 'enCr' containing the payload bytes
  const pngWithoutEnd = FileProcessor._buildPNGNoEnd(width, height, rgba);
  const enCrChunk = FileProcessor._chunk('enCr', Array.from(dataBytes));
  const iend = FileProcessor._chunk('IEND', []);

  const total = pngWithoutEnd.length + enCrChunk.length + iend.length;
  const out = new Uint8Array(total);
  out.set(pngWithoutEnd, 0);
  out.set(enCrChunk, pngWithoutEnd.length);
  out.set(iend, pngWithoutEnd.length + enCrChunk.length);
  return new Blob([out], { type: 'image/png' });
}

static _buildPNGNoEnd(width, height, rgbaPixels) {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array([...FileProcessor._u32be(width), ...FileProcessor._u32be(height), 8, 2, 0, 0, 0]);
  const rowBytes = width * 3;
  const rawRows = new Uint8Array(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) {
    rawRows[y * (1 + rowBytes)] = 0;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4, dst = y * (1 + rowBytes) + 1 + x * 3;
      rawRows[dst] = rgbaPixels[src]; rawRows[dst + 1] = rgbaPixels[src + 1]; rawRows[dst + 2] = rgbaPixels[src + 2];
    }
  }
  const parts = [sig, FileProcessor._chunk('IHDR', Array.from(ihdr)), FileProcessor._chunk('IDAT', Array.from(FileProcessor._zlibStore(rawRows)))];
  const len = parts.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(len);
  let off = 0; for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

static async decodeFromDistortedPng(file, password) {
  const bytes = new Uint8Array(await FileProcessor.readArrayBuffer(file));
  // Validate PNG signature
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== sig[i]) throw new Error('Not a valid PNG file.');
  }
  // Walk chunks looking for 'enCr'
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  while (off + 12 <= bytes.length) {
    const len = view.getUint32(off); off += 4;
    const type = String.fromCharCode(bytes[off], bytes[off+1], bytes[off+2], bytes[off+3]); off += 4;
    if (type === 'enCr') {
      return bytes.slice(off, off + len);
    }
    off += len + 4; // skip data + CRC
  }
  throw new Error('Could not parse encrypted file. Make sure it was encrypted by this app.');
}

static async encodeToDistorted3D(dataBytes, originalFile, password = null) {
  const originalBytes = new Uint8Array(await FileProcessor.readArrayBuffer(originalFile));
  const fileName = originalFile.name.toLowerCase();

  // STL → embed payload inside attribute bytes + distort vertices
  if (fileName.endsWith('.stl') || fileName.endsWith('.stlb')) {
    return FileProcessor.encodeToStlWithEmbeddedData(originalBytes, dataBytes, password);
  }

  // OBJ → distort vertex coordinate lines using password-derived keystream
  if (fileName.endsWith('.obj') && password) {
    return FileProcessor.encodeToDistortedObj(originalBytes, dataBytes, password);
  }

  // GLB → XOR the binary BIN chunk (geometry + textures) with keystream
  if (fileName.endsWith('.glb') && password) {
    return FileProcessor.encodeToDistortedGlb(originalBytes, dataBytes, password);
  }

  // GLTF → scramble inline base64 buffer data URIs
  if (fileName.endsWith('.gltf') && password) {
    return FileProcessor.encodeToDistortedGltf(originalBytes, dataBytes, password);
  }

  // FBX / other → plain append (proprietary format, unsafe to mutate binary structure)
  const magic = new TextEncoder().encode('CVLT');
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, dataBytes.length, true);
  const result = new Uint8Array(originalBytes.length + 4 + 4 + dataBytes.length);
  result.set(originalBytes, 0);
  result.set(magic, originalBytes.length);
  result.set(lenBuf, originalBytes.length + 4);
  result.set(dataBytes, originalBytes.length + 8);
  return new Blob([result], { type: 'application/octet-stream' });
}

// ── GLB distortion ────────────────────────────────────────────────────────────
// GLB = Binary glTF. Structure: 12-byte header, then chunks [length(4), type(4), data].
// Chunk type 0x004E4942 = BIN\0 — holds all geometry/texture binary data.
// XOR-ing this chunk completely scrambles the 3D content while keeping the file parseable
// (viewers will see garbage geometry or crash to load, which is the intended effect).
static async encodeToDistortedGlb(originalBytes, dataBytes, password) {
  const view = new DataView(originalBytes.buffer, originalBytes.byteOffset, originalBytes.byteLength);

  // Validate GLB magic: 'glTF' = 0x46546C67
  if (view.getUint32(0, true) !== 0x46546C67) {
    throw new Error('Not a valid GLB file.');
  }

  const distorted = new Uint8Array(originalBytes.length);
  distorted.set(originalBytes);

  // Walk chunks to find BIN chunk
  let off = 12;
  let binDistorted = false;
  while (off + 8 <= originalBytes.length) {
    const chunkLength = view.getUint32(off, true);
    const chunkType   = view.getUint32(off + 4, true);
    if (chunkType === 0x004E4942) { // BIN\0
      const salt = new Uint8Array([0x47, 0x4C, 0x42, 0x00]);
      const key  = await CryptoEngine.deriveKey({ password, salt, iterations: 1000 });
      const keystreamLen = Math.max(65536, chunkLength + 16);
      const keystream = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: new Uint8Array(12) }, key, new Uint8Array(keystreamLen)
      ));
      const dataStart = off + 8;
      for (let i = 0; i < chunkLength; i++) {
        distorted[dataStart + i] ^= keystream[i % keystream.length];
      }
      binDistorted = true;
      break;
    }
    off += 8 + chunkLength;
  }

  if (!binDistorted) {
    // No BIN chunk found (geometry-less GLB) — XOR the JSON chunk as fallback
    const jsonLength = view.getUint32(12, true);
    const salt = new Uint8Array([0x47, 0x4C, 0x54, 0x46]);
    const key  = await CryptoEngine.deriveKey({ password, salt, iterations: 1000 });
    const keystream = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: new Uint8Array(12) }, key, new Uint8Array(Math.max(65536, jsonLength + 16))
    ));
    for (let i = 0; i < jsonLength; i++) {
      distorted[20 + i] ^= keystream[i % keystream.length]; // 12 header + 8 chunk-header
    }
  }

  // Append CVLT payload
  const cvlt = new TextEncoder().encode('CVLT');
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, dataBytes.length, true);
  const result = new Uint8Array(distorted.length + 8 + dataBytes.length);
  result.set(distorted, 0);
  result.set(cvlt, distorted.length);
  result.set(lenBuf, distorted.length + 4);
  result.set(dataBytes, distorted.length + 8);
  return new Blob([result], { type: 'model/gltf-binary' });
}

// ── GLTF distortion ───────────────────────────────────────────────────────────
// GLTF is a JSON text file. Buffers can be inline (data:...;base64,<data>)
// or external .bin references (which we can't reach). We scramble any inline
// base64 buffer data so the geometry is unreadable. External-buffer GLTF files
// fall through to plain CVLT append.
static async encodeToDistortedGltf(originalBytes, dataBytes, password) {
  let json;
  try {
    json = JSON.parse(new TextDecoder().decode(originalBytes));
  } catch {
    throw new Error('Not a valid GLTF file.');
  }

  let scrambledAny = false;
  if (Array.isArray(json.buffers)) {
    const salt = new Uint8Array([0x47, 0x54, 0x4C, 0x46]);
    const key  = await CryptoEngine.deriveKey({ password, salt, iterations: 1000 });

    for (const buf of json.buffers) {
      if (typeof buf.uri === 'string' && buf.uri.startsWith('data:')) {
        // Extract base64 payload after the comma
        const commaIdx = buf.uri.indexOf(',');
        if (commaIdx === -1) continue;
        const b64 = buf.uri.slice(commaIdx + 1);
        const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));

        // XOR with keystream
        const keystream = new Uint8Array(await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: new Uint8Array(12) }, key, new Uint8Array(Math.max(65536, raw.length + 16))
        ));
        const scrambled = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) scrambled[i] = raw[i] ^ keystream[i % keystream.length];

        // Re-encode as base64 data URI (keep same mime prefix)
        const prefix = buf.uri.slice(0, commaIdx + 1);
        const scrambledB64 = btoa(String.fromCharCode(...scrambled));
        buf.uri = prefix + scrambledB64;
        scrambledAny = true;
      }
    }
  }

  const outText = JSON.stringify(json);
  const outBytes = new TextEncoder().encode(outText);

  if (!scrambledAny) {
    // External buffers only — plain CVLT append, can't distort geometry
    console.warn('GLTF has no inline buffers — falling back to plain payload append.');
  }

  // Append CVLT payload
  const cvlt = new TextEncoder().encode('CVLT');
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, dataBytes.length, true);
  const result = new Uint8Array(outBytes.length + 8 + dataBytes.length);
  result.set(outBytes, 0);
  result.set(cvlt, outBytes.length);
  result.set(lenBuf, outBytes.length + 4);
  result.set(dataBytes, outBytes.length + 8);
  return new Blob([result], { type: 'model/gltf+json' });
}

static async encodeToDistortedObj(originalBytes, dataBytes, password) {
  // 1. Decode OBJ text and parse vertex lines
  const text = new TextDecoder().decode(originalBytes);
  const lines = text.split('\n');

  // Count vertex lines to size the keystream
  let vertexCount = 0;
  for (const line of lines) {
    if (line.startsWith('v ') || line.startsWith('v\t')) vertexCount++;
  }

  // 2. Derive keystream from password (3 floats per vertex × 4 bytes each)
  const salt = new Uint8Array([0xAB, 0xCD, 0xEF, 0x01]);
  const distortionKey = await CryptoEngine.deriveKey({ password, salt, iterations: 1000 });
  const keystreamLen = Math.max(65536, vertexCount * 12 + 16);
  const zeroArray = new Uint8Array(keystreamLen);
  const keystream = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: new Uint8Array(12) }, distortionKey, zeroArray
  ));

  // 3. Walk lines and distort vertex coordinates
  let kpos = 0;
  const distortedLines = lines.map(line => {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('v ') && !trimmed.startsWith('v\t')) return line;
    const parts = trimmed.split(/\s+/); // ['v', x, y, z, (optional w)]
    if (parts.length < 4) return line;
    const distorted = parts.map((p, i) => {
      if (i === 0) return p; // keep 'v'
      const orig = parseFloat(p);
      if (isNaN(orig)) return p;
      // noise in range [-0.4, +0.4] relative to original magnitude
      const noise = (keystream[kpos++ % keystream.length] / 255) * 0.8 - 0.4;
      const val = orig === 0 ? noise * 0.5 : orig + orig * noise;
      return val.toFixed(6);
    });
    return distorted.join(' ');
  });

  // 4. Reassemble distorted OBJ and append CVLT payload
  const distortedText = distortedLines.join('\n');
  const distortedBytes = new TextEncoder().encode(distortedText);
  const magic = new TextEncoder().encode('CVLT');
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, dataBytes.length, true);

  const result = new Uint8Array(distortedBytes.length + 4 + 4 + dataBytes.length);
  result.set(distortedBytes, 0);
  result.set(magic, distortedBytes.length);
  result.set(lenBuf, distortedBytes.length + 4);
  result.set(dataBytes, distortedBytes.length + 8);

  return new Blob([result], { type: 'application/octet-stream' });
}
static _asciiStlToBinary(bytes) {
  // Parses ASCII STL text and builds an equivalent binary STL in memory.
  const text = new TextDecoder().decode(bytes);
  const triangles = [];

  // Match every "facet normal ... vertex ... vertex ... vertex ... endfacet" block
  const facetRe = /facet\s+normal\s+([\S]+)\s+([\S]+)\s+([\S]+)\s+outer\s+loop\s+vertex\s+([\S]+)\s+([\S]+)\s+([\S]+)\s+vertex\s+([\S]+)\s+([\S]+)\s+([\S]+)\s+vertex\s+([\S]+)\s+([\S]+)\s+([\S]+)\s+endloop\s+endfacet/gi;
  let m;
  while ((m = facetRe.exec(text)) !== null) {
    triangles.push([
      parseFloat(m[1]),  parseFloat(m[2]),  parseFloat(m[3]),  // normal
      parseFloat(m[4]),  parseFloat(m[5]),  parseFloat(m[6]),  // v1
      parseFloat(m[7]),  parseFloat(m[8]),  parseFloat(m[9]),  // v2
      parseFloat(m[10]), parseFloat(m[11]), parseFloat(m[12]), // v3
    ]);
  }

  if (triangles.length === 0)
    throw new Error('Could not parse any triangles from the ASCII STL file. The file may be corrupt.');

  // Binary STL: 80-byte header + 4-byte count + triCount × 50 bytes
  const bin = new Uint8Array(84 + triangles.length * 50);
  const dv  = new DataView(bin.buffer);

  // Write header (80 bytes) — encode "Binary STL converted from ASCII" as marker
  const hdr = new TextEncoder().encode('Binary STL (auto-converted)');
  bin.set(hdr, 0);

  // Write triangle count
  dv.setUint32(80, triangles.length, true);

  // Write each triangle
  for (let t = 0; t < triangles.length; t++) {
    const base = 84 + t * 50;
    const f = triangles[t];
    // Normal (3 floats)
    dv.setFloat32(base,      f[0],  true);
    dv.setFloat32(base +  4, f[1],  true);
    dv.setFloat32(base +  8, f[2],  true);
    // Vertex 1
    dv.setFloat32(base + 12, f[3],  true);
    dv.setFloat32(base + 16, f[4],  true);
    dv.setFloat32(base + 20, f[5],  true);
    // Vertex 2
    dv.setFloat32(base + 24, f[6],  true);
    dv.setFloat32(base + 28, f[7],  true);
    dv.setFloat32(base + 32, f[8],  true);
    // Vertex 3
    dv.setFloat32(base + 36, f[9],  true);
    dv.setFloat32(base + 40, f[10], true);
    dv.setFloat32(base + 44, f[11], true);
    // Attribute byte count (2 bytes, set to 0)
    dv.setUint16(base + 48, 0, true);
  }
  return bin;
}

static async encodeToStlWithEmbeddedData(originalBytes, dataBytes, password) {
  // ── Normalise: auto-convert ASCII STL → Binary STL ───────────────────────
  // Detect ASCII STL by checking if file size matches binary formula 84 + N*50.
  // Never rely on the 80-byte header text — binary exporters (Blender, Fusion 360)
  // commonly write "solid <name>" there too.
  let workingBytes = originalBytes;

  if (originalBytes.length >= 84) {
    const _dv  = new DataView(originalBytes.buffer, originalBytes.byteOffset, originalBytes.byteLength);
    const _n   = _dv.getUint32(80, true);
    const _exp = 84 + _n * 50;
    if (_n === 0 || _exp > originalBytes.length) {
      // Doesn't fit binary formula → try parsing as ASCII
      const sample = new TextDecoder().decode(originalBytes.slice(0, 256));
      if (sample.toLowerCase().includes('solid') || sample.includes('facet')) {
        workingBytes = FileProcessor._asciiStlToBinary(originalBytes);
      } else {
        throw new Error(`STL file appears truncated or corrupt (expected ${_exp} bytes, got ${originalBytes.length}).`);
      }
    }
  } else {
    // File too small for binary — try ASCII parse
    const sample = new TextDecoder().decode(originalBytes.slice(0, Math.min(256, originalBytes.length)));
    if (sample.toLowerCase().includes('solid') || sample.includes('facet')) {
      workingBytes = FileProcessor._asciiStlToBinary(originalBytes);
    } else {
      throw new Error('STL file is too small or corrupt (must be at least 84 bytes for binary STL).');
    }
  }
  // ── End normalisation — workingBytes is now guaranteed binary STL ─────────

  const view = new DataView(workingBytes.buffer, workingBytes.byteOffset, workingBytes.byteLength);
  const originalTriCount = new DataView(workingBytes.buffer, workingBytes.byteOffset, workingBytes.byteLength).getUint32(80, true);
  
  // Check if we have enough space in attribute bytes (2 bytes per triangle)
  const maxPayloadBytes = originalTriCount * 2;
  
  if (dataBytes.length + 8 <= maxPayloadBytes) {
    // Small payload: store entirely in attribute bytes
    const distorted = new Uint8Array(workingBytes.length);
    distorted.set(workingBytes);
    
    // Write magic 'CV' (2 bytes) at start of attribute bytes of first triangle
    // Write length, then data
    let dataPos = 0;
    for (let t = 0; t < originalTriCount && dataPos < dataBytes.length + 4; t++) {
      const attrOffset = 84 + t * 50 + 48; // attribute bytes location
      
      if (t === 0) {
        distorted[attrOffset] = 0x43;     // 'C'
        distorted[attrOffset + 1] = 0x56; // 'V'
        dataPos = 2;
      } else if (t === 1) {
        // Write length in next 2 bytes
        distorted[attrOffset] = (dataBytes.length >> 8) & 0xFF;
        distorted[attrOffset + 1] = dataBytes.length & 0xFF;
        dataPos += 2;
      } else {
        const remaining = dataBytes.length - (dataPos - 4);
        const bytesToWrite = Math.min(2, remaining);
        for (let i = 0; i < bytesToWrite && dataPos - 4 < dataBytes.length; i++) {
          distorted[attrOffset + i] = dataBytes[dataPos - 4 + i];
          dataPos++;
        }
      }
    }
    
    // Apply visual distortion to vertices so it looks encrypted
    if (password) {
      const salt = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);
      const key = await CryptoEngine.deriveKey({ password, salt, iterations: 500 });
      const zeroArray = new Uint8Array(65536);
      const keystream = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: new Uint8Array(12) }, key, zeroArray
      ));
      
      let kpos = 0;
      for (let t = 0; t < originalTriCount; t++) {
        const triOffset = 84 + t * 50;
        // Distort vertex coordinates slightly (scale by 0.5-1.5)
        for (let v = 0; v < 3; v++) {
          for (let c = 0; c < 3; c++) {
            const floatOffset = triOffset + 12 + v * 12 + c * 4;
            const origFloat = view.getFloat32(floatOffset, true);
            const factor = 0.5 + (keystream[kpos % keystream.length] / 255);
            const newFloat = origFloat * factor;
            const bytes = new Uint8Array(4);
            new DataView(bytes.buffer).setFloat32(0, newFloat, true);
            for (let b = 0; b < 4; b++) {
              distorted[floatOffset + b] = bytes[b];
            }
            kpos++;
          }
        }
      }
    }
    
    return new Blob([distorted], { type: 'application/sla' });
  } else {
    // Large payload: use fallback (file will be invalid for fstl, but works for other viewers)
    console.warn('Payload too large for STL attribute embedding, using appended method');
    const magic = new TextEncoder().encode('CVLT');
    const lenBuf = new Uint8Array(4);
    new DataView(lenBuf.buffer).setUint32(0, dataBytes.length, true);
    
    const result = new Uint8Array(workingBytes.length + 4 + 4 + dataBytes.length);
    result.set(workingBytes, 0);
    result.set(magic, workingBytes.length);
    result.set(lenBuf, workingBytes.length + 4);
    result.set(dataBytes, workingBytes.length + 8);
    
    return new Blob([result], { type: 'application/octet-stream' });
  }
}

static async decodeFromDistorted3D(file) {
  const bytes = new Uint8Array(await FileProcessor.readArrayBuffer(file));
  const fileName = file.name.toLowerCase();
  
  // Check if this is an STL with embedded data
  if (fileName.endsWith('.stl') || fileName.endsWith('.stlb')) {
    try {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const triCount = view.getUint32(80, true);
      
      // Check for magic 'CV' in first triangle's attribute bytes
      const firstAttrOffset = 84 + 48; // first triangle's attribute bytes
      if (bytes[firstAttrOffset] === 0x43 && bytes[firstAttrOffset + 1] === 0x56) {
        // Embedded data found
        const secondAttrOffset = 84 + 50 + 48; // second triangle's attribute bytes
        const dataLength = (bytes[secondAttrOffset] << 8) | bytes[secondAttrOffset + 1];
        
        const payload = new Uint8Array(dataLength);
        let payloadPos = 0;
        
        for (let t = 2; t < triCount && payloadPos < dataLength; t++) {
          const attrOffset = 84 + t * 50 + 48;
          const remaining = dataLength - payloadPos;
          const bytesToRead = Math.min(2, remaining);
          for (let i = 0; i < bytesToRead; i++) {
            payload[payloadPos++] = bytes[attrOffset + i];
          }
        }
        
        if (payloadPos === dataLength) {
          return payload;
        }
      }
    } catch (err) {
      console.warn('Embedded data extraction failed, trying appended method', err);
    }
  }
  
  // Fallback: search for 'CVLT' magic signature (appended method)
  const magic = [0x43, 0x56, 0x4C, 0x54];
  let magicPos = -1;
  
  for (let i = bytes.length - 8; i >= 0; i--) {
    if (bytes[i] === magic[0] && bytes[i+1] === magic[1] && 
        bytes[i+2] === magic[2] && bytes[i+3] === magic[3]) {
      magicPos = i;
      break;
    }
  }
  
  if (magicPos === -1) {
    throw new Error('Could not parse encrypted file. Make sure it was encrypted by this app.');
  }
  
  const dataLength = new DataView(bytes.buffer, bytes.byteOffset + magicPos + 4, 4).getUint32(0, true);
  const dataStart = magicPos + 8;
  
  if (dataStart + dataLength > bytes.length) {
    throw new Error('Could not parse encrypted file. Make sure it was encrypted by this app.');
  }
  
  return bytes.slice(dataStart, dataStart + dataLength);
}

  // Keep legacy decode methods for backwards compatibility (files encrypted with old version)
  static _decodeDistortedSTL(bytes) {
    if (bytes.length < 84) throw new Error('File too small to be a valid encrypted STL');
    const signature = new TextDecoder().decode(bytes.slice(76, 80));
    if (signature !== 'ENCR') throw new Error('This does not appear to be an encrypted STL file');
    const triangleCount = new DataView(bytes.buffer, 80, 4).getUint32(0, true);
    const maxDataLength = triangleCount * 48;
    const dataToExtract = new Uint8Array(maxDataLength);
    let dataIndex = 0;
    for (let t = 0; t < triangleCount && dataIndex < maxDataLength; t++) {
      const triangleOffset = 84 + t * 50;
      for (let i = 0; i < 48 && dataIndex < maxDataLength; i += 4) {
        const floatValue = new DataView(bytes.buffer, triangleOffset + i, 4).getFloat32(0, true);
        let byteValue = (t === 0 && i < 12) ? Math.round((floatValue + 1) / 2 * 255) : Math.round((floatValue + 100) / 200 * 255);
        dataToExtract[dataIndex++] = Math.max(0, Math.min(255, byteValue));
      }
    }
    const dataLength = new DataView(dataToExtract.buffer, 0, 4).getUint32(0, true);
    if (dataLength > dataToExtract.length - 4) throw new Error('Invalid data length in encrypted file');
    return dataToExtract.slice(4, 4 + dataLength);
  }

  static _decodeDistortedGeneric3D(bytes) {
    const headerSize = Math.min(64, bytes.length);
    if (bytes.length < headerSize + 4) throw new Error('File too small to contain encrypted data');
    const dataLength = new DataView(bytes.buffer, headerSize, 4).getUint32(0, true);
    const dataStart = headerSize + 4;
    if (dataStart + dataLength > bytes.length) throw new Error('File corrupted or invalid encrypted data length');
    return bytes.slice(dataStart, dataStart + dataLength);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
const accountManager = new AccountManager();


// ─── Feature Panels ───────────────────────────────────────────────────────────

const TextFileCryptoPanel = ({ user }) => {
  const [mode, setMode] = useState('encrypt');
  const [file, setFile] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [processing, setProcessing] = useState(false);
  const [copied, setCopied] = useState(false);
  const reset = () => { setError(''); setSuccess(''); };
  const handleCopyKey = () => { if (!key) return; navigator.clipboard.writeText(key); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const handleFile = (e) => {
    const f = e.target.files?.[0] || null;
    setFile(null); reset();
    if (!f) return;
    if (!FileProcessor.isText(f)) return setError('Only .txt files are allowed.');
    setFile(f);
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); reset();
    if (!file) return setError('Please select a .txt file.');
    if (!key) return setError('Please enter a key password.');
    setProcessing(true);
    try {
      const text = await FileProcessor.readText(file);
      if (mode === 'encrypt') {
        const payload = await CryptoEngine.encrypt({ plainBytes: new TextEncoder().encode(text), password: key });
        const compact = `${payload.salt}:${payload.iv}:${payload.ciphertext}`;
        const outName = `${file.name}.encrypted.txt`;
        FileProcessor.download({ text: compact, name: outName });
        await HistoryStore.addRecord(user.email, { file: outName, action: 'Encrypt Text File', data: compact, mimeType: 'text/plain' });
        setSuccess(`Encrypted "${file.name}" and downloaded.`);
      } else {
        const parts = text.trim().split(':');
        if (parts.length < 3) throw new Error('Could not parse encrypted file. Make sure it was encrypted by this app.');
        const [salt, iv, ...rest] = parts;
        const plainBytes = await CryptoEngine.decrypt({ payload: { salt, iv, ciphertext: rest.join(':'), algorithm: 'AES-256-GCM', iterations: 250000 }, password: key });
        const plainText = new TextDecoder().decode(plainBytes);
        const outName = FileProcessor.decryptedName(file.name);
        FileProcessor.download({ text: plainText, name: outName });
        await HistoryStore.addRecord(user.email, { file: outName, action: 'Decrypt Text File', data: plainText, mimeType: 'text/plain' });
        setSuccess(`Decrypted "${file.name}" and downloaded.`);
      }
    } catch (err) {
      setError(err.message || 'Operation failed. Check your key and try again.');
    } finally { setProcessing(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <Notice type="error">{error}</Notice>}
      {success && <Notice type="success">{success}</Notice>}
      <ModeToggle value={mode} onChange={m => { setMode(m); setKey(''); setFile(null); setShowKey(false); setFileInputKey(v => v + 1); reset(); }} />
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">Text File (.txt)</label>
        <input key={fileInputKey} type="file" accept=".txt,text/plain" onChange={handleFile}
          className="w-full bg-slate-900 border border-slate-600/80 text-slate-300 rounded-lg p-3 text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-cyan-700 file:text-white file:text-xs" required />
        {file && <p className="text-slate-500 text-xs mt-1.5">Selected: {file.name}</p>}
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-slate-300">Password</label>
          <button type="button" onClick={() => { setKey(generateRandomKey()); setShowKey(false); }}
            className="flex items-center gap-1.5 text-xs font-medium text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 px-2.5 py-1 rounded-md transition-all">
            <Key size={12} /> Generate Password
          </button>
        </div>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
          <input type={showKey ? 'text' : 'password'} value={key} onChange={e => setKey(e.target.value)}
            placeholder="Enter password or generate one"
            className="w-full pl-10 pr-10 py-3 bg-slate-900 border border-slate-600/80 text-slate-200 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:outline-none text-sm" />
          <button type="button" onClick={handleCopyKey} title="Copy key" className="absolute right-9 top-1/2 -translate-y-1/2 text-slate-500 hover:text-cyan-400 transition-colors">
            {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
          </button>
          <button type="button" onClick={() => setShowKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
            {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
      </div>
      <SubmitBtn processing={processing} mode={mode} />
    </form>
  );
};

const TextAreaCryptoPanel = ({ user }) => {
  const [mode, setMode] = useState('encrypt');
  const [inputText, setInputText] = useState('');
  const [outputText, setOutputText] = useState('');
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [copied, setCopied] = useState(false);
  const handleCopyKey = () => { if (!key) return; navigator.clipboard.writeText(key); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const reset = () => { setError(''); setOutputText(''); };

  const handleSubmit = async (e) => {
    e.preventDefault(); reset();
    if (!inputText.trim()) return setError('Please enter some text.');
    if (!key) return setError('Please enter a key password.');
    setProcessing(true);
    try {
      if (mode === 'encrypt') {
        const payload = await CryptoEngine.encrypt({ plainBytes: new TextEncoder().encode(inputText), password: key });
        const compact = `${payload.salt}:${payload.iv}:${payload.ciphertext}`;
        setOutputText(compact);
        FileProcessor.download({ text: compact, name: 'encrypted_snippet.txt' });
        await HistoryStore.addRecord(user.email, { file: 'encrypted_snippet.txt', action: 'Encrypt Plain Text', data: compact, mimeType: 'text/plain' });
      } else {
        const parts = inputText.trim().split(':');
        if (parts.length < 3) throw new Error('Invalid encrypted text. Make sure it was encrypted by this app.');
        const [salt, iv, ...rest] = parts;
        const plainBytes = await CryptoEngine.decrypt({ payload: { salt, iv, ciphertext: rest.join(':'), algorithm: 'AES-256-GCM', iterations: 250000 }, password: key });
        const plainText = new TextDecoder().decode(plainBytes);
        setOutputText(plainText);
        FileProcessor.download({ text: plainText, name: 'decrypted_snippet.txt' });
        await HistoryStore.addRecord(user.email, { file: 'decrypted_snippet.txt', action: 'Decrypt Plain Text', data: plainText, mimeType: 'text/plain' });
      }
    } catch (err) {
      setError(err.message || 'Operation failed. Check your key and try again.');
    } finally { setProcessing(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <Notice type="error">{error}</Notice>}
      <ModeToggle value={mode} onChange={m => { setMode(m); setInputText(''); setKey(''); setShowKey(false); reset(); }} />
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          {mode === 'encrypt' ? 'Plaintext Input' : 'Encrypted Text Input'}
        </label>
        <textarea value={inputText} onChange={e => setInputText(e.target.value)}
          placeholder={mode === 'encrypt' ? 'Type or paste text here…' : 'Paste the encrypted text here…'}
          rows={5} className="w-full bg-slate-900 border border-slate-600/80 text-slate-200 rounded-lg p-3 text-sm focus:ring-2 focus:ring-cyan-500 focus:outline-none resize-y font-mono" required />
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-slate-300">Password</label>
          <button type="button" onClick={() => { setKey(generateRandomKey()); setShowKey(false); }}
            className="flex items-center gap-1.5 text-xs font-medium text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 px-2.5 py-1 rounded-md transition-all">
            <Key size={12} /> Generate Password
          </button>
        </div>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
          <input type={showKey ? 'text' : 'password'} value={key} onChange={e => setKey(e.target.value)}
            placeholder="Enter password or generate one"
            className="w-full pl-10 pr-10 py-3 bg-slate-900 border border-slate-600/80 text-slate-200 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:outline-none text-sm" />
          <button type="button" onClick={handleCopyKey} title="Copy key" className="absolute right-9 top-1/2 -translate-y-1/2 text-slate-500 hover:text-cyan-400 transition-colors">
            {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
          </button>
          <button type="button" onClick={() => setShowKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
            {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
      </div>
      <button type="submit" disabled={processing}
        className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white py-3 rounded-lg hover:from-cyan-500 hover:to-blue-500 font-semibold shadow-lg transition-all disabled:opacity-50 text-sm">
        {processing ? 'Processing…' : mode === 'encrypt' ? 'Encrypt Text' : 'Decrypt Text'}
      </button>
      {outputText && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-slate-300">{mode === 'encrypt' ? 'Encrypted Output' : 'Decrypted Plaintext'}</label>
            <button type="button" onClick={() => navigator.clipboard.writeText(outputText)} className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors">Copy</button>
          </div>
          <textarea readOnly value={outputText} rows={6} className="w-full bg-slate-950 border border-slate-600/60 text-emerald-300 rounded-lg p-3 text-sm font-mono resize-y" />
        </div>
      )}
    </form>
  );
};

// FIX: `user` was missing from the destructured props — history records were silently dropped.
const ImageCryptoPanel = ({ user, forcedDimension = null }) => {
  const [mode, setMode] = useState('encrypt');
  const dimension = forcedDimension || '2d';
  const [file, setFile] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [processing, setProcessing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [copied, setCopied] = useState(false);
  const reset = () => { setError(''); setSuccess(''); };
  const handleCopyKey = () => { if (!key) return; navigator.clipboard.writeText(key); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const handleFile = (e) => {
    const f = e.target.files?.[0] || null;
    setFile(null); setPreview(null); reset();
    if (!f) return;
    if (mode === 'encrypt') {
      if (dimension === '2d' && !FileProcessor.isImage(f)) return setError('Please select a 2D image file (PNG, JPEG).');
      if (dimension === '3d' && !FileProcessor.is3D(f)) return setError('Please select a 3D model file (.obj, .stl).');
    } else {
      if (dimension === '2d' && !f.name.toLowerCase().endsWith('.png')) return setError('Please select a PNG file (the encrypted output from this app).');
      // Accept any file for 3D decryption — the encrypted file keeps its original extension
    }
    setFile(f);
    if (mode === 'encrypt' && dimension === '2d') setPreview(URL.createObjectURL(f));
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); reset();
    if (!file) return setError('Please select a file.');
    if (!key) return setError('Please enter a key password.');
    setProcessing(true);
   try {
      if (mode === 'encrypt') {
        const plainBytes = new Uint8Array(await FileProcessor.readArrayBuffer(file));
        const payload = await CryptoEngine.encrypt({ plainBytes, password: key });
        
        Object.assign(payload, { 
            mimeType: file.type, 
            originalName: file.name, 
            dimension 
        });

if (dimension === '3d') {
  const jsonPayload = new TextEncoder().encode(JSON.stringify(payload));
  const distortedBlob = await FileProcessor.encodeToDistorted3D(jsonPayload, file, key);
  
  const baseName = file.name.replace(/\.[^/.]+$/, '');
  const extension = file.name.split('.').pop();
  const outName = `${baseName}.encrypted.${extension}`;
  FileProcessor.downloadBytes({ 
    bytes: new Uint8Array(await distortedBlob.arrayBuffer()), 
    name: outName, 
    mimeType: file.type || 'application/octet-stream' 
  });
  await HistoryStore.addRecord(user.email, { 
    file: outName, 
    action: 'Encrypt 3D Model', 
    mimeType: file.type || 'application/octet-stream',
    data: distortedBlob
  });
  setSuccess(`Encrypted 3D model and saved as distorted "${outName}".`);
} else {
          const jsonPayload = new TextEncoder().encode(JSON.stringify(payload));
          const pngBlob = await FileProcessor.encodeToDistortedPng(jsonPayload, file, key);
          
          const baseName = file.name.replace(/\.[^/.]+$/, '');
          const outName = `${baseName}.encrypted.png`;
          FileProcessor.downloadBytes({ 
              bytes: new Uint8Array(await pngBlob.arrayBuffer()), 
              name: outName, 
              mimeType: 'image/png' 
          });
          await HistoryStore.addRecord(user.email, { 
              file: outName, 
              action: 'Encrypt Image', 
              mimeType: 'image/png',
              data: pngBlob
          });
          setSuccess(`Encrypted and saved as PNG with hidden data.`);
        }
      } else {
        let jsonBytes;
        let payload;
        
        if (dimension === '3d') {
          // Handle distorted 3D files
          jsonBytes = await FileProcessor.decodeFromDistorted3D(file);
          // Validate and clean extracted bytes — find the JSON boundaries
          const text = new TextDecoder().decode(jsonBytes);
          const start = text.indexOf('{');
          const end = text.lastIndexOf('}');
          if (start === -1 || end === -1) throw new Error('Could not parse encrypted file. Make sure it was encrypted by this app.');
          try { payload = JSON.parse(text.slice(start, end + 1)); }
          catch { throw new Error('Could not parse encrypted file. Make sure it was encrypted by this app.'); }
        } else {
          // Handle PNG steganography for 2D images
          jsonBytes = await FileProcessor.decodeFromDistortedPng(file, key);
        }
        
        if (!payload) {
          try { payload = JSON.parse(new TextDecoder().decode(jsonBytes)); }
          catch { throw new Error('Could not parse encrypted file. Make sure it was encrypted by this app.'); }
        }
        if (payload.algorithm !== 'AES-256-GCM') throw new Error('Unsupported algorithm.');
        const plainBytes = await CryptoEngine.decrypt({ payload, password: key });
        const mimeType = payload.mimeType || (payload.dimension === '3d' ? 'application/octet-stream' : 'image/png');
        const originalName = payload.originalName || (payload.dimension === '3d' ? FileProcessor.decrypted3DName(file.name) : FileProcessor.decryptedImageName(file.name));
        FileProcessor.downloadBytes({ bytes: plainBytes, name: originalName, mimeType });
        await HistoryStore.addRecord(user.email, { file: originalName, action: `Decrypt ${payload.dimension === '3d' ? '3D Model' : 'Image'}`, mimeType, data: plainBytes });
        setSuccess(`Decrypted ${payload.dimension === '3d' ? '3D model' : 'image'} and downloaded as "${originalName}".`);
      }
    } catch (err) {
      setError(err.message || 'Operation failed.');
    } finally { setProcessing(false); }
};

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <Notice type="error">{error}</Notice>}
      {success && <Notice type="success">{success}</Notice>}
      <div className="flex flex-col gap-3">
        <ModeToggle value={mode} onChange={m => { setMode(m); setFile(null); setPreview(null); setKey(''); setShowKey(false); setFileInputKey(v => v + 1); reset(); }} />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          {mode === 'encrypt' ? (dimension === '2d' ? 'Image File (PNG, JPEG)' : '3D Model File (.obj, .stl)') : (dimension === '2d' ? 'Encrypted Image File (.png)' : 'Encrypted 3D File (any format encrypted by this app)')}
        </label>
        <input key={fileInputKey} type="file"
          accept={mode === 'encrypt' ? (dimension === '2d' ? 'image/png,image/jpeg,.png,.jpg,.jpeg' : '.obj,.stl') : (dimension === '2d' ? '.png' : '.obj,.stl,.encrypted.*,*')}
          onChange={handleFile}
          className="w-full bg-slate-900 border border-slate-600/80 text-slate-300 rounded-lg p-3 text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-cyan-700 file:text-white file:text-xs" required />
        {file && <p className="text-slate-500 text-xs mt-1.5">Selected: {file.name}</p>}
        {mode === 'encrypt' && file && (
          <div className="mt-3 rounded-lg overflow-hidden border border-slate-700 bg-slate-950 p-4 flex flex-col items-center justify-center gap-3">
            {dimension === '2d' && preview
              ? <img src={preview} alt="Preview" className="max-h-48 object-contain rounded" />
              : <div className="py-8 flex flex-col items-center gap-3">
                  <div className="w-16 h-16 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-500"><Box size={32} /></div>
                  <div className="text-center"><p className="text-sm font-medium text-slate-300">3D Model Selected</p><p className="text-xs text-slate-500">{file.name}</p></div>
                </div>
            }
          </div>
        )}
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-slate-300">Password</label>
          <button type="button" onClick={() => { setKey(generateRandomKey()); setShowKey(false); }}
            className="flex items-center gap-1.5 text-xs font-medium text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 px-2.5 py-1 rounded-md transition-all">
            <Key size={12} /> Generate Password
          </button>
        </div>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
          <input type={showKey ? 'text' : 'password'} value={key} onChange={e => setKey(e.target.value)}
            placeholder="Enter password or generate one"
            className="w-full pl-10 pr-10 py-3 bg-slate-900 border border-slate-600/80 text-slate-200 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:outline-none text-sm" />
          <button type="button" onClick={handleCopyKey} title="Copy key" className="absolute right-9 top-1/2 -translate-y-1/2 text-slate-500 hover:text-cyan-400 transition-colors">
            {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
          </button>
          <button type="button" onClick={() => setShowKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
            {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
      </div>
      <SubmitBtn processing={processing} mode={mode}
        label={`${mode === 'encrypt' ? 'Encrypt' : 'Decrypt'} ${dimension === '2d' ? 'Image' : '3D Model'} & Download`} />
    </form>
  );
};

const DatasetCryptoPanel = ({ user }) => {
  const [mode, setMode] = useState('encrypt');
  const [file, setFile] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [processing, setProcessing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [copied, setCopied] = useState(false);
  const reset = () => { setError(''); setSuccess(''); };
  const handleCopyKey = () => { if (!key) return; navigator.clipboard.writeText(key); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const parsePreview = async (f) => {
    try {
      if (FileProcessor.isXlsx(f)) {
        const wb = XLSX.read(new Uint8Array(await FileProcessor.readArrayBuffer(f)), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
        if (!rows.length) return null;
        const headers = rows[0].map(h => String(h ?? ''));
        return { headers, rows: rows.slice(1, 6).map(r => headers.map((_, ci) => String(r[ci] ?? ''))), totalRows: rows.length - 1 };
      } else {
        const lines = (await f.text()).split(/\r?\n/).filter(l => l.trim());
        if (!lines.length) return null;
        const parseRow = (row) => {
          const cells = []; let current = '', inQuotes = false;
          for (let i = 0; i < row.length; i++) {
            const ch = row[i];
            if (ch === '"') { if (inQuotes && row[i + 1] === '"') { current += '"'; i++; } else inQuotes = !inQuotes; }
            else if (ch === ',' && !inQuotes) { cells.push(current.trim()); current = ''; }
            else current += ch;
          }
          cells.push(current.trim()); return cells;
        };
        const headers = parseRow(lines[0]);
        return { headers, rows: lines.slice(1, 6).map(parseRow), totalRows: lines.length - 1 };
      }
    } catch { return null; }
  };

  const handleFile = async (e) => {
    const f = e.target.files?.[0] || null;
    setFile(null); setPreview(null); reset();
    if (!f) return;
    if (mode === 'encrypt') {
      if (!FileProcessor.isDataset(f)) return setError('Only .csv and .xlsx files are allowed.');
      setFile(f); setPreview(await parsePreview(f));
    } else {
      if (!f.name.toLowerCase().endsWith('.encrypted.csv')) return setError('Please select an .encrypted.csv file.');
      setFile(f);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); reset();
    if (!file) return setError('Please select a dataset file.');
    if (!key) return setError('Please enter a key password.');
    setProcessing(true);
    try {
      if (mode === 'encrypt') {
        const plainBytes = new Uint8Array(await FileProcessor.readArrayBuffer(file));
        const payload = await CryptoEngine.encrypt({ plainBytes, password: key });
        payload.originalName = file.name;
        payload.mimeType = file.type || (FileProcessor.isXlsx(file) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv');
        const serialized = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
        const CHUNK = 30000;
        const csvRows = [];
        for (let i = 0; i < serialized.length; i += CHUNK) csvRows.push(serialized.slice(i, i + CHUNK));
        const csvContent = csvRows.join('\n');
        const outName = `${file.name}.encrypted.csv`;
        await FileProcessor.download({ text: csvContent, name: outName, mimeType: 'text/csv;charset=utf-8' });
        await HistoryStore.addRecord(user.email, { file: outName, action: 'Encrypt Dataset', data: csvContent, mimeType: 'text/csv;charset=utf-8' });
        setSuccess(`Encrypted "${file.name}" and downloaded as .csv.`);
      } else {
        const lines = (await file.text()).split(/\r?\n/).filter(l => l.trim());
        let payloadMap;
        try { payloadMap = JSON.parse(decodeURIComponent(escape(atob(lines.join(''))))); }
        catch { throw new Error('Could not parse encrypted file. Make sure it was encrypted by this app.'); }
        if (!payloadMap.ciphertext || !payloadMap.salt || !payloadMap.iv) throw new Error('Could not parse encrypted file. Make sure it was encrypted by this app.');
        if (payloadMap.algorithm !== 'AES-256-GCM') throw new Error('Unsupported algorithm.');
        const plainBytes = await CryptoEngine.decrypt({ payload: { ...payloadMap, iterations: Number(payloadMap.iterations) || 250000 }, password: key });
        const mimeType = payloadMap.mimeType || 'text/csv';
        const originalName = FileProcessor.decryptedDatasetName(file.name, payloadMap.originalName);
        await FileProcessor.downloadBytes({ bytes: plainBytes, name: originalName, mimeType });
        await HistoryStore.addRecord(user.email, { file: originalName, action: 'Decrypt Dataset', data: toB64(plainBytes.buffer), isBase64: true, mimeType });
        setSuccess(`Decrypted and downloaded as "${originalName}".`);
      }
    } catch (err) {
      setError(err.message || 'Operation failed. Check your key and try again.');
    } finally { setProcessing(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <Notice type="error">{error}</Notice>}
      {success && <Notice type="success">{success}</Notice>}
      <ModeToggle value={mode} onChange={m => { setMode(m); setFile(null); setPreview(null); setKey(''); setShowKey(false); setFileInputKey(v => v + 1); reset(); }} />
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          {mode === 'encrypt' ? 'Dataset File (.csv, .xlsx)' : 'Encrypted Dataset File (.encrypted.csv)'}
        </label>
        <input key={fileInputKey} type="file"
          accept={mode === 'encrypt' ? '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : '.csv,.encrypted.csv'}
          onChange={handleFile}
          className="w-full bg-slate-900 border border-slate-600/80 text-slate-300 rounded-lg p-3 text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-cyan-700 file:text-white file:text-xs" required />
        {file && <p className="text-slate-500 text-xs mt-1.5">Selected: {file.name}</p>}
      </div>
      {preview && (
        <div className="rounded-lg border border-slate-600/60 overflow-hidden">
          <div className="bg-slate-900/80 px-3 py-2 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Dataset Preview</span>
            <span className="text-xs text-slate-500">{preview.totalRows} row{preview.totalRows !== 1 ? 's' : ''} total{preview.rows.length < preview.totalRows ? `, showing first ${preview.rows.length}` : ''}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800">
                  {preview.headers.map((h, i) => (
                    <th key={i} className="px-3 py-2 text-left text-cyan-400 font-semibold border-b border-slate-700 whitespace-nowrap">{h || `Col ${i + 1}`}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? 'bg-slate-900/40' : 'bg-slate-900/70'}>
                    {preview.headers.map((_, ci) => (
                      <td key={ci} className="px-3 py-1.5 text-slate-300 border-b border-slate-800/60 whitespace-nowrap max-w-[200px] truncate">{row[ci] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-slate-300">Password</label>
          <button type="button" onClick={() => { setKey(generateRandomKey()); setShowKey(false); }}
            className="flex items-center gap-1.5 text-xs font-medium text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 px-2.5 py-1 rounded-md transition-all">
            <Key size={12} /> Generate Password
          </button>
        </div>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
          <input type={showKey ? 'text' : 'password'} value={key} onChange={e => setKey(e.target.value)}
            placeholder="Enter password or generate one"
            className="w-full pl-10 pr-10 py-3 bg-slate-900 border border-slate-600/80 text-slate-200 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:outline-none text-sm" />
          <button type="button" onClick={handleCopyKey} title="Copy key" className="absolute right-9 top-1/2 -translate-y-1/2 text-slate-500 hover:text-cyan-400 transition-colors">
            {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
          </button>
          <button type="button" onClick={() => setShowKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
            {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
      </div>
      <SubmitBtn processing={processing} mode={mode} label={mode === 'encrypt' ? 'Encrypt Dataset & Download' : 'Decrypt Dataset & Download'} />
    </form>
  );
};

// ─── Auth Screen ──────────────────────────────────────────────────────────────

const AuthScreen = ({ onLogin }) => {
  const [authMode, setAuthMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '', historyPin: '' });
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault(); setError(''); setSuccess('');
    setLoading(true);
    try {
      let user;
      if (authMode === 'login') {
        const firebaseUser = await loginWithEmail(form.email, form.password);
        user = { email: firebaseUser.email, name: firebaseUser.displayName || firebaseUser.email.split('@')[0], historyPin: '' };
      } else {
        const firebaseUser = await registerWithEmail(form.name, form.email, form.password);
        user = { email: firebaseUser.email, name: form.name, historyPin: form.historyPin };
      }
      accountManager.persistSession({ user }); 
      onLogin(user);
    } catch (err) { 
      setError(err.message); 
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError(''); setSuccess('');
    if (!form.email) return setError('Please enter your email address first.');
    setLoading(true);
    try {
      await resetPassword(form.email);
      setSuccess('Password reset link sent to your email!');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(''); setSuccess('');
    setLoading(true);
    try {
      const { user, accessToken } = await googleSignIn();
      const updatedUser = { ...user, googleAccessToken: accessToken };
      accountManager.persistSession({ user: updatedUser });
      onLogin(updatedUser);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const field = (key, label, type, icon, placeholder, extra = {}) => (
    <div>
      <label className="block text-sm font-medium text-slate-300 mb-2">{label}</label>
      <div className="relative">
        {icon}
        <input type={type} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}
          placeholder={placeholder}
          className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-600 text-slate-200 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:outline-none text-sm" {...extra} />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="bg-gradient-to-b from-slate-800 to-slate-900 rounded-2xl shadow-2xl border border-slate-700/80 p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl mb-4 shadow-lg shadow-cyan-900/50">
              <Shield className="text-white" size={30} />
            </div>
            <h1 className="text-3xl font-bold text-white mb-1">CipherVault</h1>
            <p className="text-slate-400 text-sm">AES-256 Encryption System</p>
          </div>
          <div className="flex gap-2 mb-6">
            {['login', 'signup'].map(m => (
              <button key={m} type="button" onClick={() => { setAuthMode(m); setError(''); }}
                className={`flex-1 py-2.5 rounded-lg font-semibold capitalize text-sm transition-all ${authMode === m ? 'bg-cyan-600 text-white shadow-md shadow-cyan-900' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
                {m === 'login' ? 'Login' : 'Sign Up'}
              </button>
            ))}
          </div>
          {error && <Notice type="error">{error}</Notice>}
          {success && <Notice type="success">{success}</Notice>}
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            {authMode === 'signup' && field('name', 'Full Name', 'text', <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />, 'Enter your name', { required: true })}
            {field('email', 'Email', 'email', <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />, 'Enter email', { required: true })}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input type={showPwd ? 'text' : 'password'} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                  placeholder="Enter password"
                  className="w-full pl-10 pr-12 py-3 bg-slate-900 border border-slate-600 text-slate-200 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:outline-none text-sm" required />
                <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {authMode === 'login' && (
                <div className="flex justify-end mt-1.5">
                  <button type="button" onClick={handleForgotPassword} className="text-xs text-cyan-500 hover:text-cyan-400 font-semibold transition-colors">
                    Forgot Password?
                  </button>
                </div>
              )}
            </div>
            {authMode === 'signup' && (
              <div className="pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-slate-300">History PIN (Optional)</label>
                  <span className="text-[10px] text-cyan-500 uppercase tracking-wider font-bold">Privacy Layer</span>
                </div>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input type="password" maxLength={6} value={form.historyPin || ''}
                    onChange={e => setForm({ ...form, historyPin: e.target.value.replace(/\D/g, '') })}
                    placeholder="Set 4-6 digit history PIN"
                    className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-600 text-cyan-400 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:outline-none text-sm font-mono" />
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5 italic">Leave empty to access history directly without a PIN.</p>
              </div>
            )}
            <button type="submit" disabled={loading}
              className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 text-white py-3 rounded-lg hover:from-cyan-500 hover:to-blue-500 font-semibold shadow-lg transition-all text-sm mt-2 disabled:opacity-50">
              {loading ? 'Processing...' : (authMode === 'login' ? 'Login' : 'Create Account')}
            </button>
            <div className="relative flex items-center justify-center mt-6">
              <div className="border-t border-slate-700 w-full absolute"></div>
              <span className="bg-slate-800/80 px-4 text-xs text-slate-400 relative z-10">OR</span>
            </div>
            
            <button type="button" onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-3 bg-white text-gray-800 py-3 rounded-lg hover:bg-gray-100 font-semibold shadow-lg transition-all text-sm mt-4 border border-gray-200">
              <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </button>
          </form>
          <p className="mt-6 text-center text-xs text-slate-500">MTI University — Secure Multi-Dimensional Encryption</p>
        </div>
      </div>
    </div>
  );
};

// ─── Change Password Modal ────────────────────────────────────────────────────

const ChangePasswordModal = ({ user, onClose }) => {
  const [form, setForm] = useState({ oldPassword: '', newPassword: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault(); setError(''); setSuccess('');
    if (!form.oldPassword || !form.newPassword) return setError('Please fill in both fields.');
    try {
      accountManager.changePassword({ email: user.email, oldPassword: form.oldPassword, newPassword: form.newPassword });
      setSuccess('Password updated successfully!');
      setTimeout(onClose, 1800);
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><Key size={20} className="text-cyan-400" />Change Password</h2>
        {error && <Notice type="error">{error}</Notice>}
        {success && <Notice type="success">{success}</Notice>}
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {['oldPassword', 'newPassword'].map(field => (
            <div key={field}>
              <label className="block text-sm font-medium text-slate-300 mb-2">{field === 'oldPassword' ? 'Old Password' : 'New Password'}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
                <input type="password" value={form[field]} onChange={e => setForm({ ...form, [field]: e.target.value })}
                  placeholder={field === 'oldPassword' ? 'Enter old password' : 'Enter new password'}
                  className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-600 text-slate-200 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:outline-none text-sm" required />
              </div>
            </div>
          ))}
          <div className="flex gap-3 pt-1">
            <button type="submit" className="flex-1 bg-gradient-to-r from-cyan-600 to-blue-600 text-white py-3 rounded-lg hover:from-cyan-500 font-semibold transition-all text-sm">Update Password</button>
            <button type="button" onClick={onClose} className="px-5 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 font-semibold transition-all text-sm">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── History Lock ─────────────────────────────────────────────────────────────

const HistoryLock = ({ user, onUnlock }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (pin === user.historyPin) { onUnlock(); }
    else { setError('Incorrect PIN. Please try again.'); setPin(''); }
  };

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 animate-in fade-in zoom-in duration-300">
      <div className="w-16 h-16 bg-cyan-500/10 rounded-full flex items-center justify-center text-cyan-500 mb-6 shadow-xl shadow-cyan-900/20"><Lock size={32} /></div>
      <h2 className="text-xl font-bold text-white mb-2">History Locked</h2>
      <p className="text-slate-400 text-sm mb-8 text-center max-w-xs">This section is protected by a dedicated PIN. Please enter it to view your activity log.</p>
      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-4">
        {error && <Notice type="error">{error}</Notice>}
        <div className="relative">
          <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          <input type="password" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="Enter History PIN"
            className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-700 text-cyan-400 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:outline-none text-center text-lg font-mono tracking-[0.5em]"
            autoFocus required />
        </div>
        <button type="submit" className="w-full bg-cyan-600 hover:bg-cyan-500 text-white py-3 rounded-lg font-semibold shadow-lg transition-all">Unlock History</button>
      </form>
    </div>
  );
};

// ─── Main App ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'file', label: 'Text Files', icon: FileText },
  { id: 'textarea', label: 'Plain Text', icon: Type },
  { id: 'image', label: '2D Images', icon: Image },
  { id: 'model', label: '3D Models', icon: Box },
  { id: 'dataset', label: 'Datasets', icon: Database },
];

const TAB_DESCRIPTIONS = {
  file: 'Encrypt or decrypt .txt files. Supports all characters including colons, semicolons, and special symbols.',
  textarea: 'Encrypt or decrypt any text directly in the browser. Copy the JSON output to decrypt later.',
  image: 'Encrypt or decrypt 2D image files (PNG, JPEG).',
  model: 'Encrypt or decrypt 3D model files (.obj, .stl) with visual distortion.',
  dataset: 'Encrypt or decrypt dataset files (.csv, .xlsx). Preview your data before encrypting.',
  history: 'View a timeline of all your encryption and decryption activities.',
};

const TAB_TITLES = { file: 'Text File Encryption', textarea: 'Plain Text Encryption', image: '2D Image Encryption', model: '3D Model Encryption', dataset: 'Dataset Encryption', history: 'Activity History' };

const EncryptionSystem = () => {
  const [user, setUser] = useState(null);
  const [isAuth, setIsAuth] = useState(false);
  const [activeTab, setActiveTab] = useState('file');
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [historyUnlocked, setHistoryUnlocked] = useState(false);

useEffect(() => {
  // onAuthStateChanged fires once immediately with the current auth state,
  // then again whenever the user signs in or out. We wait for this before
  // trusting anything in localStorage, so auth.currentUser is never null
  // when Firestore queries run.
  const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
    if (firebaseUser) {
      // Firebase session is alive — safe to restore app-level session
      const s = accountManager.getSession();
      if (s) {
        setUser(s);
        setIsAuth(true);
      } else {
        // Firebase knows the user but we have no local session (e.g. after
        // clearing localStorage manually). Build a minimal session from
        // the Firebase user so history still works.
        const fallback = {
          email: firebaseUser.email,
          name: firebaseUser.displayName || firebaseUser.email.split('@')[0],
          historyPin: ''
        };
        accountManager.persistSession({ user: fallback });
        setUser(fallback);
        setIsAuth(true);
      }
    } else {
      // Firebase says no active session — clear everything
      accountManager.clearSession();
      setUser(null);
      setIsAuth(false);
    }
  });
 
  return () => unsubscribe(); // clean up listener on unmount
}, []);
  const handleLogin = (u) => { setUser(u); setIsAuth(true); setHistoryUnlocked(false); };
  const handleLogout = () => { accountManager.clearSession(); setUser(null); setIsAuth(false); setHistoryUnlocked(false); };

  if (!isAuth) return <AuthScreen onLogin={handleLogin} />;

  const ActiveIcon = TABS.find(t => t.id === activeTab)?.icon;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 p-4">
      {showChangePwd && <ChangePasswordModal user={user} onClose={() => setShowChangePwd(false)} />}
      <div className="max-w-3xl mx-auto">
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-xl border border-slate-700/80 p-4 mb-4 shadow-2xl">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center shadow shadow-cyan-900/50">
                <Shield size={20} className="text-white" />
              </div>
              <h1 className="text-lg font-bold text-white leading-tight">CipherVault</h1>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-right hidden sm:block mr-1">
                <div className="text-sm text-slate-300 font-medium">{user.name}</div>
                <div className="text-xs text-slate-500">{user.email}</div>
              </div>
              <button onClick={() => setActiveTab('history')}
                className={`flex items-center gap-1.5 px-3 py-2 ${activeTab === 'history' ? 'bg-cyan-600 shadow-md shadow-cyan-900/50 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'} rounded-lg text-xs font-medium transition-all`}>
                <Clock size={13} /><span className="hidden sm:inline">History</span>
              </button>
              <button onClick={() => setShowChangePwd(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-medium transition-colors">
                <Key size={13} /><span className="hidden sm:inline">Change Password</span>
              </button>
              <button onClick={handleLogout}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-xs font-medium transition-colors">
                <LogOut size={13} />Logout
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          {TABS.map(tab => (
            <TabBtn key={tab.id} active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} icon={tab.icon}>{tab.label}</TabBtn>
          ))}
        </div>

        <div className="bg-slate-800 rounded-xl border border-slate-700/80 p-6 shadow-xl">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              {ActiveIcon && <ActiveIcon size={18} className="text-cyan-400" />}
              {TAB_TITLES[activeTab]}
            </h2>
            <p className="text-slate-400 text-xs mt-1">{TAB_DESCRIPTIONS[activeTab]}</p>
          </div>
          {activeTab === 'file' && <TextFileCryptoPanel user={user} />}
          {activeTab === 'textarea' && <TextAreaCryptoPanel user={user} />}
          {activeTab === 'image' && <ImageCryptoPanel user={user} forcedDimension="2d" />}
          {activeTab === 'model' && <ImageCryptoPanel user={user} forcedDimension="3d" />}
          {activeTab === 'dataset' && <DatasetCryptoPanel user={user} />}
          {activeTab === 'history' && (
            user.historyPin && !historyUnlocked
              ? <HistoryLock user={user} onUnlock={() => setHistoryUnlocked(true)} />
              : <HistoryPanel user={user} HistoryStore={HistoryStore} FileProcessor={FileProcessor} fromB64={fromB64} />
          )}
        </div>
        <p className="text-center text-xs text-slate-600 mt-4">MTI University · Dimensional Data Encryption System</p>
      </div>
    </div>
  );
};

export default EncryptionSystem;