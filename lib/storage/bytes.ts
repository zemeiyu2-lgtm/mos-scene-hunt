/**
 * Byte accounting for browser-local storage.
 *
 * `localStorage` is measured in UTF-16 code units by `String.length`, but the
 * browser charges its quota (and Safari *kills* the whole origin's storage at
 * a fixed byte budget) in UTF-8 bytes. A Chinese game title is 3 bytes per
 * character, so `length * 2` is wrong in both directions depending on the
 * text: we measure honestly.
 *
 * Everything here is pure and safe on both server and client.
 */

/** UTF-8 byte length of a string, without allocating a Blob when avoidable. */
export function utf8ByteLength(text: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).length;
  }
  // Fallback for environments without TextEncoder (very old WebViews).
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair: one 4-byte code point, skip the low surrogate.
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Human-readable size. Deliberately shows two decimals for MB: the difference
 * between "4.98 MB" and "5.00 MB" is exactly the difference between "saved"
 * and "quota exceeded", so rounding to one decimal would hide the story.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
