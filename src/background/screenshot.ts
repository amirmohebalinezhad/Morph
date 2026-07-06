// Captures the visible tab and downscales it for AI context. Runs in the
// service worker (OffscreenCanvas — no DOM needed).

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function captureAndScaleViewport(
  windowId: number,
  maxWidth: number,
  quality: number,
): Promise<string> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: 'jpeg',
    quality: Math.round(Math.min(1, Math.max(0.1, quality)) * 100),
  });

  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width <= maxWidth) {
      // Already small enough — return as-is (strip the data: prefix).
      return dataUrl.slice(dataUrl.indexOf(',') + 1);
    }
    const scale = maxWidth / bitmap.width;
    const canvas = new OffscreenCanvas(maxWidth, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const scaled = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    return toBase64(await scaled.arrayBuffer());
  } finally {
    bitmap.close();
  }
}
