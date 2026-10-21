/**
 * QR code capacity & density planning for self-contained share URLs.
 *
 * qrcode.react 4.x embeds Project Nayuki's QR-Code-generator. The encoder
 * picks the smallest QR version (1-40) whose data capacity fits the payload;
 * with level "L" requested and boostEcl enabled it may quietly raise the ECC
 * level, but the VERSION choice always uses the level-L capacity, so planning
 * against L is exact.
 *
 * The formulas and constant tables below replicate that encoder's capacity
 * arithmetic (ISO/IEC 18004 standard data) so the UI can explain a rejection
 * with the real version number and module density instead of guessing from
 * character counts.
 *
 * Why a density gate at all: every encodable URL fits version 40, but a
 * version-40 code has 177x177 modules. On a ~320 CSS px wide card that is
 * ~1.6 px per module (~0.35 mm) - the canvas "renders fine" while no phone
 * camera can reliably scan it. A QR that looks successful but never scans is
 * worse than an honest "too dense" message, so we refuse to render codes that
 * fall below the minimum module size and explain why.
 *
 * Byte-length assumption: a share URL is `origin + "/select#hunt=g." +
 * base64url` - every character is ASCII, so 1 char = 1 byte and QR byte-mode
 * capacity applies directly.
 */

/**
 * ECC codewords per block, level L, indexed by version 0-40 (index 0 unused).
 * NOTE: in the bundled encoder the `ordinal` 0 is LOW, so level-L data is the
 * FIRST row of its ECC_CODEWORDS_PER_BLOCK / NUM_ERROR_CORRECTION_BLOCKS
 * tables (the `// Low` comment sits below its row in that source).
 */
const ECC_CODEWORDS_PER_BLOCK_L = [
  -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30,
  26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
] as const;

/** Number of ECC blocks, level L, indexed by version 0-40 (index 0 unused). */
const NUM_ECC_BLOCKS_L = [
  -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14,
  15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
] as const;

export const QR_MIN_VERSION = 1;
export const QR_MAX_VERSION = 40;

/** Total data codewords (bytes, before mode/count overhead) for a version at level L. */
export function numDataCodewordsL(version: number): number {
  if (version < QR_MIN_VERSION || version > QR_MAX_VERSION) throw new RangeError("version out of range");
  // Same arithmetic as Nayuki's getNumRawDataModules:
  let rawModules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    rawModules -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) rawModules -= 36;
  }
  const rawCodewords = Math.floor(rawModules / 8);
  return rawCodewords - ECC_CODEWORDS_PER_BLOCK_L[version] * NUM_ECC_BLOCKS_L[version];
}

/** Character-count bits for byte mode at a given version (QR spec). */
function byteModeCountBits(version: number): number {
  return version < 10 ? 8 : 16;
}

/**
 * Smallest QR version (1-40) that can carry `byteLength` payload bytes in byte
 * mode at level L, or null when nothing up to version 40 fits.
 */
export function qrVersionForBytes(byteLength: number): number | null {
  for (let version = QR_MIN_VERSION; version <= QR_MAX_VERSION; version++) {
    const capacityBits = numDataCodewordsL(version) * 8;
    // Byte segment overhead: 4-bit mode marker + character-count field + payload.
    const neededBits = 4 + byteModeCountBits(version) + byteLength * 8;
    if (neededBits <= capacityBits) return version;
  }
  return null;
}

/** Assumed on-screen width of the QR in CSS px, matching the design card's max width. */
export const QR_ASSUMED_DISPLAY_PX = 320;
/** Minimum rendered module size (CSS px) for a phone camera to scan reliably. */
export const QR_MIN_MODULE_PX = 2.5;
/** Quiet-zone margin passed to the renderer, in modules per side. */
export const QR_MARGIN_MODULES = 2;

export type QrPlan =
  | { ok: true; version: number; modulePx: number; url: string }
  | { ok: false; reason: string; url: string };

/**
 * Decide whether a share URL can become a *scannable* QR code, and why not
 * when it cannot. The returned plan carries the exact URL back so the renderer
 * encodes precisely the full share URL - never a truncated or home-page
 * substitute.
 */
export function planQrForUrl(url: string): QrPlan {
  const byteLength = url.length;
  const version = qrVersionForBytes(byteLength);
  if (version === null) {
    return {
      ok: false,
      url,
      reason:
        "分享链接已超出二维码的编码容量上限（2953 字节），无法生成二维码。请直接复制链接发送给朋友。",
    };
  }
  // Total module grid including the quiet-zone margin on both sides.
  const gridModules = 17 + 4 * version + 2 * QR_MARGIN_MODULES;
  const modulePx = QR_ASSUMED_DISPLAY_PX / gridModules;
  if (modulePx < QR_MIN_MODULE_PX) {
    return {
      ok: false,
      url,
      reason: `这款游戏的分享链接较长（约 ${byteLength} 字符），对应的二维码需要 version ${version}（${gridModules}×${gridModules} 模块），在手机屏幕上每个模块只有约 ${modulePx.toFixed(1)}px，另一台手机很难稳定扫描，因此暂不生成。请复制链接发送；也可以精简游戏的故事、题目等文字后重新发布，链接变短后即可生成二维码。`,
    };
  }
  return { ok: true, version, modulePx, url };
}
