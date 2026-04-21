/**
 * Hashing helpers (Web Crypto).
 *
 * Spec v1.0 §7: cada archivo HTML capturado lleva un SHA-256 en metadata.json
 * para dar integridad al corpus exportado. También se usa un hash para
 * construir `patient.documentHash` (truncado) cuando el usuario provee su
 * nombre — evita exponer el documento real si lo configura.
 */

/** Devuelve el SHA-256 hex-lowercase del string UTF-8 dado. */
export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

/** SHA-256 sobre un ArrayBuffer / Uint8Array arbitrario. */
export async function sha256HexBytes(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  let data: ArrayBuffer;
  if (bytes instanceof Uint8Array) {
    // Copiamos a un ArrayBuffer fresco para evitar la variante SharedArrayBuffer
    // que rechaza crypto.subtle.digest en su tipado.
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    data = copy.buffer;
  } else {
    data = bytes;
  }
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}
