import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createVillageMap } from "../src/mapModel.js";
import { validateProject } from "../src/model.js";
import * as f from "../src/studioFeatures.js";
const ui = JSON.parse(
  await fs.readFile(
    new URL("../examples/character.project.json", import.meta.url),
  ),
);
test("atlas splits with margins and spacing without changing source bytes or duplicating IDs", () => {
  const a = createVillageMap().assets[0],
    tiles = f.splitAtlas(a, {
      sourceWidth: 134,
      sourceHeight: 70,
      width: 64,
      height: 32,
      margin: 2,
      spacing: 2,
    });
  assert.equal(tiles.length, 4);
  assert.deepEqual(tiles[3].atlas, { x: 68, y: 36, width: 64, height: 32 });
  assert.equal(tiles[0].src, a.src);
  assert.equal(new Set(tiles.map((t) => t.id)).size, 4);
  assert.throws(() =>
    f.splitAtlas(a, {
      sourceWidth: 10,
      sourceHeight: 10,
      width: 32,
      height: 32,
    }),
  );
});
test("map blocks capture multiple layers, rotate rectangular occupancy and place fresh stable IDs atomically", () => {
  const map = createVillageMap(),
    block = f.captureMapBlock(map, { x: 2, y: 2, width: 4, height: 4 }, "Inn");
  assert.equal(block.objects.length, 1);
  const rotated = f.transformBlock(block, { rotation: 90, mirror: true });
  assert.equal(rotated.width, 4);
  const placed = f.placeMapBlock(map, block, { x: 8, y: 8, rotation: 90 });
  assert.equal(placed.objects.length, map.objects.length + 1);
  assert.notEqual(placed.objects.at(-1).id, block.objects[0].id);
  assert.equal(placed.objects.at(-1).templateInstance.templateId, block.id);
  assert.deepEqual(map, createVillageMap());
  map.layers.find((l) => l.id === "ground").locked = true;
  assert.throws(() => f.placeMapBlock(map, block, { x: 8, y: 8 }), /locked/);
  assert.throws(
    () => f.placeMapBlock(createVillageMap(), block, { x: 15, y: 15 }),
    /bounds/,
  );
  const rectangular = { ...block, width: 4, height: 6 };
  const r = f.transformBlock(rectangular, { rotation: 90 });
  assert.equal(r.width, 6);
  assert.equal(r.height, 4);
});
test("UI templates preserve hierarchy and instance overrides while applying master updates", () => {
  const master = f.captureUIComponent(ui, ["recruit-button"], "Action"),
    inst = f.instantiateUI(ui, master, { x: 100, y: 100 });
  validateProject(inst);
  const n = inst.nodes.at(-1);
  assert.equal(n.frame.x, 100);
  const next = structuredClone(master);
  next.version++;
  next.nodes[0].style.fontSize = 20;
  const updated = f.updateInstances(inst, next);
  assert.equal(updated.document.nodes.at(-1).style.fontSize, 20);
  n.style.text = "LOCAL";
  const preserved = f.updateInstances(inst, next);
  assert.equal(preserved.document.nodes.at(-1).style.text, "LOCAL");
  assert.equal(preserved.document.nodes.at(-1).style.fontSize, 20);
  assert.equal(preserved.overrides.length, 0);
});
test("connected terrain strokes choose endpoints, corners and update adjacent masks", () => {
  const map = createVillageMap(),
    rule = {
      id: "road",
      variants: { 0: "grass", 2: "path", 8: "path", 10: "stone", 12: "water" },
    };
  const result = f.terrainStroke(map, {
    layerId: "roads",
    points: [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
    ],
    rule,
  });
  assert.equal(result.layers[1].cells["0,0"], "path");
  assert.equal(result.layers[1].cells["1,0"], "stone");
  assert.equal(result.layers[1].cells["3,0"], "water");
  assert.equal(map.layers[1].terrainCells, undefined);
  map.layers[1].locked = true;
  assert.throws(
    () =>
      f.terrainStroke(map, {
        layerId: "roads",
        points: [{ x: 0, y: 0 }],
        rule,
      }),
    /editable/,
  );
});
test("placement policies reject terrain and same-layer occupancy overlaps", () => {
  const map = createVillageMap();
  assert.throws(
    () =>
      f.checkPlacementRules(
        map,
        { assetId: "house", layerId: "decoration", x: 3, y: 3 },
        { house: { avoidOverlap: true } },
      ),
    /overlap/,
  );
  assert.throws(
    () =>
      f.checkPlacementRules(
        map,
        { assetId: "house", layerId: "decoration", x: 0, y: 0 },
        { house: { allowedTiles: ["water"] } },
      ),
    /terrain/,
  );
  assert.ok(
    f.checkPlacementRules(
      map,
      { assetId: "house", layerId: "decoration", x: 12, y: 10 },
      { house: { allowedTiles: ["water"] } },
    ),
  );
});
test("checks detect inaccessible spawn/exit and localized copies preserve source content", () => {
  const map = createVillageMap();
  map.blocked.push("7,14");
  assert.ok(f.projectChecks(ui, map).some((i) => i.kind === "blocked-spawn"));
  const project = structuredClone(ui);
  project.translations = {
    en: { "recruit-button": "Recruit" },
    "zh-CN": { "recruit-button": "招募" },
  };
  assert.equal(
    f.localizedUI(project, "zh-CN").nodes.find((n) => n.id === "recruit-button")
      .style.text,
    "招募",
  );
  assert.notEqual(
    project.nodes.find((n) => n.id === "recruit-button").style.text,
    "招募",
  );
  assert.equal(
    f.measureMap(createVillageMap(), { x: 7, y: 14 }, { x: 7, y: 0 })
      .walkablePath,
    14,
  );
});

test("map block direction variants preserve actual asset references and measurement reports road and clearance widths", () => {
  const map = createVillageMap();
  const house = map.assets.find((a) => a.id === "house");
  map.assets.push({
    ...structuredClone(house),
    id: "house-east",
    name: "East artwork",
  });
  house.directions = { 90: "house-east" };
  const block = f.captureMapBlock(
    map,
    { x: 2, y: 2, width: 4, height: 4 },
    "Directional inn",
  );
  assert.ok(block.assets.some((a) => a.id === "house-east"));
  assert.equal(
    f.transformBlock(block, { rotation: 90 }).objects[0].assetId,
    "house-east",
  );
  const measured = f.measureMap(map, { x: 7, y: 14 }, { x: 7, y: 0 });
  assert.equal(measured.terrainSpanX, 2);
  assert.equal(measured.clearanceX, 4);
});

test("disabled-only button artwork survives shared-template capture and instantiation into another page", () => {
  const source = structuredClone(ui);
  source.assets.push({
    id: "disabled-only",
    name: "Disabled",
    kind: "button",
    src: "/assets/button-normal.svg",
  });
  source.nodes.find((n) => n.id === "recruit-button").disabledAssetId =
    "disabled-only";
  const template = f.captureUIComponent(source, ["recruit-button"], "Button");
  assert.ok(template.assets.some((a) => a.id === "disabled-only"));
  const target = {
    ...structuredClone(ui),
    nodes: [],
    assets: [],
    reviews: [],
    history: [],
  };
  const result = f.instantiateUI(target, template);
  assert.equal(result.nodes[0].disabledAssetId, "disabled-only");
  assert.throws(
    () => validateProject({ ...result, interactions: { bad: true } }),
    /interactions/,
  );
  assert.throws(
    () =>
      validateProject({ ...result, translations: { en: { missing: "bad" } } }),
    /translation/,
  );
  validateProject(result);
});

test("deleting an interactive translated UI component prunes only its dangling references", () => {
  const source = structuredClone(ui);
  source.interactions = [
    {
      sourceId: "recruit-button",
      action: "toggle",
      targetId: "character-card",
    },
    { sourceId: "details-button", action: "page", targetId: "other-page" },
  ];
  source.translations = {
    en: { "recruit-button": "Recruit", "details-button": "Details" },
  };
  source.nodes = source.nodes.filter((n) => n.id !== "recruit-button");
  source.reviews = source.reviews.filter(r=>r.nodeId!=="recruit-button");
  assert.throws(() => validateProject(source), /interaction/);
  const clean = f.pruneUIReferences(source);
  validateProject(clean);
  assert.equal(clean.interactions.length, 1);
  assert.equal(clean.translations.en["recruit-button"], undefined);
  assert.equal(clean.translations.en["details-button"], "Details");
});
