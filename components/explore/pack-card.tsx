import Link from "next/link";
import { PackCover } from "./pack-cover";
import { categoryBySlug } from "@/lib/explore/taxonomy";
import { areaLabel, difficultyLabel, durationLabel, type ExplorePack } from "@/lib/explore/summary";
import { packHref } from "@/lib/explore/client";

/**
 * One pack, as a discovery card.
 *
 * The whole card is the link: on a phone the target is the card, not a small
 * button. Facts come from the pack (duration, difficulty, station count); the
 * editorial layer only adds the category chip and the tags.
 *
 * Slots with no real data are omitted rather than filled — a card without a
 * duration looks slightly emptier, which is honest, while a card with a made-up
 * "30 分钟" would be a lie the player discovers at the trailhead.
 */
export function PackCard({ pack, showCategory = true }: { pack: ExplorePack; showCategory?: boolean }) {
  const category = categoryBySlug(pack.category);
  const meta = [
    pack.place,
    durationLabel(pack.minutes),
    difficultyLabel(pack.difficulty),
    areaLabel(pack.areaMeters),
  ].filter((item): item is string => Boolean(item));

  return (
    <Link
      href={packHref(pack.gameId)}
      className="card block overflow-hidden p-0 transition-shadow hover:shadow-card"
      aria-label={`${pack.title}，查看详情`}
    >
      <PackCover
        category={pack.category}
        title={pack.title}
        badge={`${pack.sceneCount} 个站点`}
      />
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {showCategory && category ? (
            <span className="chip" style={{ color: category.accentVar, borderColor: "var(--line)" }}>
              {category.label}
            </span>
          ) : null}
          {pack.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="chip bg-[var(--surface)] text-[var(--muted)]">
              {tag}
            </span>
          ))}
        </div>
        <h3 className="mt-2 text-[16px] font-bold leading-snug">{pack.title}</h3>
        {pack.tagline ? (
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">{pack.tagline}</p>
        ) : null}
        {meta.length > 0 ? (
          <p className="mt-2 text-[12px] text-[var(--muted)]">{meta.join(" · ")}</p>
        ) : null}
        {pack.audience ? <p className="mt-1 text-[12px] text-[var(--muted)]">{pack.audience}</p> : null}
        <span className="mt-3 inline-block text-[13px] font-semibold text-[var(--accent-deep)]">
          查看探索 →
        </span>
      </div>
    </Link>
  );
}
