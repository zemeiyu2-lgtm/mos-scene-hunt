"use client";

/**
 * MOSRove 首页 V2.0 主体（手机优先，桌面自适应）。
 *
 * 视觉：菲律宾真实摄影 + 森林绿 / 自然米白 / 暖金色体系。
 * 辅助图形：探索轨迹（虚线）与定位符号，来自地图与 GPS 的品牌母题。
 *
 * 交互纪律：
 * - 主 CTA、游戏中心 / 创作中心入口、安全提示全部沿用既有路由与文案行为；
 *   游戏恢复 / 进度状态由 HuntProvider 提供，本组件只做呈现。
 * - 不引入任何虚构数据：精选探索包来自 content/*.json 的真实公开内容。
 */

import Link from "next/link";
import { SoundToggle } from "@/components/sound";
import { LocaleToggle, useHomeLocale } from "@/components/home/home-locale";
import { DIFFICULTY_LABEL, FEATURED_PACKS } from "@/lib/home-copy";

/* ------------------------------------------------------------------ */
/* 品牌辅助图形                                                        */
/* ------------------------------------------------------------------ */

/** 探索轨迹：一条虚线轨迹 + 两枚定位点，品牌导航与区块共用的小母题。 */
function RouteMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3 19 C 12 19, 14 8, 24 8 S 36 12, 44 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="1 4"
      />
      <circle cx="3" cy="19" r="2.6" fill="currentColor" />
      <path d="M44 1.5 a4.5 4.5 0 0 1 4.5 4.5 c0 3.2 -4.5 8 -4.5 8 s-4.5 -4.8 -4.5 -8 A4.5 4.5 0 0 1 44 1.5 Z M44 4.4 a1.6 1.6 0 1 0 0 3.2 a1.6 1.6 0 0 0 0 -3.2 Z" fill="currentColor" fillRule="evenodd" transform="translate(-2 0)" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="home-ico">
      <path d="M12 2a7 7 0 0 1 7 7c0 3.4-3.6 8.1-6.3 11a1 1 0 0 1-1.4 0C8.6 17.1 5 12.4 5 9a7 7 0 0 1 7-7Zm0 4.4A2.6 2.6 0 1 0 12 11.6 2.6 2.6 0 0 0 12 6.4Z" fill="currentColor" />
    </svg>
  );
}

function CompassIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="home-ico">
      <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm3.5 4.5-2.2 5.3-5.3 2.2 2.2-5.3 5.3-2.2Z" fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="home-ico">
      <path d="M12 2 4.5 5v6c0 5 3.2 8.6 7.5 11 4.3-2.4 7.5-6 7.5-11V5L12 2Zm0 2.2 5.5 2.2v4.6c0 3.9-2.3 6.8-5.5 8.9-3.2-2.1-5.5-5-5.5-8.9V6.4L12 4.2Z" fill="currentColor" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="home-ico">
      <path d="M12 2a5 5 0 0 1 5 5v2h1.2A1.8 1.8 0 0 1 20 10.8v9.4A1.8 1.8 0 0 1 18.2 22H5.8A1.8 1.8 0 0 1 4 20.2v-9.4A1.8 1.8 0 0 1 5.8 9H7V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v2h6V7a3 3 0 0 0-3-3Zm0 9a2 2 0 0 0-1 3.7V19h2v-2.3a2 2 0 0 0-1-3.7Z" fill="currentColor" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 响应式图片                                                          */
/* ------------------------------------------------------------------ */

/**
 * 本地生成的多尺寸 JPEG/WebP（见 public/home/）。项目关闭了 next/image
 * 优化（next.config.ts images.unoptimized），因此直接用 <picture> + srcset
 * 完成响应式加载，浏览器按视口选最合适的尺寸。
 */
function HomePicture({
  name,
  alt,
  sizes,
  priority = false,
  className = "",
}: {
  name: string;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const widths = [480, 800, 1200];
  const heroWidths = [640, 1080, 1800];
  const w = name === "manila-bay-sunset" ? heroWidths : widths;
  const srcSet = (ext: string) => w.map((x) => `/home/${name}-${x}w.${ext} ${x}w`).join(", ");
  const fallback = `/home/${name}-${w[Math.min(1, w.length - 1)]}w.jpg`;
  return (
    <picture className={className}>
      <source type="image/webp" srcSet={srcSet("webp")} sizes={sizes} />
      <img
        src={fallback}
        srcSet={srcSet("jpg")}
        sizes={sizes}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding={priority ? "sync" : "async"}
      />
    </picture>
  );
}

/* ------------------------------------------------------------------ */
/* 区块骨架                                                            */
/* ------------------------------------------------------------------ */

function SectionHead({ kicker, title, note }: { kicker: string; title: string; note?: string }) {
  return (
    <div className="home-sec-head">
      <p className="home-kicker home-kicker--dark">{kicker}</p>
      <h2>{title}</h2>
      {note ? <p className="home-sec-note">{note}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 主组件                                                              */
/* ------------------------------------------------------------------ */

/** 主按钮的语义种类；具体文案按当前语言在渲染时决定。 */
export type HomeCtaKind = "start" | "map" | "task" | "scene" | "bag";

export interface HomeCta {
  loading: boolean;
  loadError: string | null;
  href: string;
  kind: HomeCtaKind;
  showStatus: boolean;
  statusKind: "failed" | "complete" | "progress" | "waiting";
  progressPercent: number;
  showProgress: boolean;
  onRetry: () => void;
}

export function HomeLanding({
  online,
  cta,
  contentSource,
}: {
  online: boolean;
  cta: HomeCta;
  contentSource: "network" | "cache" | "local" | null;
}) {
  const { locale, t } = useHomeLocale();

  const ctaLabel = cta.loading
    ? t.cta.reloading
    : cta.loadError
      ? t.cta.reload
      : t.cta[cta.kind];

  const statusLabel =
    cta.statusKind === "failed"
      ? t.status.failed
      : cta.statusKind === "complete"
        ? t.status.complete
        : cta.statusKind === "progress"
          ? `${cta.progressPercent}% ${t.status.exploredSuffix}`
          : t.status.waiting;

  const contentSourceLine =
    contentSource === "cache"
      ? locale === "zh" ? "当前使用离线缓存内容" : "Using offline cached content"
      : contentSource === "local"
        ? locale === "zh" ? "当前使用本机创作的游戏" : "Using a game created on this device"
        : null;

  return (
    <div className="home">
      {/* ------------------------------ 导航 ------------------------------ */}
      <header className="home-nav">
        <div className="home-nav-in">
          <Link href="/" className="home-brand" aria-label="MOSRove">
            <RouteMark className="home-brand-mark" />
            <span className="home-brand-word">
              MOSRove
              <small>{t.brandTagline}</small>
            </span>
          </Link>
          <div className="home-nav-right">
            <span className={`home-net ${online ? "is-on" : "is-off"}`}>{online ? t.online : t.offline}</span>
            <SoundToggle />
            <LocaleToggle />
          </div>
        </div>
      </header>

      {/* ------------------------------ Hero ------------------------------ */}
      <section className="home-hero" aria-label={t.hero.title}>
        <div className="home-hero-media">
          <HomePicture
            name="manila-bay-sunset"
            alt={t.hero.imageAlt}
            sizes="100vw"
            priority
          />
        </div>
        <div className="home-hero-scrim" aria-hidden="true" />
        <div className="home-hero-in">
          <p className="home-kicker">{t.hero.kicker}</p>
          <h1>{t.hero.title}</h1>
          <p className="home-hero-sub">{t.hero.subtitle}</p>
          <div className="home-hero-cta">
            {cta.loadError ? (
              <button type="button" className="btn btn-primary" onClick={cta.onRetry}>
                {t.hero.reload}
              </button>
            ) : (
              <Link
                href={cta.loading ? "#" : cta.href}
                aria-disabled={cta.loading}
                className={`btn btn-primary home-cta ${cta.loading ? "pointer-events-none opacity-60" : ""}`}
              >
                {ctaLabel}
                <span aria-hidden="true">→</span>
              </Link>
            )}
            <Link href="/games" className="home-btn-ghost">
              {t.hero.browse}
            </Link>
          </div>
          {(cta.showStatus || Boolean(cta.loadError)) ? (
            <p className="home-hero-status">
              <span className="home-status-pill">{statusLabel}</span>
            </p>
          ) : null}
          {cta.showProgress ? (
            <div className="home-progress" aria-hidden="true">
              <div style={{ width: `${cta.progressPercent}%` }} />
            </div>
          ) : null}
        </div>
      </section>

      {/* --------------------------- 核心入口 ------------------------------ */}
      <section className="home-section" aria-label={t.entries.kicker}>
        <div className="home-in">
          <div className="home-entries">
            <Link href="/games" className="home-entry">
              <span className="home-entry-glyph"><RouteMark className="home-entry-route" /></span>
              <span className="home-entry-body">
                <strong>{t.entries.games.title}</strong>
                <span>{t.entries.games.desc}</span>
              </span>
              <span className="home-entry-arrow" aria-hidden="true">→</span>
            </Link>
            <Link href="/design" className="home-entry">
              <span className="home-entry-glyph"><CompassIcon /></span>
              <span className="home-entry-body">
                <strong>{t.entries.design.title}</strong>
                <span>{t.entries.design.desc}</span>
              </span>
              <span className="home-entry-arrow" aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="home-minor-links">
            <Link href="/how-to-create">{t.entries.howto} <span aria-hidden="true">→</span></Link>
            {contentSourceLine ? <span>{contentSourceLine}</span> : null}
          </div>
        </div>
      </section>

      {/* --------------------------- 精选探索包 ---------------------------- */}
      <section className="home-section home-section--cream" id="packs" aria-labelledby="home-packs-title">
        <div className="home-in">
          <SectionHead kicker={t.packs.kicker} title={t.packs.title} note={t.packs.note} />
          <ul className="home-packs">
            {FEATURED_PACKS.map((pack) => {
              const title = locale === "zh" ? pack.titleZh : pack.titleEn;
              const desc = locale === "zh" ? pack.descZh : pack.descEn;
              const badge = locale === "zh" ? pack.badgeZh : pack.badgeEn;
              const place = locale === "zh" ? pack.placeZh : pack.placeEn;
              return (
                <li key={pack.id} className="home-pack">
                  <div className="home-pack-media">
                    <HomePicture
                      name={pack.image}
                      alt={`${t.packs.altBase}${place}`}
                      sizes="(max-width: 720px) 100vw, 440px"
                    />
                  </div>
                  <div className="home-pack-body">
                    <span className="home-pack-badge">{badge}</span>
                    <h3>{title}</h3>
                    <p className="home-pack-desc">{desc}</p>
                    <p className="home-pack-meta">
                      <span>{pack.stops} {t.packs.stops}</span>
                      <span aria-hidden="true">·</span>
                      <span>{pack.minutes} {t.packs.minutes}</span>
                      <span aria-hidden="true">·</span>
                      <span>{DIFFICULTY_LABEL[locale][pack.difficulty]}</span>
                    </p>
                    <p className="home-pack-place"><PinIcon /> {place}</p>
                    <Link href="/games" className="home-pack-link">
                      {t.packs.open} <span aria-hidden="true">→</span>
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* --------------------------- 三步流程 ------------------------------ */}
      <section className="home-section" id="how" aria-labelledby="home-how-title">
        <div className="home-in">
          <SectionHead kicker={t.steps.kicker} title={t.steps.title} />
          <ol className="home-steps">
            {t.steps.items.map((step, index) => (
              <li key={step.title} className="home-step">
                <span className="home-step-num" aria-hidden="true">{index + 1}</span>
                <span className="home-step-body">
                  <strong>{step.title}</strong>
                  <span>{step.desc}</span>
                </span>
              </li>
            ))}
          </ol>
          <RouteMark className="home-steps-route" />
        </div>
      </section>

      {/* --------------------------- 品牌理念 ------------------------------ */}
      <section className="home-section home-section--forest home-philosophy" id="about" aria-labelledby="home-why-title">
        <div className="home-in home-philosophy-in">
          <div className="home-philosophy-media">
            <HomePicture
              name="el-nido-palawan"
              alt={t.philosophy.imageAlt}
              sizes="(max-width: 860px) 100vw, 520px"
            />
          </div>
          <div className="home-philosophy-text">
            <p className="home-kicker">{t.philosophy.kicker}</p>
            <h2 id="home-why-title">{t.philosophy.title}</h2>
            <p className="home-philosophy-body">{t.philosophy.body}</p>
          </div>
        </div>
      </section>

      {/* --------------------------- 安全与隐私 ----------------------------- */}
      <section className="home-section" id="safety" aria-labelledby="home-safety-title">
        <div className="home-in">
          <SectionHead kicker={t.safety.kicker} title={t.safety.title} />
          <ul className="home-safety">
            <li><ShieldIcon /><strong>{t.safety.items[0].title}</strong><span>{t.safety.items[0].desc}</span></li>
            <li><PinIcon /><strong>{t.safety.items[1].title}</strong><span>{t.safety.items[1].desc}</span></li>
            <li><LockIcon /><strong>{t.safety.items[2].title}</strong><span>{t.safety.items[2].desc}</span></li>
          </ul>
        </div>
      </section>

      {/* ----------------------------- 页脚 -------------------------------- */}
      <footer className="home-footer">
        <div className="home-in home-footer-in">
          <div className="home-footer-brand">
            <span className="home-brand-word home-brand-word--footer">MOSRove<small>{t.brandTagline}</small></span>
            <p>{t.footer.aboutBody}</p>
          </div>
          <nav aria-label={t.footer.helpTitle} className="home-footer-col">
            <h3>{t.footer.helpTitle}</h3>
            <ul>
              {t.footer.helpLinks.map((l) => (
                <li key={l.href}><Link href={l.href}>{l.label}</Link></li>
              ))}
            </ul>
          </nav>
          <div className="home-footer-col">
            <h3>{t.footer.contactTitle}</h3>
            <p>{t.footer.contactBody}<a href="https://github.com/zemeiyu2-lgtm/mos-scene-hunt/issues" target="_blank" rel="noreferrer">{t.footer.contactLink}</a></p>
          </div>
        </div>
        <div className="home-in home-footer-legal">
          <p>
            {t.footer.creditsLine}
            {" "}
            <a href="https://commons.wikimedia.org/wiki/User:Argenberg" target="_blank" rel="noreferrer">Wikimedia Commons / Argenberg</a>
          </p>
          <p>{t.footer.privacyLine} · {t.footer.versionLine}</p>
        </div>
      </footer>
    </div>
  );
}
