"use client";

/**
 * 首页 V2.0 的双语字典与「精选探索包」数据。
 *
 * 数据纪律：
 * - 探索包字段（标题/简介/站数/时长/难度）一律取自 content/*.json 的真实内容，
 *   不在这里编造任何数字或推荐位。
 * - 英文文案是对真实内容的翻译与转述，不新增事实。
 * - 摄影来源与许可在 IMAGE_CREDITS 中逐张记录，并在页脚展示。
 */

import demoHunt from "@/content/demo-hunt.json";
import rizalPark from "@/content/rizal-park-discovery.json";

export type HomeLocale = "zh" | "en";

/** 从真实内容包派生的展示字段（来源见各字段注释）。 */
export interface FeaturedPack {
  id: string;
  /** zh 标题直接取自内容包，保证与游戏内一致。 */
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
  stops: number;
  minutes: number;
  difficulty: "easy" | "medium" | "hard";
  placeZh: string;
  placeEn: string;
  /** 图片 key，对应 public/home/ 下的真实摄影素材。 */
  image: "rizal-park" | "fort-santiago-intramuros";
  /** 入口标签（zh/en 相同）：内置默认包直接可玩，云端包从游戏中心获取。 */
  badgeZh: string;
  badgeEn: string;
}

// demo-hunt（content/demo-hunt.json）：内置默认包，黎刹公园五站城市寻宝。
// rizal-park-discovery（content/rizal-park-discovery.json）：content/cloud/catalog.json
// 中唯一 status === "published" 的公开云端包。
export const FEATURED_PACKS: FeaturedPack[] = [
  {
    id: demoHunt.id,
    titleZh: demoHunt.title,
    titleEn: "Luneta · Seeing This City",
    descZh: demoHunt.description,
    descEn: "A five-stop, real-place city hunt across Rizal Park (Luneta): walk to actual monuments and gardens before each scene unlocks.",
    stops: demoHunt.scenes.length,
    minutes: demoHunt.estimatedMinutes,
    difficulty: demoHunt.difficulty as FeaturedPack["difficulty"],
    placeZh: "马尼拉 · 黎刹公园（Luneta）",
    placeEn: "Rizal Park (Luneta), Manila",
    image: "rizal-park",
    badgeZh: "内置 · 新玩家默认可玩",
    badgeEn: "Built in · playable by default",
  },
  {
    id: rizalPark.id,
    titleZh: rizalPark.title,
    titleEn: "Rizal Park: The Last Treasure",
    descZh: rizalPark.description,
    descEn: "Observation, photo clues, light puzzles and a team finale. Published in the cloud catalogue; coordinates are sample layout to be confirmed on site.",
    stops: rizalPark.scenes.length,
    minutes: rizalPark.estimatedMinutes,
    difficulty: rizalPark.difficulty as FeaturedPack["difficulty"],
    placeZh: "马尼拉 · 黎刹公园",
    placeEn: "Rizal Park, Manila",
    image: "fort-santiago-intramuros",
    badgeZh: "云端已发布",
    badgeEn: "Published to the cloud catalogue",
  },
];

export const DIFFICULTY_LABEL: Record<HomeLocale, Record<FeaturedPack["difficulty"], string>> = {
  zh: { easy: "轻松", medium: "适中", hard: "有挑战" },
  en: { easy: "Easy", medium: "Moderate", hard: "Challenging" },
};

/** 首页用到的全部摄影素材。许可均为 CC BY 4.0（可商用，需署名）。 */
export const IMAGE_CREDITS = [
  {
    key: "manila-bay-sunset",
    file: "Majestic sunset in Manila Bay, Manila, Philippines.jpg",
    author: "Vyacheslav Argenberg",
    license: "CC BY 4.0",
    url: "https://commons.wikimedia.org/wiki/File:Majestic_sunset_in_Manila_Bay,_Manila,_Philippines.jpg",
  },
  {
    key: "fort-santiago-intramuros",
    file: "Manila, Fort Santiago, Walled city of Intramuros, Philippines.jpg",
    author: "Vyacheslav Argenberg",
    license: "CC BY 4.0",
    url: "https://commons.wikimedia.org/wiki/File:Manila,_Fort_Santiago,_Walled_city_of_Intramuros,_Philippines.jpg",
  },
  {
    key: "rizal-park",
    file: "Manila, Rizal Park, Philippines.jpg",
    author: "Vyacheslav Argenberg",
    license: "CC BY 4.0",
    url: "https://commons.wikimedia.org/wiki/File:Manila,_Rizal_Park,_Philippines.jpg",
  },
  {
    key: "el-nido-palawan",
    file: "Island lagoon in Bacuit Bay, El Nido, Palawan, Philippines.jpg",
    author: "Vyacheslav Argenberg",
    license: "CC BY 4.0",
    url: "https://commons.wikimedia.org/wiki/File:Island_lagoon_in_Bacuit_Bay,_El_Nido,_Palawan,_Philippines.jpg",
  },
] as const;

export interface HomeCopy {
  brandTagline: string;
  langToggleLabel: string;
  online: string;
  offline: string;
  cta: {
    reloading: string;
    reload: string;
    start: string;
    map: string;
    task: string;
    scene: string;
    bag: string;
  };
  status: {
    failed: string;
    complete: string;
    exploredSuffix: string;
    waiting: string;
  };
  hero: {
    kicker: string;
    title: string;
    subtitle: string;
    browse: string;
    reload: string;
    imageAlt: string;
  };
  entries: {
    kicker: string;
    games: { title: string; desc: string };
    design: { title: string; desc: string };
    howto: string;
  };
  packs: {
    kicker: string;
    title: string;
    note: string;
    stops: string;
    minutes: string;
    open: string;
    altBase: string;
  };
  steps: {
    kicker: string;
    title: string;
    items: { title: string; desc: string }[];
  };
  philosophy: {
    kicker: string;
    title: string;
    body: string;
    imageAlt: string;
  };
  safety: {
    kicker: string;
    title: string;
    items: { title: string; desc: string }[];
  };
  footer: {
    aboutTitle: string;
    aboutBody: string;
    helpTitle: string;
    helpLinks: { label: string; href: string }[];
    contactTitle: string;
    contactBody: string;
    contactLink: string;
    creditsTitle: string;
    creditsLine: string;
    versionLine: string;
    privacyLine: string;
  };
}

export const HOME_COPY: Record<HomeLocale, HomeCopy> = {
  zh: {
    brandTagline: "真实世界探索",
    langToggleLabel: "切换语言",
    online: "在线",
    offline: "离线",
    cta: {
      reloading: "正在恢复游戏…",
      reload: "重新加载游戏",
      start: "开始探索",
      map: "继续探索",
      task: "继续当前任务",
      scene: "继续当前情境",
      bag: "查看探索成果",
    },
    status: {
      failed: "加载失败",
      complete: "已完成",
      exploredSuffix: "已探索",
      waiting: "等待你的第一步",
    },
    hero: {
      kicker: "菲律宾 · 马尼拉湾",
      title: "走到真实地点，解锁那里的故事",
      subtitle: "为步行设计的城市探索：走到现场、观察与思考、解开情境、收集关键词。",
      browse: "浏览游戏中心",
      reload: "重新加载游戏",
      imageAlt: "马尼拉湾日落：人们在罗哈斯大道的海堤上望着夕阳下的海面",
    },
    entries: {
      kicker: "两个入口",
      games: { title: "游戏中心", desc: "挑选一条已发布的路线，今天就从楼下开始。" },
      design: { title: "创作中心", desc: "把你熟悉的街区，做成一条可以分享的寻宝路线。" },
      howto: "创作说明",
    },
    packs: {
      kicker: "精选探索包",
      title: "真实地点，公开可玩",
      note: "以下均为真实地点、已公开的探索包；站数与时长来自包内数据。",
      stops: "站",
      minutes: "分钟",
      open: "在游戏中心打开",
      altBase: "实景照片：",
    },
    steps: {
      kicker: "怎么玩",
      title: "三步，开始探索",
      items: [
        { title: "选择一条路线", desc: "从游戏中心出发，或用创作中心做一条自己的。" },
        { title: "走到现场", desc: "跟着地图与实时距离，走向真实的地点——故事在现场等你。" },
        { title: "解锁情境", desc: "踏入触发半径，任务自动解锁：观察、答题、收集关键词。" },
      ],
    },
    philosophy: {
      kicker: "品牌理念",
      title: "把探索还给街道",
      body: "MOSRove 相信，最好的故事不在屏幕里，而在你脚下的街区。我们用 GPS 把叙事带回真实的公园、老城与海岸——用自己的脚步丈量一座城市，而不是在攻略里读完它。",
      imageAlt: "爱昵岛（El Nido）泻湖：巴拉望的喀斯特石灰岩峭壁与清澈海水",
    },
    safety: {
      kicker: "安全与隐私",
      title: "走得开心，也要走得安心",
      items: [
        { title: "户外安全", desc: "请在安全、开放的户外区域游玩。GPS 在室内或高楼附近可能不够准确。" },
        { title: "定位用途", desc: "定位仅在你的设备上用于计算你与目标地点的距离，MOSRove 不上传、不存储你的位置。" },
        { title: "数据与隐私", desc: "探索进度与创作内容只保存在你自己的设备上；发布游戏时上传的仅是路线内容本身。" },
      ],
    },
    footer: {
      aboutTitle: "关于",
      aboutBody: "MOSRove 是一个手机优先的真实地点寻宝游戏引擎：在真实世界里移动，解锁情境、线索与任务。",
      helpTitle: "帮助",
      helpLinks: [
        { label: "新手教程", href: "/tutorial" },
        { label: "创作说明", href: "/how-to-create" },
        { label: "游戏中心", href: "/games" },
      ],
      contactTitle: "联系",
      contactBody: "问题反馈与建议：",
      contactLink: "GitHub Issues",
      creditsTitle: "影像来源",
      creditsLine: "首页摄影：Vyacheslav Argenberg，来自 Wikimedia Commons，CC BY 4.0。",
      versionLine: "MOSRove 首页 V2.0",
      privacyLine: "进度只保存在你的设备上。",
    },
  },
  en: {
    brandTagline: "Real-world exploration",
    langToggleLabel: "Switch language",
    online: "Online",
    offline: "Offline",
    cta: {
      reloading: "Restoring your game…",
      reload: "Reload the game",
      start: "Start exploring",
      map: "Continue exploring",
      task: "Continue the task",
      scene: "Continue the scene",
      bag: "View your finds",
    },
    status: {
      failed: "Failed to load",
      complete: "Completed",
      exploredSuffix: "explored",
      waiting: "Waiting for your first step",
    },
    hero: {
      kicker: "Philippines · Manila Bay",
      title: "Walk to real places. Unlock their stories.",
      subtitle: "City exploration designed for walking: be there, look closer, solve the scene, collect the keywords.",
      browse: "Browse the game centre",
      reload: "Reload the game",
      imageAlt: "Sunset over Manila Bay: people on the Roxas Boulevard seawall watching the sun go down",
    },
    entries: {
      kicker: "Two doors in",
      games: { title: "Game Centre", desc: "Pick a published route and start from your own street today." },
      design: { title: "Creator Studio", desc: "Turn the neighbourhood you know into a treasure hunt you can share." },
      howto: "How to create",
    },
    packs: {
      kicker: "Featured packs",
      title: "Real places, playable now",
      note: "Every pack below is a real place published for everyone; stops and durations come from the pack data itself.",
      stops: "stops",
      minutes: "min",
      open: "Open in the Game Centre",
      altBase: "Real photograph: ",
    },
    steps: {
      kicker: "How it works",
      title: "Three steps to explore",
      items: [
        { title: "Pick a route", desc: "Start from the Game Centre, or craft your own in the Creator Studio." },
        { title: "Walk there", desc: "Follow the map and the live distance to a real place — the story waits on site." },
        { title: "Unlock the scene", desc: "Step inside the trigger radius and the task unlocks: observe, answer, collect keywords." },
      ],
    },
    philosophy: {
      kicker: "Why MOSRove",
      title: "Give exploration back to the streets",
      body: "MOSRove believes the best stories are not on a screen — they are on the streets under your feet. GPS brings the narrative back to real parks, old towns and coastlines, so you measure a city with your own steps instead of reading it in a guide.",
      imageAlt: "Lagoon in El Nido, Palawan: limestone karst cliffs over clear turquoise water",
    },
    safety: {
      kicker: "Safety & privacy",
      title: "Explore happily, explore safely",
      items: [
        { title: "Outdoor safety", desc: "Please play in safe, open outdoor areas. GPS can be unreliable indoors or near tall buildings." },
        { title: "Location use", desc: "Your location is only used on your device to compute the distance to a target. MOSRove never uploads or stores it." },
        { title: "Data & privacy", desc: "Progress and creations stay on your own device; publishing a game uploads only the route content itself." },
      ],
    },
    footer: {
      aboutTitle: "About",
      aboutBody: "MOSRove is a mobile-first, real-world location hunt engine: move through the real world to unlock scenes, clues and tasks.",
      helpTitle: "Help",
      helpLinks: [
        { label: "Tutorial", href: "/tutorial" },
        { label: "How to create", href: "/how-to-create" },
        { label: "Game Centre", href: "/games" },
      ],
      contactTitle: "Contact",
      contactBody: "Feedback and suggestions:",
      contactLink: "GitHub Issues",
      creditsTitle: "Photo credits",
      creditsLine: "Photography: Vyacheslav Argenberg, via Wikimedia Commons, CC BY 4.0.",
      versionLine: "MOSRove Homepage V2.0",
      privacyLine: "Progress stays on your device.",
    },
  },
};
