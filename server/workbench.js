import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { validateProject, makeId } from "../src/model.js";
import { validateMap, createVillageMap } from "../src/mapModel.js";
import { createProjectTemplate } from "../src/projectImport.js";
import * as features from "../src/studioFeatures.js";
import { createWorkspaceGodot, planGodotSync } from "./godotSync.js";
const clone = (v) => structuredClone(v),
  hash = (b) => createHash("sha256").update(b).digest("hex");
const fail = (m) => {
  throw new Error(m);
};
export async function mountWorkbench(
  app,
  { dataDir, mutate, getUI, setUI, getMap, setMap, archive, readAsset },
) {
  const filename = path.join(dataDir, "workbench.json");
  let library;
  const seed = () => ({
    schemaVersion: 1,
    revision: 1,
    activeProjectId: "workspace-default",
    projects: [
      {
        id: "workspace-default",
        name: "Game project",
        activeUIId: getUI().id,
        activeMapId: getMap().id,
        uiPages: [getUI()],
        maps: [getMap()],
        templates: [],
        terrainRules: [],
        placementRules: {},
      },
    ],
  });
  try {
    library = JSON.parse(await fs.readFile(filename, "utf8"));
    validateLibrary(library);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    library = seed();
  }
  function active(lib = library) {
    return lib.projects.find((p) => p.id === lib.activeProjectId);
  }
  function snapshot() {
    const lib = clone(library),
      project = active(lib);
    const ui = getUI(),
      map = getMap();
    project.uiPages = project.uiPages.filter(
      (p) => p.id !== project.activeUIId && p.id !== ui.id,
    );
    project.uiPages.push(ui);
    project.activeUIId = ui.id;
    project.maps = project.maps.filter(
      (p) => p.id !== project.activeMapId && p.id !== map.id,
    );
    project.maps.push(map);
    project.activeMapId = map.id;
    return lib;
  }
  function validateLibrary(lib) {
    if (
      lib?.schemaVersion !== 1 ||
      !Number.isSafeInteger(lib.revision) ||
      !Array.isArray(lib.projects) ||
      lib.projects.length < 1 ||
      lib.projects.length > 100
    )
      fail("Invalid project library.");
    const ids = new Set();
    for (const project of lib.projects) {
      if (
        !/^[A-Za-z0-9_-]+$/.test(project.id) ||
        ids.has(project.id) ||
        typeof project.name !== "string" ||
        !project.name.trim()
      )
        fail("Invalid project identity.");
      ids.add(project.id);
      if (
        !Array.isArray(project.uiPages) ||
        !project.uiPages.length ||
        project.uiPages.length > 100 ||
        !Array.isArray(project.maps) ||
        !project.maps.length ||
        project.maps.length > 100 ||
        !Array.isArray(project.templates) ||
        project.templates.length > 200
      )
        fail("Invalid workspace documents.");
      for (const doc of project.uiPages) validateProject(doc);
      for (const doc of project.maps) validateMap(doc);
      if (
        !project.uiPages.some((d) => d.id === project.activeUIId) ||
        !project.maps.some((d) => d.id === project.activeMapId)
      )
        fail("Missing active page or map.");
    }
    if (!ids.has(lib.activeProjectId)) fail("Missing active project.");
  }
  async function persist(lib) {
    validateLibrary(lib);
    const tmp = filename + "." + randomUUID() + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(lib, null, 2) + "\n");
    await fs.rename(tmp, filename);
    library = lib;
  }
  async function checkAssets(lib) {
    for (const project of lib.projects)
      for (const doc of [
        ...project.uiPages,
        ...project.maps,
        ...project.templates,
      ])
        for (const asset of doc.assets || []) await readAsset(asset.src);
  }
  const response = () => ({
    library: snapshot(),
    uiRevision: getUI().revision,
    mapRevision: getMap().revision,
  });
  app.get("/api/workbench", (_req, res) => res.json(response()));
  app.post("/api/workbench/action", async (req, res) =>
    res.json(
      await mutate(async () => {
        const body = req.body;
        if (
          body.libraryRevision !== library.revision ||
          body.uiRevision !== getUI().revision ||
          body.mapRevision !== getMap().revision
        )
          throw Object.assign(
            new Error("The workspace changed. Reload before continuing."),
            {
              status: 409,
            },
          );
        const lib = snapshot(),
          project = active(lib);
        let ui = getUI(),
          map = getMap(),
          uiChanged = false,
          mapChanged = false,
          details = {};
        const data = body.data || {};
        const template = () =>
          project.templates.find((t) => t.id === data.templateId) ||
          fail("Template is missing.");
        switch (body.action) {
          case "project-create": {
            const id = makeId("project"),
              u = createProjectTemplate(data.name || "New UI"),
              m = createVillageMap();
            u.id = makeId("ui");
            m.id = makeId("map");
            m.name = data.name || "Map";
            const p = {
              id,
              name: data.name?.trim() || "New project",
              activeUIId: u.id,
              activeMapId: m.id,
              uiPages: [u],
              maps: [m],
              templates: [],
              terrainRules: [],
              placementRules: {},
            };
            lib.projects.push(p);
            lib.activeProjectId = id;
            ui = u;
            map = m;
            uiChanged = mapChanged = true;
            break;
          }
          case "project-open": {
            const p =
              lib.projects.find((p) => p.id === data.id) ||
              fail("Project is missing.");
            lib.activeProjectId = p.id;
            ui = p.uiPages.find((d) => d.id === p.activeUIId);
            map = p.maps.find((d) => d.id === p.activeMapId);
            uiChanged = mapChanged = true;
            break;
          }
          case "rename":
            project.name =
              String(data.name || "").trim() || fail("A name is required.");
            break;
          case "document-create": {
            if (data.kind === "ui") {
              ui = createProjectTemplate(data.name || "UI page");
              ui.id = makeId("ui");
              project.uiPages.push(ui);
              project.activeUIId = ui.id;
              uiChanged = true;
            } else {
              map = clone(map);
              map.id = makeId("map");
              map.name = data.name || "Map";
              map.layers = map.layers.map((l) => ({
                ...l,
                cells: {},
              }));
              map.objects = [];
              map.blocked = [];
              map.markers = [];
              map.reference = null;
              map.reviews = [];
              map.history = [];
              project.maps.push(map);
              project.activeMapId = map.id;
              mapChanged = true;
            }
            break;
          }
          case "document-open": {
            if (data.kind === "ui") {
              ui =
                project.uiPages.find((p) => p.id === data.id) ||
                fail("Page missing.");
              project.activeUIId = ui.id;
              uiChanged = true;
            } else {
              map =
                project.maps.find((p) => p.id === data.id) ||
                fail("Map missing.");
              project.activeMapId = map.id;
              mapChanged = true;
            }
            break;
          }
          case "capture-ui":
            project.templates.push(
              features.captureUIComponent(ui, data.ids, data.name),
            );
            break;
          case "capture-block":
            project.templates.push(
              features.captureMapBlock(map, data.region, data.name),
            );
            map.blocks = clone(
              project.templates.filter((t) => t.kind === "map-block"),
            );
            mapChanged = true;
            break;
          case "place-template": {
            const t = template();
            if (t.kind === "ui-component") {
              ui = features.instantiateUI(ui, t, data);
              uiChanged = true;
            } else {
              map = features.placeMapBlock(map, t, data);
              mapChanged = true;
            }
            break;
          }
          case "template-update": {
            const t = template(),
              next =
                t.kind === "ui-component"
                  ? features.captureUIComponent(ui, data.ids, t.name)
                  : features.captureMapBlock(map, data.region, t.name);
            next.id = t.id;
            next.version = t.version + 1;
            const prior = t.kind === "ui-component" ? t.nodes : t.objects,
              now = next.nodes || next.objects;
            if (prior.length !== now.length)
              fail(
                "Template structure changed. Save a new template for added/removed components.",
              );
            const ids = new Map(now.map((n, i) => [n.id, prior[i].id]));
            for (let i = 0; i < now.length; i++) {
              now[i].id = prior[i].id;
              if (now[i].parentId)
                now[i].parentId = ids.get(now[i].parentId) || null;
            }
            project.templates[project.templates.indexOf(t)] = next;
            if (next.kind === "map-block") {
              map.blocks = clone(
                project.templates.filter((t) => t.kind === "map-block"),
              );
              mapChanged = true;
            }
            break;
          }
          case "instances-preview": {
            details = features.updateInstances(
              data.kind === "ui" ? ui : map,
              template(),
            );
            delete details.document;
            return {
              ...response(),
              details,
            };
          }
          case "instances-apply": {
            const t = template();
            for (let i = 0; i < project.uiPages.length; i++)
              if (t.kind === "ui-component")
                project.uiPages[i] = features.updateInstances(
                  project.uiPages[i],
                  t,
                ).document;
            for (let i = 0; i < project.maps.length; i++)
              if (t.kind === "map-block")
                project.maps[i] = features.updateInstances(
                  project.maps[i],
                  t,
                ).document;
            if (t.kind === "ui-component") {
              ui = project.uiPages.find((p) => p.id === ui.id);
              uiChanged = true;
            } else {
              map = project.maps.find((p) => p.id === map.id);
              mapChanged = true;
            }
            break;
          }
          case "atlas-split": {
            const asset =
              map.assets.find((a) => a.id === data.assetId) ||
              fail("Choose an imported map asset.");
            const tiles = features.splitAtlas(asset, {
              ...data,
              width: Number(data.width),
              height: Number(data.height),
            });
            map.assets.push(...tiles);
            details.count = tiles.length;
            mapChanged = true;
            break;
          }
          case "terrain-rule": {
            const rule = {
              id: data.id || makeId("terrain"),
              name: data.name || "Terrain",
              variants: data.variants,
            };
            if (!rule.variants || typeof rule.variants !== "object")
              fail("Choose terrain variant tiles.");
            for (const id of Object.values(rule.variants))
              if (!map.assets.some((a) => a.id === id && a.kind === "tile"))
                fail("Missing terrain tile.");
            project.terrainRules = project.terrainRules.filter(
              (r) => r.id !== rule.id,
            );
            project.terrainRules.push(rule);
            map.terrainRules = [
              ...(map.terrainRules || []).filter((r) => r.id !== rule.id),
              clone(rule),
            ];
            mapChanged = true;
            break;
          }
          case "terrain-stroke": {
            const rule =
              project.terrainRules.find((r) => r.id === data.ruleId) ||
              fail("Terrain rule missing.");
            map = features.terrainStroke(map, {
              ...data,
              rule,
            });
            mapChanged = true;
            break;
          }
          case "map-directions": {
            const asset = map.assets.find(
              (a) => a.id === data.assetId && a.kind === "object",
            );
            if (!asset) fail("Choose an object asset.");
            if (
              !data.directions ||
              Object.entries(data.directions).some(
                ([k, v]) =>
                  ![
                    "0",
                    "90",
                    "180",
                    "270",
                    "0m",
                    "90m",
                    "180m",
                    "270m",
                  ].includes(k) ||
                  !map.assets.some((a) => a.id === v && a.kind === "object"),
              )
            )
              fail("Invalid directional artwork.");
            asset.directions = data.directions;
            mapChanged = true;
            break;
          }
          case "placement-rule": {
            if (!map.assets.some((a) => a.id === data.assetId))
              fail("Asset missing.");
            project.placementRules[data.assetId] = {
              allowedTiles: data.allowedTiles || [],
              avoidOverlap: !!data.avoidOverlap,
            };
            map.placementRules = {
              ...map.placementRules,
              [data.assetId]: clone(project.placementRules[data.assetId]),
            };
            mapChanged = true;
            break;
          }
          case "reference": {
            if (
              data.reference &&
              !map.assets.some((a) => a.id === data.reference.assetId)
            )
              fail("Reference asset missing.");
            map.reference = data.reference;
            mapChanged = true;
            break;
          }
          case "ui-behavior": {
            ui.interactions = data.interactions;
            ui.translations = data.translations;
            validateBehaviors(ui, project.uiPages);
            uiChanged = true;
            break;
          }
          case "nine-slice": {
            const asset =
              ui.assets.find((a) => a.id === data.assetId) ||
              fail("UI asset missing.");
            asset.margins = data.margins;
            asset.kind = "nineSlice";
            uiChanged = true;
            break;
          }
          case "button-states": {
            const n =
              ui.nodes.find(
                (n) => n.id === data.nodeId && n.type === "Button",
              ) || fail("Choose a button.");
            n.buttonAssets = {
              normal: data.normal || null,
              hover: data.hover || null,
              pressed: data.pressed || null,
            };
            n.disabledAssetId = data.disabled || null;
            uiChanged = true;
            break;
          }
          default:
            fail("Unknown workspace action.");
        }
        validateProject(ui);
        validateMap(map);
        validateLibrary(lib);
        await checkAssets(lib);
        const previousUI = getUI(),
          previousMap = getMap();
        try {
          if (uiChanged) ui = await setUI(ui);
          if (mapChanged) map = await setMap(map);
          const p = active(lib);
          if (uiChanged) {
            p.uiPages = p.uiPages.filter((d) => d.id !== p.activeUIId);
            p.uiPages.push(ui);
            p.activeUIId = ui.id;
          }
          if (mapChanged) {
            p.maps = p.maps.filter((d) => d.id !== p.activeMapId);
            p.maps.push(map);
            p.activeMapId = map.id;
          }
          lib.revision++;
          await persist(lib);
        } catch (error) {
          if (uiChanged) await setUI(previousUI);
          if (mapChanged) await setMap(previousMap);
          throw error;
        }
        return {
          ...response(),
          details,
          reload: uiChanged || mapChanged,
        };
      }),
    ),
  );
  app.post("/api/workbench/checks", async (_req, res) => {
    const project = active(snapshot()),
      issues = [];
    for (const ui of project.uiPages)
      issues.push(
        ...features
          .projectChecks(ui, project.maps[0])
          .filter((i) => ["bounds", "text-overflow"].includes(i.kind))
          .map((i) => ({
            ...i,
            document: ui.id,
          })),
      );
    for (const map of project.maps)
      issues.push(
        ...features
          .projectChecks(
            {
              ...project.uiPages[0],
              nodes: [],
            },
            map,
          )
          .map((i) => ({
            ...i,
            document: map.id,
          })),
      );
    for (const doc of [...project.uiPages, ...project.maps])
      for (const asset of doc.assets)
        try {
          await readAsset(asset.src);
        } catch {
          issues.push({
            kind: "missing-asset",
            target: asset.id,
            severity: "error",
            document: doc.id,
          });
        }
    res.json({
      issues,
    });
  });
  app.post("/api/workbench/export", async (_req, res) => {
    const project = active(snapshot()),
      files = {},
      resources = {};
    let totalBytes = 0;
    for (const doc of [
      ...project.uiPages,
      ...project.maps,
      ...project.templates,
      ...project.maps.flatMap((m) => m.blocks || []),
    ])
      for (const asset of doc.assets || []) {
        if (resources[asset.src]) continue;
        const bytes = await readAsset(asset.src);
        totalBytes += bytes.length;
        if (totalBytes > 256 * 1024 * 1024)
          fail("Project resources exceed 256 MiB.");
        const name = `resources/${hash(bytes)}.${asset.src.split(".").at(-1)}`;
        files[name] = bytes;
        resources[asset.src] = name;
      }
    files["workspace.json"] = strToU8(JSON.stringify(project));
    files["resources.json"] = strToU8(JSON.stringify(resources));
    files["LICENSE.txt"] = await fs.readFile(
      new URL("../LICENSE", import.meta.url),
    );
    files["FONT-LICENSE.txt"] = await readAsset("/assets/FONT-LICENSE.txt");
    res.json(await archive("workspace", files, { maxBytes: 50 * 1024 * 1024 }));
  });
  app.post("/api/workbench/import", async (req, res) =>
    res.json(
      await mutate(async () => {
        if (
          typeof req.body.base64 !== "string" ||
          req.body.base64.length > 70 * 1024 * 1024
        )
          fail("Workspace ZIP exceeds 50 MiB.");
        let total = 0;
        const files = unzipSync(Buffer.from(req.body.base64, "base64"), {
          filter: (item) => {
            total += item.originalSize;
            if (
              total > 256 * 1024 * 1024 ||
              item.originalSize > 30 * 1024 * 1024 ||
              item.name.includes("..") ||
              item.name.startsWith("/")
            )
              fail("Unsafe or oversized workspace archive.");
            return true;
          },
        });
        const project = JSON.parse(strFromU8(files["workspace.json"])),
          resources = JSON.parse(strFromU8(files["resources.json"]));
        const lib = snapshot();
        project.id = makeId("project");
        if (lib.projects.length >= 100) fail("Project limit reached.");
        lib.projects.push(project);
        lib.activeProjectId = project.id;
        validateLibrary(lib);
        const replacements = {};
        for (const [src, name] of Object.entries(resources)) {
          if (
            !/^resources\/[a-f0-9]{64}\.(svg|png|jpe?g|webp|ttf|otf)$/.test(
              name,
            ) ||
            !files[name]
          )
            fail("Invalid portable resource.");
          const bytes = files[name],
            digest = name.split("/")[1].split(".")[0];
          if (hash(bytes) !== digest) fail("Resource checksum mismatch.");
          const filename = "portable-" + name.split("/")[1];
          const target = path.join(dataDir, "assets", filename);
          try {
            await fs.writeFile(target, bytes, { flag: "wx" });
          } catch (e) {
            if (e.code !== "EEXIST") throw e;
            const stat = await fs.lstat(target);
            if (
              !stat.isFile() ||
              stat.isSymbolicLink() ||
              hash(await fs.readFile(target)) !== digest
            )
              fail("Portable asset conflicts with an existing file.");
          }
          replacements[src] = "/local-assets/" + filename;
        }
        for (const doc of [
          ...project.uiPages,
          ...project.maps,
          ...project.templates,
          ...project.maps.flatMap((m) => m.blocks || []),
        ])
          for (const asset of doc.assets || []) {
            if (!replacements[asset.src])
              fail("Archive omits a referenced resource.");
            asset.src = replacements[asset.src];
          }
        await checkAssets(lib);
        const ui = project.uiPages.find((d) => d.id === project.activeUIId),
          map = project.maps.find((d) => d.id === project.activeMapId);
        await setUI(ui);
        await setMap(map);
        lib.revision++;
        await persist(lib);
        return {
          ...response(),
          reload: true,
        };
      }),
    ),
  );
  app.post("/api/workbench/godot", async (req, res) => {
    const generated = await createWorkspaceGodot(
        active(snapshot()),
        readAsset,
        { kind: req.body.kind === "map" ? "map" : "ui" },
      ),
      files = Object.fromEntries(
        Object.entries(generated.files).map(([n, b]) => ["incoming/" + n, b]),
      );
    files["sync.mjs"] = strToU8(generated.syncScript);
    files["incoming-manifest.json"] = strToU8(
      JSON.stringify(generated.manifest, null, 2),
    );
    files["starter-project.godot"] = strToU8(generated.starter);
    files["LICENSE.txt"] = await fs.readFile(
      new URL("../LICENSE", import.meta.url),
    );
    files["FONT-LICENSE.txt"] = await readAsset("/assets/FONT-LICENSE.txt");
    res.json({
      ...(await archive("godot-update", files)),
      manifest: generated.manifest,
    });
  });
  app.post("/api/workbench/sync-preview", async (req, res) => {
    const generated = await createWorkspaceGodot(active(snapshot()), readAsset);
    res.json({
      changes: planGodotSync(
        req.body.previous || {
          files: {},
        },
        generated.manifest,
        req.body.actual || {},
      ),
    });
  });
  return {
    snapshot,
  };
}
function validateBehaviors(ui, pages) {
  if (
    !Array.isArray(ui.interactions) ||
    ui.interactions.length > 1000 ||
    !ui.translations ||
    typeof ui.translations !== "object"
  )
    throw new Error("Invalid UI behavior configuration.");
  for (const r of ui.interactions) {
    if (
      !ui.nodes.some((n) => n.id === r.sourceId) ||
      !["open", "close", "toggle", "page", "setText"].includes(r.action)
    )
      throw new Error("Invalid UI interaction.");
    if (r.action === "page" && !pages.some((p) => p.id === r.targetId))
      throw new Error("Interaction page missing.");
    if (r.action !== "page" && !ui.nodes.some((n) => n.id === r.targetId))
      throw new Error("Interaction target missing.");
  }
  for (const [locale, values] of Object.entries(ui.translations)) {
    if (
      !/^[A-Za-z][A-Za-z0-9-]{1,24}$/.test(locale) ||
      !values ||
      typeof values !== "object"
    )
      throw new Error("Invalid translation locale.");
    for (const [id, text] of Object.entries(values))
      if (
        !ui.nodes.some((n) => n.id === id) ||
        typeof text !== "string" ||
        text.length > 20000
      )
        throw new Error("Invalid translation text.");
  }
}
