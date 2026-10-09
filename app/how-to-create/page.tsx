"use client";

import Link from "next/link";
import { useState } from "react";
import { Screen } from "@/components/ui";

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
startLocation 和每个 scene.location 的 lat、lng 暂时统一填 0。0,0 只是明显的待设置占位值，不是真实地点。导入后，设计者必须进入 MOS Scene Hunt 设计器，用地图逐一设置起点、探索区域和每一站的真实坐标，再检查路线并试玩。不要声称游戏已经完成定位。

请先向我询问最多三个简单问题，了解游戏给谁玩、在哪里玩、想玩多久。若我已经说明，就不要重复询问，直接开始设计。允许我用自然语言反复修改游戏。最后请输出完整 JSON，并在 JSON 代码块之外列出需要我现场确认的事项。`;

export default function HowToCreatePage() {
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
    <Screen title="教你设计游戏" subtitle="不懂编程，也能借助自己常用的 AI 创作">
      <section className="card p-5">
        <p className="game-kicker">MOS SCENE HUNT · 新手指南</p>
        <h2 className="mt-2 text-2xl font-bold">从一个想法，到一款可以试玩的游戏</h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">你不需要在 MOS Scene Hunt 里购买或调用 AI。打开自己已经能使用的 ChatGPT、Claude、Gemini 或其他 AI，把下面的设计指令复制过去，按它的提问逐步完成即可。</p>
      </section>

      <section className="card mt-4 p-5">
        <h3 className="text-base font-bold">照着做，只需 5 步</h3>
        <ol className="mt-3 space-y-3 text-sm leading-relaxed">
          <li><b>1. 说出你的想法。</b><p className="mt-1 text-[var(--muted)]">例如：“给朋友聚会设计一个 15 分钟的户外寻宝游戏，有 5 个站点，轻松搞笑。”</p></li>
          <li><b>2. 复制下面的指令，交给你常用的 AI。</b><p className="mt-1 text-[var(--muted)]">AI 会先问几个简单问题，再帮你生成故事、站点、线索、题目和奖励。</p></li>
          <li><b>3. 反复修改，直到你喜欢。</b><p className="mt-1 text-[var(--muted)]">直接说“题目太难，改简单一点”“减少到 4 站”“把知识题改成观察挑战”。</p></li>
          <li><b>4. 让 AI 输出完整 JSON 文件。</b><p className="mt-1 text-[var(--muted)]">请它只输出严格有效的 JSON。复制 JSON 代码块到纯文本编辑器，保存为游戏名.json，编码选择 UTF-8。不要把 Markdown 说明一起保存进文件。</p></li>
          <li><b>5. 导入、设置地点、试玩。</b><p className="mt-1 text-[var(--muted)]">进入创建游戏页面，导入 JSON；再进入设计器，用地图设置真实起点和各站坐标，检查题目、路线与触发范围，最后在户外试玩。</p></li>
        </ol>
      </section>

      <section className="card mt-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="text-base font-bold">AI 游戏设计指令</h3><p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">复制整段内容，粘贴到你常用的 AI 对话中。</p></div>
          <button type="button" className="btn btn-primary shrink-0" onClick={copyPrompt}>{copied ? "已复制" : "复制指令"}</button>
        </div>
        <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--surface)] p-3 text-xs leading-relaxed">{PROMPT}</pre>
      </section>

      <section className="card mt-4 p-5">
        <h3 className="text-base font-bold">特别注意：AI 不知道你现场的真实坐标</h3>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-[var(--muted)]">
          <li>AI 可以设计故事、题目、线索和奖励，但不能凭空知道每个站点的真实 GPS 坐标。</li>
          <li>指令中的 0,0 是待设置标记，不是真实位置。导入后必须在设计器中把起点、区域和所有站点逐一标到真实地点。</li>
          <li>请在安全、开放的户外区域标定；不要把触发半径设得过小，也不要把路线安排到私人区域或危险道路。</li>
          <li>导入成功不代表游戏已经完成。请先检查设计器里的验证结果，再到现场试玩。</li>
        </ul>
      </section>

      <section className="card mt-4 p-5">
        <h3 className="text-base font-bold">开始动手</h3>
        <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">建议先从 3–5 个站点的小型游戏开始。先做出一个能完整走通的版本，再增加站点和复杂玩法。</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Link href="/create" className="btn btn-primary text-center">进入创建 / 导入游戏</Link>
          <Link href="/design" className="btn btn-secondary text-center">打开设计器</Link>
          <Link href="/tutorial" className="btn btn-ghost text-center sm:col-span-2">先看玩家游戏演示</Link>
        </div>
      </section>
    </Screen>
  );
}
