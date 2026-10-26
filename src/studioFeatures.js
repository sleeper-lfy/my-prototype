import { makeId, validateProject, computeLayout } from "./model.js";
import {
  validateMap,
  isWalkable,
  findPath,
  moveMapObject,
  planMapPlacement,
} from "./mapModel.js";
const copy = (value) => structuredClone(value);
const fail = (message) => {
  throw new Error(message);
};
const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const key = (x, y) => `${x},${y}`;
export function splitAtlas(
  asset,
  { sourceWidth, sourceHeight, width, height, margin = 0, spacing = 0 },
) {
  if (
    ![sourceWidth, sourceHeight, width, height].every((v) =>
      integer(v, 1, 32768),
    ) ||
    ![margin, spacing].every((v) => integer(v, 0, 1024))
  )
    fail("Invalid atlas dimensions.");
  const columns = Math.floor(
      (sourceWidth - 2 * margin + spacing) / (width + spacing),
    ),
    rows = Math.floor(
      (sourceHeight - 2 * margin + spacing) / (height + spacing),
    );
  if (columns < 1 || rows < 1 || columns * rows > 1000)
    fail("Atlas must contain 1–1000 tiles.");
  return Array.from(
    {
      length: rows * columns,
    },
    (_, i) => ({
      ...copy(asset),
      id: makeId("tile"),
      name: `${asset.name} ${i + 1}`,
      kind: "tile",
      footprint: {
        width: 1,
        height: 1,
      },
      atlas: {
        x: margin + (i % columns) * (width + spacing),
        y: margin + Math.floor(i / columns) * (height + spacing),
        width,
        height,
      },
    }),
  );
}
export function captureMapBlock(map, region, name) {
  validateMap(map);
  if (
    !name?.trim() ||
    !region ||
    !integer(region.x, 0, map.grid.width - 1) ||
    !integer(region.y, 0, map.grid.height - 1) ||
    !integer(region.width, 1, map.grid.width - region.x) ||
    !integer(region.height, 1, map.grid.height - region.y)
  )
    fail("Select a valid map region and name.");
  const contains = (x, y) =>
    x >= region.x &&
    y >= region.y &&
    x < region.x + region.width &&
    y < region.y + region.height;
  const objects = map.objects.filter((o) => contains(o.x, o.y));
  if (
    objects.some(
      (o) =>
        o.x + o.footprint.width > region.x + region.width ||
        o.y + o.footprint.height > region.y + region.height,
    )
  )
    fail("The region must contain complete object footprints.");
  const layers = map.layers.map((l) => ({
    ...copy(l),
    cells: Object.fromEntries(
      Object.entries(l.cells)
        .filter(([k]) => contains(...k.split(",").map(Number)))
        .map(([k, id]) => {
          const [x, y] = k.split(",").map(Number);
          return [key(x - region.x, y - region.y), id];
        }),
    ),
  }));
  const used = new Set([
    ...objects.map((o) => o.assetId),
    ...layers.flatMap((l) => Object.values(l.cells)),
  ]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const asset of map.assets.filter((a) => used.has(a.id)))
      for (const variant of Object.values(asset.directions || {}))
        if (!used.has(variant)) {
          used.add(variant);
          expanded = true;
        }
  }
  return {
    id: makeId("block"),
    kind: "map-block",
    name: name.trim(),
    version: 1,
    width: region.width,
    height: region.height,
    grid: copy(map.grid),
    layers,
    objects: objects.map((o) => {
      const n = {
        ...copy(o),
        x: o.x - region.x,
        y: o.y - region.y,
      };
      delete n.templateInstance;
      return n;
    }),
    blocked: map.blocked
      .filter((k) => contains(...k.split(",").map(Number)))
      .map((k) => {
        const [x, y] = k.split(",").map(Number);
        return key(x - region.x, y - region.y);
      }),
    markers: map.markers
      .filter((m) => contains(m.x, m.y))
      .map((m) => ({
        ...copy(m),
        x: m.x - region.x,
        y: m.y - region.y,
      })),
    assets: copy(map.assets.filter((a) => used.has(a.id))),
  };
}
export function transformBlock(block, { rotation = 0, mirror = false } = {}) {
  if (block.kind !== "map-block" || ![0, 90, 180, 270].includes(rotation))
    fail("Invalid block transform.");
  const result = copy(block);
  let w = block.width,
    h = block.height;
  const point = (x, y) => {
    if (mirror) x = block.width - 1 - x;
    for (let n = 0; n < rotation / 90; n++) {
      [x, y] = [h - 1 - y, x];
      [w, h] = [h, w];
    }
    w = block.width;
    h = block.height;
    return {
      x,
      y,
    };
  };
  const rect = (o) => {
    const corners = [
      [o.x, o.y],
      [o.x + o.footprint.width - 1, o.y],
      [o.x, o.y + o.footprint.height - 1],
      [o.x + o.footprint.width - 1, o.y + o.footprint.height - 1],
    ].map((p) => point(...p));
    const xs = corners.map((p) => p.x),
      ys = corners.map((p) => p.y);
    return {
      ...o,
      x: Math.min(...xs),
      y: Math.min(...ys),
      footprint: {
        width: Math.max(...xs) - Math.min(...xs) + 1,
        height: Math.max(...ys) - Math.min(...ys) + 1,
      },
    };
  };
  result.width = rotation % 180 ? block.height : block.width;
  result.height = rotation % 180 ? block.width : block.height;
  result.layers = result.layers.map((l) => ({
    ...l,
    cells: Object.fromEntries(
      Object.entries(l.cells).map(([k, id]) => {
        const p = point(...k.split(",").map(Number));
        return [key(p.x, p.y), id];
      }),
    ),
  }));
  result.objects = result.objects.map((o) => ({
    ...rect(o),
    assetId:
      block.assets.find((a) => a.id === o.assetId)?.directions?.[
        String(rotation) + (mirror ? "m" : "")
      ] || o.assetId,
    orientation: {
      rotation,
      mirror,
    },
  }));
  result.blocked = result.blocked.map((k) => {
    const p = point(...k.split(",").map(Number));
    return key(p.x, p.y);
  });
  result.markers = result.markers.map((m) => ({
    ...m,
    ...point(m.x, m.y),
  }));
  return result;
}
export function placeMapBlock(
  map,
  block,
  { x, y, rotation = 0, mirror = false, layerMapping = {}, link = true } = {},
) {
  validateMap(map);
  const b = transformBlock(block, {
    rotation,
    mirror,
  });
  if (
    !integer(x, 0, map.grid.width - b.width) ||
    !integer(y, 0, map.grid.height - b.height) ||
    b.grid.tileWidth !== map.grid.tileWidth ||
    b.grid.tileHeight !== map.grid.tileHeight
  )
    fail("Map block grid or bounds do not match.");
  const result = copy(map),
    mapping = new Map();
  for (const l of b.layers) {
    let target = result.layers.find(
      (t) => t.id === (layerMapping[l.id] || l.id),
    );
    if (!target) {
      if (result.layers.length >= 16) fail("Too many layers.");
      target = {
        ...copy(l),
        id: makeId("layer"),
        cells: {},
      };
      result.layers.push(target);
    }
    if (target.locked) fail("The destination map layer is locked.");
    mapping.set(l.id, target.id);
    for (const [k, id] of Object.entries(l.cells)) {
      const [a, c] = k.split(",").map(Number);
      target.cells[key(x + a, y + c)] = id;
    }
  }
  for (const asset of b.assets) {
    const old = result.assets.find((a) => a.id === asset.id);
    if (old && (old.src !== asset.src || old.kind !== asset.kind))
      fail("Map block asset ID conflicts with current assets.");
    if (!old) result.assets.push(copy(asset));
  }
  const instanceId = makeId("instance");
  for (const o of b.objects) {
    checkPlacementRules(
      result,
      {
        assetId: o.assetId,
        layerId: mapping.get(o.layerId),
        x: x + o.x,
        y: y + o.y,
        footprint: o.footprint,
      },
      result.placementRules || {},
    );
    result.objects.push({
      ...o,
      id: makeId("object"),
      x: x + o.x,
      y: y + o.y,
      layerId: mapping.get(o.layerId),
      ...(link
        ? {
            templateInstance: {
              templateId: block.id,
              instanceId,
              sourceId: o.id,
              version: block.version,
              baseline: copy(o),
            },
          }
        : {}),
    });
  }
  result.blocked = [
    ...new Set([
      ...result.blocked,
      ...b.blocked.map((k) => {
        const [a, c] = k.split(",").map(Number);
        return key(x + a, y + c);
      }),
    ]),
  ];
  for (const m of b.markers)
    result.markers.push({
      ...m,
      id: makeId("marker"),
      x: x + m.x,
      y: y + m.y,
    });
  validateMap(result);
  return result;
}
export function captureUIComponent(project, ids, name) {
  validateProject(project);
  const included = new Set(ids);
  let grow = true;
  while (grow) {
    grow = false;
    for (const n of project.nodes)
      if (included.has(n.parentId) && !included.has(n.id)) {
        included.add(n.id);
        grow = true;
      }
  }
  const layout = computeLayout(project),
    nodes = project.nodes
      .filter((n) => included.has(n.id))
      .map((n) => {
        const v = copy(n);
        delete v.templateInstance;
        return v;
      });
  if (!nodes.length || !name?.trim()) fail("Select components and a name.");
  const roots = nodes.filter((n) => !included.has(n.parentId));
  const ox = Math.min(...roots.map((n) => layout.get(n.id).x)),
    oy = Math.min(...roots.map((n) => layout.get(n.id).y));
  for (const n of roots) {
    const p = layout.get(n.id);
    n.parentId = null;
    n.frame.x = p.x - ox;
    n.frame.y = p.y - oy;
  }
  const assets = new Set(
    nodes
      .flatMap((n) => [
        n.assetId,
        n.disabledAssetId,
        ...Object.values(n.buttonAssets || {}),
      ])
      .filter(Boolean),
  );
  return {
    id: makeId("component"),
    kind: "ui-component",
    name: name.trim(),
    version: 1,
    nodes,
    assets: copy(
      project.assets.filter((a) => assets.has(a.id) || a.kind === "font"),
    ),
  };
}
export function instantiateUI(project, template, { x = 32, y = 32 } = {}) {
  const result = copy(project),
    ids = new Map(template.nodes.map((n) => [n.id, makeId("node")])),
    instanceId = makeId("instance");
  for (const asset of template.assets) {
    const old = result.assets.find((a) => a.id === asset.id);
    if (old && old.src !== asset.src) fail("Component asset conflict.");
    if (!old) result.assets.push(copy(asset));
  }
  for (const n of template.nodes)
    result.nodes.push({
      ...copy(n),
      id: ids.get(n.id),
      parentId: ids.get(n.parentId) || null,
      frame: {
        ...n.frame,
        x: n.frame.x + (n.parentId ? 0 : x),
        y: n.frame.y + (n.parentId ? 0 : y),
      },
      templateInstance: {
        templateId: template.id,
        instanceId,
        sourceId: n.id,
        version: template.version,
        baseline: copy(n),
      },
    });
  validateProject(result);
  return result;
}
/** Update only unchanged properties; local overrides remain intact. No deletion/reparenting. */
export function updateInstances(document, template) {
  (template.kind === "ui-component" ? validateProject : validateMap)(document);
  const result = copy(document);
  for (const asset of template.assets || []) {
    const old = result.assets.find((a) => a.id === asset.id);
    if (old && old.src !== asset.src) fail("Template asset conflict.");
    if (!old) result.assets.push(copy(asset));
  }
  const items =
      template.kind === "ui-component" ? result.nodes : result.objects,
    source = template.nodes || template.objects,
    changes = [],
    overrides = [];
  for (const item of items) {
    const ref = item.templateInstance;
    if (ref?.templateId !== template.id) continue;
    if (template.kind === "ui-component") {
      let n = item;
      let locked = false;
      while (n) {
        if (n.locked) locked = true;
        n = result.nodes.find((p) => p.id === n.parentId);
      }
      if (locked) {
        overrides.push({
          id: item.id,
          path: "locked",
        });
        continue;
      }
    } else if (result.layers.find((l) => l.id === item.layerId)?.locked) {
      overrides.push({
        id: item.id,
        path: "locked",
      });
      continue;
    }
    const master = (
      template.kind === "map-block" && item.orientation
        ? transformBlock(template, item.orientation).objects
        : source
    ).find((n) => n.id === ref.sourceId);
    if (!master) continue;
    const paths =
      template.kind === "ui-component"
        ? [
            ...new Set([
              "assetId",
              "disabledAssetId",
              "frame.width",
              "frame.height",
              ...Object.keys({
                ...ref.baseline?.style,
                ...master.style,
              }).map((k) => "style." + k),
              ...Object.keys({
                ...ref.baseline?.buttonAssets,
                ...master.buttonAssets,
              }).map((k) => "buttonAssets." + k),
            ]),
          ]
        : [
            "assetId",
            "width",
            "height",
            "anchorX",
            "anchorY",
            "blocking",
            "footprint",
          ];
    for (const path of paths) {
      const parts = path.split("."),
        read = (o) => parts.reduce((v, p) => v?.[p], o),
        before = read(ref.baseline),
        current = read(item),
        after = read(master);
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      if (JSON.stringify(before) !== JSON.stringify(current)) {
        overrides.push({
          id: item.id,
          path,
        });
        continue;
      }
      let target = item;
      for (const p of parts.slice(0, -1)) target = target[p] ??= {};
      if (after === undefined) delete target[parts.at(-1)];
      else target[parts.at(-1)] = copy(after);
      changes.push({
        id: item.id,
        path,
        before,
        after,
      });
    }
    ref.baseline = copy(master);
    ref.version = template.version;
  }
  (template.kind === "ui-component" ? validateProject : validateMap)(result);
  return {
    document: result,
    changes,
    overrides,
  };
}
export function terrainStroke(map, { layerId, points, rule }) {
  const result = copy(map),
    layer = result.layers.find((l) => l.id === layerId);
  if (!layer || layer.locked || !points?.length || points.length > 16384)
    fail("Choose an editable terrain layer and path.");
  const variants = rule?.variants;
  if (!variants || !Object.keys(variants).length)
    fail("Configure terrain variants for connection masks.");
  for (const id of Object.values(variants))
    if (!result.assets.some((a) => a.id === id && a.kind === "tile"))
      fail("Terrain rule references missing tiles.");
  layer.terrainCells ??= {};
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      prev = points[i - 1] || p;
    if (
      !integer(p.x, 0, map.grid.width - 1) ||
      !integer(p.y, 0, map.grid.height - 1)
    )
      fail("Terrain stroke leaves map bounds.");
    let x = prev.x,
      y = prev.y;
    layer.terrainCells[key(x, y)] = rule.id;
    while (x !== p.x || y !== p.y) {
      if (x !== p.x) x += Math.sign(p.x - x);
      else y += Math.sign(p.y - y);
      layer.terrainCells[key(x, y)] = rule.id;
    }
  }
  for (const [k, id] of Object.entries(layer.terrainCells)) {
    if (id !== rule.id) continue;
    const [x, y] = k.split(",").map(Number);
    let mask = 0;
    for (const [dx, dy, bit] of [
      [0, -1, 1],
      [1, 0, 2],
      [0, 1, 4],
      [-1, 0, 8],
    ])
      if (layer.terrainCells[key(x + dx, y + dy)] === rule.id) mask |= bit;
    const tile = variants[String(mask)] || variants["0"];
    if (!tile) fail(`Terrain rule needs mask ${mask} or fallback 0.`);
    layer.cells[k] = tile;
  }
  validateMap(result);
  return result;
}
export function checkPlacementRules(
  map,
  { assetId, layerId, x, y, footprint },
  rules = {},
) {
  const plan = planMapPlacement(map, {
      assetId,
      layerId,
      x,
      y,
      footprint,
    }),
    shape = plan.object?.footprint || plan.footprint,
    policy = rules[assetId];
  if (!policy) return plan;
  for (let yy = y; yy < y + shape.height; yy++)
    for (let xx = x; xx < x + shape.width; xx++) {
      if (
        policy.allowedTiles?.length &&
        !policy.allowedTiles.includes(
          [...map.layers].reverse().find((l) => l.cells[key(xx, yy)])?.cells[
            key(xx, yy)
          ],
        )
      )
        fail("This asset requires an allowed terrain tile.");
      if (
        policy.avoidOverlap &&
        map.objects.some(
          (o) =>
            o.layerId === layerId &&
            xx >= o.x &&
            yy >= o.y &&
            xx < o.x + o.footprint.width &&
            yy < o.y + o.footprint.height,
        )
      )
        fail("This footprint overlaps another object.");
    }
  return plan;
}
export function measureMap(map, a, b) {
  const path = findPath(map, a, b),
    tileAt = (x, y) =>
      [...map.layers].reverse().find((l) => l.cells[key(x, y)])?.cells[
        key(x, y)
      ];
  const run = (dx, dy, predicate) => {
    if (
      !integer(a.x, 0, map.grid.width - 1) ||
      !integer(a.y, 0, map.grid.height - 1) ||
      !predicate(a.x, a.y)
    )
      return 0;
    let width = 1;
    for (const sign of [-1, 1])
      for (let n = 1; n <= 128; n++) {
        const x = a.x + dx * n * sign,
          y = a.y + dy * n * sign;
        if (
          !integer(x, 0, map.grid.width - 1) ||
          !integer(y, 0, map.grid.height - 1) ||
          !predicate(x, y)
        )
          break;
        width++;
      }
    return width;
  };
  const tile = tileAt(a.x, a.y);
  return {
    gridManhattan: Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
    gridEuclidean: Math.hypot(a.x - b.x, a.y - b.y),
    walkablePath: path.length ? path.length - 1 : null,
    terrainSpanX: tile ? run(1, 0, (x, y) => tileAt(x, y) === tile) : 0,
    terrainSpanY: tile ? run(0, 1, (x, y) => tileAt(x, y) === tile) : 0,
    clearanceX: run(1, 0, (x, y) => isWalkable(map, x, y)),
    clearanceY: run(0, 1, (x, y) => isWalkable(map, x, y)),
  };
}
export function projectChecks(ui, map) {
  const results = [],
    layout = computeLayout(ui);
  for (const n of ui.nodes) {
    const r = layout.get(n.id);
    if (
      r.x < 0 ||
      r.y < 0 ||
      r.x + r.width > ui.canvas.width ||
      r.y + r.height > ui.canvas.height
    )
      results.push({
        kind: "bounds",
        target: n.id,
        severity: "warning",
      });
    if (
      n.style?.text &&
      ((n.style.text.length * (n.style.fontSize || 14) * 0.55 > r.width &&
        (n.type === "Button" || r.height < (n.style.fontSize || 14) * 2)) ||
        (n.style.fontSize || 14) > r.height)
    )
      results.push({
        kind: "text-overflow",
        target: n.id,
        severity: "warning",
      });
  }
  const spawn = map.markers.find((m) => m.type === "spawn");
  if (!spawn)
    results.push({
      kind: "missing-spawn",
      target: map.id,
      severity: "warning",
    });
  else {
    if (!isWalkable(map, spawn.x, spawn.y))
      results.push({
        kind: "blocked-spawn",
        target: spawn.id,
        severity: "error",
      });
    for (const exit of map.markers.filter((m) => m.type === "exit"))
      if (!findPath(map, spawn, exit).length)
        results.push({
          kind: "unreachable-exit",
          target: exit.id,
          severity: "error",
        });
  }
  return results;
}
export function localizedUI(ui, locale) {
  const result = copy(ui);
  for (const n of result.nodes) {
    const text = result.translations?.[locale]?.[n.id];
    if (typeof text === "string") {
      n.style ??= {};
      n.style.text = text;
    }
  }
  return result;
}

/** Remove only references to author-deleted UI nodes, preserving page links. */
export function pruneUIReferences(project) {
  const result = copy(project),
    ids = new Set(result.nodes.map((n) => n.id));
  if (result.interactions)
    result.interactions = result.interactions.filter(
      (r) =>
        ids.has(r.sourceId) && (r.action === "page" || ids.has(r.targetId)),
    );
  if (result.translations)
    for (const locale of Object.keys(result.translations))
      result.translations[locale] = Object.fromEntries(
        Object.entries(result.translations[locale]).filter(([id]) =>
          ids.has(id),
        ),
      );
  return result;
}
