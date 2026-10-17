import type { Game } from "./types";

/**
 * Official starter template: Rizal Park mini treasure hunt.
 * Coordinates are a rough demo layout only. Designers must confirm every point
 * on the map and in the field before publishing or playing for real.
 */
const PARK_CENTER = { lat: 14.5832, lng: 120.9794 };
const spot = (name: string, lat: number, lng: number): Game["scenes"][number]["location"] => ({
  lat, lng, radius: 20, name,
});

const LANDSCAPE = "https://images.unsplash.com/photo-1500530855697-b586d89ee3ee?auto=format&fit=crop&w=1000&q=80";
const GREEN_SPACE = "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1000&q=80";
const PATH_IMAGE = "https://images.unsplash.com/photo-1472396961693-142e6e269027?auto=format&fit=crop&w=1000&q=80";

export const RIZAL_PARK_TEMPLATE: Game = {
  id: "rizal-park-discovery",
  language: "zh-CN",
  title: "黎刹公园：寻找最后的宝藏",
  description: "官方创作母版。用观察、图片线索、简单解谜、团队任务和最终宝藏，示范如何把地图点位变成一场完整的真实世界探索。请在正式游玩前逐点核对坐标。",
  author: "MOS Scene Hunt · 官方母版",
  version: "1.1.0",
  estimatedMinutes: 25,
  difficulty: "easy",
  startLocation: { ...PARK_CENTER, radius: 30, name: "黎刹公园集合点（请现场确认）" },
  huntArea: { center: { ...PARK_CENTER }, radiusMeters: 350, shape: "circle", name: "黎刹公园探索区（请在地图上确认边界）" },
  entrySceneId: "park-01",
  aiProfile: {
    tone: "轻快、现代、富有发现感；像一位友善的户外游戏向导。",
    canon: [
      "这是用于学习创作流程的官方示范母版，不代表官方场地许可或精确坐标。",
      "地图坐标是示范布局，正式游玩前必须逐点核对并现场测试。",
      "所有任务必须在开放、安全的公共区域完成，不得进入限制区域或打扰他人。",
      "最终奖励必须由设计者准备并兑现；本母版的宝藏为设计者现场准备的小礼物或纪念卡。"
    ],
    allowGeneration: true
  },
  scenes: [
    {
      id: "park-01",
      title: "第一站 · 观察者上线",
      story: "欢迎来到探索现场。先停下来观察周围：颜色、形状、声音和人们使用空间的方式。真正的线索，往往藏在匆忙时不会注意的细节里。",
      briefing: "到达集合点后，确认队员都已准备好。选择不影响行人通行的位置完成任务。",
      location: spot("示范点 1 · 集合区（现场微调）", 14.5832, 120.9794),
      nextSceneId: "park-02",
      media: [{ id: "park-image-01", kind: "image", title: "观察自然的示例图", url: GREEN_SPACE, description: "示范：图片可用来提示玩家留意自然环境的形状和颜色。" }],
      challenge: { type: "choice", question: "开始探索前，哪一种做法最适合？", options: ["先观察环境并确认安全", "立刻跑向最远的点", "不看路线直接开始"], answer: 0, hint: "好的探索从留心环境开始。", explanation: "先观察、安全行动，才能更好地享受游戏。" },
      reward: { type: "keyword", title: "观察徽记", value: "观察", icon: "◎" },
      mapStyle: { icon: "◎", color: "#2c7a68" }
    },
    {
      id: "park-02",
      title: "第二站 · 图片侦探",
      story: "线索不一定是一段文字，也可以是一张图。看看现场周围，找出与提示最接近的自然或建筑特征。请只观察公共区域，不要攀爬或触碰设施。",
      briefing: "打开图片线索，比较图中形状与眼前环境；找不到完全相同的对象时，说明最接近的特征即可。",
      location: spot("示范点 2 · 观察区（现场微调）", 14.58345, 120.97955),
      nextSceneId: "park-03",
      media: [{ id: "park-image-02", kind: "image", title: "自然线索图", url: LANDSCAPE, description: "玩家根据图片寻找相似的形状、颜色或环境特征。" }],
      challenge: { type: "keyword", question: "完成观察后，输入你发现的一个自然特征，例如“树”“绿色”或“影子”。", answer: ["树", "绿色", "影子", "自然", "叶子"], hint: "看看周围的植物、颜色或地面上的影子。" },
      reward: { type: "keyword", title: "发现线索", value: "发现", icon: "⌕" },
      mapStyle: { icon: "⌕", color: "#478b78" }
    },
    {
      id: "park-03",
      title: "第三站 · 路线密码",
      story: "你已经收集到两个关键词。现在需要团队一起解开路线密码：真正的寻宝不是走得最快，而是让线索彼此连接。",
      briefing: "到达下一个安全停留点，队员先一起讨论，再提交答案。",
      location: spot("示范点 3 · 路线点（现场微调）", 14.58305, 120.9798),
      nextSceneId: "park-04",
      media: [{ id: "park-image-03", kind: "image", title: "路径与方向示例图", url: PATH_IMAGE, description: "可作为方向、路线或环境观察任务的视觉引导。" }],
      challenge: { type: "choice", question: "当团队对下一步意见不同，最好的做法是什么？", options: ["停下来对照线索并共同决定", "各走各的", "跳过任务直接领奖"], answer: 0, hint: "团队任务需要共同判断。" , explanation: "讨论、比较线索，再一起行动。" },
      reward: { type: "item", title: "路线碎片", value: "route-fragment", icon: "◇", description: "最终站需要用到的虚拟线索。" },
      mapStyle: { icon: "◇", color: "#d29a42" }
    },
    {
      id: "park-04",
      title: "第四站 · 团队挑战",
      story: "现在轮到你们创造线索。每位队员说出一个在公园里观察到、但刚才可能被忽略的细节。团队选出最有趣的一项，并用一句话描述。",
      briefing: "请在不阻挡通行的位置完成。不要拍摄陌生人；如果需要照片，只拍环境、物件或团队自愿入镜的成员。",
      location: spot("示范点 4 · 团队任务点（现场微调）", 14.58285, 120.97945),
      nextSceneId: "park-05",
      media: [{ id: "park-team-image", kind: "image", title: "团队观察任务参考图", url: GREEN_SPACE, description: "示范图可用于引出团队观察与分享任务。" }],
      challenge: { type: "text", question: "请用一个短词或短句，写下团队刚才共同发现的细节。", answer: ["树影", "树", "叶子", "花", "长椅", "小路", "绿色", "光影"], hint: "写下一个你们亲眼观察到的环境细节。" },
      reward: { type: "keyword", title: "团队徽记", value: "合作", icon: "✦" },
      mapStyle: { icon: "✦", color: "#b77935" }
    },
    {
      id: "park-05",
      title: "最终站 · 找到并兑现宝藏",
      story: "你们已经收集了观察、发现和合作的线索。现在前往设计者现场确认的终点，向游戏主持人出示这些关键词，完成最后挑战后领取真正的宝藏。",
      briefing: "宝藏由设计者提前准备并保管。正式发布前，请填写实际领取地点、负责人和开放时间；不要把宝藏藏在危险、无人看管或未经许可的地方。",
      location: spot("示范点 5 · 宝藏终点（必须现场确认）", 14.58325, 120.97915),
      nextSceneId: null,
      media: [{ id: "park-treasure-image", kind: "image", title: "宝藏奖励示例图", url: LANDSCAPE, description: "创作者可替换为真实奖品照片、纪念卡或徽章图片。" }],
      challenge: { type: "choice", question: "领取宝藏前，团队必须完成哪一步？", options: ["向主持人展示线索并确认领取规则", "直接拿走任何物品", "跳过主持人和最终任务"], answer: 0, hint: "真正的奖励需要有清楚、安全的兑现流程。", explanation: "完成游戏，也要尊重场地和奖励规则。" },
      reward: { type: "badge", title: "黎刹公园探索者", value: "rizal-park-discovery", icon: "🏆", description: "兑现方式：设计者在终点向完成任务的玩家发放预先准备的小礼物或纪念卡。请在实际游戏中填写领取地点与负责人。" },
      mapStyle: { icon: "🏆", color: "#c18b3a" }
    }
  ]
};

export default RIZAL_PARK_TEMPLATE;
