import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Stage,
  Layer,
  Group,
  Rect,
  Text,
  Image as KImage,
  Transformer,
  Circle,
  Line,
} from "react-konva";
import { computeLayout, validateProject, makeId } from "./model.js";
import { snapRectangle, movableSelection, descendantsOf, selectionBounds, alignmentUpdates } from './snapGuides.js';
import { useLocale } from './useLocale.js';
import { errorMessage, translateMessage } from './i18n.js';
import ImportDialog from './ImportDialog.jsx';
import MapWorkspace from './MapWorkspace.jsx';
import AnimationWorkspace from './AnimationWorkspace.jsx';
import StudioToolbox from './StudioToolbox.jsx';
import { pruneUIReferences } from './studioFeatures.js';
import GenerationDialog from './GenerationDialog.jsx';
import PatchReviewDialog from './PatchReviewDialog.jsx';

const clone = (value) => structuredClone(value);
const containers = ["HBoxContainer", "VBoxContainer", "MarginContainer"];
const statuses = {
  pending: "status.pending",
  modified: "status.modified",
  review: "status.review",
  approved: "status.approved",
};
const priorityNames = { low: "priority.low", medium: "priority.medium", high: "priority.high", critical: "priority.critical" };
const typeIcons = {
  Control: "group",
  TextureRect: "image",
  Label: "text",
  Button: "button",
  Panel: "panel",
  HBoxContainer: "columns",
  VBoxContainer: "rows",
  MarginContainer: "panel",
};
const icons = {
  cursor: <path d="m5 3 13 9-6 1-3 6z" />,
  hand: (
    <path d="M8 12V5a2 2 0 0 1 4 0v5-6a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v7c0 5-3 7-7 7-3 0-5-2-7-5L3 12a2 2 0 0 1 3-2l2 2Z" />
  ),
  layers: (
    <>
      <path d="m12 3 10 5-10 5L2 8z" />
      <path d="m2 12 10 5 10-5M2 16l10 5 10-5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m4 18 5-5 4 3 3-6 5 8" />
    </>
  ),
  text: (
    <>
      <path d="M4 4h16M12 4v17M8 21h8M4 4v4M20 4v4" />
    </>
  ),
  button: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="4" />
      <path d="M7 12h10" />
    </>
  ),
  panel: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 8h18" />
    </>
  ),
  group: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 3" />
      <path d="M8 8h8v8H8z" />
    </>
  ),
  columns: (
    <>
      <rect x="3" y="4" width="7" height="16" />
      <rect x="14" y="4" width="7" height="16" />
    </>
  ),
  rows: (
    <>
      <rect x="4" y="3" width="16" height="7" />
      <rect x="4" y="14" width="16" height="7" />
    </>
  ),
  undo: (
    <>
      <path d="M8 5 3 10l5 5M3 10h11a6 6 0 0 1 0 12" />
    </>
  ),
  redo: (
    <>
      <path d="m16 5 5 5-5 5M21 10H10a6 6 0 0 0 0 12" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5" />
    </>
  ),
  code: (
    <>
      <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18" />
    </>
  ),
  comment: (
    <path d="M20 15a3 3 0 0 1-3 3H9l-6 4V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3z" />
  ),
  check: <path d="m5 12 5 5L20 7" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  duplicate: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M15 8V3H3v12h5" />
    </>
  ),
  align: (
    <>
      <path d="M4 3v18M8 6h12v5H8zM8 15h8v5H8z" />
    </>
  ),
  history: (
    <>
      <path d="M3 11a9 9 0 1 1 1 6M3 4v7h7M12 7v5l4 2" />
    </>
  ),
  diamond: <path d="m12 2 10 10-10 10L2 12z" />,
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6" />
    </>
  ),
  folder: <path d="M3 6h7l2 3h9v11H3z" />,
  trash: (
    <>
      <path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7" />
    </>
  ),
  chevron: <path d="m9 5 7 7-7 7" />,
  snap: (
    <>
      <path d="M5 3v7a7 7 0 0 0 14 0V3h-4v7a3 3 0 0 1-6 0V3z" />
      <path d="M5 7h4m6 0h4" />
    </>
  ),
  fit: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
  palette: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="8" cy="8" r="1" />
      <circle cx="15" cy="7" r="1" />
      <circle cx="7" cy="14" r="1" />
      <path d="M17 13c-5-2-7 4-2 7" />
    </>
  ),
  save: (
    <>
      <path d="M3 3h15l3 3v15H3zM7 3v7h9V3M7 21v-7h10v7" />
    </>
  ),
};
function Icon({ name, size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name] || icons.panel}
    </svg>
  );
}
function Tool({ icon, label, onClick, disabled, active, children, ...props }) {
  return (
    <button
      className={`tool ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      {...props}
    >
      <Icon name={icon} />
      {children}
    </button>
  );
}
async function api(path, body, method = "POST") {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}
function downloadJson(name, value) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
function downloadArchive(url) {
  const link = document.createElement("a");
  link.href = url;
  link.download = url.split("/").pop() || "studio-export.zip";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
function useAsset(src) {
  const [image, setImage] = useState(null);
  useEffect(() => {
    if (!src) {
      setImage(null);
      return;
    }
    const el = new window.Image();
    let live = true;
    el.onload = () => live && setImage(el);
    el.onerror = () => live && setImage(null);
    el.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return image;
}
function NineSlice({ image, width, height, margins }) {
  if (!image) return null;
  const m = { left: 12, top: 12, right: 12, bottom: 12, ...margins };
  const sw = image.naturalWidth || image.width,
    sh = image.naturalHeight || image.height;
  const sx = [0, m.left, sw - m.right],
    sy = [0, m.top, sh - m.bottom],
    cw = [m.left, sw - m.left - m.right, m.right],
    ch = [m.top, sh - m.top - m.bottom, m.bottom];
  const dx = [0, m.left, width - m.right],
    dy = [0, m.top, height - m.bottom],
    dw = [m.left, Math.max(0, width - m.left - m.right), m.right],
    dh = [m.top, Math.max(0, height - m.top - m.bottom), m.bottom];
  return (
    <>
      {sx.flatMap((x, i) =>
        sy.map((y, j) => (
          <KImage
            key={`${i}-${j}`}
            image={image}
            x={dx[i]}
            y={dy[j]}
            width={dw[i]}
            height={dh[j]}
            crop={{ x, y, width: cw[i], height: ch[j] }}
            listening={false}
          />
        )),
      )}
    </>
  );
}
export function DesignNode({
  t,
  node,
  rect,
  asset,
  selected,
  onSelect,
  onMove,
  onDragStart,
  onDragMove,
  onTransform,
  nodeRef,
  disabledDrag,
  showTip,
}) {
  const image = useAsset(asset?.src),
    style = node.style || {},
    isText = node.type === "Label",
    isButton = node.type === "Button";
  return (
    <Group
      ref={nodeRef}
      name={`design-${node.id}`}
      id={node.id}
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      opacity={style.opacity ?? 1}
      draggable={!node.locked && !disabledDrag}
      onClick={onSelect}
      onTap={onSelect}
      onDragStart={(event) => {
        event.cancelBubble = true;
        onSelect(event, true);
        onDragStart(node, event);
      }}
      onDragMove={(event) => onDragMove(node, event)}
      onDragEnd={(event) => onMove(node, event)}
      onTransformEnd={(event) => onTransform(node, event)}
      onDblClick={() =>
        disabledDrag &&
        showTip(t("notify.autoLayout"))
      }
    >
      <Rect
        width={rect.width}
        height={rect.height}
        fill={style.fill || (isText ? "transparent" : "transparent")}
        stroke={style.stroke || undefined}
        strokeWidth={style.strokeWidth ?? 0}
        cornerRadius={style.radius || 0}
      />
      {image &&
        (asset?.kind === "nineSlice" ? (
          <NineSlice
            image={image}
            width={rect.width}
            height={rect.height}
            margins={asset.margins}
          />
        ) : (
          <KImage
            image={image}
            width={rect.width}
            height={rect.height}
            listening={false}
          />
        ))}
      {(isText || isButton || style.text) && (
        <Text
          text={style.text || ""}
          width={rect.width}
          height={rect.height}
          x={0}
          y={0}
          fontSize={style.fontSize || 16}
          fontFamily={style.fontFamily || "Studio Sans"}
          fill={style.color || "#ddd8c9"}
          align={style.align || (isButton ? "center" : "left")}
          verticalAlign="middle"
          padding={isButton ? 0 : 0}
          fontStyle={style.fontStyle || "normal"}
          letterSpacing={style.letterSpacing || 0}
          lineHeight={style.lineHeight || 1.2}
          listening={false}
        />
      )}
    </Group>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "text",
  min,
  max,
  step,
  disabled,
  ...props
}) {
  return (
    <label className={`field ${disabled ? "disabled" : ""}`}>
      <span>{label}</span>
      <input
        aria-label={label}
        value={value ?? ""}
        type={type}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) =>
          onChange(
            type === "number" ? Number(event.target.value) : event.target.value,
          )
        }
        {...props}
      />
    </label>
  );
}

export default function App() {
  const { locale, setLocale, t, preferenceError, ready: localeReady } = useLocale();
  const [workspace, setWorkspace] = useState("ui");
  const [mapVisited, setMapVisited] = useState(false);
  const [animationVisited, setAnimationVisited] = useState(false);
  const [project, setProject] = useState(null),
    projectRef = useRef(null),
    [selected, setSelected] = useState([]),
    [tab, setTab] = useState("review"),
    [leftTab, setLeftTab] = useState("layers");
  const [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [pending, setPending] = useState(0),
    [busy, setBusy] = useState(false),
    queue = useRef(Promise.resolve()),
    saveEpoch = useRef(0);
  const [zoom, setZoom] = useState(0.8),
    [hand, setHand] = useState(false),
    [snap, setSnap] = useState(true),
    [showGuides, setShowGuides] = useState(true),
    [dragGuides, setDragGuides] = useState([]),
    [dragActive, setDragActive] = useState(false),
    [dragBounds, setDragBounds] = useState(null),
    [alignmentMode, setAlignmentMode] = useState("left"),
    [showPins, setShowPins] = useState(true),
    [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(new Set()),
    [historyTick, setHistoryTick] = useState(0),
    undo = useRef([]),
    redo = useRef([]),
    [reviewForm, setReviewForm] = useState({
      target: "",
      expected: "",
      protectedProperties: "frame.x, frame.y, frame.width, frame.height",
      priority: "high",
    });
  const [assetKind, setAssetKind] = useState("portrait"),
    [addType, setAddType] = useState("Label"),
    [buttonState, setButtonState] = useState("normal"),
    [dialog, setDialog] = useState(null),
    [jsonText, setJsonText] = useState(""),
    [fontEpoch, setFontEpoch] = useState(0);
  const stageRef = useRef(null),
    overlayRef = useRef(null),
    transformerRef = useRef(null),
    shapeRefs = useRef(new Map()),
    canvasWrap = useRef(null),
    patchInput = useRef(null),
    assetInput = useRef(null),
    componentInput = useRef(null),
    dragSessionRef = useRef(null),
    panRef = useRef(null);
  const notify = useCallback((text) => {
    setToast(text);
    setTimeout(() => setToast(""), 4200);
  }, []);
  const accept = useCallback((value) => {
    projectRef.current = value;
    setProject(value);
  }, []);
  useEffect(() => {
    api("/api/project")
      .then(accept)
      .catch((e) => setError(e.message));
  }, [accept]);
  const commit = useCallback(
    (next, record = true) => {
      const previous = projectRef.current;
      if (!previous) return;
      try {
        next = clone(next);
        next.revision = previous.revision + 1;
        validateProject(next);
      } catch (e) {
        setError(e.message);
        return;
      }
      if (record) {
        undo.current.push(clone(previous));
        if (undo.current.length > 50) undo.current.shift();
        redo.current = [];
        setHistoryTick((v) => v + 1);
      }
      accept(next);
      setPending((n) => n + 1);
      setError("");
      const epoch = saveEpoch.current;
      queue.current = queue.current.then(async () => {
        if (epoch !== saveEpoch.current) {
          setPending((n) => Math.max(0, n - 1));
          return;
        }
        try {
          const saved = await api("/api/project", next, "PUT");
          if (projectRef.current.revision === next.revision) accept(saved);
        } catch (e) {
          saveEpoch.current += 1;
          setError({ key: "error.save", values: { detail: e.message } });
          try {
            const saved = await api("/api/project");
            accept(saved);
          } catch (reloadError) {
            setError(
              { key: "error.connection", values: { detail: reloadError.message } },
            );
          }
          undo.current = [];
          redo.current = [];
        } finally {
          setPending((n) => Math.max(0, n - 1));
        }
      });
    },
    [accept],
  );
  const edit = useCallback(
    (fn) => {
      const next = clone(projectRef.current);
      fn(next);
      commit(next);
    },
    [commit],
  );
  const doUndo = useCallback(() => {
    if (!undo.current.length || busy) return;
    redo.current.push(clone(projectRef.current));
    const next = undo.current.pop();
    commit(next, false);
    setHistoryTick((v) => v + 1);
  }, [busy, commit]);
  const doRedo = useCallback(() => {
    if (!redo.current.length || busy) return;
    undo.current.push(clone(projectRef.current));
    const next = redo.current.pop();
    commit(next, false);
    setHistoryTick((v) => v + 1);
  }, [busy, commit]);
  const action = useCallback(async (fn) => {
    setBusy(true);
    setError("");
    try {
      await queue.current;
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, []);
  const fontAssetsKey = JSON.stringify(
    project?.assets
      .filter((a) => a.kind === "font")
      .map((a) => [a.name, a.src]) || [],
  );
  useEffect(() => {
    let alive = true;
    const faces = [];
    Promise.all(
      JSON.parse(fontAssetsKey).map(async ([name, src]) => {
        const face = new FontFace(name, `url(${src})`);
        await face.load();
        if (alive) {
          document.fonts.add(face);
          faces.push(face);
        }
      }),
    )
      .then(() => {
        if (alive) setFontEpoch((n) => n + 1);
      })
      .catch((e) => {
        if (alive) setError({ key: "error.font", values: { detail: e.message } });
      });
    return () => {
      alive = false;
      for (const face of faces) document.fonts.delete(face);
    };
  }, [fontAssetsKey]);
  const layout = useMemo(
    () => (project ? computeLayout(project) : new Map()),
    [project],
  );
  const selectedNode = project?.nodes.find((n) => n.id === selected[0]);
  const parentOf = (n) => project?.nodes.find((p) => p.id === n.parentId);
  const autoPosition = (n) => containers.includes(parentOf(n)?.type);
  const effectiveLocked = (n) => {
    let current = n;
    while (current) {
      if (current.locked) return true;
      current = parentOf(current);
    }
    return false;
  };
  const visibleNodes = useMemo(() => {
    if (!project) return [];
    const map = new Map(project.nodes.map((n) => [n.id, n]));
    return project.nodes.filter((node) => {
      let n = node;
      while (n) {
        if (n.visible === false) return false;
        n = map.get(n.parentId);
      }
      return true;
    });
  }, [project]);
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr || !project) return;
    if (dragSessionRef.current) { tr.nodes([]); return; }
    tr.nodes(
      movableSelection(project, selected)
        .map((n) => shapeRefs.current.get(n.id))
        .filter(Boolean),
    );
    tr.getLayer()?.batchDraw();
  }, [selected, project, zoom, fontEpoch, dragActive]);
  const fit = useCallback(() => {
    if (!projectRef.current || !canvasWrap.current) return;
    const { width, height } = canvasWrap.current.getBoundingClientRect(),
      c = projectRef.current.canvas;
    setZoom(
      Math.max(
        0.25,
        Math.min(1, (width - 72) / c.width, (height - 82) / c.height),
      ),
    );
  }, []);
  useEffect(() => {
    if (project) {
      const timer = setTimeout(fit, 60);
      return () => clearTimeout(timer);
    }
  }, [Boolean(project), fit]);
  const mutateNodes = (ids, fn) =>
    edit((d) =>
      d.nodes.forEach((n) => {
        if (ids.includes(n.id) && !effectiveLocked(n)) fn(n);
      }),
    );
  const updateNode = (path, value) => {
    if (!selectedNode || effectiveLocked(selectedNode)) return;
    edit((d) => {
      const n = d.nodes.find((n) => n.id === selectedNode.id);
      const [a, b] = path.split(".");
      if (b) {
        n[a] ||= {};
        n[a][b] = value;
      } else n[a] = value;
    });
  };
  const selectNode = (node, event, preserve = false) => {
    event.cancelBubble = true;
    if (preserve && selected.includes(node.id)) return;
    const multi =
      event.evt?.shiftKey || event.evt?.ctrlKey || event.evt?.metaKey;
    setSelected((old) =>
      multi
        ? old.includes(node.id)
          ? old.filter((id) => id !== node.id)
          : [...old, node.id]
        : [node.id],
    );
  };
  const beginDrag = (node, event) => {
    if (dragSessionRef.current) return;
    const multi = event.evt?.shiftKey || event.evt?.ctrlKey || event.evt?.metaKey;
    const ids = selected.includes(node.id) ? selected : multi ? [...selected, node.id] : [node.id];
    const roots = movableSelection(project, ids);
    if (!roots.length) return;
    const rootIds = roots.map(item => item.id), movedIds = descendantsOf(project, rootIds);
    const bounds = selectionBounds(roots.map(item => layout.get(item.id)));
    // Konva's Transformer otherwise starts a separate drag for every selected
    // shape. One owner translates the selection and descendants exactly once.
    transformerRef.current?.nodes([]);
    dragSessionRef.current = { ownerId: node.id, rootIds, movedIds, layout, bounds, dx: 0, dy: 0,
      targets: visibleNodes.filter(item => !movedIds.has(item.id) && roots.some(root => root.parentId === item.parentId))
        .map(item => ({ id: item.id, rect: layout.get(item.id) })) };
    setDragActive(true);
    setDragGuides([]);
    setDragBounds(bounds);
  };
  const updateDrag = (node, event) => {
    const session = dragSessionRef.current;
    if (!session || session.ownerId !== node.id) return;
    const original = session.layout.get(node.id);
    const raw = { ...session.bounds, x: session.bounds.x + event.target.x() - original.x, y: session.bounds.y + event.target.y() - original.y };
    const snapped = snapRectangle({ rect: raw, targets: session.targets, canvas: project.canvas, zoom, enabled: snap });
    session.dx = snapped.x - session.bounds.x;
    session.dy = snapped.y - session.bounds.y;
    for (const id of session.movedIds) {
      const element = shapeRefs.current.get(id), rect = session.layout.get(id);
      if (element && rect) element.position({ x: rect.x + session.dx, y: rect.y + session.dy });
    }
    setDragGuides(showGuides ? snapped.guides : []);
    setDragBounds({ ...session.bounds, x: snapped.x, y: snapped.y });
  };
  const moveNode = (node, event) => {
    const session = dragSessionRef.current;
    if (!session || session.ownerId !== node.id) return;
    updateDrag(node, event);
    for (const id of session.movedIds) {
      const element = shapeRefs.current.get(id), rect = session.layout.get(id);
      if (element && rect) element.position({ x: rect.x, y: rect.y });
    }
    dragSessionRef.current = null;
    setDragGuides([]); setDragBounds(null); setDragActive(false);
    if (Math.abs(session.dx) < 0.00001 && Math.abs(session.dy) < 0.00001) return;
    edit(draft => {
      for (const item of draft.nodes) if (session.rootIds.includes(item.id)) {
        item.frame.x = Math.round((item.frame.x + session.dx) * 1000) / 1000;
        item.frame.y = Math.round((item.frame.y + session.dy) * 1000) / 1000;
      }
    });
  };
  const transformNode = (node, event) => {
    if (effectiveLocked(node) || autoPosition(node)) return;
    const target = event.target,
      parent = layout.get(node.parentId) || { x: 0, y: 0 };
    const next = {
      x: Math.round(target.x() - parent.x),
      y: Math.round(target.y() - parent.y),
      width: Math.max(8, Math.round(node.frame.width * target.scaleX())),
      height: Math.max(8, Math.round(node.frame.height * target.scaleY())),
    };
    target.scale({ x: 1, y: 1 });
    edit((d) => {
      d.nodes.find((n) => n.id === node.id).frame = next;
    });
  };
  const duplicate = useCallback(() => {
    if (!selected.length) return;
    const ids = new Set(selected);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of projectRef.current.nodes) {
        if (ids.has(n.parentId) && !ids.has(n.id)) {
          ids.add(n.id);
          grew = true;
        }
      }
    }
    const mapping = new Map([...ids].map((id) => [id, makeId("node")]));
    edit((d) => {
      const copies = d.nodes
        .filter((n) => ids.has(n.id))
        .map((n) => ({
          ...clone(n),
          id: mapping.get(n.id),
                          name: t("copyName", { name: n.name }),
          parentId: mapping.get(n.parentId) || n.parentId,
          frame: {
            ...n.frame,
            x: n.frame.x + (ids.has(n.parentId) ? 0 : 24),
            y: n.frame.y + (ids.has(n.parentId) ? 0 : 24),
          },
          locked: false,
        }));
      d.nodes.push(...copies);
    });
    setSelected(selected.map((id) => mapping.get(id)));
  }, [selected, edit, t]);
  const group = () => {
    if (selected.length < 2) return;
    const nodes = project.nodes.filter((n) => selected.includes(n.id));
    if (
      nodes.some(
        (n) =>
          n.parentId !== nodes[0].parentId ||
          autoPosition(n) ||
          effectiveLocked(n),
      )
    ) {
      notify(t("notify.group"));
      return;
    }
    const x = Math.min(...nodes.map((n) => n.frame.x)),
      y = Math.min(...nodes.map((n) => n.frame.y)),
      right = Math.max(...nodes.map((n) => n.frame.x + n.frame.width)),
      bottom = Math.max(...nodes.map((n) => n.frame.y + n.frame.height)),
      id = makeId("group");
    edit((d) => {
      const index = d.nodes.findIndex((n) => n.id === nodes[0].id);
      d.nodes.splice(index, 0, {
        id,
        name: t("newGroup"),
        type: "Control",
        parentId: nodes[0].parentId,
        frame: { x, y, width: right - x, height: bottom - y },
        style: {},
        layout: { mode: "free", padding: 0, gap: 12 },
        visible: true,
        locked: false,
      });
      for (const n of d.nodes)
        if (selected.includes(n.id)) {
          n.parentId = id;
          n.frame.x -= x;
          n.frame.y -= y;
        }
    });
    setSelected([id]);
  };
  const ungroup = () => {
    if (!selectedNode || selectedNode.type !== "Control") return;
    const id = selectedNode.id;
    const children = project.nodes.filter((n) => n.parentId === id);
    if (!children.length) return;
    edit((d) => {
      for (const n of d.nodes)
        if (n.parentId === id) {
          n.parentId = selectedNode.parentId;
          n.frame.x += selectedNode.frame.x;
          n.frame.y += selectedNode.frame.y;
        }
      d.nodes = d.nodes.filter((n) => n.id !== id);
      d.reviews = d.reviews.filter((r) => r.nodeId !== id);
    });
    setSelected(children.map((n) => n.id));
  };
  const align = (mode) => {
    const updates = alignmentUpdates(project, selected, mode);
    if (!updates.length) return;
    edit(draft => { for (const change of updates) Object.assign(draft.nodes.find(node => node.id === change.nodeId).frame, { x: change.x, y: change.y }); });
  };
  const addNode = (type = addType, asset) => {
    const id = makeId("node");
    const node = {
      id,
      name: asset ? asset.name : t("newComponent", { type: t(`type.${type}`) }),
      type,
      parentId: null,
      frame: {
        x: 80,
        y: 80,
        width: type === "Label" ? 220 : 200,
        height: type === "Label" ? 40 : type === "Button" ? 52 : 160,
      },
      style: {
        fill: ["Panel", "Button"].includes(type) ? "#303a38" : "transparent",
        stroke: ["Panel", "Button"].includes(type) ? "#68705e" : "transparent",
        strokeWidth: ["Panel", "Button"].includes(type) ? 1 : 0,
        radius: 2,
        color: "#ded7c3",
        fontSize: 18,
        fontFamily: "Studio Sans",
        text:
          type === "Label" ? t("newLabel") : type === "Button" ? t("newAction") : "",
        align: type === "Button" ? "center" : "left",
        opacity: 1,
      },
      layout: {
        mode:
          type === "HBoxContainer"
            ? "horizontal"
            : type === "VBoxContainer"
              ? "vertical"
              : "free",
        gap: 12,
        padding: 0,
      },
      assetId: asset?.id || null,
      visible: true,
      locked: false,
    };
    edit((d) => d.nodes.push(node));
    setSelected([id]);
    setTab("design");
  };
  const remove = () => {
    if (!selected.length) return;
    const ids = new Set(
      selected.filter(
        (id) => !effectiveLocked(project.nodes.find((n) => n.id === id)),
      ),
    );
    let grow = true;
    while (grow) {
      grow = false;
      for (const n of project.nodes)
        if (ids.has(n.parentId) && !ids.has(n.id)) {
          ids.add(n.id);
          grow = true;
        }
    }
    edit((d) => {
      d.nodes = d.nodes.filter((n) => !ids.has(n.id));
      d.reviews = d.reviews.filter((r) => !ids.has(r.nodeId));
      Object.assign(d, pruneUIReferences(d));
    });
    setSelected([]);
  };
  useEffect(() => {
    const handler = (e) => {
      if (busy || workspace !== "ui" || dialog || dragSessionRef.current) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        setDialog("import");
        return;
      }
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) ||
        e.target.isContentEditable
      )
        return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? doRedo() : doUndo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicate();
      } else if (e.key === "Escape") {
        setSelected([]);
        setDialog(null);
      } else if (e.key === " ") {
        e.preventDefault();
        setHand(true);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      } else if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
        selected.length
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        mutateNodes(selected, (n) => {
          if (!autoPosition(n)) {
            n.frame.x +=
              e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
            n.frame.y +=
              e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
          }
        });
      }
    };
    const up = (e) => {
      if (e.key === " ") setHand(false);
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", up);
    };
  }, [project, selected, doUndo, doRedo, duplicate, busy, workspace, dialog]);
  const exportFeedback = () =>
    action(async () => {
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const stage = stageRef.current,
        overlay = overlayRef.current;
      snapshotVisible(false);
      const shots = {};
      try {
        for (const id of new Set(
          projectRef.current.reviews
            .filter((r) => r.status === "pending")
            .map((r) => r.nodeId),
        )) {
          const r = layout.get(id);
          if (r) {
            const x = Math.max(0, r.x - 16),
              y = Math.max(0, r.y - 16),
              w = Math.min(project.canvas.width - x, r.width + 32),
              h = Math.min(project.canvas.height - y, r.height + 32);
            if (w > 0 && h > 0)
              shots[id] = stage.toDataURL({
                x: x * zoom,
                y: y * zoom,
                width: w * zoom,
                height: h * zoom,
                pixelRatio: 1 / zoom,
              });
          }
        }
      } finally {
        snapshotVisible(true);
      }
      const result = await api("/api/feedback", {
        baseRevision: projectRef.current.revision,
        screenshots: shots,
      });
      downloadArchive(result.downloadUrl);
      notify({ key: "notify.feedback", values: { count: result.count } });
    });
  const snapshotVisible = (value) => {
    overlayRef.current?.visible(value);
    overlayRef.current?.getStage()?.batchDraw();
  };
  useEffect(() => {
    window.__studioCapture = async () => {
      await queue.current;
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const stage = stageRef.current;
      if (!stage) throw new Error(t("error.canvas"));
      snapshotVisible(false);
      try {
        return stage.toDataURL({ pixelRatio: 1 / zoom });
      } finally {
        snapshotVisible(true);
      }
    };
    window.__studioState = () => ({
      revision: projectRef.current?.revision,
      zoom,
      selected,
      canvas: projectRef.current?.canvas,
      guides: showGuides ? dragGuides : [],
      dragActive,
      movingBounds: dragBounds,
    });
    return () => {
      delete window.__studioCapture;
      delete window.__studioState;
    };
  }, [zoom, selected, project, dragGuides, dragActive, dragBounds, showGuides]);
  const componentExport = () => {
    if (!selected.length) return;
    const ids = new Set(selected);
    let grow = true;
    while (grow) {
      grow = false;
      for (const n of project.nodes)
        if (ids.has(n.parentId) && !ids.has(n.id)) {
          ids.add(n.id);
          grow = true;
        }
    }
    const nodes = project.nodes.filter((n) => ids.has(n.id)).map(clone);
    const assets = new Set();
    for (const n of nodes) {
      if (n.assetId) assets.add(n.assetId);
      if (n.disabledAssetId) assets.add(n.disabledAssetId);
      for (const id of Object.values(n.buttonAssets || {}))
        if (id) assets.add(id);
      if (!ids.has(n.parentId)) {
        const r = layout.get(n.id);
        n.parentId = null;
        n.frame.x = r.x;
        n.frame.y = r.y;
      }
    }
    const x = Math.min(
        ...nodes.filter((n) => !n.parentId).map((n) => n.frame.x),
      ),
      y = Math.min(...nodes.filter((n) => !n.parentId).map((n) => n.frame.y));
    for (const n of nodes)
      if (!n.parentId) {
        n.frame.x -= x;
        n.frame.y -= y;
      }
    downloadJson("selection.component.json", {
      schemaVersion: 1,
      kind: "studio-component",
      name: selectedNode.name,
      nodes,
      assets: project.assets.filter(
        (a) => assets.has(a.id) || a.kind === "font",
      ),
    });
    notify(t("notify.exportComponent"));
  };
  const componentImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const value = JSON.parse(await file.text());
      if (
        value.schemaVersion !== 1 ||
        value.kind !== "studio-component" ||
        !Array.isArray(value.nodes) ||
        !Array.isArray(value.assets)
      )
        throw new Error(t("error.component"));
      const mapping = new Map(value.nodes.map((n) => [n.id, makeId("node")])),
        assetMapping = new Map(
          value.assets.map((a) => [
            a.id,
            project.assets.some((v) => v.id === a.id && v.src !== a.src)
              ? makeId("asset")
              : a.id,
          ]),
        );
      const next = clone(projectRef.current);
      for (const a of value.assets) {
        const id = assetMapping.get(a.id);
        if (!next.assets.some((v) => v.id === id))
          next.assets.push({ ...a, id });
      }
      const imported = value.nodes.map((n) => ({
        ...clone(n),
        id: mapping.get(n.id),
        parentId: n.parentId ? mapping.get(n.parentId) : null,
        assetId: n.assetId ? assetMapping.get(n.assetId) || n.assetId : null,
        ...(n.disabledAssetId ? { disabledAssetId: assetMapping.get(n.disabledAssetId) || n.disabledAssetId } : {}),
        buttonAssets: Object.fromEntries(
          Object.entries(n.buttonAssets || {}).map(([key, id]) => [
            key,
            assetMapping.get(id) || id,
          ]),
        ),
        frame: {
          ...n.frame,
          x: n.frame.x + (n.parentId ? 0 : 64),
          y: n.frame.y + (n.parentId ? 0 : 64),
        },
      }));
      next.nodes.push(...imported);
      validateProject(next);
      commit(next);
      setSelected(imported.filter((n) => !n.parentId).map((n) => n.id));
      notify(t("notify.importComponent"));
    } catch (e) {
      setError(e.message);
    }
  };

  const exportCanvas = () =>
    action(async () => {
      await document.fonts.ready;
      snapshotVisible(false);
      try {
        const url = stageRef.current.toDataURL({ pixelRatio: 1 / zoom });
        const a = document.createElement("a");
        a.download = "studio-canvas.png";
        a.href = url;
        a.click();
      } finally {
        snapshotVisible(true);
      }
    });
  const previewPatch = async (patchValue) => {
    await queue.current;
    return api("/api/patch/preview", { patch: patchValue });
  };
  const patch = async (patchValue, selectedIndices) => {
    await queue.current;
    const result = await api("/api/patch/selected", { patch: patchValue, selectedIndices });
    accept(result);
    undo.current = [];
    redo.current = [];
    setTab("history");
    notify(t("notify.patch"));
  };
  const exportGeneration = async (payload) => {
    await queue.current;
    return api("/api/generation", { ...payload, baseRevision: projectRef.current.revision });
  };
  const samplePatch = () =>
    action(async () => {
      const value = await api("/api/example-patch");
      setJsonText(JSON.stringify(value, null, 2));
      setDialog("patch");
    });
  const uploadJson = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const value = JSON.parse(await file.text());
      setJsonText(JSON.stringify(value, null, 2));
      setDialog("patch");
    } catch { setError("import.invalidJson"); }
  };
  const importProject = (value, backup) => action(async () => {
    if (backup) downloadJson(`${projectRef.current.id}.backup-${Date.now()}.project.json`, projectRef.current);
    const result = await api("/api/import", value);
    accept(result);
    undo.current = [];
    redo.current = [];
    setSelected([]);
    setLeftTab("layers");
    setTab("design");
    setDialog(null);
    setTimeout(fit, 60);
    notify({ key: "notify.import" });
  });
  const addReview = (event) => {
    event.preventDefault();
    if (!selectedNode) return;
    edit((d) =>
      d.reviews.push({
        id: makeId("review"),
        nodeId: selectedNode.id,
        ...reviewForm,
        protectedProperties: reviewForm.protectedProperties
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        status: "pending",
        createdAt: new Date().toISOString(),
      }),
    );
    setReviewForm({ ...reviewForm, target: "", expected: "" });
    notify(t("notify.review"));
  };
  const assetUpload = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    action(async () => {
      let dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      if (assetKind === "font") {
        const mime = /\.otf$/i.test(file.name) ? "font/otf" : "font/ttf";
        dataUrl = dataUrl.replace(/^data:[^;]*;/, `data:${mime};`);
      }
      const asset = await api("/api/assets", {
        name: file.name,
        kind: assetKind,
        dataUrl,
      });
      edit((d) => d.assets.push(asset));
      notify(t("notify.asset"));
    });
  };
  const rows = [];
  if (project) {
    const walk = (parent, depth) => {
      for (const n of project.nodes.filter(
        (n) => (n.parentId || null) === parent,
      )) {
        if (
          !search ||
          n.name.toLowerCase().includes(search.toLowerCase()) ||
          n.id.includes(search)
        )
          rows.push({ node: n, depth });
        if (!collapsed.has(n.id) || search) walk(n.id, depth + 1);
      }
    };
    walk(null, 0);
  }
  const reviewList =
    project?.reviews.filter(
      (r) => !selected.length || selected.includes(r.nodeId),
    ) || [];
  const pendingReviews =
    project?.reviews.filter((r) => r.status === "pending") || [];
  if (!project || !localeReady)
    return (
      <div className="loading">
        <div className="brand-mark">
          <Icon name="diamond" size={24} />
        </div>
        <h2>Game UI Studio</h2>
        <p>{error ? errorMessage(locale, error) : t("loading")}</p>
        {error && <button onClick={() => location.reload()}>{t("retry")}</button>}
      </div>
    );
  return (
    <div className="studio">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <Icon name="diamond" size={21} />
          </div>
          <div>
            <strong>
              GAME UI <span>STUDIO</span>
            </strong>
            <small>{t("localLab")}</small>
          </div>
        </div>
        <div className="project-breadcrumb" style={workspace === "map" ? { visibility: "hidden" } : undefined}>
          <Icon name="folder" />
          <span>{project.name.split("·")[0]}</span>
          <Icon name="chevron" size={12} />
          <strong>{project.name.split("·")[1] || t("canvas")}</strong>
          <span className="phase-badge">{t("prototype")}</span>
        </div>
        <div className="header-actions">
          <label className="language-control">
            <span className="sr-only">{t("language")}</span>
            <select data-testid="language-select" aria-label={t("language")} value={locale} onChange={event => setLocale(event.target.value)}>
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </label>
          {workspace === "ui" && <>
          <span className={`save-status ${pending ? "saving" : ""}`}>
            <i />
            {pending ? t("saving") : t("saved")}
          </span>
          <button data-testid="import-ui" className="button import-ui-button" title={t("importUI")} disabled={busy || pending > 0} onClick={() => setDialog("import")}>
            <Icon name="upload" />{t("importUI")}
          </button>
          <button
            data-testid="export-project"
            className="button subtle"
            onClick={() => downloadJson(`${project.id}.project.json`, project)}
            title={t("exportProject")}
          >
            <Icon name="save" />
            {t("exportProject")}
          </button>
          <button
            data-testid="export-feedback"
            className="button primary"
            onClick={exportFeedback}
            disabled={busy || pending > 0 || !pendingReviews.length}
          >
            <Icon name="download" />
            {t("exportFeedback")}
            <span className="button-count">{pendingReviews.length}</span>
          </button>
          </>}
        </div>
      </header>
      <nav className="workspace-switchbar" aria-label={t("workspace.label")}>
        <div className="workspace-switches">
          <button data-testid="workspace-ui" aria-pressed={workspace === "ui"} onClick={() => { setWorkspace("ui"); setTimeout(fit, 60); }}>{t("workspace.ui")}</button>
          <button data-testid="workspace-map" aria-pressed={workspace === "map"} onClick={() => { setDialog(null); setMapVisited(true); setWorkspace("map"); }}>{t("workspace.map")}</button>
          <button data-testid="workspace-animation" aria-pressed={workspace === "animation"} onClick={() => { setDialog(null); setAnimationVisited(true); setWorkspace("animation"); }}>{locale === "zh-CN" ? "像素动画" : "Pixel animation"}</button>
        </div>
        <span>{workspace === "animation" ? (locale === "zh-CN" ? "主体 64×96 · 动作范围自动扩展" : "Body 64×96 · Automatic action bounds") : workspace === "map" ? t("workspace.mapHint") : t("workspace.uiHint")}</span>
        {workspace === "ui" && <button className="button" data-testid="studio-tools" disabled={busy || pending > 0} onClick={() => action(async () => setDialog("studio"))}>{locale === "zh-CN" ? "项目工具箱" : "Project toolbox"}</button>}
        {workspace === "ui" && <button className="button generation-trigger" data-testid="generation-task" disabled={busy || pending > 0} onClick={() => setDialog("generation")}><Icon name="code" />{t("generation.open")}</button>}
      </nav>
      {mapVisited && <div className="map-workspace-host" style={{ display: workspace === "map" ? "flex" : "none" }}><MapWorkspace locale={locale} active={workspace === "map"} /></div>}
      {animationVisited && <div className="animation-workspace-host" style={{ display: workspace === "animation" ? "flex" : "none", flex: 1, minHeight: 0 }}><AnimationWorkspace locale={locale} active={workspace === "animation"} /></div>}
      <div className="ui-workspace-host" style={{ display: workspace === "ui" ? "contents" : "none" }}>
      <div className="workspace">
        <aside className="left-panel">
          <div className="panel-tabs">
            <button
              className={leftTab === "layers" ? "selected" : ""}
              onClick={() => setLeftTab("layers")}
            >
              <Icon name="layers" />
              {t("layers")}
            </button>
            <button
              className={leftTab === "assets" ? "selected" : ""}
              onClick={() => setLeftTab("assets")}
            >
              <Icon name="image" />
              {t("assets")}
            </button>
            <button
              className={leftTab === "tokens" ? "selected" : ""}
              onClick={() => setLeftTab("tokens")}
            >
              <Icon name="palette" />
              {t("tokens")}
            </button>
          </div>
          {leftTab === "layers" ? (
            <>
              <div className="section-title">
                <span>{t("layerTree")}</span>
                <span className="muted">{project.nodes.length}</span>
              </div>
              <div className="search">
                <Icon name="search" size={14} />
                <input
                  placeholder={t("searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label={t("searchLayers")}
                />
              </div>
              <div className="layer-list">
                {rows.map(({ node, depth }) => {
                  const child = project.nodes.some(
                      (n) => n.parentId === node.id,
                    ),
                    count = project.reviews.filter(
                      (r) => r.nodeId === node.id && r.status !== "approved",
                    ).length;
                  return (
                    <div
                      key={node.id}
                      className={`layer-row ${selected.includes(node.id) ? "selected" : ""} ${node.visible === false ? "hidden-node" : ""}`}
                      style={{ paddingLeft: 12 + depth * 13 }}
                    >
                      <button
                        className="collapse"
                        aria-label={t("childrenLabel", { name: node.name })}
                        onClick={() =>
                          setCollapsed((old) => {
                            const s = new Set(old);
                            s.has(node.id) ? s.delete(node.id) : s.add(node.id);
                            return s;
                          })
                        }
                      >
                        {child && (
                          <span
                            className={collapsed.has(node.id) ? "" : "rotated"}
                          >
                            <Icon name="chevron" size={10} />
                          </span>
                        )}
                      </button>
                      <button
                        className="layer-select"
                        onClick={(event) => selectNode(node, { evt: event })}
                        title={node.id}
                        data-node-id={node.id}
                        data-testid={`layer-${node.id}`}
                      >
                        <Icon name={typeIcons[node.type]} size={14} />
                        <span>{node.name}</span>
                        {count > 0 && <b className="review-dot">{count}</b>}
                      </button>
                      <button
                        className="layer-mini"
                        title={
                          node.locked ? t("unlock") : t("lock")
                        }
                        aria-label={t("lockLabel", { name: node.name })}
                        onClick={() =>
                          edit((d) => {
                            d.nodes.find((n) => n.id === node.id).locked =
                              !node.locked;
                          })
                        }
                      >
                        <Icon
                          name={node.locked ? "lock" : "unlock"}
                          size={11}
                        />
                      </button>
                      <button
                        className="layer-mini"
                        title={t("visibility")}
                        aria-label={t("visibilityLabel", { name: node.name })}
                        onClick={() =>
                          edit((d) => {
                            d.nodes.find((n) => n.id === node.id).visible =
                              node.visible === false;
                          })
                        }
                      >
                        <Icon name="eye" size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="add-component">
                <select
                  aria-label={t("newType")}
                  value={addType}
                  onChange={(e) => setAddType(e.target.value)}
                >
                  {Object.keys(typeIcons).map((type) => (
                    <option key={type} value={type} title={type}>{t(`type.${type}`)}</option>
                  ))}
                </select>
                <button
                  title={t("addComponent")}
                  aria-label={t("addComponent")}
                  onClick={() => addNode()}
                >
                  <Icon name="plus" />
                </button>
              </div>
              <div className="component-library-actions">
                <button
                  onClick={componentExport}
                  disabled={!selected.length}
                  title={t("exportComponentTip")}
                >
                  {t("exportComponent")}
                </button>
                <button
                  onClick={() => componentInput.current.click()}
                  title={t("importComponentTip")}
                >
                  {t("importComponent")}
                </button>
              </div>
              <div className="local-note">
                <span className="live-dot" />
                <div>
                  <strong>{t("localTitle")}</strong>
                  <span>{t("localSubtitle")}</span>
                </div>
              </div>
            </>
          ) : leftTab === "assets" ? (
            <div className="assets-panel">
              <div className="section-title">
                <span>{t("projectLibrary")}</span>
                <span>{project.assets.length}</span>
              </div>
              <p className="hint">
                {t("assetsHint")}
              </p>
              <div className="asset-import">
                <select
                  aria-label={t("assetKind")}
                  value={assetKind}
                  onChange={(e) => setAssetKind(e.target.value)}
                >
                  {[
                    "portrait",
                    "background",
                    "nineSlice",
                    "button",
                    "icon",
                    "font",
                  ].map((k) => (
                    <option key={k} value={k}>{t(`kind.${k}`)}</option>
                  ))}
                </select>
                <button
                  className="button small"
                  onClick={() => assetInput.current.click()}
                >
                  <Icon name="upload" />
                  {t("importAsset")}
                </button>
              </div>
              {project.assets
                .filter((asset) => asset.kind !== "font")
                .map((asset) => (
                  <button
                    className="asset-card"
                    key={asset.id}
                    onClick={() =>
                      addNode(
                        asset.kind === "nineSlice" ? "Panel" : "TextureRect",
                        asset,
                      )
                    }
                    title={t("placeAsset", { name: asset.name })}
                  >
                    <img src={asset.src} />
                    <div>
                      <strong>{asset.name}</strong>
                      <span>{t(`kind.${asset.kind}`)}</span>
                    </div>
                    <Icon name="plus" size={14} />
                  </button>
                ))}
              <h4 className="library-subtitle">{t("fonts")}</h4>
              {project.assets
                .filter((a) => a.kind === "font")
                .map((asset) => (
                  <div className="font-asset-card" key={asset.id}>
                    <span style={{ fontFamily: asset.name }}>Aa</span>
                    <div>
                      <strong>{asset.name}</strong>
                      <small>{t("fontHint")}</small>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="tokens-panel">
              <div className="section-title">
                <span>{t("artDirection")}</span>
                <Icon name="diamond" size={13} />
              </div>
              <h3>{t("foundations")}</h3>
              <p className="hint">{t("tokensHint")}</p>
              <h4>{t("colorPalette")}</h4>
              {Object.entries(project.tokens.colors || {}).map(
                ([key, value]) => (
                  <div className="token-row" key={key}>
                    <input
                      aria-label={t("tokenLabel", { name: key })}
                      type="color"
                      value={value}
                      onChange={(e) =>
                        edit((d) => {
                          d.tokens.colors[key] = e.target.value;
                        })
                      }
                    />
                    <span>{key}</span>
                    <code>{value}</code>
                  </div>
                ),
              )}
              <h4>{t("typography")}</h4>
              {Object.entries(project.tokens.fonts || {}).map(
                ([key, value]) => (
                  <Field
                    key={key}
                    label={key}
                    value={value}
                    onChange={(v) =>
                      edit((d) => {
                        d.tokens.fonts[key] = v;
                      })
                    }
                  />
                ),
              )}
              <h4>{t("designRules")}</h4>
              <textarea
                aria-label={t("projectRules")}
                className="rules-editor"
                key={project.id}
                defaultValue={(project.tokens.rules || []).join("\n")}
                onBlur={(e) => {
                  const rules = e.target.value.split("\n").filter(Boolean);
                  if (
                    JSON.stringify(rules) !==
                    JSON.stringify(project.tokens.rules)
                  )
                    edit((d) => {
                      d.tokens.rules = rules;
                    });
                }}
              />
              <p className="hint">
                {t("rulesHint")}
              </p>
            </div>
          )}
        </aside>
        <main className="canvas-panel">
          <div className="canvas-toolbar">
            <div className="toolbar-cluster">
              <Tool
                icon="cursor"
                label={t("selectTool")}
                active={!hand}
                onClick={() => setHand(false)}
              />
              <Tool
                icon="hand"
                label={t("panTool")}
                active={hand}
                onClick={() => setHand(!hand)}
              />
              <span className="toolbar-separator" />
              <Tool
                icon="undo"
                label={t("undo")}
                disabled={!undo.current.length || busy}
                onClick={doUndo}
              />
              <Tool
                icon="redo"
                label={t("redo")}
                disabled={!redo.current.length || busy}
                onClick={doRedo}
              />
            </div>
            <div className="toolbar-cluster">
              <select className="alignment-select" aria-label={t("alignment.action")} data-testid="ui-alignment-action" value={alignmentMode} onChange={event => setAlignmentMode(event.target.value)}>
                {['left', 'center', 'right', 'top', 'middle', 'bottom', 'distributeX', 'distributeY'].map(mode => <option key={mode} value={mode}>{t(`alignment.${mode}`)}</option>)}
              </select>
              <Tool icon="align" label={t("alignment.apply")} data-testid="ui-alignment-apply" disabled={busy || movableSelection(project, selected).length < (alignmentMode.startsWith('distribute') ? 3 : 2)} onClick={() => align(alignmentMode)} />
              <Tool
                icon="group"
                label={t("group")}
                disabled={selected.length < 2}
                onClick={group}
              />
              <Tool
                icon="duplicate"
                label={t("duplicate")}
                disabled={!selected.length}
                onClick={duplicate}
              />
              <span className="toolbar-separator" />
              <Tool
                icon="snap"
                label={t("snap")}
                active={snap}
                aria-pressed={snap}
                data-testid="ui-snap-toggle"
                onClick={() => setSnap(!snap)}
              />
              <Tool icon="fit" label={t("guides.toggle")} active={showGuides} aria-pressed={showGuides} data-testid="ui-guides-toggle" onClick={() => { setShowGuides(!showGuides); setDragGuides([]); }} />
              <Tool
                icon="comment"
                label={t("pins")}
                active={showPins}
                onClick={() => setShowPins(!showPins)}
              />
            </div>
            <div className="zoom-controls">
              <Tool
                icon="minus"
                label={t("zoomOut")}
                onClick={() => setZoom((z) => Math.max(0.2, z - 0.1))}
              />
              <button className="zoom-value" data-testid="ui-zoom-reset" onClick={() => setZoom(1)}>
                {Math.round(zoom * 100)}%
              </button>
              <Tool
                icon="plus"
                label={t("zoomIn")}
                onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
              />
              <Tool icon="fit" label={t("fit")} onClick={fit} />
            </div>
          </div>
          <div className="canvas-context">
            <span>
              <i className="live-dot" />
              {dragActive ? t("guides.dragging") : t("canvasOverview")}
            </span>
            <span>
              {project.canvas.width} × {project.canvas.height}
              <b>{t("freeLayout")}</b>
            </span>
          </div>
          <div
            className={`canvas-scroll ${hand ? "pan-mode" : ""}`}
            ref={canvasWrap}
            onPointerDown={(e) => {
              if (hand) {
                panRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  left: e.currentTarget.scrollLeft,
                  top: e.currentTarget.scrollTop,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }
            }}
            onPointerMove={(e) => {
              if (panRef.current) {
                e.currentTarget.scrollLeft =
                  panRef.current.left - e.clientX + panRef.current.x;
                e.currentTarget.scrollTop =
                  panRef.current.top - e.clientY + panRef.current.y;
              }
            }}
            onPointerUp={() => (panRef.current = null)}
            onWheel={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                setZoom((z) =>
                  Math.max(0.2, Math.min(2, z + (e.deltaY < 0 ? 0.05 : -0.05))),
                );
              }
            }}
          >
            <div
              className="artboard-wrap"
              style={{
                width: project.canvas.width * zoom,
                height: project.canvas.height * zoom,
              }}
            >
              <div className="artboard-label">
                <Icon name="panel" size={11} />
                {project.name}<span>01</span>
              </div>
              <Stage
                ref={stageRef}
                width={project.canvas.width * zoom}
                height={project.canvas.height * zoom}
                scaleX={zoom}
                scaleY={zoom}
                listening={!hand}
                onMouseDown={(e) => {
                  if (
                    e.target === e.target.getStage() ||
                    e.target.name() === "canvas-background"
                  )
                    setSelected([]);
                }}
              >
                <Layer>
                  <Rect
                    name="canvas-background"
                    width={project.canvas.width}
                    height={project.canvas.height}
                    fill={project.canvas.background}
                  />
                  {visibleNodes.map((node) => (
                    <DesignNode
                      t={t}
                      key={`${node.id}-${fontEpoch}`}
                      node={node}
                      rect={layout.get(node.id)}
                      asset={project.assets.find(
                        (a) =>
                          a.id ===
                          (node.type === "Button"
                            ? node.buttonAssets?.[buttonState] || node.assetId
                            : node.assetId),
                      )}
                      selected={selected.includes(node.id)}
                      disabledDrag={autoPosition(node) || effectiveLocked(node)}
                      onSelect={(e, p) => selectNode(node, e, p)}
                      onMove={moveNode}
                      onDragStart={beginDrag}
                      onDragMove={updateDrag}
                      onTransform={transformNode}
                      showTip={notify}
                      nodeRef={(el) => {
                        if (el) shapeRefs.current.set(node.id, el);
                        else shapeRefs.current.delete(node.id);
                      }}
                    />
                  ))}
                </Layer>
                <Layer ref={overlayRef}>
                  {dragActive && dragBounds && <Rect name="moving-selection-outline" x={dragBounds.x} y={dragBounds.y} width={dragBounds.width} height={dragBounds.height} stroke="#d6bd79" strokeWidth={1 / zoom} dash={[4 / zoom, 3 / zoom]} listening={false} />}
                  {showGuides && dragGuides.map((guide, index) => <Line key={`${guide.axis}-${guide.value}-${index}`} name="smart-alignment-guide" points={guide.axis === 'x' ? [guide.value, guide.from, guide.value, guide.to] : [guide.from, guide.value, guide.to, guide.value]} stroke={guide.kind === 'center' ? '#63d4dc' : '#f0c96b'} strokeWidth={1.25 / zoom} dash={guide.kind === 'center' ? [5 / zoom, 3 / zoom] : undefined} listening={false} />)}
                  <Transformer
                    ref={transformerRef}
                    rotateEnabled={false}
                    flipEnabled={false}
                    borderStroke="#d6bd79"
                    anchorFill="#171e1d"
                    anchorStroke="#d6bd79"
                    anchorSize={7 / zoom}
                    borderStrokeWidth={1 / zoom}
                    keepRatio={false}
                    boundBoxFunc={(oldBox, newBox) =>
                      newBox.width < 8 || newBox.height < 8 ? oldBox : newBox
                    }
                  />
                  {showPins &&
                    project.reviews
                      .filter((r) => r.status !== "approved")
                      .map((r, index) => {
                        const n = layout.get(r.nodeId);
                        if (!n) return null;
                        return (
                          <Group
                            key={r.id}
                            x={n.x + n.width - 3}
                            y={n.y + 3}
                            onClick={() => {
                              setSelected([r.nodeId]);
                              setTab("review");
                            }}
                          >
                            <Circle
                              radius={10 / zoom}
                              fill={
                                r.status === "pending" ? "#d6bd79" : "#74b49c"
                              }
                              stroke="#17201e"
                              strokeWidth={2 / zoom}
                            />
                            <Text
                              x={-10 / zoom}
                              y={-6 / zoom}
                              width={20 / zoom}
                              text={String(index + 1)}
                              fontSize={11 / zoom}
                              fill="#17201e"
                              fontStyle="bold"
                              align="center"
                            />
                          </Group>
                        );
                      })}
                </Layer>
              </Stage>
            </div>
          </div>
          <div className="canvas-bottom">
            <div>
              <Icon name="cursor" size={12} />
              <span>
                {selected.length
                  ? t("selectedLabel", { count: selected.length, name: selectedNode?.name || "" })
                  : t("selectHint")}
              </span>
            </div>
            <span>
              {t("shiftHint")} <i>·</i> {t("spaceHint")} <i>·</i> {t("arrowsHint")}
            </span>
            <button onClick={exportCanvas}>{t("exportCanvas")}</button>
          </div>
          <div className="workflow-strip">
            <div className="workflow-step">
              <span>01</span>
              <div>
                <strong>{t("compose")}</strong>
                <small>{t("composeHint")}</small>
              </div>
            </div>
            <Icon name="chevron" size={13} />
            <div className="workflow-step active">
              <span>02</span>
              <div>
                <strong>{t("reviewTab")}</strong>
                <small>{t("reviewStepHint")}</small>
              </div>
            </div>
            <Icon name="chevron" size={13} />
            <div className="workflow-step">
              <span>03</span>
              <div>
                <strong>{t("patchStep")}</strong>
                <small>{t("patchStepHint")}</small>
              </div>
            </div>
            <Icon name="chevron" size={13} />
            <div className="workflow-step">
              <span>04</span>
              <div>
                <strong>Godot</strong>
                <small>{t("exportStepHint")}</small>
              </div>
            </div>
          </div>
        </main>
        <aside className="right-panel">
          <div className="panel-tabs">
            <button
              className={tab === "design" ? "selected" : ""}
              onClick={() => setTab("design")}
            >
              {t("properties")}
            </button>
            <button
              className={tab === "review" ? "selected" : ""}
              onClick={() => setTab("review")}
            >
              {t("reviewTab")}{" "}
              <span className="tab-count">
                {project.reviews.filter((r) => r.status !== "approved").length}
              </span>
            </button>
            <button
              className={tab === "history" ? "selected" : ""}
              onClick={() => setTab("history")}
            >
              {t("changesTab")}
            </button>
          </div>
          <div className="inspector-scroll">
            {tab === "design" ? (
              selectedNode ? (
                <>
                  <div className="selection-heading">
                    <span className="type-label" title={selectedNode.type}>{t(`type.${selectedNode.type}`)}</span>
                    <h3>{selectedNode.name}</h3>
                    <code title={selectedNode.id}>{selectedNode.id}</code>
                  </div>
                  <div className="inspector-section">
                    <div className="section-title">
                      <span>{t("component")}</span>
                      <Tool
                        icon={selectedNode.locked ? "lock" : "unlock"}
                        label={t("toggleLock")}
                        onClick={() =>
                          edit((d) => {
                            d.nodes.find(
                              (n) => n.id === selectedNode.id,
                            ).locked = !selectedNode.locked;
                          })
                        }
                      />
                    </div>
                    <Field
                      label={t("name")}
                      value={selectedNode.name}
                      onChange={(v) => updateNode("name", v)}
                      disabled={effectiveLocked(selectedNode)}
                    />
                    <label className="field">
                      <span>{t("parent")}</span>
                      <select
                        aria-label={t("parentComponent")}
                        value={selectedNode.parentId || ""}
                        disabled={effectiveLocked(selectedNode)}
                        onChange={(e) =>
                          edit((d) => {
                            const n = d.nodes.find(
                              (n) => n.id === selectedNode.id,
                            );
                            const old = layout.get(n.id),
                              p = layout.get(e.target.value) || { x: 0, y: 0 };
                            n.parentId = e.target.value || null;
                            n.frame.x = old.x - p.x;
                            n.frame.y = old.y - p.y;
                          })
                        }
                      >
                        <option value="">{t("canvas")}</option>
                        {project.nodes
                          .filter(
                            (n) =>
                              n.id !== selectedNode.id &&
                              ["Control", "Panel", ...containers].includes(
                                n.type,
                              ),
                          )
                          .map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <div className="property-grid">
                      {["x", "y", "width", "height"].map((k) => (
                        <Field
                          key={k}
                          label={
                            k === "width"
                              ? "W"
                              : k === "height"
                                ? "H"
                                : k.toUpperCase()
                          }
                          type="number"
                          value={Math.round(selectedNode.frame[k])}
                          min={["width", "height"].includes(k) ? 8 : undefined}
                          onChange={(v) => updateNode(`frame.${k}`, v)}
                          disabled={
                            effectiveLocked(selectedNode) ||
                            (autoPosition(selectedNode) &&
                              ["x", "y"].includes(k))
                          }
                        />
                      ))}
                    </div>
                    {autoPosition(selectedNode) && (
                      <p className="info-note">
                        {t("autoLayoutHint")}
                      </p>
                    )}
                    {containers.includes(selectedNode.type) && (
                      <div className="property-grid">
                        <Field
                          label={t("gap")}
                          type="number"
                          min="0"
                          value={selectedNode.layout?.gap || 0}
                          onChange={(v) => updateNode("layout.gap", v)}
                        />
                        <Field
                          label={t("padding")}
                          type="number"
                          min="0"
                          value={selectedNode.layout?.padding || 0}
                          onChange={(v) => updateNode("layout.padding", v)}
                        />
                      </div>
                    )}
                  </div>
                  <div className="inspector-section">
                    <div className="section-title">
                      <span>{t("appearance")}</span>
                    </div>
                    {["Label", "Button"].includes(selectedNode.type) && (
                      <>
                        <label className="field vertical">
                          <span>{t("text")}</span>
                          <textarea
                            aria-label={t("componentText")}
                            value={selectedNode.style?.text || ""}
                            disabled={effectiveLocked(selectedNode)}
                            onChange={(e) =>
                              updateNode("style.text", e.target.value)
                            }
                          />
                        </label>
                        <div className="property-grid">
                          <Field
                            label={t("fontSize")}
                            type="number"
                            min="8"
                            value={selectedNode.style?.fontSize || 16}
                            onChange={(v) => updateNode("style.fontSize", v)}
                          />
                          <label className="field">
                            <span>{t("align")}</span>
                            <select
                              aria-label={t("textAlign")}
                              value={selectedNode.style?.align || "left"}
                              onChange={(e) =>
                                updateNode("style.align", e.target.value)
                              }
                            >
                              {["left", "center", "right"].map((v) => (
                                <option key={v} value={v}>{t(`align.${v}`)}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <label className="field">
                          <span>{t("typeface")}</span>
                          <select
                            aria-label={t("typeface")}
                            value={
                              selectedNode.style?.fontFamily || "Studio Sans"
                            }
                            onChange={(e) =>
                              updateNode("style.fontFamily", e.target.value)
                            }
                          >
                            {[
                              ...new Set([
                                "Studio Sans",
                                "Studio Serif",
                                ...project.assets
                                  .filter((a) => a.kind === "font")
                                  .map((a) => a.name),
                              ]),
                            ].map((name) => (
                              <option key={name}>{name}</option>
                            ))}
                            <option>Georgia</option>
                            <option>Arial</option>
                          </select>
                        </label>
                      </>
                    )}
                    {["fill", "stroke", "color"].map((key) => (
                      <label className="color-field" key={key}>
                        <span>
                          {key === "color"
                            ? t("textColor")
                            : t(key)}
                        </span>
                        <div>
                          <input
                            type="color"
                            aria-label={t("colorLabel", { field: t(key === "color" ? "textColor" : key) })}
                            value={
                              /^#[a-fA-F0-9]{6}$/.test(
                                selectedNode.style?.[key] || "",
                              )
                                ? selectedNode.style[key]
                                : "#000000"
                            }
                            disabled={effectiveLocked(selectedNode)}
                            onChange={(e) =>
                              updateNode(`style.${key}`, e.target.value)
                            }
                          />
                          <input
                            aria-label={t("hexLabel", { field: t(key === "color" ? "textColor" : key) })}
                            value={selectedNode.style?.[key] || "transparent"}
                            onChange={(e) =>
                              updateNode(`style.${key}`, e.target.value)
                            }
                          />
                        </div>
                      </label>
                    ))}
                    <div className="property-grid">
                      <Field
                        label={t("radius")}
                        type="number"
                        min="0"
                        value={selectedNode.style?.radius || 0}
                        onChange={(v) => updateNode("style.radius", v)}
                      />
                      <Field
                        label={t("stroke")}
                        type="number"
                        min="0"
                        value={selectedNode.style?.strokeWidth || 0}
                        onChange={(v) => updateNode("style.strokeWidth", v)}
                      />
                      <Field
                        label={t("opacity")}
                        type="number"
                        min="0"
                        max="1"
                        step=".1"
                        value={selectedNode.style?.opacity ?? 1}
                        onChange={(v) => updateNode("style.opacity", v)}
                      />
                    </div>
                    <label className="field">
                      <span>{t("kind.texture")}</span>
                      <select
                        aria-label={t("componentTexture")}
                        value={selectedNode.assetId || ""}
                        onChange={(e) =>
                          updateNode("assetId", e.target.value || null)
                        }
                      >
                        <option value="">{t("none")}</option>
                        {project.assets
                          .filter((a) => a.kind !== "font")
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    {selectedNode.type === "Button" && (
                      <>
                        <div className="section-title">
                          <span>{t("buttonStates")}</span>
                        </div>
                        <div className="segmented">
                          {["normal", "hover", "pressed"].map((state) => (
                            <button
                              key={state}
                              className={buttonState === state ? "active" : ""}
                              onClick={() => setButtonState(state)}
                            >
                              {t(`state.${state}`)}
                            </button>
                          ))}
                        </div>
                        <label className="field">
                          <span>{t(`state.${buttonState}`)}</span>
                          <select
                            aria-label={t("buttonStateTexture")}
                            value={
                              selectedNode.buttonAssets?.[buttonState] || ""
                            }
                            onChange={(e) =>
                              edit((d) => {
                                const n = d.nodes.find(
                                  (n) => n.id === selectedNode.id,
                                );
                                n.buttonAssets ||= {};
                                if (e.target.value)
                                  n.buttonAssets[buttonState] = e.target.value;
                                else delete n.buttonAssets[buttonState];
                              })
                            }
                          >
                            <option value="">{t("useDefault")}</option>
                            {project.assets
                              .filter((a) => a.kind !== "font")
                              .map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      </>
                    )}
                  </div>
                  <div className="inspector-section">
                    <button
                      className="button full"
                      onClick={() => {
                        setTab("review");
                        setReviewForm({
                          ...reviewForm,
                          target: selectedNode.name,
                        });
                      }}
                    >
                      <Icon name="comment" />
                      {t("addReview")}
                    </button>
                    {selectedNode.type === "Control" &&
                      project.nodes.some(
                        (n) => n.parentId === selectedNode.id,
                      ) && (
                        <button
                          className="button full subtle"
                          onClick={ungroup}
                        >
                          {t("ungroup")}
                        </button>
                      )}
                    <button className="button full danger" onClick={remove}>
                      <Icon name="trash" />
                      {t("delete")}
                    </button>
                  </div>
                </>
              ) : (
                <div className="empty-panel">
                  <Icon name="cursor" size={32} />
                  <h3>{t("selectComponent")}</h3>
                  <p>{t("selectDescription")}</p>
                </div>
              )
            ) : tab === "review" ? (
              <>
                <div className="review-heading">
                  <div className="eyebrow">{t("componentReview")}</div>
                  <h2>{t("reviewTitle")}</h2>
                  <p>{t("reviewDescription")}</p>
                  <div className="review-summary">
                    <span>
                      <b>{pendingReviews.length}</b> {t("status.pending")}
                    </span>
                    <span>
                      <b>
                        {
                          project.reviews.filter((r) => r.status === "review")
                            .length
                        }
                      </b>{" "}
                      {t("status.review")}
                    </span>
                    <span>
                      <b>
                        {
                          project.reviews.filter((r) => r.status === "approved")
                            .length
                        }
                      </b>{" "}
                      {t("status.approved")}
                    </span>
                  </div>
                </div>
                <div className="section-title padded">
                  <span>
                    {selectedNode
                      ? selectedNode.name.toUpperCase()
                      : t("allComponents")}
                  </span>
                  {selected.length > 0 && (
                    <button
                      className="text-button"
                      onClick={() => setSelected([])}
                    >
                      {t("showAll")}
                    </button>
                  )}
                </div>
                {reviewList.length ? (
                  reviewList.map((review) => (
                    <article
                      className={`review-card status-${review.status}`}
                      key={review.id}
                    >
                      <div className="review-card-top">
                        <span className={`priority ${review.priority}`}>
                          {t(priorityNames[review.priority])}{t("prioritySuffix")}
                        </span>
                        <span className="review-status">
                          {t(statuses[review.status])}
                        </span>
                      </div>
                      <button
                        className="review-target"
                        onClick={() => setSelected([review.nodeId])}
                      >
                        <Icon name="button" size={13} />
                        {project.nodes.find((n) => n.id === review.nodeId)
                          ?.name || review.nodeId}
                      </button>
                      <h4>{review.target}</h4>
                      <p>{review.expected}</p>
                      {review.protectedProperties.length > 0 && (
                        <div className="protected">
                          <Icon name="lock" size={12} />
                          <span>
                            {t("keep")} {review.protectedProperties.join(", ")}
                          </span>
                        </div>
                      )}
                      <div className="review-card-footer">
                        <code title={review.id}>{review.id.slice(0, 20)}</code>
                        <select
                          aria-label={t("reviewStatusLabel", { id: review.id })}
                          value={review.status}
                          onChange={(e) =>
                            edit((d) => {
                              d.reviews.find((r) => r.id === review.id).status =
                                e.target.value;
                            })
                          }
                        >
                          {Object.entries(statuses).map(([key, label]) => (
                            <option key={key} value={key}>
                              {t(label)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="small-empty">
                    <Icon name="comment" size={24} />
                    <p>{t("noReviews")}</p>
                  </div>
                )}
                <div className="review-form">
                  <div className="section-title">
                    <span>{t("newFeedback")}</span>
                    <Icon name="plus" size={14} />
                  </div>
                  {selectedNode ? (
                    <form onSubmit={addReview}>
                      <div className="attached-to">
                        <Icon name="layers" size={12} />
                        <span>{t("attached")}{selectedNode.name}</span>
                      </div>
                      <label>
                        {t("reviewTarget")}
                        <input
                          aria-label={t("reviewTarget")}
                          required
                          placeholder={t("targetPlaceholder")}
                          value={reviewForm.target}
                          onChange={(e) =>
                            setReviewForm({
                              ...reviewForm,
                              target: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        {t("expectedResult")}
                        <textarea
                          aria-label={t("expectedResult")}
                          required
                          placeholder={t("expectedPlaceholder")}
                          value={reviewForm.expected}
                          onChange={(e) =>
                            setReviewForm({
                              ...reviewForm,
                              expected: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        {t("protected")}
                        <input
                          aria-label={t("protected")}
                          placeholder="frame.x, frame.y"
                          value={reviewForm.protectedProperties}
                          onChange={(e) =>
                            setReviewForm({
                              ...reviewForm,
                              protectedProperties: e.target.value,
                            })
                          }
                        />
                      </label>
                      <div className="review-submit">
                        <select
                          aria-label={t("reviewPriority")}
                          value={reviewForm.priority}
                          onChange={(e) =>
                            setReviewForm({
                              ...reviewForm,
                              priority: e.target.value,
                            })
                          }
                        >
                          <option value="critical">{t("criticalPriority")}</option>
                          <option value="high">{t("highPriority")}</option>
                          <option value="medium">{t("mediumPriority")}</option>
                          <option value="low">{t("lowPriority")}</option>
                        </select>
                        <button className="button primary small" type="submit">
                          <Icon name="plus" size={13} />
                          {t("submitReview")}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <p className="hint">{t("reviewSelectHint")}</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="review-heading">
                  <div className="eyebrow">{t("incremental")}</div>
                  <h2>{t("changesTitle")}</h2>
                  <p>{t("changesHint")}</p>
                </div>
                <div className="inspector-section">
                  <button
                    className="button full"
                    onClick={() => patchInput.current.click()}
                    disabled={busy}
                  >
                    <Icon name="upload" />
                    {t("importPatch")}
                  </button>
                  <button
                    className="button full subtle"
                    onClick={samplePatch}
                    disabled={busy}
                  >
                    {t("samplePatch")}
                  </button>
                  <p className="hint">
                    {t("patchHint")}
                  </p>
                </div>
                {project.history.length ? (
                  [...project.history].reverse().map((entry) => (
                    <article className="history-card" key={entry.id}>
                      <div className="history-heading">
                        <Icon
                          name={entry.kind === "rollback" ? "undo" : "code"}
                          size={14}
                        />
                        <span>{entry.summary || entry.kind}</span>
                        <small>r{entry.revision}</small>
                      </div>
                      {(entry.changes || []).map((change, i) => (
                        <div className="diff-row" key={i}>
                          <strong>
                            {project.nodes.find((n) => n.id === change.nodeId)
                              ?.name || change.nodeId}
                          </strong>
                          <code>{change.path}</code>
                          <div>
                            <del>{String(change.before ?? "∅")}</del>
                            <ins>{String(change.after ?? "∅")}</ins>
                          </div>
                        </div>
                      ))}
                      {entry.kind === "patch" && (
                        <button
                          className="button small full subtle"
                          disabled={entry.rolledBack || busy}
                          onClick={() =>
                            action(async () => {
                              const value = await api("/api/rollback", {
                                historyId: entry.id,
                              });
                              accept(value);
                              undo.current = [];
                              redo.current = [];
                              notify(t("notify.rollback"));
                            })
                          }
                        >
                          <Icon name="undo" size={13} />
                          {entry.rolledBack ? t("rolledBack") : t("rollback")}
                        </button>
                      )}
                    </article>
                  ))
                ) : (
                  <div className="small-empty">
                    <Icon name="history" size={28} />
                    <p>
                      {t("noHistory")}
                      <br />
                      {t("noHistoryHint")}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="export-panel">
            <div>
              <Icon name="code" size={18} />
              <span>
                <strong>Godot 4</strong>
                <small>{t("nativeNodes")}</small>
              </span>
              <span className="export-label">{t("experimental")}</span>
            </div>
            <button
              className="button full"
              disabled={busy || pending > 0}
              onClick={() =>
                action(async () => {
                  const result = await api("/api/godot", {});
                  downloadArchive(result.downloadUrl);
                  notify(
                    result.warnings?.length
                      ? { key: "notify.godotWarnings", values: { count: result.warnings.length } }
                      : t("notify.godot"),
                  );
                })
              }
            >
              <Icon name="download" />
              {t("exportGodot")}
            </button>
          </div>
        </aside>
      </div>
      <footer className="app-footer">
        <span>
          <i className="live-dot" />
          {t("localWorkspace")} <b>·</b> r{project.revision}
        </span>
        <span>
          {project.nodes.length} {t("componentsCount")} <b>·</b> {project.assets.length}{" "}
          {t("assetsCount")} <b>·</b> {project.reviews.length} {t("reviewsCount")}
        </span>
        <div>
          <button onClick={() => setDialog("import")}>{t("importUI")}</button>
          <button onClick={() => patchInput.current.click()}>{t("importPatch")}</button>
          <span>{t("phase")}</span>
        </div>
      </footer>
      </div>
      {busy && (
        <div className="busy-shield" aria-label={t("working")} role="status">
          <span>{t("working")}</span>
        </div>
      )}
      {error && (
        <div role="alert" className="error-banner">
          <Icon name="close" />
          <span>{errorMessage(locale, error)}</span>
          <button aria-label={t("closeError")} onClick={() => setError("")}>
            <Icon name="close" />
          </button>
        </div>
      )}
      {toast && (
        <div role="status" className="toast">
          <Icon name="check" size={16} />
          {translateMessage(locale, toast)}
        </div>
      )}
      {preferenceError && <div className="preference-notice" role="status">{t("languageFailure")}</div>}
      {dialog === "import" && <ImportDialog t={t} locale={locale} busy={busy} externalError={error} onClearError={() => setError("")} onClose={() => setDialog(null)} onImport={importProject} downloadJson={downloadJson} />}
      {dialog === "studio" && <StudioToolbox locale={locale} kind="ui" selection={selected} onClose={() => setDialog(null)} />}
      {dialog === "generation" && <GenerationDialog locale={locale} project={project} onClose={() => setDialog(null)} onExport={exportGeneration} />}
      {dialog === "patch" && <PatchReviewDialog t={t} locale={locale} initialText={jsonText} onClose={() => setDialog(null)} onPreview={previewPatch} onApply={patch} downloadJson={downloadJson} />}
      <input
        data-testid="component-file"
        aria-label={t("componentFile")}
        hidden
        type="file"
        accept="application/json,.json"
        ref={componentInput}
        onChange={componentImport}
      />
      <input
        data-testid="patch-file"
        aria-label={t("patchFile")}
        hidden
        type="file"
        accept="application/json,.json"
        ref={patchInput}
        onChange={(e) => uploadJson(e, "patch")}
      />
      <input
        data-testid="asset-file"
        aria-label={t("assetFile")}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,.ttf,.otf"
        ref={assetInput}
        onChange={assetUpload}
      />
    </div>
  );
}
