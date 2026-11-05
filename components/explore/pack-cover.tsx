import type { ExploreCategorySlug } from "@/lib/explore/taxonomy";
import { categoryBySlug } from "@/lib/explore/taxonomy";

/**
 * Branded cover for a pack.
 *
 * There is no cover image field in the pack schema and the product rule is
 * explicit: a stock photo must never stand in for a real place. So the cover is
 * a typographic plate — deep teal, the category glyph, the pack's own first
 * character as a watermark — that looks intentional rather than broken, and
 * tells the three categories apart at a glance.
 */

export function PackCover({
  category,
  title,
  size = "card",
  badge,
}: {
  category: ExploreCategorySlug | null;
  title: string;
  size?: "card" | "hero";
  badge?: string | null;
}) {
  const meta = categoryBySlug(category);
  const glyph = meta?.glyph ?? "◇";
  const accent = meta?.accentVar ?? "var(--hero-gold)";
  const watermark = title.trim().slice(0, 1);

  return (
    <div
      className={`relative overflow-hidden ${size === "hero" ? "h-[188px] rounded-2xl" : "h-[112px] rounded-t-2xl"} bg-[var(--hero-teal)]`}
      style={{
        backgroundImage:
          "radial-gradient(120% 120% at 12% 0%, var(--hero-teal-mid) 0%, var(--hero-teal) 62%)",
      }}
      aria-hidden
    >
      <span
        className="absolute -right-3 -top-6 select-none text-[132px] font-black leading-none opacity-[0.13]"
        style={{ color: accent }}
      >
        {watermark}
      </span>
      <span
        className={`absolute ${size === "hero" ? "left-5 top-5 text-[38px]" : "left-4 top-3 text-[24px]"} leading-none`}
        style={{ color: accent }}
      >
        {glyph}
      </span>
      {badge ? (
        <span className="absolute bottom-3 left-4 rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-[12px] font-semibold text-white backdrop-blur">
          {badge}
        </span>
      ) : null}
    </div>
  );
}
