import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

const encoder = new TextEncoder()

/** Synchronous UTF-8 SHA-256, including on LAN HTTP where SubtleCrypto is unavailable. */
export function sha256Hex(value: string): string {
  // Preserve the previous encoder's rejection of malformed UTF-16 rather than replacing it.
  encodeURIComponent(value)
  return bytesToHex(sha256(encoder.encode(value)))
}
