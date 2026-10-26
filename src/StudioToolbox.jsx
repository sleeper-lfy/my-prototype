import React, { useState, useEffect, useRef } from "react";
import StudioPreview from "./StudioPreview.jsx";
import { measureMap } from "./studioFeatures.js";
import "./studioToolbox.css";
const call = async (path, body) => {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const v = await r.json();
  if (!r.ok) throw Error(v.error);
  return v;
};
const save = (url) => {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.click();
};
const bytes = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
function SliceEditor({ asset, onSave, t }) {
  const [m, setM] = useState(
      asset.margins || {
        left: 12,
        top: 12,
        right: 12,
        bottom: 12,
      },
    ),
    [size, setSize] = useState({
      width: 256,
      height: 160,
    }),
    drag = useRef(null);
  useEffect(
    () =>
      setM(
        asset.margins || {
          left: 12,
          top: 12,
          right: 12,
          bottom: 12,
        },
      ),
    [asset],
  );
  return (
    <div>
      <div
        className="slice-editor"
        onPointerMove={(e) => {
          if (!drag.current) return;
          const r = e.currentTarget.getBoundingClientRect(),
            edge = drag.current;
          setM((old) => ({
            ...old,
            [edge]: Math.max(
              0,
              Math.round(
                edge === "left"
                  ? e.clientX - r.left
                  : edge === "right"
                    ? r.right - e.clientX
                    : edge === "top"
                      ? e.clientY - r.top
                      : r.bottom - e.clientY,
              ),
            ),
          }));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <img
          src={asset.src}
          onLoad={(e) =>
            setSize({
              width: e.currentTarget.naturalWidth,
              height: e.currentTarget.naturalHeight,
            })
          }
          style={{
            width: size.width,
            height: size.height,
          }}
        />
        {Object.keys(m).map((edge) => (
          <span
            key={edge}
            role="slider"
            aria-label={t(
              {
                left: "左边界",
                right: "右边界",
                top: "上边界",
                bottom: "下边界",
              }[edge],
              edge,
            )}
            tabIndex={0}
            className={"slice-line " + edge}
            style={{
              [edge]: m[edge],
            }}
            onKeyDown={(e) => {
              if (
                ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(
                  e.key,
                )
              ) {
                e.preventDefault();
                setM((v) => ({
                  ...v,
                  [edge]: Math.max(
                    0,
                    v[edge] +
                      (["ArrowRight", "ArrowDown"].includes(e.key) ? 1 : -1),
                  ),
                }));
              }
            }}
            onPointerDown={(e) => {
              drag.current = edge;
              e.currentTarget.parentElement.setPointerCapture(e.pointerId);
            }}
          />
        ))}
      </div>
      <div className="feature-grid">
        {Object.keys(m).map((edge) => (
          <label key={edge}>
            {t(
              {
                left: "左",
                right: "右",
                top: "上",
                bottom: "下",
              }[edge],
              edge,
            )}
            <input
              type="number"
              min="0"
              value={m[edge]}
              onChange={(e) =>
                setM({
                  ...m,
                  [edge]: Math.max(0, Number(e.target.value)),
                })
              }
            />
          </label>
        ))}
      </div>
      <div
        className="slice-live"
        style={{
          borderImageSource: `url(${asset.src})`,
          borderImageSlice: `${m.top} ${m.right} ${m.bottom} ${m.left} fill`,
          borderWidth: `${m.top}px ${m.right}px ${m.bottom}px ${m.left}px`,
        }}
      >
        {t(
          "可拖动边界；拉伸效果预览",
          "Drag slice boundaries; stretched preview",
        )}
      </div>
      <button
        className="button primary"
        disabled={
          m.left + m.right >= size.width || m.top + m.bottom >= size.height
        }
        onClick={() => onSave(m)}
      >
        {t("保存九宫格", "Save nine-slice")}
      </button>
    </div>
  );
}
export default function StudioToolbox({
  locale,
  kind = "ui",
  selection,
  onClose,
}) {
  const zh = locale === "zh-CN",
    t = (a, b) => (zh ? a : b),
    [tab, setTab] = useState("projects"),
    [state, setState] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [dirty, setDirty] = useState(false);
  const [name, setName] = useState(""),
    [templateId, setTemplateId] = useState(""),
    [x, setX] = useState(0),
    [y, setY] = useState(0),
    [w, setW] = useState(2),
    [h, setH] = useState(2),
    [rotation, setRotation] = useState(0),
    [mirror, setMirror] = useState(false),
    [assetId, setAssetId] = useState(""),
    [tileW, setTileW] = useState(64),
    [tileH, setTileH] = useState(32),
    [margin, setMargin] = useState(0),
    [spacing, setSpacing] = useState(0),
    [sourceSize, setSourceSize] = useState({
      width: 0,
      height: 0,
    }),
    [issues, setIssues] = useState(null),
    [details, setDetails] = useState(null),
    [variants, setVariants] = useState({}),
    [allowed, setAllowed] = useState([]),
    [avoid, setAvoid] = useState(true),
    [rules, setRules] = useState([]),
    [translations, setTranslations] = useState({}),
    [gameLocale, setGameLocale] = useState("en"),
    [buttonId, setButtonId] = useState(""),
    [buttonAssets, setButtonAssets] = useState({}),
    [refOpacity, setRefOpacity] = useState(0.35),
    [distance, setDistance] = useState(null);
  const root = useRef(null),
    file = useRef(null),
    folder = useRef(null);
  useEffect(() => {
    call("/api/workbench")
      .then((v) => {
        setState(v);
        const p = v.library.projects.find(
            (p) => p.id === v.library.activeProjectId,
          ),
          ui = p.uiPages.find((d) => d.id === p.activeUIId);
        setRules(ui.interactions || []);
        setTranslations(ui.translations || {});
      })
      .catch((e) => setError(e.message));
    const prior = document.activeElement;
    root.current?.querySelector("button")?.focus();
    return () => prior?.focus?.();
  }, []);
  const project = state?.library.projects.find(
      (p) => p.id === state.library.activeProjectId,
    ),
    ui = project?.uiPages.find((d) => d.id === project.activeUIId),
    map = project?.maps.find((d) => d.id === project.activeMapId),
    asset = map?.assets.find((a) => a.id === assetId),
    uiAsset = ui?.assets.find((a) => a.id === assetId);
  useEffect(() => {
    if (!asset) return;
    let live = true;
    const i = new Image();
    i.onload = () => {
      if (live)
        setSourceSize({
          width: i.naturalWidth,
          height: i.naturalHeight,
        });
    };
    i.src = asset.src;
    return () => {
      live = false;
    };
  }, [asset?.src]);
  useEffect(() => {
    if (ui) {
      setRules(ui.interactions || []);
      setTranslations(ui.translations || {});
    }
    setAssetId("");
    setTemplateId("");
    setVariants({});
    setAllowed([]);
    setAvoid(true);
    setButtonId("");
    setButtonAssets({});
    setDetails(null);
  }, [project?.id, ui?.id, map?.id]);
  async function execute(fn) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function act(action, data = {}) {
    return execute(async () => {
      const v = await call("/api/workbench/action", {
        action,
        data,
        libraryRevision: state.library.revision,
        uiRevision: state.uiRevision,
        mapRevision: state.mapRevision,
      });
      setState(v);
      if (v.reload) setDirty(true);
      if (v.details) setDetails(v.details);
      setNotice(t("已保存到本机。", "Saved locally."));
      return v;
    });
  }
  const region =
    selection?.type === "region"
      ? selection
      : {
          x: Number(x),
          y: Number(y),
          width: Number(w),
          height: Number(h),
        };
  const ids = Array.isArray(selection) ? selection : [];
  const close = () => {
    if (dirty) location.reload();
    else onClose();
  };
  const numeric = (label, value, set, min = 0, max = 16384) => (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
      />
    </label>
  );
  const assetSelect = (label, items, value, set) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
      >
        <option value="">{t("选择…", "Choose…")}</option>
        {items.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
  const tabs = [
    ["projects", "项目与完整备份", "Projects & backup"],
    ["blocks", "地图块与模板", "Blocks & templates"],
    ["atlas", "瓦片图集", "Tile atlas"],
    ["terrain", "连接与放置规则", "Terrain & placement"],
    ["preview", "UI 交互预览", "UI preview"],
    ["behavior", "交互与文案", "Interactions & text"],
    ["assets", "九宫格与按钮", "Slices & buttons"],
    ["reference", "测量与参考图", "Measure & reference"],
    ["checks", "项目检查", "Project checks"],
    ["sync", "Godot 增量更新", "Godot updates"],
  ];
  return (
    <div className="feature-backdrop">
      <section
        ref={root}
        className="feature-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("项目工具箱", "Project toolbox")}
        data-testid="studio-toolbox"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            close();
          }
          if (e.key === "Tab") {
            const f = [
              ...root.current.querySelectorAll(
                "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
              ),
            ].filter((v) => v.offsetParent !== null);
            if (e.shiftKey && document.activeElement === f[0]) {
              e.preventDefault();
              f.at(-1)?.focus();
            }
            if (!e.shiftKey && document.activeElement === f.at(-1)) {
              e.preventDefault();
              f[0]?.focus();
            }
          }
        }}
      >
        <header>
          <h2>{t("项目工具箱", "Project toolbox")}</h2>
          <button disabled={busy} onClick={close}>
            {t(
              dirty ? "关闭并刷新编辑器" : "关闭",
              dirty ? "Close and refresh editor" : "Close",
            )}
          </button>
        </header>
        <div className="feature-layout">
          <nav>
            {tabs.map(([id, cn, en]) => (
              <button
                key={id}
                data-testid={"feature-tab-" + id}
                className={tab === id ? "active" : ""}
                onClick={() => {
                  setTab(id);
                  setAssetId("");
                  setError("");
                }}
              >
                {t(cn, en)}
              </button>
            ))}
          </nav>
          <main aria-busy={busy}>
            {error && (
              <div role="alert" className="feature-error">
                {t(
                  "操作失败，请查看技术详情。",
                  "Operation failed; see technical details.",
                )}
                <details>
                  <summary>{t("技术详情", "Technical details")}</summary>
                  {error}
                </details>
              </div>
            )}
            {notice && <p role="status">{notice}</p>}
            {!state ? (
              <p>{t("正在读取本地项目…", "Loading local projects…")}</p>
            ) : (
              <fieldset disabled={busy}>
                {tab === "projects" && (
                  <>
                    <h3>{project.name}</h3>
                    <div className="feature-grid">
                      <label>
                        {t("新名称", "New name")}
                        <input
                          data-testid="feature-name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </label>
                      <button
                        data-testid="project-create"
                        onClick={() =>
                          act("project-create", {
                            name,
                          })
                        }
                      >
                        {t("新建完整项目", "New project")}
                      </button>
                      <button
                        onClick={() =>
                          act("rename", {
                            name,
                          })
                        }
                      >
                        {t("重命名项目", "Rename project")}
                      </button>
                    </div>
                    <div className="feature-list">
                      {state.library.projects.map((p) => (
                        <button
                          key={p.id}
                          data-testid={"open-project-" + p.id}
                          onClick={() =>
                            act("project-open", {
                              id: p.id,
                            })
                          }
                        >
                          {p.id === project.id ? "● " : ""}
                          {p.name}
                        </button>
                      ))}
                    </div>
                    {[
                      ["ui", project.uiPages, "UI 页面", "UI pages"],
                      ["map", project.maps, "地图", "Maps"],
                    ].map(([k, docs, cn, en]) => (
                      <section key={k}>
                        <h4>{t(cn, en)}</h4>
                        <button
                          data-testid={"document-create-" + k}
                          onClick={() =>
                            act("document-create", {
                              kind: k,
                              name,
                            })
                          }
                        >
                          {t("新增", "Add")}
                        </button>
                        {docs.map((d) => (
                          <button
                            key={d.id}
                            data-testid={"open-doc-" + d.id}
                            onClick={() =>
                              act("document-open", {
                                kind: k,
                                id: d.id,
                              })
                            }
                          >
                            {d.name}{" "}
                            {d.id ===
                            (k === "ui"
                              ? project.activeUIId
                              : project.activeMapId)
                              ? "●"
                              : ""}
                          </button>
                        ))}
                      </section>
                    ))}
                    <hr />
                    <button
                      data-testid="workspace-export"
                      onClick={() =>
                        execute(async () =>
                          save(
                            (await call("/api/workbench/export", {}))
                              .downloadUrl,
                          ),
                        )
                      }
                    >
                      {t(
                        "导出完整项目 ZIP（含原始素材、评论、模板）",
                        "Export complete project ZIP (assets, reviews, templates)",
                      )}
                    </button>
                    <button onClick={() => file.current.click()}>
                      {t(
                        "导入完整项目 ZIP 为新项目",
                        "Import project ZIP as a new project",
                      )}
                    </button>
                    <input
                      hidden
                      ref={file}
                      data-testid="workspace-import"
                      type="file"
                      accept=".zip"
                      onChange={(e) => {
                        const f = e.target.files[0];
                        if (f)
                          execute(async () => {
                            const v = await call("/api/workbench/import", {
                              base64: await bytes(f),
                            });
                            setState(v);
                            setDirty(true);
                          });
                      }}
                    />
                    <p>
                      {t(
                        "导入创建独立项目，不覆盖已有项目。完整包会复制图片和字体，支持换电脑恢复。",
                        "Import creates a separate project. Packages include original images and fonts for another computer.",
                      )}
                    </p>
                  </>
                )}
                {tab === "blocks" && (
                  <>
                    <h3>
                      {t(
                        "可复用地图块与 UI 组件",
                        "Reusable map blocks and UI components",
                      )}
                    </h3>
                    <label>
                      {t("模板名称", "Template name")}
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <p>
                      {t(
                        "UI 使用编辑器当前多选；地图使用框选区域，也可在下方输入格子矩形。",
                        "UI uses the editor selection. Maps use the selected region or the rectangle below.",
                      )}
                    </p>
                    <div className="feature-grid">
                      {numeric("X", x, setX)}
                      {numeric("Y", y, setY)}
                      {numeric(t("宽（格）", "Width (cells)"), w, setW, 1, 128)}
                      {numeric(t("深（格）", "Depth (cells)"), h, setH, 1, 128)}
                    </div>
                    <button
                      data-testid="capture-template"
                      disabled={!name.trim() || (kind === "ui" && !ids.length)}
                      onClick={() =>
                        act(kind === "ui" ? "capture-ui" : "capture-block", {
                          name,
                          ids,
                          region,
                        })
                      }
                    >
                      {t("保存当前选区为模板", "Save selection as template")}
                    </button>
                    {assetSelect(
                      t("模板", "Template"),
                      project.templates.filter(
                        (t) =>
                          t.kind ===
                          (kind === "ui" ? "ui-component" : "map-block"),
                      ),
                      templateId,
                      setTemplateId,
                    )}
                    <div className="feature-grid">
                      <label>
                        {t("布局旋转", "Layout rotation")}
                        <select
                          aria-label={t("布局旋转", "Layout rotation")}
                          value={rotation}
                          onChange={(e) => setRotation(Number(e.target.value))}
                        >
                          {[0, 90, 180, 270].map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={mirror}
                          onChange={(e) => setMirror(e.target.checked)}
                        />
                        {t("镜像布局", "Mirror layout")}
                      </label>
                    </div>
                    <p>
                      {t(
                        "旋转/镜像变换格子、占地与锚点位置；方向性美术保持原图，应替换为对应方向素材。",
                        "Transforms affect grid layout, footprints and anchor positions. Directional artwork stays unchanged; supply matching directional assets.",
                      )}
                    </p>
                    <button
                      data-testid="place-template"
                      disabled={!templateId}
                      onClick={() =>
                        act("place-template", {
                          templateId,
                          x,
                          y,
                          rotation,
                          mirror,
                        })
                      }
                    >
                      {t("在 X/Y 放置关联实例", "Place linked instance at X/Y")}
                    </button>
                    <button
                      disabled={!templateId}
                      onClick={() =>
                        act("template-update", {
                          templateId,
                          ids,
                          region,
                        })
                      }
                    >
                      {t(
                        "用当前选区更新主模板",
                        "Update master from selection",
                      )}
                    </button>
                    <button
                      disabled={!templateId}
                      onClick={() =>
                        act("instances-preview", {
                          templateId,
                          kind,
                        })
                      }
                    >
                      {t("预览实例更新", "Preview instance updates")}
                    </button>
                    <button
                      disabled={!templateId}
                      onClick={() =>
                        act("instances-apply", {
                          templateId,
                        })
                      }
                    >
                      {t(
                        "更新实例并保留本地覆盖",
                        "Update instances, preserve overrides",
                      )}
                    </button>
                    {details && <pre>{JSON.stringify(details, null, 2)}</pre>}
                    <hr />
                    <h3>
                      {t("地图物件的方向美术", "Directional map artwork")}
                    </h3>
                    {assetSelect(
                      t("基础物件素材", "Base object asset"),
                      map.assets.filter((a) => a.kind === "object"),
                      assetId,
                      (value) => {
                        setAssetId(value);
                        setVariants(
                          map.assets.find((a) => a.id === value)?.directions ||
                            {},
                        );
                      },
                    )}
                    {["0", "90", "180", "270", "0m", "90m", "180m", "270m"].map(
                      (direction) =>
                        assetSelect(
                          direction.replace("m", "") +
                            "° " +
                            (direction.endsWith("m")
                              ? t("镜像", "mirror")
                              : ""),
                          map.assets.filter((a) => a.kind === "object"),
                          variants[direction] || "",
                          (value) =>
                            setVariants((old) => {
                              const next = { ...old };
                              if (value) next[direction] = value;
                              else delete next[direction];
                              return next;
                            }),
                        ),
                    )}
                    <button
                      disabled={!assetId}
                      onClick={() =>
                        act("map-directions", { assetId, directions: variants })
                      }
                    >
                      {t(
                        "保存对应方向素材（新地图块生效）",
                        "Save directional assets (new blocks)",
                      )}
                    </button>
                  </>
                )}
                {tab === "atlas" && (
                  <>
                    <h3>{t("自动切分瓦片图集", "Split a tile atlas")}</h3>
                    {assetSelect(
                      t("已导入素材", "Imported asset"),
                      map.assets,
                      assetId,
                      setAssetId,
                    )}
                    {asset && (
                      <img className="feature-reference" src={asset.src} />
                    )}
                    <p>
                      {sourceSize.width} × {sourceSize.height}
                    </p>
                    <div className="feature-grid">
                      {numeric(
                        t("单元宽（像素）", "Cell width (px)"),
                        tileW,
                        setTileW,
                        1,
                      )}
                      {numeric(
                        t("单元高（像素）", "Cell height (px)"),
                        tileH,
                        setTileH,
                        1,
                      )}
                      {numeric(t("外边距", "Margin"), margin, setMargin)}
                      {numeric(t("间距", "Spacing"), spacing, setSpacing)}
                    </div>
                    <button
                      data-testid="atlas-split"
                      disabled={!asset}
                      onClick={() =>
                        act("atlas-split", {
                          assetId,
                          sourceWidth: sourceSize.width,
                          sourceHeight: sourceSize.height,
                          width: tileW,
                          height: tileH,
                          margin,
                          spacing,
                        })
                      }
                    >
                      {t("切分并加入瓦片面板", "Split and add to tile palette")}
                    </button>
                    <p>
                      {t(
                        "原图不改变；每块瓦片保存源图裁切区域。",
                        "Original bytes remain intact; tiles reference source crop rectangles.",
                      )}
                    </p>
                  </>
                )}
                {tab === "terrain" && (
                  <>
                    <h3>
                      {t(
                        "道路、河流与围墙连接规则",
                        "Road, river and wall connections",
                      )}
                    </h3>
                    <label>
                      {t("规则名称", "Rule name")}
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <p>
                      {t(
                        "位掩码：北1、东2、南4、西8。至少配置默认0，其余用于端点、直线和转角。",
                        "Mask: north 1, east 2, south 4, west 8. Configure fallback 0 and optional endpoints, straight segments and corners.",
                      )}
                    </p>
                    <div className="feature-grid">
                      {Array.from(
                        {
                          length: 16,
                        },
                        (_, i) =>
                          assetSelect(
                            String(i),
                            map.assets.filter((a) => a.kind === "tile"),
                            variants[i] || "",
                            (v) =>
                              setVariants((old) => {
                                const next = {
                                  ...old,
                                };
                                if (v) next[i] = v;
                                else delete next[i];
                                return next;
                              }),
                          ),
                      )}
                    </div>
                    <button
                      data-testid="terrain-save"
                      disabled={!variants[0]}
                      onClick={() =>
                        act("terrain-rule", {
                          name,
                          variants,
                        })
                      }
                    >
                      {t(
                        "保存规则；画布中使用连接画笔",
                        "Save rule; use connected brush on canvas",
                      )}
                    </button>
                    <hr />
                    <h3>{t("素材放置规则", "Asset placement rules")}</h3>
                    {assetSelect(
                      t("物件素材", "Object asset"),
                      map.assets.filter((a) => a.kind === "object"),
                      assetId,
                      setAssetId,
                    )}
                    <label>
                      {t(
                        "允许的地形（不选则不限）",
                        "Allowed terrain (empty means any)",
                      )}
                      <select
                        aria-label={t(
                          "允许的地形（不选则不限）",
                          "Allowed terrain (empty means any)",
                        )}
                        multiple
                        value={allowed}
                        onChange={(e) =>
                          setAllowed(
                            [...e.target.selectedOptions].map((v) => v.value),
                          )
                        }
                      >
                        {map.assets
                          .filter((a) => a.kind === "tile")
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={avoid}
                        onChange={(e) => setAvoid(e.target.checked)}
                      />
                      {t(
                        "禁止同图层占地重叠",
                        "Avoid footprint overlap in the same layer",
                      )}
                    </label>
                    <button
                      disabled={!assetId}
                      data-testid="placement-rule-save"
                      onClick={() =>
                        act("placement-rule", {
                          assetId,
                          allowedTiles: allowed,
                          avoidOverlap: avoid,
                        })
                      }
                    >
                      {t("保存放置规则", "Save placement rule")}
                    </button>
                  </>
                )}
                {tab === "preview" && (
                  <StudioPreview
                    pages={project.uiPages}
                    initialId={ui.id}
                    locale={locale}
                  />
                )}
                {tab === "behavior" && (
                  <>
                    <h3>{t("点击交互规则", "Click interactions")}</h3>
                    {rules.map((r, i) => (
                      <div className="feature-rule" key={i}>
                        {assetSelect(
                          t("源组件", "Source"),
                          ui.nodes,
                          r.sourceId,
                          (v) =>
                            setRules((old) =>
                              old.map((r, j) =>
                                j === i
                                  ? {
                                      ...r,
                                      sourceId: v,
                                    }
                                  : r,
                              ),
                            ),
                        )}
                        <label>
                          {t("动作", "Action")}
                          <select
                            aria-label={t("动作", "Action")}
                            value={r.action}
                            onChange={(e) =>
                              setRules((old) =>
                                old.map((r, j) =>
                                  j === i
                                    ? {
                                        ...r,
                                        action: e.target.value,
                                        targetId: "",
                                      }
                                    : r,
                                ),
                              )
                            }
                          >
                            {["open", "close", "toggle", "page", "setText"].map(
                              (a, j) => (
                                <option value={a} key={a}>
                                  {t(
                                    [
                                      "打开",
                                      "关闭",
                                      "切换可见性",
                                      "切换页面",
                                      "更新文字",
                                    ][j],
                                    a,
                                  )}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                        {assetSelect(
                          t("目标", "Target"),
                          r.action === "page" ? project.uiPages : ui.nodes,
                          r.targetId,
                          (v) =>
                            setRules((old) =>
                              old.map((r, j) =>
                                j === i
                                  ? {
                                      ...r,
                                      targetId: v,
                                    }
                                  : r,
                              ),
                            ),
                        )}
                        {r.action === "setText" && (
                          <input
                            aria-label={t("交互文字", "Interaction text")}
                            value={r.text || ""}
                            onChange={(e) =>
                              setRules((old) =>
                                old.map((r, j) =>
                                  j === i
                                    ? {
                                        ...r,
                                        text: e.target.value,
                                      }
                                    : r,
                                ),
                              )
                            }
                          />
                        )}
                        <button
                          onClick={() =>
                            setRules((old) => old.filter((_, j) => j !== i))
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      data-testid="interaction-add"
                      onClick={() =>
                        setRules([
                          ...rules,
                          {
                            sourceId:
                              ui.nodes.find((n) => n.type === "Button")?.id ||
                              "",
                            action: "toggle",
                            targetId: ui.nodes[0]?.id || "",
                          },
                        ])
                      }
                    >
                      {t("添加交互", "Add interaction")}
                    </button>
                    <h3>{t("游戏文案翻译", "Game text translations")}</h3>
                    <label>
                      {t("语言代码", "Language code")}
                      <input
                        value={gameLocale}
                        onChange={(e) => setGameLocale(e.target.value)}
                      />
                    </label>
                    {ui.nodes
                      .filter((n) => n.style?.text)
                      .map((n) => (
                        <label key={n.id}>
                          {n.name}
                          <small>{n.style.text}</small>
                          <input
                            data-testid={"translation-" + n.id}
                            value={translations[gameLocale]?.[n.id] ?? ""}
                            onChange={(e) =>
                              setTranslations({
                                ...translations,
                                [gameLocale]: {
                                  ...translations[gameLocale],
                                  [n.id]: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                    <button
                      data-testid="behavior-save"
                      onClick={() =>
                        act("ui-behavior", {
                          interactions: rules,
                          translations,
                        })
                      }
                    >
                      {t(
                        "保存交互与翻译",
                        "Save interactions and translations",
                      )}
                    </button>
                  </>
                )}
                {tab === "assets" && (
                  <>
                    <h3>{t("九宫格边界编辑", "Nine-slice boundaries")}</h3>
                    {assetSelect(
                      t("图片素材", "Image asset"),
                      ui.assets.filter((a) => a.kind !== "font"),
                      assetId,
                      setAssetId,
                    )}
                    {uiAsset && (
                      <SliceEditor
                        asset={uiAsset}
                        t={t}
                        onSave={(m) =>
                          act("nine-slice", {
                            assetId,
                            margins: m,
                          })
                        }
                      />
                    )}
                    <hr />
                    <h3>{t("按钮各状态贴图", "Button state artwork")}</h3>
                    {assetSelect(
                      t("按钮", "Button"),
                      ui.nodes.filter((n) => n.type === "Button"),
                      buttonId,
                      (id) => {
                        setButtonId(id);
                        const n = ui.nodes.find((n) => n.id === id);
                        setButtonAssets({
                          ...n.buttonAssets,
                          disabled: n.disabledAssetId,
                        });
                      },
                    )}
                    {["normal", "hover", "pressed", "disabled"].map((s, i) =>
                      assetSelect(
                        t(["正常", "悬停", "按下", "禁用"][i], s),
                        ui.assets.filter((a) => a.kind !== "font"),
                        buttonAssets[s] || "",
                        (v) =>
                          setButtonAssets({
                            ...buttonAssets,
                            [s]: v,
                          }),
                      ),
                    )}
                    <button
                      data-testid="button-states-save"
                      disabled={!buttonId}
                      onClick={() =>
                        act("button-states", {
                          nodeId: buttonId,
                          ...buttonAssets,
                        })
                      }
                    >
                      {t("保存按钮状态", "Save button states")}
                    </button>
                  </>
                )}
                {tab === "reference" && (
                  <>
                    <h3>{t("锁定参考覆盖图", "Locked reference overlay")}</h3>
                    {assetSelect(
                      t("参考图片素材", "Reference asset"),
                      map.assets,
                      assetId,
                      setAssetId,
                    )}
                    <div className="feature-grid">
                      {numeric("X", x, setX, -32768)}
                      {numeric("Y", y, setY, -32768)}
                      {numeric(t("宽（像素）", "Width (px)"), w, setW, 1)}
                      {numeric(t("高（像素）", "Height (px)"), h, setH, 1)}
                      <label>
                        {t("透明度", "Opacity")}
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step=".05"
                          value={refOpacity}
                          onChange={(e) =>
                            setRefOpacity(Number(e.target.value))
                          }
                        />
                      </label>
                    </div>
                    <button
                      disabled={!assetId}
                      data-testid="reference-save"
                      onClick={() =>
                        act("reference", {
                          reference: {
                            assetId,
                            x,
                            y,
                            width: w,
                            height: h,
                            opacity: refOpacity,
                            visible: true,
                            locked: true,
                          },
                        })
                      }
                    >
                      {t("显示锁定参考图", "Show locked reference")}
                    </button>
                    <button
                      onClick={() =>
                        act("reference", {
                          reference: null,
                        })
                      }
                    >
                      {t("移除覆盖图", "Remove overlay")}
                    </button>
                    <h3>
                      {t("格距离与可通过距离", "Grid and walkable distance")}
                    </h3>
                    <p>
                      {t(
                        "画布测量工具可点选两格；下方也可计算从 (X,Y) 到 (宽,深) 的距离。",
                        "Use the canvas measure tool, or measure from (X,Y) to (Width,Depth) above.",
                      )}
                    </p>
                    <button
                      onClick={() =>
                        setDistance(
                          measureMap(
                            map,
                            {
                              x,
                              y,
                            },
                            {
                              x: w,
                              y: h,
                            },
                          ),
                        )
                      }
                    >
                      {t("测量两点", "Measure points")}
                    </button>
                    {distance && (
                      <dl>
                        {Object.entries(distance).map(([key, value]) => (
                          <React.Fragment key={key}>
                            <dt>
                              {t(
                                {
                                  gridManhattan: "网格距离",
                                  gridEuclidean: "直线格距离",
                                  walkablePath: "可行走路径长度",
                                  terrainSpanX: "同地形 X 连续宽度",
                                  terrainSpanY: "同地形 Y 连续宽度",
                                  clearanceX: "X 可通过宽度",
                                  clearanceY: "Y 可通过宽度",
                                }[key] || key,
                                key,
                              )}
                            </dt>
                            <dd>{value ?? t("不可到达", "Unreachable")}</dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    )}
                  </>
                )}
                {tab === "checks" && (
                  <>
                    <button
                      data-testid="run-project-checks"
                      onClick={() =>
                        execute(async () =>
                          setIssues(
                            (await call("/api/workbench/checks", {})).issues,
                          ),
                        )
                      }
                    >
                      {t(
                        "检查当前页面、地图与素材",
                        "Check current page, map and assets",
                      )}
                    </button>
                    {issues && (
                      <p>
                        {issues.length}{" "}
                        {t(
                          "项提示；文字估算需在 UI 预览中实测确认。",
                          "findings; confirm text estimates in UI preview.",
                        )}
                      </p>
                    )}
                    {issues?.map((r, i) => (
                      <p className="feature-warning" key={i}>
                        <b>{r.target}</b> ·{" "}
                        {t(
                          {
                            bounds: "组件越界",
                            "text-overflow": "疑似文字溢出",
                            "missing-spawn": "没有出生点",
                            "blocked-spawn": "出生点被阻挡",
                            "unreachable-exit": "出口无法到达",
                            "missing-asset": "素材缺失",
                          }[r.kind] || r.kind,
                          r.kind,
                        )}
                      </p>
                    ))}
                  </>
                )}
                {tab === "sync" && (
                  <>
                    <h3>
                      {t(
                        "Godot 冲突预览与增量更新",
                        "Godot conflict preview and incremental updates",
                      )}
                    </h3>
                    <p>
                      {t(
                        "仅管理 studio_generated/；用户脚本和外部业务节点保留。选择现有 Godot 项目文件夹查看冲突，再下载更新包。",
                        "Only studio_generated/ is managed. User scripts and external gameplay scenes remain untouched. Select an existing Godot project folder to inspect conflicts, then download an update.",
                      )}
                    </p>
                    <button onClick={() => folder.current.click()}>
                      {t(
                        "选择 Godot 项目文件夹以预览",
                        "Choose Godot folder to preview",
                      )}
                    </button>
                    <input
                      ref={folder}
                      hidden
                      type="file"
                      webkitdirectory=""
                      multiple
                      data-testid="godot-folder"
                      onChange={(e) =>
                        execute(async () => {
                          const actual = {};
                          let previous = {
                            files: {},
                          };
                          for (const f of e.target.files) {
                            const rel = f.webkitRelativePath
                              .split("/")
                              .slice(1)
                              .join("/");
                            if (rel === ".studio-sync.json")
                              previous = JSON.parse(await f.text());
                            if (rel.startsWith("studio_generated/")) {
                              const digest = await crypto.subtle.digest(
                                "SHA-256",
                                await f.arrayBuffer(),
                              );
                              actual[rel] = [...new Uint8Array(digest)]
                                .map((v) => v.toString(16).padStart(2, "0"))
                                .join("");
                            }
                          }
                          setDetails(
                            await call("/api/workbench/sync-preview", {
                              actual,
                              previous,
                            }),
                          );
                        })
                      }
                    />
                    {details?.changes && (
                      <div>
                        {details.changes.map((r) => (
                          <p
                            key={r.path}
                            className={
                              r.action === "conflict" ? "feature-warning" : ""
                            }
                          >
                            {r.action} · {r.path}
                          </p>
                        ))}
                      </div>
                    )}
                    <button
                      data-testid="godot-update-export"
                      onClick={() =>
                        execute(async () =>
                          save(
                            (await call("/api/workbench/godot", { kind }))
                              .downloadUrl,
                          ),
                        )
                      }
                    >
                      {t(
                        "下载可审阅的增量更新包",
                        "Download incremental update package",
                      )}
                    </button>
                    <p>
                      {t(
                        "解压后运行以下命令先预览，再加 --apply 应用。冲突需要逐个用 --accept 精确路径确认；已有生成文件先备份。Windows 安装版可使用内置 node.exe。",
                        "Extract, run the command to preview, then add --apply. Each conflict requires --accept with its exact path; replaced generated files are backed up. The installed Windows app includes node.exe.",
                      )}
                    </p>
                    <pre>
                      node sync.mjs --project "C:\Games\MyGodotProject"
                      {"\n"}node sync.mjs --project "C:\Games\MyGodotProject"
                      --apply
                    </pre>
                  </>
                )}
              </fieldset>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}
