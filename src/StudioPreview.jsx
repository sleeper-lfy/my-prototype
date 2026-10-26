import React, { useState, useMemo, useEffect } from "react";
import { Stage, Layer, Group, Rect, Text, Line } from "react-konva";
import { DesignNode } from "./App.jsx";
import { computeLayout } from "./model.js";
import { localizedUI } from "./studioFeatures.js";
export default function StudioPreview({ pages, initialId, locale }) {
  const zh = locale === "zh-CN",
    t = (a, b) => (zh ? a : b);
  const [id, setId] = useState(initialId),
    [language, setLanguage] = useState("source"),
    [width, setWidth] = useState(960),
    [height, setHeight] = useState(600),
    [safe, setSafe] = useState(24),
    [runtime, setRuntime] = useState(null),
    [state, setState] = useState("normal"),
    [overflow, setOverflow] = useState([]);
  const source = pages.find((p) => p.id === id) || pages[0];
  useEffect(() => {
    setRuntime(structuredClone(source));
    setWidth(source.canvas.width);
    setHeight(source.canvas.height);
  }, [source]);
  const project = useMemo(
      () => (runtime ? localizedUI(runtime, language) : source),
      [runtime, language, source],
    ),
    layout = computeLayout(project);
  useEffect(() => {
    let live = true;
    const faces = [];
    Promise.all(
      project.assets
        .filter((a) => a.kind === "font")
        .map(async (a) => {
          const f = new FontFace(a.name, `url(${a.src})`);
          await f.load();
          if (live) {
            document.fonts.add(f);
            faces.push(f);
          }
        }),
    ).catch(() => {});
    return () => {
      live = false;
      faces.forEach((f) => document.fonts.delete(f));
    };
  }, [source.id]);
  const scale = Math.min(1, 900 / width, 520 / height),
    byId = new Map(project.nodes.map((n) => [n.id, n]));
  const visible = (n) => {
    for (let c = n; c; c = byId.get(c.parentId))
      if (c.visible === false) return false;
    return true;
  };
  function interact(node) {
    const next = structuredClone(runtime);
    for (const r of source.interactions || []) {
      if (r.sourceId !== node.id) continue;
      if (r.action === "page") {
        setId(r.targetId);
        return;
      }
      const target = next.nodes.find((n) => n.id === r.targetId);
      if (!target) continue;
      if (r.action === "setText") {
        target.style ??= {};
        target.style.text = r.text || "";
        for (const values of Object.values(next.translations || {}))
          delete values[target.id];
      } else
        target.visible =
          r.action === "open"
            ? true
            : r.action === "close"
              ? false
              : target.visible === false;
    }
    setRuntime(next);
  }
  async function fontCheck() {
    await document.fonts.ready;
    const warnings = [];
    for (const n of project.nodes.filter((n) => n.style?.text)) {
      const r = layout.get(n.id),
        canvas = document.createElement("canvas"),
        c = canvas.getContext("2d");
      c.font = `${n.style.fontSize || 14}px "${n.style.fontFamily || "sans-serif"}"`;
      const text = n.style.text;
      if (c.measureText(text).width > r.width)
        warnings.push(
          n.id + ": " + t("文字宽度超出组件", "text width exceeds component"),
        );
      if (!document.fonts.check(c.font, text))
        warnings.push(n.id + ": " + t("字体尚未加载", "font not loaded"));
      for (const ch of new Set(text)) {
        if (ch === " " || ch === "\n") continue;
        const a = document.createElement("canvas"),
          b = document.createElement("canvas");
        a.width = b.width = 80;
        a.height = b.height = 80;
        const ca = a.getContext("2d"),
          cb = b.getContext("2d");
        ca.font = cb.font = c.font;
        ca.fillText(ch, 4, 45);
        cb.fillText("\u{10ffff}", 4, 45);
        if (a.toDataURL() === b.toDataURL())
          warnings.push(
            n.id + ": " + t("疑似缺字 ", "possible missing glyph ") + ch,
          );
      }
    }
    setOverflow([...new Set(warnings)]);
  }
  return (
    <div
      className="feature-preview"
      data-testid="studio-preview"
      data-page={source.id}
      data-visible-count={project.nodes.filter(visible).length}
      data-texts={JSON.stringify(
        project.nodes
          .filter(visible)
          .map((n) => n.style?.text)
          .filter(Boolean),
      )}
    >
      <div className="feature-grid">
        <label>
          {t("预览页面", "Page")}
          <select
            aria-label={t("预览页面", "Page")}
            value={source.id}
            onChange={(e) => setId(e.target.value)}
          >
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("游戏文案语言", "Game text language")}
          <select
            aria-label={t("游戏文案语言", "Game text language")}
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="source">{t("原文", "Original")}</option>
            {Object.keys(source.translations || {}).map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label>
          {t("分辨率", "Resolution")}
          <select
            aria-label={t("分辨率", "Resolution")}
            defaultValue="custom"
            onChange={(e) => {
              if (e.target.value !== "custom") {
                const [w, h] = e.target.value.split("x").map(Number);
                setWidth(w);
                setHeight(h);
              }
            }}
          >
            <option value="custom">
              {t("自定义 / 原始", "Custom / Original")}
            </option>
            {["960x600", "1280x720", "1920x1080", "1920x1200", "2560x1080"].map(
              (s) => (
                <option key={s}>{s}</option>
              ),
            )}
          </select>
        </label>
        <label>
          {t("安全区（像素）", "Safe inset (px)")}
          <input
            type="number"
            value={safe}
            min="0"
            max="200"
            onChange={(e) => setSafe(Number(e.target.value))}
          />
        </label>
        <label>
          {t("按钮状态预览", "Button state")}
          <select
            aria-label={t("按钮状态预览", "Button state")}
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            {["normal", "hover", "pressed", "disabled"].map((s, i) => (
              <option value={s} key={s}>
                {t(["正常", "悬停", "按下", "禁用"][i], s)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="feature-grid">
        <label>
          {t("预览宽度（像素）", "Preview width (px)")}
          <input
            type="number"
            min="1"
            max="16384"
            value={width}
            onChange={(e) =>
              setWidth(Math.max(1, Math.min(16384, Number(e.target.value))))
            }
          />
        </label>
        <label>
          {t("预览高度（像素）", "Preview height (px)")}
          <input
            type="number"
            min="1"
            max="16384"
            value={height}
            onChange={(e) =>
              setHeight(Math.max(1, Math.min(16384, Number(e.target.value))))
            }
          />
        </label>
      </div>
      <p>
        {t(
          "点击组件测试已配置的交互；此预览使用原始坐标，不会自动拉伸布局。",
          "Click components to test configured interactions. Coordinates remain fixed; resizing does not invent responsive constraints.",
        )}
      </p>
      <div className="feature-preview-stage">
        <Stage
          width={width * scale}
          height={height * scale}
          scaleX={scale}
          scaleY={scale}
        >
          <Layer>
            <Rect
              width={width}
              height={height}
              fill={project.canvas.background}
            />
            {project.nodes.filter(visible).map((n) => {
              const asset = project.assets.find(
                (a) =>
                  a.id ===
                  (n.type === "Button"
                    ? (state === "disabled"
                        ? n.disabledAssetId
                        : n.buttonAssets?.[state]) || n.assetId
                    : n.assetId),
              );
              return (
                <DesignNode
                  key={n.id}
                  t={(k) => k}
                  node={{
                    ...n,
                    locked: true,
                  }}
                  rect={layout.get(n.id)}
                  asset={asset}
                  disabledDrag
                  onSelect={() => state !== "disabled" && interact(n)}
                  onMove={() => {}}
                  onDragMove={() => {}}
                  onTransform={() => {}}
                  showTip={() => {}}
                />
              );
            })}
            <Rect
              x={safe}
              y={safe}
              width={Math.max(0, width - safe * 2)}
              height={Math.max(0, height - safe * 2)}
              stroke="#edca78"
              dash={[6, 5]}
              listening={false}
            />
          </Layer>
        </Stage>
      </div>
      <button className="button" onClick={fontCheck}>
        {t("检查真实文字宽度与字体", "Check rendered text width and fonts")}
      </button>
      {overflow.map((s, i) => (
        <p key={i} className="feature-warning">
          {s}
        </p>
      ))}
      <p>
        {t(
          "缺字检测为浏览器字体渲染检查，字体回退和复杂文字排版仍需目视验收。",
          "Glyph checks use browser font rendering; fallback fonts and complex scripts still need visual review.",
        )}
      </p>
    </div>
  );
}
