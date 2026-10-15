"use client";

import type { MediaItem } from "@/lib/game/types";

export function MediaGallery({ media }: { media?: MediaItem[] }) {
  if (!media?.length) return null;
  return (
    <section className="media-gallery" aria-label="现场资料">
      {media.map((item) =>
        item.kind === "image" ? (
          <figure key={item.id} className="media-card media-card--image">
            <a href={item.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.url} alt={item.title} className="media-image" loading="lazy" />
            </a>
            <figcaption>
              <strong>{item.title}</strong>
              {item.description ? <span>{item.description}</span> : null}
            </figcaption>
          </figure>
        ) : (
          <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="media-card media-card--document">
            <span className="media-doc-icon">▤</span>
            <span className="min-w-0">
              <strong className="block truncate">{item.title}</strong>
              {item.description ? <span className="mt-0.5 block text-[11px] text-[var(--muted)]">{item.description}</span> : null}
              <span className="mt-1 block text-[11px] font-semibold text-[var(--accent-deep)]">打开资料 →</span>
            </span>
          </a>
        ),
      )}
    </section>
  );
}

export function MediaEditor({
  media,
  onChange,
}: {
  media?: MediaItem[];
  onChange: (media: MediaItem[]) => void;
}) {
  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const additions: MediaItem[] = [];
    for (const file of Array.from(files).slice(0, 8)) {
      const isImage = file.type.startsWith("image/");
      const isDocument = file.type === "application/pdf" ||
        /\\.(doc|docx|ppt|pptx)$/i.test(file.name);
      if (!isImage && !isDocument) continue;
      // Photos are resized and JPEG-compressed before embedding in the game pack.
      // This keeps real location photos while reducing the chance of unshareable URLs.
      const prepared = isImage ? await prepareImage(file) : file;
      const data = await readAsDataUrl(prepared);
      additions.push({
        id: `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        kind: isImage ? "image" : "document",
        title: file.name,
        url: data,
        mimeType: prepared.type || file.type || "application/octet-stream",
      });
    }
    if (additions.length) onChange([...(media ?? []), ...additions]);
  };

  return (
    <div className="mt-4 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[12px] font-bold">图片与资料</p>
          <p className="text-[10.5px] text-[var(--muted)]">图片、PDF、Word、PowerPoint 可作为这一站的现场资料。</p>
        </div>
        <label className="btn btn-secondary min-h-9 cursor-pointer px-3 text-[12px]">
          添加文件
          <input className="sr-only" type="file" multiple accept="image/*,.pdf,.doc,.docx,.ppt,.pptx" onChange={(e) => { void addFiles(e.target.files); e.currentTarget.value = ""; }} />
        </label>
      </div>
      {media?.length ? (
        <div className="mt-3 space-y-2">
          {media.map((item) => (
            <div key={item.id} className="flex items-center gap-2 rounded-xl bg-[var(--card)] px-2.5 py-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-[var(--surface)]">
                {item.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt="" className="h-full w-full object-cover" />
                ) : "▤"}
              </span>
              <input className="input !min-h-9 !py-1.5 text-[13px]" value={item.title} onChange={(e) => onChange(media.map((m) => m.id === item.id ? { ...m, title: e.target.value } : m))} />
              <button type="button" className="btn btn-ghost min-h-9 shrink-0 px-2 text-[12px]" onClick={() => onChange(media.filter((m) => m.id !== item.id))}>删除</button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Resize photos to a mobile-friendly maximum edge and JPEG quality. */
async function prepareImage(file: File): Promise<Blob> {
  const MAX_EDGE = 1600;
  const QUALITY = 0.8;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }
    // JPEG has no transparency; use a white background for predictable results.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const compressed = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    const wasResized = scale < 1;
    return compressed && (wasResized || compressed.size < file.size) ? compressed : file;
  } catch {
    // Unsupported formats or browser limitations: keep the original photo.
    return file;
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}
