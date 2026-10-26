import React, { useCallback, useEffect, useRef, useState } from "react";
import Konva from "konva";
import {
  Stage,
  Layer,
  Group,
  Image as KImage,
  Line,
  Circle,
  Rect,
} from "react-konva";
import {
  validateMap,
  isoToScreen,
  screenToIso,
  isWalkable,
  findPath,
  previewMapPatch,
  getAssetFootprint,
  planMapPlacement,
  moveMapObject,
  getActorLayerId,
  getMapRenderLayers,
} from "./mapModel.js";
import { makeId } from "./model.js";
import { mapTranslate } from "./mapMessages.js";
import "./mapStyles.css";
const copy = (value) => structuredClone(value);
const key = (x, y) => x + "," + y;
const inside = (map, x, y) =>
  x >= 0 && y >= 0 && x < map.grid.width && y < map.grid.height;
const statuses = ["pending", "modified", "review", "approved"];
const priorities = ["low", "medium", "high", "critical"];
const toolNames = [
  "select",
  "pan",
  "brush",
  "erase",
  "rectangle",
  "fill",
  "region",
  "collision",
  "spawn",
  "exit",
  "trigger",
  "walk",
];
const symbols = {
  select: "↖",
  pan: "✥",
  brush: "▱",
  erase: "◇",
  rectangle: "▰",
  fill: "◈",
  region: "▧",
  collision: "⊠",
  spawn: "⚑",
  exit: "↗",
  trigger: "◎",
  walk: "♟",
};
async function request(url, body, method) {
  const response = await fetch(url, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "HTTP " + response.status);
  return result;
}
function download(name, value) {
  const url = URL.createObjectURL(
    new Blob(
      [typeof value === "string" ? value : JSON.stringify(value, null, 2)],
      { type: "application/json" },
    ),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function archive(result) {
  const link = document.createElement("a");
  link.href = result.downloadUrl;
  link.download = "";
  link.click();
}
async function readJson(file) {
  if (!file || !/\.json$/i.test(file.name) || file.size > 25 * 1024 * 1024)
    throw new Error("MAP_INVALID_FILE");
  return JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
}
function useImages(assets) {
  const [images, setImages] = useState({});
  const sources = [...new Set((assets || []).map((asset) => asset.src))].join(
    "|",
  );
  useEffect(() => {
    let active = true;
    const values = { __errors: [], __ready: false };
    Promise.all(
      sources
        .split("|")
        .filter(Boolean)
        .map(
          (src) =>
            new Promise((resolve) => {
              const image = new Image();
              image.onload = () => {
                values[src] = image;
                resolve();
              };
              image.onerror = () => {
                values.__errors.push(src);
                resolve();
              };
              image.src = src;
            }),
        ),
    ).then(() => {
      values.__ready = true;
      if (active) setImages(values);
    });
    return () => {
      active = false;
    };
  }, [sources]);
  return images;
}
function sprite(asset, images, props) {
  const { key: elementKey, ...imageProps } = props;
  return asset && images[asset.src] ? (
    <KImage
      key={elementKey}
      image={images[asset.src]}
      crop={asset.atlas}
      {...imageProps}
    />
  ) : null;
}
function diamond(x, y, grid) {
  const p = isoToScreen(x, y, grid);
  return [
    p.x,
    p.y - grid.tileHeight / 2,
    p.x + grid.tileWidth / 2,
    p.y,
    p.x,
    p.y + grid.tileHeight / 2,
    p.x - grid.tileWidth / 2,
    p.y,
  ];
}
function regionBounds(region, grid, padding = 0) {
  const corners = [
    [region.x, region.y],
    [region.x + region.width - 1, region.y],
    [region.x, region.y + region.height - 1],
    [region.x + region.width - 1, region.y + region.height - 1],
  ].map(([x, y]) => isoToScreen(x, y, grid));
  const x = Math.min(...corners.map((p) => p.x)) - grid.tileWidth / 2 - padding,
    y = Math.min(...corners.map((p) => p.y)) - grid.tileHeight / 2 - padding;
  return {
    x,
    y,
    width:
      Math.max(...corners.map((p) => p.x)) + grid.tileWidth / 2 + padding - x,
    height:
      Math.max(...corners.map((p) => p.y)) + grid.tileHeight / 2 + padding - y,
  };
}
function objectBounds(object, grid, padding = 0) {
  const p = isoToScreen(object.x, object.y, grid);
  return {
    x: p.x - object.width * object.anchorX - padding,
    y: p.y - object.height * object.anchorY - padding,
    width: object.width + padding * 2,
    height: object.height + padding * 2,
  };
}
export function MapScene({
  project,
  images,
  sceneRef,
  selectedId,
  editable = false,
  onSelect,
  onDrag,
  onDragPreview,
  player,
  showMarkers = true,
}) {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const renderObject = (object) => {
    const p = isoToScreen(object.x, object.y, project.grid);
    if (object.isPlayer)
      return (
        <Group key={object.id} x={p.x} y={p.y} listening={false}>
          <Circle radius={9} fill="#09160b88" scaleY={0.5} />
          <Line
            points={[-5, -5, 0, -20, 5, -5]}
            closed
            fill="#cbad67"
            stroke="#f2dfa2"
            strokeWidth={2}
          />
          <Circle y={-23} radius={5} fill="#edd9ae" stroke="#684c33" />
        </Group>
      );
    const locked = project.layers.find(
      (layer) => layer.id === object.layerId,
    )?.locked;
    return (
      <Group
        key={object.id}
        id={"map-object-" + object.id}
        x={p.x}
        y={p.y}
        draggable={editable && !locked}
        onMouseDown={(event) => {
          if (editable) {
            event.cancelBubble = true;
            onSelect?.(object.id);
          }
        }}
        onTouchStart={(event) => {
          if (editable) {
            event.cancelBubble = true;
            onSelect?.(object.id);
          }
        }}
        onClick={(event) => {
          if (editable) {
            event.cancelBubble = true;
            onSelect?.(object.id);
          }
        }}
        onDragStart={(event) => {
          event.cancelBubble = true;
          onSelect?.(object.id);
          onDragPreview?.(object.id, object.x, object.y);
        }}
        onDragMove={(event) => {
          event.cancelBubble = true;
          const point = screenToIso(
            event.target.x(),
            event.target.y(),
            project.grid,
          );
          onDragPreview?.(object.id, Math.round(point.x), Math.round(point.y));
        }}
        onDragEnd={(event) => {
          event.cancelBubble = true;
          const point = screenToIso(
            event.target.x(),
            event.target.y(),
            project.grid,
          );
          event.target.position(p);
          onDragPreview?.(null);
          onDrag?.(object.id, Math.round(point.x), Math.round(point.y));
        }}
      >
        {sprite(assets.get(object.assetId), images, {
          x: -object.width * object.anchorX,
          y: -object.height * object.anchorY,
          width: object.width,
          height: object.height,
        })}
        {selectedId === object.id && (
          <Rect
            name="selection-outline"
            x={-object.width * object.anchorX - 3}
            y={-object.height * object.anchorY - 3}
            width={object.width + 6}
            height={object.height + 6}
            stroke="#e6d18c"
            strokeWidth={1.5}
            dash={[5, 4]}
            listening={false}
          />
        )}
      </Group>
    );
  };
  return (
    <Group ref={sceneRef}>
      {getMapRenderLayers(project)
        .filter((band) => band.layer.visible)
        .map((band) => {
          const objects = [...band.objects];
          if (player && band.actor)
            objects.push({
              id: "__player",
              x: player.x,
              y: player.y,
              isPlayer: true,
            });
          objects.sort((a, b) => a.x + a.y - b.x - b.y);
          return (
            <Group key={band.layer.id}>
              <Group listening={false}>
                {Object.entries(band.layer.cells).map(([cell, assetId]) => {
                  const [x, y] = cell.split(",").map(Number),
                    p = isoToScreen(x, y, project.grid),
                    asset = assets.get(assetId);
                  return sprite(asset, images, {
                    key: cell,
                    x: p.x - asset.width / 2,
                    y: p.y - asset.height / 2,
                    width: asset.width,
                    height: asset.height,
                    listening: false,
                  });
                })}
              </Group>
              {objects.map(renderObject)}
            </Group>
          );
        })}
      {showMarkers &&
        project.markers.map((marker) => {
          const p = isoToScreen(marker.x, marker.y, project.grid),
            color =
              marker.type === "spawn"
                ? "#b4e189"
                : marker.type === "exit"
                  ? "#f5cf7b"
                  : "#91cde0";
          return (
            <Group key={marker.id} x={p.x} y={p.y} listening={false}>
              <Circle
                radius={8}
                stroke={color}
                strokeWidth={2}
                fill={color + "33"}
                scaleY={0.5}
              />
              <Line
                points={[0, 0, 0, -21, 13, -16, 0, -11]}
                stroke={color}
                strokeWidth={2}
              />
            </Group>
          );
        })}
    </Group>
  );
}

function Modal({ title, children, close, busy = false, testId }) {
  const ref = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector("button,input,textarea,select")?.focus();
    const handler = (event) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        close();
      }
      if (event.key === "Tab") {
        const items = [
            ...ref.current.querySelectorAll(
              'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
            ),
          ],
          first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const element = ref.current;
    element.addEventListener("keydown", handler);
    return () => {
      element.removeEventListener("keydown", handler);
      previous?.focus?.();
    };
  }, [busy, close]);
  return (
    <div className="map-modal-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="map-dialog"
        ref={ref}
        data-testid={testId}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
function FilePicker({ label, emptyLabel, disabled, onChange, ...inputProps }) {
  const input = useRef(null);
  const [filename, setFilename] = useState("");
  return (
    <div className="map-file-picker">
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {label}
      </button>
      <span className="map-muted">{filename || emptyLabel}</span>
      <input
        {...inputProps}
        ref={input}
        type="file"
        hidden
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          setFilename(event.target.files[0]?.name || "");
          onChange(event);
        }}
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 16384,
  step = 1,
  disabled,
  testId,
  integer = false,
}) {
  return (
    <label>
      {label}
      <input
        className="map-number-input"
        data-testid={testId}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value === "") return;
          const next = Number(event.target.value);
          if (
            Number.isFinite(next) &&
            next >= min &&
            next <= max &&
            (!integer || Number.isInteger(next))
          )
            onChange(next);
        }}
      />
    </label>
  );
}

export default function MapWorkspace({ locale = "zh-CN", active = true }) {
  const t = useCallback((name) => mapTranslate(locale, name), [locale]);
  const [project, setProject] = useState(null),
    projectRef = useRef(null),
    saveQueue = useRef(Promise.resolve()),
    serverRevision = useRef(0),
    localVersion = useRef(0),
    failed = useRef(false);
  const [saving, setSaving] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(null),
    [notice, setNotice] = useState(null);
  const [tool, setTool] = useState("select"),
    [activeLayer, setActiveLayer] = useState(null),
    [palette, setPalette] = useState("terrain"),
    [assetId, setAssetId] = useState(null);
  const [selection, setSelection] = useState(null),
    [rightTab, setRightTab] = useState("properties"),
    [showGrid, setShowGrid] = useState(true),
    [showCollisions, setShowCollisions] = useState(false);
  const [view, setView] = useState({ x: 350, y: 120, scale: 1 }),
    [viewport, setViewport] = useState({ width: 800, height: 600 }),
    viewRef = useRef(view);
  const [undoStack, setUndoStack] = useState([]),
    [redoStack, setRedoStack] = useState([]),
    undoRef = useRef([]),
    redoRef = useRef([]);
  const canvasRef = useRef(),
    stageRef = useRef(),
    sceneRef = useRef(),
    gesture = useRef(null),
    [dragRegion, setDragRegion] = useState(null),
    dragRegionRef = useRef(null),
    readEpoch = useRef(0),
    draggingAsset = useRef(null);
  const [dropGhost, setDropGhost] = useState(null),
    [objectGhost, setObjectGhost] = useState(null);
  const [importFootprint, setImportFootprint] = useState({
    width: 1,
    height: 1,
  });
  const [player, setPlayer] = useState(null),
    walkTimer = useRef(null);
  const [reviewTarget, setReviewTarget] = useState(""),
    [expected, setExpected] = useState(""),
    [priority, setPriority] = useState("medium"),
    [protections, setProtections] = useState([]);
  const [dialog, setDialog] = useState(null),
    [dialogError, setDialogError] = useState(""),
    [jsonText, setJsonText] = useState(""),
    [imported, setImported] = useState(null);
  const [patch, setPatch] = useState(null),
    [patchPreview, setPatchPreview] = useState(null),
    [chosenChanges, setChosenChanges] = useState([]),
    [previewAfter, setPreviewAfter] = useState(true);
  const [newName, setNewName] = useState(""),
    [newWidth, setNewWidth] = useState(16),
    [newHeight, setNewHeight] = useState(16);
  const [assetFile, setAssetFile] = useState(null),
    [assetName, setAssetName] = useState(""),
    [assetKind, setAssetKind] = useState("tile"),
    [useAtlas, setUseAtlas] = useState(false),
    [atlas, setAtlas] = useState({ x: 0, y: 0, width: 64, height: 32 });
  const images = useImages(project?.assets),
    currentLayer = project?.layers.find((layer) => layer.id === activeLayer);
  const activeAsset = project?.assets.find((asset) => asset.id === assetId);
  const selectedObject =
    selection?.type === "object"
      ? project?.objects.find((object) => object.id === selection.objectId)
      : null;
  const lockedSelection =
    selectedObject &&
    project.layers.find((layer) => layer.id === selectedObject.layerId)?.locked;
  const setDocument = useCallback((next) => {
    projectRef.current = next;
    setProject(next);
  }, []);
  const setUndo = (value) => {
      undoRef.current = value;
      setUndoStack(value);
    },
    setRedo = (value) => {
      redoRef.current = value;
      setRedoStack(value);
    };
  const reportError = useCallback(
    (value) => setError({ message: value?.message || String(value) }),
    [],
  );
  const localError = (value) =>
    value === "MAP_INVALID_FILE" ? t("invalidFile") : t("error");
  const fit = useCallback(
    (map = projectRef.current) => {
      if (!map) return;
      const ground = regionBounds(
        { x: 0, y: 0, width: map.grid.width, height: map.grid.height },
        map.grid,
      );
      const boxes = [
        ground,
        ...map.objects
          .filter((object) =>
            map.layers.some(
              (layer) => layer.id === object.layerId && layer.visible,
            ),
          )
          .map((object) => objectBounds(object, map.grid)),
      ];
      const left = Math.min(...boxes.map((box) => box.x)) - 30,
        top = Math.min(...boxes.map((box) => box.y)) - 30;
      const right = Math.max(...boxes.map((box) => box.x + box.width)) + 30,
        bottom = Math.max(...boxes.map((box) => box.y + box.height)) + 30;
      const bounds = {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      };
      const width = canvasRef.current?.clientWidth || viewport.width,
        height = canvasRef.current?.clientHeight || viewport.height;
      if (!width || !height) return;
      const scale = Math.max(
        0.15,
        Math.min(2, (width - 30) / bounds.width, (height - 30) / bounds.height),
      );
      const next = {
        x: width / 2 - (bounds.x + bounds.width / 2) * scale,
        y: height / 2 - (bounds.y + bounds.height / 2) * scale,
        scale,
      };
      viewRef.current = next;
      setView(next);
    },
    [viewport],
  );
  const refresh = useCallback(async () => {
    const next = await request("/api/map");
    serverRevision.current = next.revision;
    localVersion.current++;
    failed.current = false;
    setDocument(next);
    setActiveLayer(next.layers[0]?.id || null);
    setAssetId(next.assets.find((asset) => asset.kind === "tile")?.id || null);
    setSelection(null);
    setUndo([]);
    setRedo([]);
    setError(null);
    setSaving(false);
    const spawn = next.markers.find((marker) => marker.type === "spawn");
    setPlayer(spawn ? { x: spawn.x, y: spawn.y } : null);
    return next;
  }, [setDocument]);
  useEffect(() => {
    let live = true;
    refresh()
      .then((next) => {
        if (live) requestAnimationFrame(() => fit(next));
      })
      .catch(reportError);
    return () => {
      live = false;
      clearInterval(walkTimer.current);
    };
  }, []);
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setViewport({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [!!project]);
  useEffect(() => {
    if (!active || tool !== "walk") clearInterval(walkTimer.current);
  }, [active, tool]);
  const persist = useCallback(
    (next) => {
      const version = ++localVersion.current;
      setSaving(true);
      saveQueue.current = saveQueue.current.then(async () => {
        if (failed.current) return;
        const payload = copy(next);
        payload.revision = serverRevision.current;
        try {
          const saved = await request(
            "/api/map",
            { project: payload, baseRevision: serverRevision.current },
            "PUT",
          );
          serverRevision.current = saved.revision;
          if (version === localVersion.current) {
            setDocument(saved);
            setSaving(false);
          } else if (projectRef.current)
            setDocument({ ...projectRef.current, revision: saved.revision });
        } catch (failure) {
          failed.current = true;
          setSaving(false);
          reportError(failure);
        }
      });
      return saveQueue.current;
    },
    [reportError, setDocument],
  );
  const commit = useCallback(
    (next, previous = projectRef.current, remember = true) => {
      if (busy || failed.current) return false;
      try {
        validateMap(next);
        if (remember) {
          setUndo([...undoRef.current.slice(-49), copy(previous)]);
          setRedo([]);
        }
        setDocument(next);
        persist(next);
        setNotice(null);
        return true;
      } catch (failure) {
        reportError(failure);
        return false;
      }
    },
    [busy, persist, reportError, setDocument],
  );
  const edit = useCallback(
    (mutator) => {
      const current = projectRef.current;
      if (!current) return;
      const next = copy(current);
      mutator(next);
      return commit(next, current);
    },
    [commit],
  );
  const flush = useCallback(async () => {
    await saveQueue.current;
    if (failed.current) throw new Error("MAP_SAVE_FAILED");
    return projectRef.current;
  }, []);
  const perform = useCallback(
    async (action) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await flush();
        await action();
      } catch (failure) {
        reportError(failure);
      } finally {
        setBusy(false);
      }
    },
    [busy, flush, reportError],
  );
  const undo = useCallback(() => {
    if (!undoRef.current.length || busy || failed.current) return;
    const next = copy(undoRef.current.at(-1));
    next.revision = serverRevision.current;
    setRedo([...redoRef.current, copy(projectRef.current)]);
    setUndo(undoRef.current.slice(0, -1));
    commit(next, projectRef.current, false);
  }, [busy, commit]);
  const redo = useCallback(() => {
    if (!redoRef.current.length || busy || failed.current) return;
    const next = copy(redoRef.current.at(-1));
    next.revision = serverRevision.current;
    setUndo([...undoRef.current, copy(projectRef.current)]);
    setRedo(redoRef.current.slice(0, -1));
    commit(next, projectRef.current, false);
  }, [busy, commit]);
  const updateObject = useCallback(
    (id, values) => {
      const map = projectRef.current,
        object = map?.objects.find((item) => item.id === id);
      if (!object) return false;
      if (map.layers.find((layer) => layer.id === object.layerId)?.locked) {
        setNotice("lockedLayer");
        return false;
      }
      try {
        let next;
        if (
          ["x", "y", "layerId", "footprint"].some((field) =>
            Object.hasOwn(values, field),
          )
        )
          next = moveMapObject(map, {
            objectId: id,
            layerId: values.layerId ?? object.layerId,
            x: values.x ?? object.x,
            y: values.y ?? object.y,
            footprint: values.footprint ?? object.footprint,
          });
        else next = copy(map);
        Object.assign(
          next.objects.find((item) => item.id === id),
          values,
        );
        return commit(next, map);
      } catch (failure) {
        reportError(failure);
        return false;
      }
    },
    [commit, reportError],
  );
  const reorderLayer = (id, direction) => {
    const map = projectRef.current,
      index = map.layers.findIndex((layer) => layer.id === id),
      target = index + direction;
    if (index < 0 || target < 0 || target >= map.layers.length) return;
    if (map.layers[index].locked || map.layers[target].locked) {
      setNotice("lockedLayer");
      return;
    }
    edit((next) => {
      next.actorLayerId = getActorLayerId(next);
      [next.layers[index], next.layers[target]] = [
        next.layers[target],
        next.layers[index],
      ];
    });
  };
  const updateAssetFootprint = (field, value) => {
    if (!activeAsset) return;
    edit((next) => {
      const asset = next.assets.find((item) => item.id === activeAsset.id);
      asset.footprint = { ...getAssetFootprint(asset), [field]: value };
    });
  };
  const zoom = (
    factor,
    pointer = { x: viewport.width / 2, y: viewport.height / 2 },
  ) => {
    const previous = viewRef.current,
      scale = Math.min(4, Math.max(0.12, previous.scale * factor));
    const next = {
      scale,
      x: pointer.x - ((pointer.x - previous.x) / previous.scale) * scale,
      y: pointer.y - ((pointer.y - previous.y) / previous.scale) * scale,
    };
    viewRef.current = next;
    setView(next);
  };
  const pointerCell = (event) => {
    const pointer = event
      ? {
          x: event.clientX - canvasRef.current.getBoundingClientRect().left,
          y: event.clientY - canvasRef.current.getBoundingClientRect().top,
        }
      : stageRef.current?.getPointerPosition();
    if (!pointer || !projectRef.current) return null;
    const p = screenToIso(
      (pointer.x - viewRef.current.x) / viewRef.current.scale,
      (pointer.y - viewRef.current.y) / viewRef.current.scale,
      projectRef.current.grid,
    );
    return { x: Math.round(p.x), y: Math.round(p.y) };
  };
  const walkTo = useCallback(
    (target) => {
      clearInterval(walkTimer.current);
      const map = projectRef.current,
        spawn = map.markers.find((marker) => marker.type === "spawn"),
        start = player || spawn || target,
        path = findPath(map, start, target);
      if (!path.length) {
        setNotice("noPath");
        return;
      }
      setNotice(null);
      let index = 0;
      setPlayer(path[0]);
      walkTimer.current = setInterval(() => {
        index++;
        if (index >= path.length) {
          clearInterval(walkTimer.current);
          return;
        }
        setPlayer(path[index]);
      }, 110);
    },
    [player],
  );
  const placeAsset = (id, point) => {
    const map = projectRef.current;
    try {
      const plan = planMapPlacement(map, {
        assetId: id,
        layerId: activeLayer,
        x: point.x,
        y: point.y,
      });
      const next = copy(map);
      if (plan.type === "tile") {
        const layer = next.layers.find((item) => item.id === activeLayer);
        for (const cell of plan.cells)
          layer.cells[key(cell.x, cell.y)] = cell.assetId;
      } else next.objects.push(plan.object);
      if (commit(next, map)) {
        if (plan.type === "object") {
          setSelection({ type: "object", objectId: plan.object.id });
          setRightTab("properties");
        }
        if (!map.layers.find((layer) => layer.id === activeLayer)?.visible)
          setNotice("placedHidden");
        return true;
      }
    } catch (failure) {
      setNotice("invalidPlacement");
      reportError(failure);
    }
    return false;
  };
  const placeObject = placeAsset;
  const ghostFor = (id, point, objectId = null) => {
    const map = projectRef.current,
      asset = map.assets.find((item) => item.id === id),
      object = objectId
        ? map.objects.find((item) => item.id === objectId)
        : null;
    if (!asset || !point) return null;
    const footprint = object?.footprint || getAssetFootprint(asset),
      layerId = object?.layerId || activeLayer,
      layer = map.layers.find((item) => item.id === layerId);
    return {
      assetId: id,
      objectId,
      layerId,
      x: point.x,
      y: point.y,
      width: footprint.width,
      height: footprint.height,
      valid:
        !!layer &&
        !layer.locked &&
        point.x >= 0 &&
        point.y >= 0 &&
        point.x + footprint.width <= map.grid.width &&
        point.y + footprint.height <= map.grid.height,
    };
  };
  const strokeCell = (draft, point, mode, paintValue) => {
    if (!inside(draft, point.x, point.y)) return;
    const layer = draft.layers.find((item) => item.id === activeLayer),
      cell = key(point.x, point.y);
    if (mode === "collision") {
      const blocked = new Set(draft.blocked);
      if (paintValue) blocked.add(cell);
      else blocked.delete(cell);
      draft.blocked = [...blocked];
    } else if (mode === "erase") delete layer.cells[cell];
    else layer.cells[cell] = assetId;
  };
  const strokeStamp = (draft, point, mode, paintValue) => {
    const footprint =
      mode === "collision"
        ? { width: 1, height: 1 }
        : getAssetFootprint(draft.assets.find((asset) => asset.id === assetId));
    if (
      point.x < 0 ||
      point.y < 0 ||
      point.x + footprint.width > draft.grid.width ||
      point.y + footprint.height > draft.grid.height
    )
      return false;
    for (let x = point.x; x < point.x + footprint.width; x++)
      for (let y = point.y; y < point.y + footprint.height; y++)
        strokeCell(draft, { x, y }, mode, paintValue);
    return true;
  };
  const showRegion = (value) => {
    dragRegionRef.current = value;
    setDragRegion(value);
  };
  const pointerDown = (event) => {
    if (busy || failed.current || dialog) return;
    const pointer = stageRef.current.getPointerPosition();
    if (event.evt.button === 1 || tool === "pan") {
      event.evt.preventDefault();
      gesture.current = { mode: "pan", pointer, view: { ...viewRef.current } };
      return;
    }
    if (event.evt.button !== undefined && event.evt.button !== 0) return;
    const point = pointerCell(),
      map = projectRef.current;
    if (!point || !inside(map, point.x, point.y)) return;
    if (tool === "walk") {
      walkTo(point);
      return;
    }
    if (tool === "select") {
      setSelection(null);
      return;
    }
    if (tool === "region") {
      gesture.current = { mode: "region", start: point };
      showRegion({ ...point, width: 1, height: 1 });
      return;
    }
    const layer = map.layers.find((item) => item.id === activeLayer);
    if (!layer || layer.locked) {
      setNotice("lockedLayer");
      return;
    }
    if (tool === "object") {
      placeObject(assetId, point);
      return;
    }
    if (["spawn", "exit", "trigger"].includes(tool)) {
      edit((next) => {
        if (tool === "spawn")
          next.markers = next.markers.filter(
            (marker) => marker.type !== "spawn",
          );
        next.markers.push({
          id: makeId("marker"),
          type: tool,
          x: point.x,
          y: point.y,
          name: t(tool),
        });
      });
      if (tool === "spawn") setPlayer(point);
      return;
    }
    if (
      ["brush", "rectangle", "fill"].includes(tool) &&
      !map.assets.some((asset) => asset.id === assetId && asset.kind === "tile")
    ) {
      setNotice("noTiles");
      return;
    }
    if (tool === "rectangle") {
      gesture.current = { mode: "rectangle", start: point, before: copy(map) };
      showRegion({ ...point, width: 1, height: 1 });
      return;
    }
    if (tool === "fill") {
      const old = layer.cells[key(point.x, point.y)];
      if (old === assetId) return;
      edit((next) => {
        const target = next.layers.find((item) => item.id === activeLayer),
          queue = [point],
          seen = new Set();
        for (let cursor = 0; cursor < queue.length; cursor++) {
          const item = queue[cursor],
            cell = key(item.x, item.y);
          if (
            !inside(next, item.x, item.y) ||
            seen.has(cell) ||
            target.cells[cell] !== old
          )
            continue;
          seen.add(cell);
          target.cells[cell] = assetId;
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ])
            queue.push({ x: item.x + dx, y: item.y + dy });
        }
      });
      return;
    }
    if (["brush", "erase", "collision"].includes(tool)) {
      const before = copy(map),
        draft = copy(map),
        paintValue = !map.blocked.includes(key(point.x, point.y));
      if (!strokeStamp(draft, point, tool, paintValue)) {
        setNotice("invalidPlacement");
        return;
      }
      localVersion.current++;
      gesture.current = { mode: tool, before, draft, last: point, paintValue };
      setDocument(draft);
    }
  };
  const pointerMove = () => {
    const current = gesture.current;
    if (!current) return;
    if (current.mode === "pan") {
      const p = stageRef.current.getPointerPosition(),
        next = {
          ...current.view,
          x: current.view.x + p.x - current.pointer.x,
          y: current.view.y + p.y - current.pointer.y,
        };
      viewRef.current = next;
      setView(next);
      return;
    }
    const point = pointerCell();
    if (!point || !inside(projectRef.current, point.x, point.y)) return;
    if (["rectangle", "region"].includes(current.mode)) {
      showRegion({
        x: Math.min(point.x, current.start.x),
        y: Math.min(point.y, current.start.y),
        width: Math.abs(point.x - current.start.x) + 1,
        height: Math.abs(point.y - current.start.y) + 1,
      });
      return;
    }
    const steps = Math.max(
      1,
      Math.abs(point.x - current.last.x),
      Math.abs(point.y - current.last.y),
    );
    for (let step = 1; step <= steps; step++)
      strokeStamp(
        current.draft,
        {
          x: Math.round(
            current.last.x + ((point.x - current.last.x) * step) / steps,
          ),
          y: Math.round(
            current.last.y + ((point.y - current.last.y) * step) / steps,
          ),
        },
        current.mode,
        current.paintValue,
      );
    current.last = point;
    setDocument(copy(current.draft));
  };
  const pointerUp = () => {
    const current = gesture.current,
      region = dragRegionRef.current;
    if (!current) return;
    gesture.current = null;
    if (current.mode === "region" && region) {
      setSelection({ type: "region", layerId: activeLayer, ...region });
      setRightTab("reviews");
      setProtections([]);
    } else if (current.mode === "rectangle" && region) {
      const draft = copy(current.before);
      for (let x = region.x; x < region.x + region.width; x++)
        for (let y = region.y; y < region.y + region.height; y++)
          strokeCell(draft, { x, y }, "brush");
      commit(draft, current.before);
    } else if (current.draft) commit(current.draft, current.before);
    showRegion(null);
  };
  useEffect(() => {
    if (!active) return;
    const onKey = (event) => {
      if (
        dialog ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) ||
        event.target.isContentEditable
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
      if (tool === "walk" && !busy && projectRef.current) {
        const delta = {
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
        }[event.key];
        if (delta && player) {
          event.preventDefault();
          clearInterval(walkTimer.current);
          const next = { x: player.x + delta[0], y: player.y + delta[1] };
          if (isWalkable(projectRef.current, next.x, next.y)) setPlayer(next);
          else setNotice("noPath");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, busy, dialog, tool, player, undo, redo]);
  const openDialog = (kind) => {
    readEpoch.current++;
    setDialog(kind);
    if (kind === "new") {
      setNewName(t("newMap"));
      setNewWidth(16);
      setNewHeight(16);
    }
    setDialogError("");
    setJsonText("");
    setImported(null);
    setPatch(null);
    setPatchPreview(null);
    setChosenChanges([]);
    setAssetFile(null);
    setAssetName("");
    setUseAtlas(false);
    setImportFootprint({ width: 1, height: 1 });
  };
  const closeDialog = useCallback(() => {
    readEpoch.current++;
    setDialog(null);
  }, []);
  const dialogAction = async (action) => {
    if (busy) return;
    setBusy(true);
    setDialogError("");
    try {
      await flush();
      await action();
    } catch (failure) {
      setDialogError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  const screenshot = (review) => {
    const map = projectRef.current;
    let bounds;
    if (review.target.type === "object")
      bounds = objectBounds(
        map.objects.find((item) => item.id === review.target.objectId),
        map.grid,
        40,
      );
    else {
      bounds = regionBounds(review.target, map.grid, 48);
      bounds.y -= 100;
      bounds.height += 100;
    }
    const scale = Math.min(1, 1400 / bounds.width, 1000 / bounds.height),
      element = document.createElement("div"),
      temporary = new Konva.Stage({
        container: element,
        width: Math.ceil(bounds.width * scale),
        height: Math.ceil(bounds.height * scale),
      }),
      layer = new Konva.Layer();
    try {
      temporary.add(layer);
      layer.add(
        new Konva.Rect({
          width: temporary.width(),
          height: temporary.height(),
          fill: "#203326",
        }),
      );
      const content = sceneRef.current.clone({
        x: -bounds.x * scale,
        y: -bounds.y * scale,
        scaleX: scale,
        scaleY: scale,
        listening: false,
      });
      content.find(".selection-outline").forEach((node) => node.destroy());
      layer.add(content);
      layer.draw();
      return temporary.toDataURL({ pixelRatio: 1 });
    } finally {
      temporary.destroy();
    }
  };
  const exportFeedback = () =>
    perform(async () => {
      const map = projectRef.current,
        pending = map.reviews.filter((review) => review.status === "pending");
      if (!pending.length) {
        setNotice("noPending");
        return;
      }
      const screenshots = Object.fromEntries(
        pending.map((review) => [review.id, screenshot(review)]),
      );
      const result = await request("/api/map/feedback", {
        baseRevision: map.revision,
        screenshots,
      });
      archive(result);
      setNotice("feedbackReady");
    });
  const addReview = (event) => {
    event.preventDefault();
    if (!selection || !reviewTarget.trim() || !expected.trim()) return;
    const review = {
      id: makeId("map-review"),
      target: copy(selection),
      targetText: reviewTarget.trim(),
      expected: expected.trim(),
      protectedProperties: protections,
      priority,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    if (edit((next) => next.reviews.push(review))) {
      setReviewTarget("");
      setExpected("");
      setProtections([]);
    }
  };
  const exportMap = () => {
    if (failed.current) {
      download(projectRef.current.id + ".unsaved.map.json", projectRef.current);
      return;
    }
    perform(async () => {
      const saved = await flush();
      download(saved.id + ".map.json", saved);
    });
  };
  const duplicateObject = () => {
    if (!selectedObject || lockedSelection) return;
    const next = copy(selectedObject);
    next.id = makeId("object");
    next.name += " " + t("copy");
    next.x = Math.min(project.grid.width - next.footprint.width, next.x + 1);
    next.y = Math.min(project.grid.height - next.footprint.height, next.y + 1);
    if (edit((draft) => draft.objects.push(next)))
      setSelection({ type: "object", objectId: next.id });
  };
  const deleteObject = () => {
    if (!selectedObject || lockedSelection) return;
    if (
      project.reviews.some(
        (review) =>
          review.target.type === "object" &&
          review.target.objectId === selectedObject.id,
      )
    ) {
      setNotice("deleteReviewed");
      return;
    }
    if (
      edit((next) => {
        next.objects = next.objects.filter(
          (object) => object.id !== selectedObject.id,
        );
      })
    )
      setSelection(null);
  };
  const preparePatch = async (incoming) => {
    const result = await request("/api/map/patch/preview", { patch: incoming });
    setPatch(incoming);
    setPatchPreview(result);
    setChosenChanges(incoming.changes.map((_, index) => index));
    setPreviewAfter(true);
  };
  const importAsset = async () => {
    if (!assetFile) return;
    if (assetFile.size > 15 * 1024 * 1024)
      throw new Error("Asset must not exceed 15 MB.");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(assetFile);
    });
    const image = await new Promise((resolve, reject) => {
      const value = new Image();
      value.onload = () => resolve(value);
      value.onerror = () =>
        reject(new Error("The image could not be decoded."));
      value.src = dataUrl;
    });
    if (
      useAtlas &&
      (atlas.x + atlas.width > image.width ||
        atlas.y + atlas.height > image.height)
    )
      throw new Error("Atlas crop is outside the image bounds.");
    const asset = await request("/api/assets", {
      name: assetName.trim() || assetFile.name,
      kind: "texture",
      dataUrl,
    });
    const sourceWidth = useAtlas ? atlas.width : image.width,
      sourceHeight = useAtlas ? atlas.height : image.height;
    const displayScale = Math.min(1, 512 / sourceWidth, 512 / sourceHeight);
    const map = projectRef.current,
      next = copy(map),
      entry = {
        id: asset.id,
        name: asset.name,
        src: asset.src,
        kind: assetKind,
        footprint: copy(importFootprint),
        width:
          assetKind === "tile"
            ? map.grid.tileWidth
            : Math.max(1, sourceWidth * displayScale),
        height:
          assetKind === "tile"
            ? map.grid.tileHeight
            : Math.max(1, sourceHeight * displayScale),
        ...(useAtlas ? { atlas } : {}),
      };
    next.assets.push(entry);
    validateMap(next);
    const saved = await request(
      "/api/map",
      { project: next, baseRevision: map.revision },
      "PUT",
    );
    serverRevision.current = saved.revision;
    localVersion.current++;
    setDocument(saved);
    setUndo([...undoRef.current, copy(map)]);
    setRedo([]);
    setAssetId(entry.id);
    setPalette(assetKind === "tile" ? "terrain" : "objects");
    setTool(assetKind === "tile" ? "brush" : "object");
    setDialog(null);
  };
  let selectedPreview = project,
    selectionError = null;
  if (patchPreview && chosenChanges.length) {
    try {
      selectedPreview = previewMapPatch(project, patch, {
        selectedIndices: chosenChanges,
      }).project;
    } catch (failure) {
      selectionError = failure.message;
    }
  }
  const previewProject = previewAfter ? selectedPreview : project;
  const previewBounds = previewProject
    ? regionBounds(
        {
          x: 0,
          y: 0,
          width: previewProject.grid.width,
          height: previewProject.grid.height,
        },
        previewProject.grid,
        50,
      )
    : null;
  const previewScale = previewBounds
    ? Math.min(600 / previewBounds.width, 230 / (previewBounds.height + 140))
    : 1;
  const diffField = (value) =>
    t(
      value === "assetId"
        ? "asset"
        : value === "footprint.width"
          ? "footprintWidth"
          : value === "footprint.height"
            ? "footprintHeight"
            : value,
    );
  const diffValue = (value) =>
    value === null
      ? t("protectedNone")
      : typeof value === "boolean"
        ? t(value ? "yes" : "no")
        : String(value);
  const errorDetails = (value) => (
    <div className="map-error" role="alert">
      {localError(value)}
      <details>
        <summary>{t("details")}</summary>
        {value}
      </details>
    </div>
  );
  if (!project)
    return (
      <div className="map-workspace">
        <div className="map-stage-loading">
          {error ? (
            <div>
              {t("error")}
              <details>
                <summary>{t("details")}</summary>
                {error.message}
              </details>
              <button onClick={() => refresh().catch(reportError)}>
                {t("reload")}
              </button>
            </div>
          ) : (
            t("loading")
          )}
        </div>
      </div>
    );
  const region =
    dragRegion || (selection?.type === "region" ? selection : null);
  const placementGhost = dropGhost || objectGhost;
  const visibleAssets = project.assets.filter(
    (asset) => asset.kind === (palette === "terrain" ? "tile" : "object"),
  );
  const protectionChoices =
    selection?.type === "object"
      ? ["x", "y", "width", "height", "assetId", "blocking", "footprint"]
      : ["cells", "blocked"];
  return (
    <div className="map-workspace" data-testid="map-workspace">
      <div className="map-topbar">
        <div className="map-heading">
          <strong>{t("title")}</strong>
          <input
            className="map-title-input"
            aria-label={t("name")}
            value={project.name}
            disabled={busy || failed.current}
            onChange={(event) => {
              const name = event.target.value;
              if (name.trim())
                edit((next) => {
                  next.name = name;
                });
            }}
          />
          <small>{t("subtitle")}</small>
        </div>
        <div className="map-top-actions">
          <button
            data-testid="map-new"
            onClick={() => openDialog("new")}
            disabled={busy}
          >
            {t("newMap")}
          </button>
          <button
            data-testid="map-import"
            onClick={() => openDialog("import")}
            disabled={busy}
          >
            {t("import")}
          </button>
          <button data-testid="map-export" onClick={exportMap} disabled={busy}>
            {t(failed.current ? "exportUnsaved" : "export")}
          </button>
          <button
            data-testid="map-feedback"
            onClick={exportFeedback}
            disabled={
              busy ||
              !project.assets.every((asset) => images[asset.src]) ||
              !project.reviews.some((review) => review.status === "pending")
            }
          >
            {t("feedback")}
          </button>
          <button
            data-testid="map-patch"
            onClick={() => openDialog("patch")}
            disabled={busy}
          >
            {t("patch")}
          </button>
          <button
            className="primary"
            data-testid="map-godot"
            disabled={busy}
            onClick={() =>
              perform(async () => {
                archive(
                  await request("/api/map/godot", {
                    baseRevision: projectRef.current.revision,
                  }),
                );
                setNotice("downloadable");
              })
            }
          >
            {t("godot")}
          </button>
        </div>
      </div>
      {(error || notice) && (
        <div className="map-banner" role={error ? "alert" : "status"}>
          <span>
            {error
              ? failed.current
                ? t("saveFailed")
                : localError(error.message)
              : t(notice)}
          </span>
          {error && (
            <details>
              <summary>{t("details")}</summary>
              <pre>{error.message}</pre>
            </details>
          )}
          {failed.current && (
            <button onClick={() => refresh().catch(reportError)}>
              {t("reload")}
            </button>
          )}
          <button
            aria-label={t("close")}
            onClick={() => {
              setError(null);
              setNotice(null);
            }}
          >
            ×
          </button>
        </div>
      )}
      {images.__errors?.length > 0 && (
        <div className="map-banner" role="alert">
          {t("missingAssets")}
          <details>
            <summary>{t("details")}</summary>
            {images.__errors.join(", ")}
          </details>
        </div>
      )}
      <div className="map-main">
        <aside className="map-sidebar">
          <section>
            <h3>{t("layers")}</h3>
            <p className="map-muted">{t("layerOrder")}</p>
            {project.layers.map((layer, layerIndex) => (
              <div className="map-layer" key={layer.id}>
                <button
                  className={
                    "map-layer-name " +
                    (activeLayer === layer.id ? "active" : "")
                  }
                  data-testid={"map-layer-" + layer.id}
                  onClick={() => setActiveLayer(layer.id)}
                >
                  {layer.name}
                </button>
                <button
                  data-testid={"map-layer-visible-" + layer.id}
                  aria-label={t("visible") + ": " + layer.name}
                  title={t("visible")}
                  onClick={() =>
                    edit((next) => {
                      next.layers.find((item) => item.id === layer.id).visible =
                        !layer.visible;
                    })
                  }
                >
                  {layer.visible ? "◉" : "○"}
                </button>
                <button
                  data-testid={"map-layer-lock-" + layer.id}
                  aria-label={t("locked") + ": " + layer.name}
                  title={t("locked")}
                  onClick={() =>
                    edit((next) => {
                      next.layers.find((item) => item.id === layer.id).locked =
                        !layer.locked;
                    })
                  }
                >
                  {layer.locked ? "▣" : "□"}
                </button>
                <button
                  data-testid={"map-layer-back-" + layer.id}
                  aria-label={t("layerBack") + ": " + layer.name}
                  title={t("layerBack")}
                  disabled={
                    busy ||
                    layer.locked ||
                    layerIndex === 0 ||
                    project.layers[layerIndex - 1]?.locked
                  }
                  onClick={() => reorderLayer(layer.id, -1)}
                >
                  ↑
                </button>
                <button
                  data-testid={"map-layer-front-" + layer.id}
                  aria-label={t("layerFront") + ": " + layer.name}
                  title={t("layerFront")}
                  disabled={
                    busy ||
                    layer.locked ||
                    layerIndex === project.layers.length - 1 ||
                    project.layers[layerIndex + 1]?.locked
                  }
                  onClick={() => reorderLayer(layer.id, 1)}
                >
                  ↓
                </button>
              </div>
            ))}
            <button
              style={{ marginTop: 6, width: "100%" }}
              onClick={() => {
                const id = makeId("layer");
                if (
                  edit((next) => {
                    next.actorLayerId = getActorLayerId(next);
                    next.layers.push({
                      id,
                      name: t("newLayer") + " " + (next.layers.length + 1),
                      visible: true,
                      locked: false,
                      cells: {},
                    });
                  })
                )
                  setActiveLayer(id);
              }}
            >
              {t("addLayer")}
            </button>
            <label className="map-actor-layer">
              {t("actorLayer")}
              <select
                data-testid="map-actor-layer"
                value={getActorLayerId(project)}
                disabled={busy}
                onChange={(event) =>
                  edit((next) => {
                    next.actorLayerId = event.target.value;
                  })
                }
              >
                {project.layers.map((layer) => (
                  <option key={layer.id} value={layer.id}>
                    {layer.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="map-muted">{t("layerDepthHelp")}</p>
          </section>
          <section>
            <div className="map-tabs">
              <button
                data-testid="map-palette-terrain"
                className={palette === "terrain" ? "active" : ""}
                onClick={() => {
                  setPalette("terrain");
                  setAssetId(
                    project.assets.find((asset) => asset.kind === "tile")?.id,
                  );
                }}
              >
                {t("terrain")}
              </button>
              <button
                data-testid="map-palette-objects"
                className={palette === "objects" ? "active" : ""}
                onClick={() => {
                  setPalette("objects");
                  setAssetId(
                    project.assets.find((asset) => asset.kind === "object")?.id,
                  );
                }}
              >
                {t("objects")}
              </button>
            </div>
            <div className="map-palette">
              {visibleAssets.map((asset) => (
                <button
                  key={asset.id}
                  draggable
                  onDragStart={(event) => {
                    draggingAsset.current = asset.id;
                    setAssetId(asset.id);
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(
                      "application/x-studio-map-asset",
                      asset.id,
                    );
                  }}
                  onDragEnd={() => {
                    draggingAsset.current = null;
                    setDropGhost(null);
                  }}
                  className={assetId === asset.id ? "active" : ""}
                  data-testid={"map-asset-" + asset.id}
                  onClick={() => {
                    setAssetId(asset.id);
                    setTool(asset.kind === "tile" ? "brush" : "object");
                  }}
                  title={asset.name}
                >
                  <img src={asset.src} alt="" draggable={false} />
                  <span>{asset.name}</span>
                  <small className="map-asset-footprint">
                    {getAssetFootprint(asset).width} ×{" "}
                    {getAssetFootprint(asset).height} {t("cellsUnit")}
                  </small>
                </button>
              ))}
            </div>
            {activeAsset && (
              <div className="map-asset-settings">
                <h3>
                  {t(
                    activeAsset.kind === "tile"
                      ? "stampFootprint"
                      : "defaultFootprint",
                  )}
                </h3>
                <div className="map-two">
                  <NumberField
                    testId="map-asset-footprint-width"
                    label={t("cellWidth")}
                    value={getAssetFootprint(activeAsset).width}
                    integer
                    min={1}
                    max={128}
                    disabled={busy}
                    onChange={(value) => updateAssetFootprint("width", value)}
                  />
                  <NumberField
                    testId="map-asset-footprint-height"
                    label={t("cellHeight")}
                    value={getAssetFootprint(activeAsset).height}
                    integer
                    min={1}
                    max={128}
                    disabled={busy}
                    onChange={(value) => updateAssetFootprint("height", value)}
                  />
                </div>
                <p className="map-muted">
                  {t(
                    activeAsset.kind === "tile"
                      ? "tileStampHelp"
                      : "footprintHelp",
                  )}
                </p>
                <p className="map-muted">{t("dragPaletteHelp")}</p>
              </div>
            )}
            <button
              className="map-asset-button"
              data-testid="map-asset-import"
              onClick={() => {
                setAssetKind(palette === "terrain" ? "tile" : "object");
                openDialog("asset");
              }}
            >
              {t("assetImport")}
            </button>
          </section>
          <section>
            <h3>
              {t("objects")} · {project.objects.length}
            </h3>
            <div className="map-object-list">
              {project.objects.map((object) => (
                <button
                  key={object.id}
                  className={selectedObject?.id === object.id ? "active" : ""}
                  data-testid={"map-object-list-" + object.id}
                  onClick={() => {
                    setSelection({ type: "object", objectId: object.id });
                    setActiveLayer(object.layerId);
                    setTool("select");
                    setRightTab("properties");
                    setProtections([]);
                  }}
                >
                  {object.name}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h3>{t("marker")}</h3>
            {project.markers.map((marker) => (
              <div
                className="map-row"
                key={marker.id}
                style={{ marginBottom: 5 }}
              >
                <span className="map-muted" style={{ flex: 1 }}>
                  {t(marker.type)} ({marker.x}, {marker.y})
                </span>
                <button
                  aria-label={t("remove") + ": " + marker.name}
                  onClick={() =>
                    edit((next) => {
                      next.markers = next.markers.filter(
                        (item) => item.id !== marker.id,
                      );
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </section>
        </aside>
        <section className="map-canvas-section">
          <div className="map-tools">
            {toolNames.map((item) => (
              <button
                key={item}
                data-testid={"map-tool-" + item}
                title={t(item)}
                className={tool === item ? "active" : ""}
                onClick={() => {
                  setTool(item);
                  if (item === "collision") setShowCollisions(true);
                }}
              >
                {symbols[item]} {t(item)}
              </button>
            ))}
            <button
              data-testid="map-undo"
              disabled={!undoStack.length || busy || failed.current}
              onClick={undo}
              title={t("undo")}
            >
              ↶
            </button>
            <button
              data-testid="map-redo"
              disabled={!redoStack.length || busy || failed.current}
              onClick={redo}
              title={t("redo")}
            >
              ↷
            </button>
          </div>
          <div
            className="map-canvas"
            tabIndex={0}
            aria-label={t("title")}
            ref={canvasRef}
            data-testid="map-canvas"
            data-origin-x={view.x}
            data-origin-y={view.y}
            data-scale={view.scale}
            data-player-x={player?.x ?? ""}
            data-player-y={player?.y ?? ""}
            data-drop-x={placementGhost?.x ?? ""}
            data-drop-y={placementGhost?.y ?? ""}
            data-drop-width={placementGhost?.width ?? ""}
            data-drop-height={placementGhost?.height ?? ""}
            data-drop-valid={placementGhost ? String(placementGhost.valid) : ""}
            onDragOver={(event) => {
              event.preventDefault();
              if (busy || failed.current) return;
              const id =
                draggingAsset.current ||
                event.dataTransfer.getData("application/x-studio-map-asset");
              const ghost = ghostFor(id, pointerCell(event));
              setDropGhost(ghost);
              event.dataTransfer.dropEffect = ghost?.valid ? "copy" : "none";
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                setDropGhost(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const id =
                  event.dataTransfer.getData(
                    "application/x-studio-map-asset",
                  ) || draggingAsset.current,
                point = pointerCell(event);
              draggingAsset.current = null;
              setDropGhost(null);
              if (
                busy ||
                failed.current ||
                !point ||
                !projectRef.current.assets.some((asset) => asset.id === id)
              )
                return;
              placeAsset(id, point);
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <Stage
              width={viewport.width}
              height={viewport.height}
              ref={stageRef}
              onMouseDown={pointerDown}
              onMouseMove={pointerMove}
              onMouseUp={pointerUp}
              onMouseLeave={pointerUp}
              onTouchStart={pointerDown}
              onTouchMove={pointerMove}
              onTouchEnd={pointerUp}
              onWheel={(event) => {
                event.evt.preventDefault();
                zoom(
                  event.evt.deltaY < 0 ? 1.1 : 1 / 1.1,
                  stageRef.current.getPointerPosition(),
                );
              }}
            >
              <Layer>
                <Group
                  x={view.x}
                  y={view.y}
                  scaleX={view.scale}
                  scaleY={view.scale}
                >
                  <MapScene
                    project={project}
                    images={images}
                    sceneRef={sceneRef}
                    selectedId={selectedObject?.id}
                    editable={tool === "select" && !busy && !failed.current}
                    onSelect={(id) => {
                      setSelection({ type: "object", objectId: id });
                      setRightTab("properties");
                      setProtections([]);
                      setActiveLayer(
                        project.objects.find((object) => object.id === id)
                          ?.layerId || activeLayer,
                      );
                    }}
                    onDragPreview={(id, x, y) => {
                      const object = projectRef.current.objects.find(
                        (item) => item.id === id,
                      );
                      setObjectGhost(
                        object ? ghostFor(object.assetId, { x, y }, id) : null,
                      );
                    }}
                    onDrag={(id, x, y) => {
                      updateObject(id, { x, y });
                    }}
                    player={tool === "walk" ? player : null}
                  />
                  {showGrid && (
                    <Group listening={false}>
                      {Array.from(
                        { length: project.grid.width * project.grid.height },
                        (_, index) => {
                          const x = index % project.grid.width,
                            y = Math.floor(index / project.grid.width);
                          return (
                            <Line
                              key={index}
                              points={diamond(x, y, project.grid)}
                              closed
                              stroke="#c1d7a920"
                              strokeWidth={0.7}
                            />
                          );
                        },
                      )}
                    </Group>
                  )}
                  {showCollisions && (
                    <Group listening={false}>
                      {Array.from(
                        { length: project.grid.width * project.grid.height },
                        (_, index) => {
                          const x = index % project.grid.width,
                            y = Math.floor(index / project.grid.width);
                          return (
                            !isWalkable(project, x, y) && (
                              <Line
                                key={index}
                                points={diamond(x, y, project.grid)}
                                closed
                                fill="#c955454f"
                                stroke="#ee927a80"
                                strokeWidth={1}
                              />
                            )
                          );
                        },
                      )}
                    </Group>
                  )}
                  {selectedObject &&
                    !placementGhost &&
                    project.layers.find(
                      (layer) => layer.id === selectedObject.layerId,
                    )?.visible && (
                      <Group listening={false}>
                        {Array.from(
                          {
                            length:
                              selectedObject.footprint.width *
                              selectedObject.footprint.height,
                          },
                          (_, index) => (
                            <Line
                              key={index}
                              points={diamond(
                                selectedObject.x +
                                  (index % selectedObject.footprint.width),
                                selectedObject.y +
                                  Math.floor(
                                    index / selectedObject.footprint.width,
                                  ),
                                project.grid,
                              )}
                              closed
                              fill="#f4dc8933"
                              stroke="#ebd68bb0"
                              strokeWidth={1.5}
                            />
                          ),
                        )}
                      </Group>
                    )}
                  {placementGhost && (
                    <Group listening={false}>
                      {Array.from(
                        {
                          length: placementGhost.width * placementGhost.height,
                        },
                        (_, index) => (
                          <Line
                            key={index}
                            points={diamond(
                              placementGhost.x + (index % placementGhost.width),
                              placementGhost.y +
                                Math.floor(index / placementGhost.width),
                              project.grid,
                            )}
                            closed
                            fill={
                              placementGhost.valid ? "#8de8a34d" : "#ef725466"
                            }
                            stroke={
                              placementGhost.valid ? "#b9e9a2" : "#f3a080"
                            }
                            strokeWidth={2}
                          />
                        ),
                      )}
                    </Group>
                  )}
                  {region && (
                    <Group listening={false}>
                      {Array.from(
                        { length: region.width * region.height },
                        (_, index) => (
                          <Line
                            key={index}
                            points={diamond(
                              region.x + (index % region.width),
                              region.y + Math.floor(index / region.width),
                              project.grid,
                            )}
                            closed
                            stroke="#e9ce7c"
                            strokeWidth={1.4}
                            fill="#ebd68b33"
                          />
                        ),
                      )}
                    </Group>
                  )}
                </Group>
              </Layer>
            </Stage>
            <div className="map-view-controls">
              <button onClick={() => zoom(1 / 1.2)} aria-label="−">
                −
              </button>
              <span>{Math.round(view.scale * 100)}%</span>
              <button onClick={() => zoom(1.2)} aria-label="+">
                +
              </button>
              <button data-testid="map-fit" onClick={() => fit()}>
                {t("fit")}
              </button>
              <button
                className={showGrid ? "active" : ""}
                onClick={() => setShowGrid(!showGrid)}
              >
                {t("grid")}
              </button>
              <button
                className={showCollisions ? "active" : ""}
                onClick={() => setShowCollisions(!showCollisions)}
              >
                {t("collisions")}
              </button>
            </div>
          </div>
        </section>
        <aside className="map-sidebar right">
          <div className="map-tabs">
            {["properties", "reviews", "changes"].map((tab) => (
              <button
                data-testid={"map-tab-" + tab}
                key={tab}
                className={rightTab === tab ? "active" : ""}
                onClick={() => setRightTab(tab)}
              >
                {t(tab)}
              </button>
            ))}
          </div>
          {rightTab === "properties" &&
            (selectedObject ? (
              <section>
                <div className="map-selection">
                  <strong>{selectedObject.name}</strong>
                  <div className="map-target-id">{selectedObject.id}</div>
                  {lockedSelection && <p>{t("layerLocked")}</p>}
                </div>
                <label>
                  {t("name")}
                  <input
                    value={selectedObject.name}
                    disabled={lockedSelection || busy}
                    onChange={(event) => {
                      if (event.target.value.trim())
                        updateObject(selectedObject.id, {
                          name: event.target.value,
                        });
                    }}
                  />
                </label>
                <label>
                  {t("layer")}
                  <select
                    data-testid="map-object-layer"
                    value={selectedObject.layerId}
                    disabled={busy || lockedSelection}
                    onChange={(event) => {
                      if (
                        updateObject(selectedObject.id, {
                          layerId: event.target.value,
                        })
                      )
                        setActiveLayer(event.target.value);
                    }}
                  >
                    {project.layers.map((layer) => (
                      <option
                        key={layer.id}
                        value={layer.id}
                        disabled={layer.locked}
                      >
                        {layer.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="map-two">
                  {["x", "y", "width", "height", "anchorX", "anchorY"].map(
                    (field) => (
                      <NumberField
                        key={field}
                        testId={"map-object-" + field}
                        label={t(field)}
                        value={selectedObject[field]}
                        min={["width", "height"].includes(field) ? 1 : 0}
                        max={
                          field === "x"
                            ? project.grid.width -
                              selectedObject.footprint.width
                            : field === "y"
                              ? project.grid.height -
                                selectedObject.footprint.height
                              : field.startsWith("anchor")
                                ? 1
                                : 2048
                        }
                        step={field.startsWith("anchor") ? 0.05 : 1}
                        integer={["x", "y"].includes(field)}
                        disabled={lockedSelection || busy}
                        onChange={(value) =>
                          updateObject(selectedObject.id, { [field]: value })
                        }
                      />
                    ),
                  )}
                </div>
                <div className="map-two">
                  <NumberField
                    label={t("footprintWidth")}
                    value={selectedObject.footprint.width}
                    min={1}
                    max={project.grid.width - selectedObject.x}
                    disabled={lockedSelection || busy}
                    testId="map-object-footprint-width"
                    integer
                    onChange={(value) =>
                      updateObject(selectedObject.id, {
                        footprint: {
                          ...selectedObject.footprint,
                          width: value,
                        },
                      })
                    }
                  />
                  <NumberField
                    label={t("footprintHeight")}
                    value={selectedObject.footprint.height}
                    min={1}
                    max={project.grid.height - selectedObject.y}
                    disabled={lockedSelection || busy}
                    testId="map-object-footprint-height"
                    integer
                    onChange={(value) =>
                      updateObject(selectedObject.id, {
                        footprint: {
                          ...selectedObject.footprint,
                          height: value,
                        },
                      })
                    }
                  />
                </div>
                <p className="map-muted">{t("instanceFootprintHelp")}</p>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={selectedObject.blocking}
                    disabled={lockedSelection || busy}
                    onChange={(event) =>
                      updateObject(selectedObject.id, {
                        blocking: event.target.checked,
                      })
                    }
                  />
                  {t("blocking")}
                </label>
                <div className="map-row">
                  <button
                    onClick={duplicateObject}
                    disabled={lockedSelection || busy}
                    data-testid="map-object-duplicate"
                  >
                    {t("duplicate")}
                  </button>
                  <button
                    onClick={deleteObject}
                    disabled={lockedSelection || busy}
                    data-testid="map-object-delete"
                  >
                    {t("remove")}
                  </button>
                  <button
                    className="primary"
                    onClick={() => setRightTab("reviews")}
                  >
                    {t("addReview")}
                  </button>
                </div>
              </section>
            ) : (
              <p className="map-empty">{t("noSelection")}</p>
            ))}
          {rightTab === "reviews" && (
            <section>
              <p className="map-muted">{t("reviewHint")}</p>
              {selection ? (
                <form onSubmit={addReview}>
                  <div className="map-selection">
                    {selection.type === "object"
                      ? selectedObject?.name
                      : t("selectedRegion") +
                        " (" +
                        selection.x +
                        ", " +
                        selection.y +
                        ") " +
                        selection.width +
                        " × " +
                        selection.height}
                    <div className="map-target-id">
                      {selection.objectId || selection.layerId}
                    </div>
                  </div>
                  <label>
                    {t("reviewTarget")}
                    <input
                      data-testid="map-review-target"
                      value={reviewTarget}
                      maxLength={2000}
                      required
                      onChange={(event) => setReviewTarget(event.target.value)}
                    />
                  </label>
                  <label>
                    {t("expected")}
                    <textarea
                      data-testid="map-review-expected"
                      value={expected}
                      maxLength={4000}
                      required
                      onChange={(event) => setExpected(event.target.value)}
                    />
                  </label>
                  <div className="map-muted">{t("protected")}</div>
                  <div className="map-protected">
                    {protectionChoices.map((field) => (
                      <label className="check" key={field}>
                        <input
                          data-testid={"map-protect-" + field}
                          type="checkbox"
                          checked={protections.includes(field)}
                          onChange={(event) =>
                            setProtections(
                              event.target.checked
                                ? [...protections, field]
                                : protections.filter((item) => item !== field),
                            )
                          }
                        />
                        {t(
                          field === "assetId"
                            ? "asset"
                            : field === "footprint"
                              ? "footprint"
                              : field,
                        )}
                      </label>
                    ))}
                  </div>
                  <label>
                    {t("priority")}
                    <select
                      data-testid="map-review-priority"
                      value={priority}
                      onChange={(event) => setPriority(event.target.value)}
                    >
                      {priorities.map((value) => (
                        <option key={value} value={value}>
                          {t(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="primary"
                    data-testid="map-review-add"
                    disabled={busy || failed.current}
                  >
                    {t("addReview")}
                  </button>
                </form>
              ) : (
                <p className="map-empty">{t("noSelection")}</p>
              )}
              <div className="map-review-list">
                {!project.reviews.length && (
                  <p className="map-empty">{t("noReviews")}</p>
                )}
                {project.reviews.map((review) => (
                  <article
                    className="map-review-card"
                    data-testid={"map-review-" + review.id}
                    key={review.id}
                  >
                    <button
                      onClick={() => {
                        setSelection(copy(review.target));
                        setProtections([]);
                        if (review.target.layerId)
                          setActiveLayer(review.target.layerId);
                      }}
                    >
                      {review.target.type === "object"
                        ? project.objects.find(
                            (object) => object.id === review.target.objectId,
                          )?.name || review.target.objectId
                        : t("selectedRegion") +
                          " (" +
                          review.target.x +
                          ", " +
                          review.target.y +
                          ")"}
                    </button>
                    <strong>{review.targetText}</strong>
                    <p>{review.expected}</p>
                    <code>
                      {t("protected")}:{" "}
                      {review.protectedProperties
                        .map((field) =>
                          t(field === "assetId" ? "asset" : field),
                        )
                        .join(", ") || t("protectedNone")}
                    </code>
                    <span className="map-muted">{t(review.priority)}</span>
                    <select
                      aria-label={t("reviews") + ": " + review.targetText}
                      value={review.status}
                      disabled={busy}
                      onChange={(event) =>
                        edit((next) => {
                          next.reviews.find(
                            (item) => item.id === review.id,
                          ).status = event.target.value;
                        })
                      }
                    >
                      {statuses.map((status) => (
                        <option key={status} value={status}>
                          {t(status)}
                        </option>
                      ))}
                    </select>
                  </article>
                ))}
              </div>
            </section>
          )}
          {rightTab === "changes" && (
            <section>
              <button
                data-testid="map-import-patch-side"
                onClick={() => openDialog("patch")}
              >
                {t("patch")}
              </button>
              {!project.history.length && (
                <p className="map-empty">{t("noHistory")}</p>
              )}
              {[...project.history].reverse().map((history) => (
                <article className="map-history-card" key={history.id}>
                  <strong>{history.summary || history.id}</strong>
                  <code className="map-target-id">{history.id}</code>
                  <p className="map-muted">
                    {history.changes?.length || 0} {t("changesCount")}
                  </p>
                  <button
                    data-testid={"map-rollback-" + history.id}
                    disabled={
                      busy ||
                      history.rolledBack ||
                      history.type === "rollback" ||
                      history.kind === "rollback"
                    }
                    onClick={() =>
                      perform(async () => {
                        const next = await request("/api/map/rollback", {
                          historyId: history.id,
                        });
                        serverRevision.current = next.revision;
                        localVersion.current++;
                        setDocument(next);
                        setUndo([]);
                        setRedo([]);
                      })
                    }
                  >
                    {t("rollback")}
                  </button>
                </article>
              ))}
            </section>
          )}
        </aside>
      </div>
      <footer className="map-footer">
        <span>{tool === "walk" ? t("walkHint") : t("mapHint")}</span>
        <span data-testid="map-save-state">
          {failed.current ? t("saveFailed") : saving ? t("saving") : t("saved")}{" "}
          · {t("revision")} {project.revision} · {project.grid.width} ×{" "}
          {project.grid.height}
        </span>
      </footer>
      {dialog === "new" && (
        <Modal
          title={t("newMap")}
          close={closeDialog}
          busy={busy}
          testId="map-new-dialog"
        >
          <p>{t("newMapHelp")}</p>
          <label>
            {t("name")}
            <input
              data-testid="map-new-name"
              value={newName}
              maxLength={200}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <div className="map-two">
            <NumberField
              testId="map-new-width"
              label={t("gridWidth")}
              min={1}
              max={128}
              value={newWidth}
              onChange={setNewWidth}
            />
            <NumberField
              testId="map-new-height"
              label={t("gridHeight")}
              min={1}
              max={128}
              value={newHeight}
              onChange={setNewHeight}
            />
          </div>
          <p>{t("importNotice")}</p>
          {dialogError && errorDetails(dialogError)}
          <div className="map-dialog-actions">
            <button disabled={busy} onClick={closeDialog}>
              {t("cancel")}
            </button>
            <button
              className="primary"
              data-testid="map-new-confirm"
              disabled={busy || !newName.trim()}
              onClick={() =>
                dialogAction(async () => {
                  const current = projectRef.current;
                  const value = {
                    schemaVersion: 1,
                    kind: "studio-map",
                    id: makeId("map"),
                    name: newName.trim(),
                    revision: 1,
                    grid: {
                      ...current.grid,
                      width: newWidth,
                      height: newHeight,
                    },
                    assets: copy(current.assets),
                    layers: [
                      {
                        id: "ground",
                        name: t("terrain"),
                        visible: true,
                        locked: false,
                        cells: {},
                      },
                      {
                        id: "decoration",
                        name: t("objects"),
                        visible: true,
                        locked: false,
                        cells: {},
                      },
                    ],
                    objects: [],
                    blocked: [],
                    markers: [],
                    reviews: [],
                    history: [],
                  };
                  validateMap(value);
                  download(current.id + ".backup.map.json", current);
                  const next = await request("/api/map/import", {
                    project: value,
                    baseRevision: current.revision,
                  });
                  serverRevision.current = next.revision;
                  localVersion.current++;
                  setDocument(next);
                  setUndo([]);
                  setRedo([]);
                  setSelection(null);
                  setActiveLayer("ground");
                  setPlayer(null);
                  setDialog(null);
                  requestAnimationFrame(() => fit(next));
                })
              }
            >
              {t("createMap")}
            </button>
          </div>
        </Modal>
      )}
      {dialog === "import" && (
        <Modal
          title={t("importTitle")}
          close={closeDialog}
          busy={busy}
          testId="map-import-dialog"
        >
          <p>{t("importHelp")}</p>
          <FilePicker
            label={t("chooseFile")}
            emptyLabel={t("noFile")}
            data-testid="map-import-file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files[0];
              const epoch = ++readEpoch.current;
              setImported(null);
              setDialogError("");
              readJson(file)
                .then((value) => {
                  if (epoch !== readEpoch.current) return;
                  validateMap(value);
                  setImported(value);
                  setJsonText(JSON.stringify(value, null, 2));
                })
                .catch((failure) => {
                  if (epoch === readEpoch.current)
                    setDialogError(failure.message);
                });
            }}
          />
          <label>
            {t("paste")}
            <textarea
              data-testid="map-import-json"
              value={jsonText}
              onChange={(event) => {
                readEpoch.current++;
                setJsonText(event.target.value);
                setImported(null);
              }}
            />
          </label>
          <button
            disabled={busy}
            onClick={() => {
              readEpoch.current++;
              try {
                const value = JSON.parse(jsonText.replace(/^\uFEFF/, ""));
                validateMap(value);
                setImported(value);
                setDialogError("");
              } catch (failure) {
                setImported(null);
                setDialogError(failure.message);
              }
            }}
          >
            {t("validate")}
          </button>
          {imported && (
            <div className="map-import-summary">
              {t("valid")} · {imported.name}
              <p>
                {imported.grid.width} × {imported.grid.height} ·{" "}
                {imported.layers.length} {t("layers")} ·{" "}
                {imported.objects.length} {t("objects")}
              </p>
            </div>
          )}
          <p style={{ marginTop: 12 }}>{t("importNotice")}</p>
          {dialogError && errorDetails(dialogError)}
          <div className="map-dialog-actions">
            <button disabled={busy} onClick={closeDialog}>
              {t("cancel")}
            </button>
            <button
              className="primary"
              data-testid="map-import-confirm"
              disabled={!imported || busy}
              onClick={() =>
                dialogAction(async () => {
                  download(
                    projectRef.current.id + ".backup.map.json",
                    projectRef.current,
                  );
                  const next = await request("/api/map/import", {
                    project: imported,
                    baseRevision: projectRef.current.revision,
                  });
                  serverRevision.current = next.revision;
                  localVersion.current++;
                  setDocument(next);
                  setUndo([]);
                  setRedo([]);
                  setSelection(null);
                  setActiveLayer(next.layers[0]?.id);
                  setAssetId(
                    next.assets.find((asset) => asset.kind === "tile")?.id,
                  );
                  setPlayer(
                    next.markers.find((marker) => marker.type === "spawn") ||
                      null,
                  );
                  setDialog(null);
                  requestAnimationFrame(() => fit(next));
                })
              }
            >
              {t("replace")}
            </button>
          </div>
        </Modal>
      )}
      {dialog === "patch" && (
        <Modal
          title={t("patchTitle")}
          close={closeDialog}
          busy={busy}
          testId="map-patch-dialog"
        >
          <p>{t("patchHelp")}</p>
          <FilePicker
            label={t("chooseFile")}
            emptyLabel={t("noFile")}
            data-testid="map-patch-file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files[0];
              setPatch(null);
              setPatchPreview(null);
              dialogAction(async () => {
                const value = await readJson(file);
                setJsonText(JSON.stringify(value, null, 2));
                await preparePatch(value);
              });
            }}
          />
          {!patchPreview && (
            <>
              <textarea
                data-testid="map-patch-json"
                aria-label={t("patch")}
                value={jsonText}
                onChange={(event) => setJsonText(event.target.value)}
              />
              <button
                disabled={busy}
                onClick={() =>
                  dialogAction(() => preparePatch(JSON.parse(jsonText)))
                }
              >
                {t("preview")}
              </button>
            </>
          )}
          {patchPreview && (
            <>
              <strong>{patch.summary}</strong>
              <div className="map-row" style={{ margin: "10px 0" }}>
                <button
                  className={!previewAfter ? "active" : ""}
                  onClick={() => setPreviewAfter(false)}
                >
                  {t("before")}
                </button>
                <button
                  className={previewAfter ? "active" : ""}
                  onClick={() => setPreviewAfter(true)}
                >
                  {t("after")}
                </button>
              </div>
              <div
                style={{
                  background: "#14251b",
                  borderRadius: 5,
                  overflow: "hidden",
                }}
              >
                <Stage width={Math.min(640, viewport.width)} height={260}>
                  <Layer>
                    <Group
                      x={
                        Math.min(640, viewport.width) / 2 -
                        (previewBounds.x + previewBounds.width / 2) *
                          previewScale
                      }
                      y={140 * previewScale - previewBounds.y * previewScale}
                      scaleX={previewScale}
                      scaleY={previewScale}
                    >
                      <MapScene project={previewProject} images={images} />
                    </Group>
                  </Layer>
                </Stage>
              </div>
              {patch.changes.map((change, index) => (
                <div className="map-patch-change" key={index}>
                  <label className="check">
                    <input
                      type="checkbox"
                      data-testid={"map-patch-change-" + index}
                      checked={chosenChanges.includes(index)}
                      disabled={busy}
                      onChange={(event) =>
                        setChosenChanges(
                          event.target.checked
                            ? [...chosenChanges, index]
                            : chosenChanges.filter((item) => item !== index),
                        )
                      }
                    />
                    {change.type === "object"
                      ? change.objectId
                      : t(change.type === "blocked" ? "blocked" : "cells") +
                        " (" +
                        change.x +
                        ", " +
                        change.y +
                        ")"}
                  </label>
                  <div className="map-diff-list">
                    {patchPreview.changes
                      .filter((item) => item.index === index)
                      .map((diff, diffIndex) => (
                        <div key={diffIndex}>
                          <strong>
                            {diffField(
                              diff.path ||
                                (diff.type === "blocked" ? "blocked" : "cells"),
                            )}
                          </strong>
                          <span>
                            {diffValue(diff.before)} → {diffValue(diff.after)}
                          </span>
                        </div>
                      ))}
                  </div>
                  <details className="map-muted">
                    <summary>{t("details")}</summary>
                    <pre>
                      {JSON.stringify(
                        patchPreview.changes.filter(
                          (item) => item.index === index,
                        ),
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </div>
              ))}
              <p className="map-muted">{t("partial")}</p>
            </>
          )}
          {selectionError && errorDetails(selectionError)}
          {dialogError && errorDetails(dialogError)}
          <div className="map-dialog-actions">
            <button disabled={busy} onClick={closeDialog}>
              {t("cancel")}
            </button>
            <button
              className="primary"
              data-testid="map-patch-apply"
              disabled={
                !patchPreview ||
                !chosenChanges.length ||
                busy ||
                !!selectionError
              }
              onClick={() =>
                dialogAction(async () => {
                  const next = await request("/api/map/patch", {
                    patch,
                    selectedIndices: chosenChanges,
                  });
                  serverRevision.current = next.revision;
                  localVersion.current++;
                  setDocument(next);
                  setUndo([]);
                  setRedo([]);
                  setDialog(null);
                  setRightTab("changes");
                })
              }
            >
              {t("accept")} ({chosenChanges.length})
            </button>
          </div>
        </Modal>
      )}
      {dialog === "asset" && (
        <Modal
          title={t("assetImport")}
          close={closeDialog}
          busy={busy}
          testId="map-asset-dialog"
        >
          <p>{t("assetHelp")}</p>
          <FilePicker
            label={t("chooseAsset")}
            emptyLabel={t("noFile")}
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            data-testid="map-asset-file"
            disabled={busy}
            onChange={(event) => {
              setAssetFile(event.target.files[0]);
              setAssetName(event.target.files[0]?.name || "");
            }}
          />
          <div className="map-two">
            <label>
              {t("name")}
              <input
                value={assetName}
                onChange={(event) => setAssetName(event.target.value)}
              />
            </label>
            <label>
              {t("assetKind")}
              <select
                value={assetKind}
                onChange={(event) => setAssetKind(event.target.value)}
              >
                <option value="tile">{t("terrain")}</option>
                <option value="object">{t("objects")}</option>
              </select>
            </label>
          </div>
          <h3>
            {t(assetKind === "tile" ? "stampFootprint" : "defaultFootprint")}
          </h3>
          <div className="map-two">
            <NumberField
              testId="map-import-footprint-width"
              label={t("cellWidth")}
              value={importFootprint.width}
              integer
              min={1}
              max={128}
              onChange={(value) =>
                setImportFootprint({ ...importFootprint, width: value })
              }
            />
            <NumberField
              testId="map-import-footprint-height"
              label={t("cellHeight")}
              value={importFootprint.height}
              integer
              min={1}
              max={128}
              onChange={(value) =>
                setImportFootprint({ ...importFootprint, height: value })
              }
            />
          </div>
          <p className="map-muted">
            {t(assetKind === "tile" ? "tileStampHelp" : "footprintHelp")}
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={useAtlas}
              onChange={(event) => setUseAtlas(event.target.checked)}
            />
            {t("atlas")}
          </label>
          <p className="map-muted">{t("atlasHint")}</p>
          {useAtlas && (
            <div className="map-two">
              {["x", "y", "width", "height"].map((field) => (
                <NumberField
                  key={field}
                  label={t("atlas" + field[0].toUpperCase() + field.slice(1))}
                  value={atlas[field]}
                  min={["width", "height"].includes(field) ? 1 : 0}
                  max={16384}
                  onChange={(value) => setAtlas({ ...atlas, [field]: value })}
                />
              ))}
            </div>
          )}
          {dialogError && errorDetails(dialogError)}
          <div className="map-dialog-actions">
            <button disabled={busy} onClick={closeDialog}>
              {t("cancel")}
            </button>
            <button
              data-testid="map-asset-confirm"
              className="primary"
              disabled={!assetFile || !assetName.trim() || busy}
              onClick={() => dialogAction(importAsset)}
            >
              {t("upload")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
