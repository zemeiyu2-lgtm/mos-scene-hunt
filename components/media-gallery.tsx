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
      if (!file.type.startsWith("image/") && file.type !== "application/pdf" &&
          !file.name.endsWith(".doc") && !file.name.endsWith(".docx") &&
          !file.name.endsWith(".ppt") && !file.name.endsWith(".pptx")) continue;
      const data = await readAsDataUrl(file);
      additions.push({
        id: `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        kind: file.type.startsWith("image/") ? "image" : "document",
        title: file.name,
        url: data,
        mimeType: file.type || "application/octet-stream",
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

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}
