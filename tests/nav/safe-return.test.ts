/**
 * `?from=` must only ever produce an in-app path.
 *
 * A return target that accepts arbitrary input is an open redirect: the player
 * taps 返回 inside our own UI and lands on someone else's site. These cases are
 * the whole allow-list — and the whole encoding-bypass family, which is why any
 * `%` is rejected outright instead of being decoded and re-checked.
 *
 * The allow-list is exactly as large as the deployed routes: `/games`, `/explore`
 * and `/explore/<pack id>`. The old branch also allowed `/cities/...`; production
 * has no city pages, so that entry is gone with the feature.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_RETURN_PATH, resolveReturnTarget, safeReturnPath } from "@/lib/nav/safe-return";

describe("safeReturnPath — 允许", () => {
  it("探索中心、探索目录与合法探索包 id", () => {
    expect(safeReturnPath("/games")).toBe("/games");
    expect(safeReturnPath("/explore")).toBe("/explore");
    expect(safeReturnPath("/explore/rizal-park-discovery")).toBe("/explore/rizal-park-discovery");
    expect(safeReturnPath("/explore/demo-pack")).toBe("/explore/demo-pack");
  });
});

describe("safeReturnPath — 拒绝站外与协议", () => {
  it("绝对地址与协议", () => {
    expect(safeReturnPath("https://evil.example/explore")).toBeNull();
    expect(safeReturnPath("http://evil.example/explore")).toBeNull();
    expect(safeReturnPath("HTTPS://evil.example")).toBeNull();
    expect(safeReturnPath("javascript:alert(1)")).toBeNull();
    expect(safeReturnPath("data:text/html,<script>")).toBeNull();
    expect(safeReturnPath("mailto:someone@example.com")).toBeNull();
  });

  it("协议相对地址与反斜杠", () => {
    expect(safeReturnPath("//evil.example/explore")).toBeNull();
    expect(safeReturnPath("///evil.example")).toBeNull();
    expect(safeReturnPath("/\\evil.example")).toBeNull();
    expect(safeReturnPath("\\/evil.example")).toBeNull();
    expect(safeReturnPath("/explore\\demo-pack")).toBeNull();
  });

  it("缺少前导斜杠的相对路径", () => {
    expect(safeReturnPath("explore")).toBeNull();
    expect(safeReturnPath("explore/demo-pack")).toBeNull();
    expect(safeReturnPath("./explore")).toBeNull();
  });
});

describe("safeReturnPath — 拒绝编码绕过", () => {
  it("任何百分号编码都被拒绝（这些目标本来就不需要编码）", () => {
    expect(safeReturnPath("/explore/%2F%2Fevil.example")).toBeNull();
    expect(safeReturnPath("/explore/%2f%2fevil.example")).toBeNull();
    expect(safeReturnPath("/explore/%5Cevil.example")).toBeNull();
    expect(safeReturnPath("/%65xplore")).toBeNull();
    expect(safeReturnPath("/explore%2Fdemo-pack")).toBeNull();
    expect(safeReturnPath("/explore/demo%2Dpack")).toBeNull();
    expect(safeReturnPath("/explore/%252F%252Fevil.example")).toBeNull();
    expect(safeReturnPath("/explore/%2e%2e")).toBeNull();
    expect(safeReturnPath("/explore/%00")).toBeNull();
  });

  it("形似但非法的路径不会被规范化成合法目标", () => {
    expect(safeReturnPath("/explore/..")).toBeNull();
    expect(safeReturnPath("/explore/.")).toBeNull();
    expect(safeReturnPath("/./explore")).toBeNull();
    expect(safeReturnPath("/explore//demo-pack")).toBeNull();
    expect(safeReturnPath("//explore")).toBeNull();
    expect(safeReturnPath("/explore/demo-pack/")).toBeNull();
    expect(safeReturnPath("/explore/demo-pack/x")).toBeNull();
    expect(safeReturnPath("/explorex")).toBeNull();
  });

  it("查询串与锚点不属于允许形状", () => {
    expect(safeReturnPath("/explore?x=1")).toBeNull();
    expect(safeReturnPath("/explore#top")).toBeNull();
    expect(safeReturnPath("/explore/demo-pack?a=b")).toBeNull();
  });

  it("其他站内路由不在允许清单内", () => {
    expect(safeReturnPath("/select")).toBeNull();
    expect(safeReturnPath("/map")).toBeNull();
    expect(safeReturnPath("/cities")).toBeNull();
    expect(safeReturnPath("/cities/manila-ph")).toBeNull();
    expect(safeReturnPath("/admin/works")).toBeNull();
  });
});

describe("safeReturnPath — 边界输入", () => {
  it("空值与非字符串", () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath("")).toBeNull();
  });

  it("空白与控制字符", () => {
    expect(safeReturnPath(" /explore")).toBeNull();
    expect(safeReturnPath("/explore ")).toBeNull();
    expect(safeReturnPath("/explore\n")).toBeNull();
    expect(safeReturnPath("/explore\r\nLocation: //evil.example")).toBeNull();
    expect(safeReturnPath("/explore\u0000")).toBeNull();
    expect(safeReturnPath("/expl\u0009ore")).toBeNull();
  });

  it("超长输入", () => {
    expect(safeReturnPath(`/explore/${"a".repeat(600)}`)).toBeNull();
  });
});

describe("resolveReturnTarget — 安全默认落点", () => {
  it("合法目标原样返回", () => {
    expect(resolveReturnTarget("/explore/demo-pack")).toBe("/explore/demo-pack");
  });

  it("参数存在但不可用时退到探索中心，而不是外站", () => {
    expect(resolveReturnTarget("https://evil.example")).toBe(DEFAULT_RETURN_PATH);
    expect(resolveReturnTarget("//evil.example")).toBe(DEFAULT_RETURN_PATH);
    expect(resolveReturnTarget("/explore/%2F%2Fevil.example")).toBe(DEFAULT_RETURN_PATH);
  });

  it("参数缺失时返回 null，交回浏览器历史", () => {
    expect(resolveReturnTarget(null)).toBeNull();
    expect(resolveReturnTarget(undefined)).toBeNull();
    expect(resolveReturnTarget("")).toBeNull();
  });
});

describe("safeReturnPath — 探索页（2026-11-05）", () => {
  it("探索目录与合法探索包 id 允许返回", () => {
    expect(safeReturnPath("/explore")).toBe("/explore");
    expect(safeReturnPath("/explore/rizal-park-discovery")).toBe("/explore/rizal-park-discovery");
  });

  it("多层路径、非法 id 与大写 id 一律拒绝", () => {
    expect(safeReturnPath("/explore/category/place-activity")).toBeNull();
    expect(safeReturnPath("/explore/../etc")).toBeNull();
    expect(safeReturnPath("/explore/Rizal-Park")).toBeNull();
    expect(safeReturnPath("/explore/")).toBeNull();
  });

  it("不可用的探索返回目标退到探索中心，不跳出站外", () => {
    expect(resolveReturnTarget("/explore/../etc")).toBe(DEFAULT_RETURN_PATH);
  });
});
