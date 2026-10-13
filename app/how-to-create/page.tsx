"use client";

import Link from "next/link";
import { useState } from "react";
import { Screen } from "@/components/ui";
import { useUiLocale } from "@/components/ui-locale-provider";

const PROMPT = `你是 MOS Scene Hunt 的游戏设计助手。请帮助一个不懂编程的普通人，把一个简单想法变成可以导入 MOS Scene Hunt 的手机户外寻宝游戏。

先根据我的想法设计一款轻松、有趣、容易上手的游戏。除非我明确要求，不要写长篇说教。每个站点要有简短故事、清楚任务、答案或完成条件、提示和奖励。

请先生成完整游戏内容，然后输出一个【严格有效的 JSON】代码块。不要在 JSON 内写注释，不要省略字段，不要输出伪代码。JSON 顶层直接是游戏对象，字段至少包括：
id、language、title、description、author、version、estimatedMinutes、difficulty、startLocation、huntArea、entrySceneId、scenes。

每个 scenes 项至少包括：
id、title、story、location、nextSceneId、challenge、reward。

挑战类型只用以下三种：
1. choice：question、options（2至4个选项）、answer（正确选项从0开始的下标）、prompt、explanation。
2. text：question、answer（字符串数组，列出可接受答案）、hint。
3. keyword：question、answer（字符串数组）、hint。

奖励 type 使用 keyword、badge 或 item。所有场景按游玩顺序连接，最后一个场景的 nextSceneId 必须是 null。所有 id 必须唯一，entrySceneId 必须对应第一站。答案必须与选项一致，所有必需字段完整。

【重要：不得编造真实 GPS 坐标。】
startLocation、huntArea.center 和每个 scene.location 的 lat、lng 暂时统一填 0。0,0 只是明显的待设置占位值，不是真实地点。导入后，设计者必须进入 MOS Scene Hunt 设计器，用地图逐一设置起点、探索区域和每一站的真实坐标，再检查路线并试玩。不要声称游戏已经完成定位。

请先向我询问最多三个简单问题，了解游戏给谁玩、在哪里玩、想玩多久。若我已经说明，就不要重复询问，直接开始设计。允许我用自然语言反复修改游戏。最后请输出完整 JSON，并在 JSON 代码块之外列出需要我现场确认的事项。`;

export default function HowToCreatePage() {
  const { locale } = useUiLocale();
  const en = locale === "en";
  const [copied, setCopied] = useState(false);
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(PROMPT);
      setCopied(true);
    } catch {
      setCopied(false);
      window.prompt("复制下面的指令：", PROMPT);
    }
  }
  return (
    <Screen title=(en ? "How to design a game" : "教你设计游戏") subtitle=(en ? "Create with an AI tool you already use — no coding required" : "不懂编程，也能借助自己常用的 AI 创作")>
      <section className="card p-5">
        <p className="game-kicker">{en ? "MOS SCENE HUNT · CREATOR GUIDE" : (en ? "MOS SCENE HUNT · CREATOR GUIDE" : "MOS SCENE HUNT · 新手指南")}</p>
        <h2 className="mt-2 text-2xl font-bold">{en ? "From an idea to a playable game" : (en ? "From an idea to a playable game" : "从一个想法，到一款可以试玩的游戏")}</h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{en ? "You do not need to buy or run AI inside MOS Scene Hunt. Open ChatGPT, Claude, Gemini, or another AI tool you already use. Copy the design prompt below and follow its questions." : (en ? "You do not need to buy or run AI inside MOS Scene Hunt. Open ChatGPT, Claude, Gemini, or another AI tool you already use. Copy the design prompt below and follow its questions." : "你不需要在 MOS Scene Hunt 里购买或调用 AI。打开自己已经能使用的 ChatGPT、Claude、Gemini 或其他 AI，把下面的设计指令复制过去，按它的提问逐步完成即可。")}</p>
      </section>

      <section className="card mt-4 p-5">
        <h3 className="text-base font-bold">{en ? "Follow these steps to design and share" : (en ? "Follow these steps to design and share" : "照着做，完成设计与分享")}</h3>
        <ol className="mt-3 space-y-3 text-sm leading-relaxed">
          <li><b>{en ? "1. Describe your idea." : (en ? "1. Describe your idea." : "1. 说出你的想法。")}</b><p className="mt-1 text-[var(--muted)]">{en ? "Example: “Design a lighthearted 15-minute outdoor treasure hunt for friends, with five stops.”" : (en ? "Example: “Design a lighthearted 15-minute outdoor treasure hunt for friends, with five stops.”" : "例如：“给朋友聚会设计一个 15 分钟的户外寻宝游戏，有 5 个站点，轻松搞笑。”")}</p></li>
          <li><b>{en ? "2. Copy the prompt below into your AI tool." : (en ? "2. Copy the prompt below into your AI tool." : "2. 复制下面的指令，交给你常用的 AI。")}</b><p className="mt-1 text-[var(--muted)]">{en ? "The AI will ask a few simple questions, then draft the story, stops, clues, challenges, and rewards." : (en ? "The AI will ask a few simple questions, then draft the story, stops, clues, challenges, and rewards." : "AI 会先问几个简单问题，再帮你生成故事、站点、线索、题目和奖励。")}</p></li>
          <li><b>{en ? "3. Revise until you are happy with it." : (en ? "3. Revise until you are happy with it." : "3. 反复修改，直到你喜欢。")}</b><p className="mt-1 text-[var(--muted)]">{en ? "For example: “Make the questions easier,” “Use four stops,” or “Replace trivia with an observation challenge.”" : (en ? "For example: “Make the questions easier,” “Use four stops,” or “Replace trivia with an observation challenge.”" : "直接说“题目太难，改简单一点”“减少到 4 站”“把知识题改成观察挑战”。")}</p></li>
          <li><b>{en ? "4. Ask the AI for a complete JSON file." : (en ? "4. Ask the AI for a complete JSON file." : "4. 让 AI 输出完整 JSON 文件。")}</b><p className="mt-1 text-[var(--muted)]">{en ? "Ask for strictly valid JSON only. Copy the JSON code block into a plain-text editor and save it as game-name.json using UTF-8. Do not include surrounding Markdown explanations." : (en ? "Ask for strictly valid JSON only. Copy the JSON code block into a plain-text editor and save it as game-name.json using UTF-8. Do not include surrounding Markdown explanations." : "请它只输出严格有效的 JSON。复制 JSON 代码块到纯文本编辑器，保存为游戏名.json，编码选择 UTF-8。不要把 Markdown 说明一起保存进文件。")}</p></li>
          <li><b>{en ? "5. Import, set locations, and playtest." : (en ? "5. Import, set locations, and playtest." : "5. 导入、设置地点、试玩。")}</b><p className="mt-1 text-[var(--muted)]">{en ? "Open Create Game and import the JSON. In the designer, set the real start point and each stop on the map, check challenges, route, and trigger radius, then playtest outdoors." : (en ? "Open Create Game and import the JSON. In the designer, set the real start point and each stop on the map, check challenges, route, and trigger radius, then playtest outdoors." : "进入创建游戏页面，导入 JSON；再进入设计器，用地图设置真实起点和各站坐标，检查题目、路线与触发范围，最后在户外试玩。")}</p></li>
          <li><b>{en ? "6. Validate before publishing and sharing." : (en ? "6. Validate before publishing and sharing." : "6. 验收后再发布分享。")}</b><p className="mt-1 text-[var(--muted)]">{en ? "Confirm the start point, play area, and every stop use real locations, then playtest outdoors. The designer creates a share link and QR code locally; you can display the code or download it as a PNG. The link carries the published game content, so recipients do not need your local save or your device to stay online." : (en ? "Confirm the start point, play area, and every stop use real locations, then playtest outdoors. The designer creates a share link and QR code locally; you can display the code or download it as a PNG. The link carries the published game content, so recipients do not need your local save or your device to stay online." : "先确认起点、游戏区域和每一站都已设置为真实地点，并在户外试玩。设计器会在本机生成独立分享链接和二维码，可直接展示二维码或下载 PNG 图片用于现场分享。分享链接携带本次发布的游戏内容，别人打开后不依赖你的本机存档，也不要求你一直在线。")}</p></li>
        </ol>
      </section>

      <section className="card mt-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="text-base font-bold">{en ? "AI game design prompt" : (en ? "AI game design prompt" : "AI 游戏设计指令")}</h3><p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{en ? "Copy the entire prompt into a conversation with your preferred AI tool." : (en ? "Copy the entire prompt into a conversation with your preferred AI tool." : "复制整段内容，粘贴到你常用的 AI 对话中。")}</p></div>
          <button type="button" className="btn btn-primary shrink-0" onClick={copyPrompt}>{copied ? (en ? "Copied" : "已复制") : (en ? "Copy prompt" : "复制指令")}</button>
        </div>
        <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--surface)] p-3 text-xs leading-relaxed">{PROMPT}</pre>
      </section>

      <section className="card mt-4 p-5">
        <h3 className="text-base font-bold">{en ? "Important: AI does not know your real-world coordinates" : (en ? "Important: AI does not know your real-world coordinates" : "特别注意：AI 不知道你现场的真实坐标")}</h3>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-[var(--muted)]">
          <li>{en ? "AI can design stories, questions, clues, and rewards, but it cannot know the real GPS coordinates of your stops." : (en ? "AI can design stories, questions, clues, and rewards, but it cannot know the real GPS coordinates of your stops." : "AI 可以设计故事、题目、线索和奖励，但不能凭空知道每个站点的真实 GPS 坐标。")}</li>
          <li>{en ? "The 0,0 values in the prompt are placeholders, not real locations. After import, set the start, play area, and every stop to actual locations in the designer." : (en ? "The 0,0 values in the prompt are placeholders, not real locations. After import, set the start, play area, and every stop to actual locations in the designer." : "指令中的 0,0 是待设置标记，不是真实位置。导入后必须在设计器中把起点、区域和所有站点逐一标到真实地点。")}</li>
          <li>{en ? "Set locations in safe, open outdoor areas. Avoid trigger radii that are too small, private property, and dangerous roads." : (en ? "Set locations in safe, open outdoor areas. Avoid trigger radii that are too small, private property, and dangerous roads." : "请在安全、开放的户外区域标定；不要把触发半径设得过小，也不要把路线安排到私人区域或危险道路。")}</li>
          <li>{en ? "A successful import does not mean the game is finished. Review validation results and playtest on site." : (en ? "A successful import does not mean the game is finished. Review validation results and playtest on site." : "导入成功不代表游戏已经完成。请先检查设计器里的验证结果，再到现场试玩。")}</li>
        </ul>
      </section>

      <section className="card mt-4 p-5">
        <h3 className="text-base font-bold">{en ? "Publishing and sharing: what creators should know" : (en ? "Publishing and sharing: what creators should know" : "发布与分享：设计者请先了解")}</h3>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-[var(--muted)]">
          <li><b>{en ? "Validate before publishing." : (en ? "Validate before publishing." : "先校验，再发布。")}</b>{en ? "Set real GPS coordinates for the start, play area, and every stop, then complete a safe outdoor playtest. AI-generated 0,0 placeholders must never be published as a ready-to-play real-world game." : (en ? "Set real GPS coordinates for the start, play area, and every stop, then complete a safe outdoor playtest. AI-generated 0,0 placeholders must never be published as a ready-to-play real-world game." : "确认真实起点、游戏区域和每一站的 GPS 坐标都已设置，并在安全的户外环境完成试玩。AI 生成的 0,0 只是占位符，绝不能直接发布为可玩的现场游戏。")}</li>
          <li><b>{en ? "Each publication represents one game version." : (en ? "Each publication represents one game version." : "每次发布对应一份游戏内容。")}</b>{en ? "Share each game separately. After editing a game, generate and share a new link; previously shared links do not update automatically." : (en ? "Share each game separately. After editing a game, generate and share a new link; previously shared links do not update automatically." : "不同游戏分别分享；修改游戏后，请重新生成并分享链接。已经发出的旧链接不会自动更新。")}</li>
          <li><b>{en ? "Sharing does not depend on the creator’s device." : (en ? "Sharing does not depend on the creator’s device." : "分享不依赖设计者设备。")}</b>{en ? "Recipients can open the link to load its game content without your local save or your phone staying online. Player progress does not currently sync between players." : (en ? "Recipients can open the link to load its game content without your local save or your phone staying online. Player progress does not currently sync between players." : "接收者打开链接即可加载链接中携带的游戏内容，不需要你的本机存档，也不需要你的手机一直在线。玩家的游玩进度目前不会自动同步到其他玩家。")}</li>
          <li><b>{en ? "QR codes are the preferred option for in-person sharing." : (en ? "QR codes are the preferred option for in-person sharing." : "二维码是现场分享的优先方向。")}</b>{en ? "The designer currently supports link sharing; QR generation and saving are not yet available in this guide’s stated workflow. The planned priority is to display and save QR images on phones while keeping link sharing available." : (en ? "The designer currently supports link sharing; QR generation and saving are not yet available in this guide’s stated workflow. The planned priority is to display and save QR images on phones while keeping link sharing available." : "当前设计器提供链接分享，二维码生成与保存功能尚未上线。后续会优先完善手机展示二维码、保存二维码图片，同时保留复制或发送链接的方式。")}</li>
          <li><b>{en ? "No separate payment is needed for QR codes or AI." : (en ? "No separate payment is needed for QR codes or AI." : "不需要为二维码或 AI 单独付费。")}</b>{en ? "The plan is to generate QR codes locally in the mobile browser without calling AI services. Extra server costs will be considered only if short links or a cloud game library become necessary." : (en ? "The plan is to generate QR codes locally in the mobile browser without calling AI services. Extra server costs will be considered only if short links or a cloud game library become necessary." : "计划采用手机浏览器本地生成二维码，不调用 AI 服务；只有未来确实需要短链接或云端游戏库时，才评估额外的服务器与维护成本。")}</li>
        </ul>
      </section>

      <section className="card mt-4 p-5">
        <h3 className="text-base font-bold">{en ? "Get started" : (en ? "Get started" : "开始动手")}</h3>
        <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{en ? "Start with a small game of three to five stops. Make sure the full experience works before adding more stops or complex mechanics." : (en ? "Start with a small game of three to five stops. Make sure the full experience works before adding more stops or complex mechanics." : "建议先从 3–5 个站点的小型游戏开始。先做出一个能完整走通的版本，再增加站点和复杂玩法。")}</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Link href="/create" className="btn btn-primary text-center">{en ? "Create / import a game" : (en ? "Create / import a game" : "进入创建 / 导入游戏")}</Link>
          <Link href="/design" className="btn btn-secondary text-center">{en ? "Open designer" : (en ? "Open designer" : "打开设计器")}</Link>
          <Link href="/tutorial" className="btn btn-ghost text-center sm:col-span-2">{en ? "Watch the player demo" : (en ? "Watch the player demo" : "先看玩家游戏演示")}</Link>
        </div>
      </section>
    </Screen>
  );
}
