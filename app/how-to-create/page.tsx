"use client";

import Link from "next/link";
import { useState } from "react";
import { Screen } from "@/components/ui";

const PROMPT = `你是 MOS Scene Hunt 的户外寻宝游戏设计助手。请帮助我设计一款手机优先、能在真实地点游玩的轻量游戏。

开始前先确认：玩家是谁、游戏地点、时长、主题。然后设计一场完整的探索，不要把所有站点都做成选择题。请混合使用：现场观察、寻找特征、图片辨认、简单谜题、关键词收集、团队合作、创意拍照（不拍陌生人）、路线发现和最终宝藏任务。

必须设计一个明确的“宝”：可以是小礼物、纪念卡、贴纸、徽章、合照、祝福卡或一项真实体验。写清楚宝藏是什么、放在哪里或由谁保管、玩家完成什么条件可以领取、由谁兑现、如何避免提前泄露。若无法现场发放实物，请提供可兑现的数字奖励或体验奖励。最后一站必须有明确的领取/兑现步骤，不能只写一句“恭喜通关”。

每个站点都要包含：简短标题、故事或情境、现场行动、任务问题、提示、完成条件、奖励，以及建议使用的图片/文件。内容简洁、可执行、安全，不要求玩家进入私人或危险区域。每一站玩法要有变化，避免连续重复同一种题型。

请输出一个完整、严格有效的 JSON 游戏对象，顶层字段包括：id、language、title、description、author、version、estimatedMinutes、difficulty、startLocation、huntArea、entrySceneId、scenes。每个站点包括：id、title、story、briefing、location、nextSceneId、challenge、reward；可用 media 数组附加图片或文件。challenge 类型只能是 choice、text、keyword。choice 必须有 question、options（2至4项）、answer（正确选项从0开始的下标）；text/keyword 必须有 question、answer（可接受答案字符串数组）、hint。若属于观察或团队任务，可将行动要求写在 story/briefing 中，再用简短提交题确认完成。媒体项格式：{ "id":"唯一编号", "kind":"image 或 document", "title":"资源名称", "url":"可访问的 https 图片或文件地址", "description":"用途" }。不要编造图片链接；如果没有可靠地址，请在建议中注明由设计者上传本地图片。

所有 id 唯一，entrySceneId 指向第一站，nextSceneId 按路线连接，最后一站为 null。不要编造真实 GPS 坐标：startLocation、huntArea.center 和每个 scene.location 的 lat、lng 暂时填 0。导入后必须在设计器地图上标定真实地点，逐站调整坐标、区域和触发距离，再进行现场试玩。

请先问我最多三个关键问题；若我已经说明，直接设计。最后在 JSON 之外列出：现场需要确认的地点、需要准备的宝藏、需要上传的图片/文件，以及安全检查清单。`;

export default function HowToCreatePage() {
  const [copied, setCopied] = useState(false);
  async function copyPrompt() {
    try { await navigator.clipboard.writeText(PROMPT); setCopied(true); }
    catch { setCopied(false); window.prompt("复制下面的指令：", PROMPT); }
  }
  return (
    <Screen title="创作说明">
      <section className="card p-5">
        <p className="game-kicker">MOS SCENE HUNT · 创作指南</p>
        <h2 className="mt-2 text-2xl font-bold">从一个想法，到一场真正能玩的寻宝</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">先想好玩家要经历什么，再把故事、地图、任务和奖励连起来。无需编程，AI 可以帮你起草，真实地点和宝藏兑现仍由设计者负责。</p>
      </section>
      <section className="card mt-3 p-5">
        <h3 className="font-bold">五步完成创作</h3>
        <ol className="mt-3 space-y-4 text-sm leading-relaxed">
          <li><b>1. 确定主题与玩家</b><p className="mt-1 text-[var(--muted)]">明确谁来玩、在哪里玩、玩多久、想带来什么体验。第一次建议 10–30 分钟，路线短、容易完成。</p></li>
          <li><b>2. 先选定一个“宝”，并设计兑现方式</b><p className="mt-1 text-[var(--muted)]">可以是小礼物、纪念卡、贴纸、徽章、合照或一项体验。提前决定由谁保管、玩家达到什么条件领取、在哪里领取。没有兑现安排的奖励不算完成设计。</p></li>
          <li><b>3. 选定安全区域和路线</b><p className="mt-1 text-[var(--muted)]">一个点也可以开始；多站游戏应使用 3 个以上的点。地图上的每个点都要与任务对应，按真实步行路线安排顺序，并检查开放时间、无障碍与 GPS 误差。</p></li>
          <li><b>4. 设计有变化的任务，并加入图片/文件</b><p className="mt-1 text-[var(--muted)]">不要每站都做选择题。交替使用现场观察、找特征、图片辨认、简单谜题、关键词收集、团队合作和创意任务。可在创作中心为站点添加图片、说明文件或任务配图；只使用自己有权使用的素材。</p></li>
          <li><b>5. 导入、现场标点、试玩并兑现</b><p className="mt-1 text-[var(--muted)]">把 AI 输出保存成 UTF-8 编码的 .json 文件（只保存 JSON，不要附带 Markdown 说明），或使用可编辑 Markdown/Word 设计稿。导入后在地图上逐站设置真实坐标，检查任务、触发范围、图片显示和最后的宝藏领取流程，再实际走一遍。</p></li>
        </ol>
      </section>
      <section className="card mt-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="font-bold">AI 创作指令</h3><p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">复制到你常用的 ChatGPT、Claude、Gemini 或其他 AI。MOS Scene Hunt 不会因此自动调用 AI。</p></div>
          <button className="btn btn-primary shrink-0" onClick={copyPrompt}>{copied ? "已复制" : "复制指令"}</button>
        </div>
        <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--surface)] p-3 text-xs leading-relaxed">{PROMPT}</pre>
      </section>
      <section className="card mt-3 p-5">
        <h3 className="font-bold">文件与素材要求</h3>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-[var(--muted)]">
          <li><b>JSON：</b>完整游戏数据；使用 UTF-8 编码，文件名可用游戏名称.json。</li>
          <li><b>Markdown：</b>适合人工阅读和修改，导入前确认字段结构完整。</li>
          <li><b>Word：</b>适合先写故事、地点和任务草稿；复杂媒体与逻辑以设计器和 JSON 为准。</li>
          <li><b>图片/文件：</b>可以为地点、线索、谜题或奖励提供视觉提示。优先上传清晰、体积适中的图片；不要用图片代替必要的文字说明，也不要放入私人信息。</li>
          <li><b>坐标：</b>AI 不知道你现场的真实 GPS。0,0 只是待设置占位值，导入后必须逐点在地图上标定。</li>
        </ul>
      </section>
      <section className="card mt-3 p-5">
        <h3 className="font-bold">发布前检查</h3>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-[var(--muted)]">
          <li>路线位于安全、开放的公共区域，不要求翻越围栏或进入私人空间。</li>
          <li>每个任务都有清楚的完成条件，提示可用，玩法有变化。</li>
          <li>最后一站明确写出宝藏领取地点、负责人和兑现方法。</li>
          <li>所有图片和文件均能打开，素材使用有授权。</li>
          <li>设计者已实地试玩；AI 生成的占位坐标绝不能直接作为正式地点。</li>
        </ul>
      </section>
      <section className="card mt-3 p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <Link href="/create" className="btn btn-primary text-center">进入创作中心</Link>
          <Link href="/tutorial" className="btn btn-secondary text-center">体验玩家演示</Link>
        </div>
      </section>
    </Screen>
  );
}
