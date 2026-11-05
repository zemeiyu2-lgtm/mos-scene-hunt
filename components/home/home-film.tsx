"use client";

/**
 * 首页品牌影片区块（V2.1 动画）。
 *
 * 加载纪律（首页性能契约）：
 * - 视频默认不加载：进入视口附近才开始取流（IntersectionObserver）；
 * - `prefers-reduced-motion: reduce` 时不自动播放，只显示封面与手动播放按钮；
 * - 静音自动播放（autoplay 政策安全），提供独立的声音开关；
 * - 播放失败回退到静态封面（同一帧导出，视觉无跳变）；
 * - 16:9 固定宽高比，不产生布局位移（CLS = 0）。
 *
 * 素材说明：影片为 MOSRove 自制原创动画（V2.1），无第三方素材与水印。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useHomeLocale } from "@/components/home/home-locale";

const FILM_SRC = "/home/film/mosrove-v21-720p.mp4";
const FILM_POSTER = "/home/film/mosrove-v21-poster-1280w.jpg";

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8.5 5.5v13l10.5-6.5-10.5-6.5Z" fill="currentColor" />
    </svg>
  );
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4Z" fill="currentColor" />
      {muted ? (
        <path d="M15.5 9.5 20 14m0-4.5L15.5 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M15.5 8.5a5 5 0 0 1 0 7M17.8 6.2a8 8 0 0 1 0 11.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

export function HomeFilm() {
  const { t } = useHomeLocale();
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const reducedMotionRef = useRef(false);

  const [shouldLoad, setShouldLoad] = useState(false);
  const [failed, setFailed] = useState(false);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // 跟踪系统"减少动态效果"设置，实时生效。
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      reducedMotionRef.current = mq.matches;
      setReducedMotion(mq.matches);
    };
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  // 进入视口附近才开始加载视频；减少动态时保持封面，等待用户手动播放。
  useEffect(() => {
    if (shouldLoad) return;
    const el = frameRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      if (!reducedMotionRef.current) setShouldLoad(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !reducedMotionRef.current) {
          setShouldLoad(true);
          io.disconnect();
        }
      },
      { rootMargin: "240px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shouldLoad]);

  // 加载完成后尝试静音自动播放；被浏览器拦截时静默失败（保留播放按钮）。
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !shouldLoad || reducedMotion) return;
    v.muted = true;
    const p = v.play();
    if (p) p.catch(() => undefined);
  }, [shouldLoad, reducedMotion]);

  const manualPlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setShouldLoad(true);
    v.muted = muted;
    const p = v.play();
    if (p) p.catch(() => undefined);
  }, [muted]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      if (videoRef.current) videoRef.current.muted = next;
      return next;
    });
  }, []);

  const showPlayOverlay = !failed && !playing;

  return (
    <section className="home-section home-film-sec" aria-label={t.film.title}>
      <div className="home-in">
        <div className="home-sec-head">
          <p className="home-kicker home-kicker--dark">{t.film.kicker}</p>
          <h2>{t.film.title}</h2>
          <p className="home-sec-note">{t.film.note}</p>
        </div>
        <div className="home-film" ref={frameRef}>
          <div className="home-film-frame">
            {shouldLoad && !failed ? (
              <video
                ref={videoRef}
                className="home-film-video"
                src={FILM_SRC}
                poster={FILM_POSTER}
                preload="metadata"
                muted={muted}
                loop
                playsInline
                onError={() => setFailed(true)}
                onPlaying={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                aria-label={t.film.title}
              />
            ) : (
              <img
                className="home-film-video"
                src={FILM_POSTER}
                alt={t.film.posterAlt}
                loading="lazy"
                decoding="async"
              />
            )}
            {showPlayOverlay ? (
              <button
                type="button"
                className="home-film-play"
                onClick={manualPlay}
                aria-label={t.film.play}
              >
                <PlayIcon />
              </button>
            ) : null}
            {playing ? (
              <button
                type="button"
                className="home-film-sound"
                onClick={toggleMute}
                aria-pressed={!muted}
                aria-label={muted ? t.film.soundOn : t.film.soundOff}
              >
                <SoundIcon muted={muted} />
                <span>{muted ? t.film.soundOn : t.film.soundOff}</span>
              </button>
            ) : null}
          </div>
          {failed ? <p className="home-film-note">{t.film.fallback}</p> : null}
        </div>
      </div>
    </section>
  );
}
