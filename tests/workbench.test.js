import os from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { createStudioServer } from "../server/index.js";
async function setup(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),"studio-workbench-")),
    s = await createStudioServer({ dataDir: dir, vite: false });
  await new Promise((r) => s.httpServer.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${s.httpServer.address().port}`;
  const req = async (route, body) => {
    const r = await fetch(base + route, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  };
  const act = async (action, data = {}) => {
    const { data: v } = await req("/api/workbench");
    return req("/api/workbench/action", {
      action,
      data,
      libraryRevision: v.library.revision,
      uiRevision: v.uiRevision,
      mapRevision: v.mapRevision,
    });
  };
  try {
    await run({ dir, base, req, act });
  } finally {
    await new Promise((r) => s.httpServer.close(r));
    await s.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}
test("multiple projects/pages/maps persist independently and stale workspace writes are rejected", () =>
  setup(async ({ req, act, dir }) => {
    const initial = (await req("/api/workbench")).data;
    assert.equal(
      (await act("document-create", { kind: "ui", name: "Inventory" })).status,
      200,
    );
    let v = (await req("/api/workbench")).data;
    assert.equal(v.library.projects[0].uiPages.length, 2);
    assert.equal(
      (await act("document-open", { kind: "ui", id: "ashfall" })).status,
      200,
    );
    assert.equal((await req("/api/project")).data.id, "ashfall");
    assert.equal(
      (await act("project-create", { name: "Other game" })).status,
      200,
    );
    v = (await req("/api/workbench")).data;
    assert.equal(v.library.projects.length, 2);
    assert.equal(
      (await act("project-open", { id: "workspace-default" })).status,
      200,
    );
    assert.equal((await req("/api/project")).data.id, "ashfall");
    const stale = await req("/api/workbench/action", {
      action: "rename",
      data: { name: "wrong" },
      libraryRevision: initial.library.revision,
      uiRevision: initial.uiRevision,
      mapRevision: initial.mapRevision,
    });
    assert.equal(stale.status, 409);
    assert.equal(
      JSON.parse(await fs.readFile(path.join(dir, "workbench.json"))).projects
        .length,
      2,
    );
  }));
test("portable ZIP includes original resources and restores a separate project with local resource paths", () =>
  setup(async ({ req, act, base }) => {
    await act("capture-block", {
      name: "Inn",
      region: { x: 2, y: 2, width: 4, height: 4 },
    });
    const exported = (await req("/api/workbench/export", {})).data;
    const bytes = new Uint8Array(
        await (await fetch(base + exported.downloadUrl)).arrayBuffer(),
      ),
      zip = unzipSync(bytes);
    assert.ok(zip["workspace.json"]);
    assert.ok(Object.keys(zip).some((n) => n.endsWith(".ttf")));
    const restored = await req("/api/workbench/import", {
      base64: Buffer.from(bytes).toString("base64"),
    });
    assert.equal(restored.status, 200, restored.data.error);
    const projects = restored.data.library.projects;
    assert.equal(projects.length, 2);
    const project = projects.at(-1);
    assert.ok(
      project.uiPages[0].assets.every((a) =>
        a.src.startsWith("/local-assets/"),
      ),
    );
    assert.ok(
      project.maps[0].blocks[0].assets.every((a) =>
        a.src.startsWith("/local-assets/"),
      ),
    );
    const placed = await act("place-template", {
      templateId: project.templates[0].id,
      x: 8,
      y: 8,
    });
    assert.equal(placed.status, 200, placed.data.error);
  }));
test("workspace APIs configure atlas, terrain, references, behaviors, slices and button states without crossing doc scopes", () =>
  setup(async ({ req, act }) => {
    assert.equal(
      (
        await act("atlas-split", {
          assetId: "grass",
          sourceWidth: 64,
          sourceHeight: 32,
          width: 32,
          height: 16,
          margin: 0,
          spacing: 0,
        })
      ).data.details.count,
      4,
    );
    assert.equal(
      (
        await act("terrain-rule", {
          name: "Road",
          variants: { 0: "grass", 2: "path", 8: "path", 10: "stone" },
        })
      ).status,
      200,
    );
    const p = (await req("/api/workbench")).data.library.projects[0];
    assert.equal(
      (
        await act("terrain-stroke", {
          layerId: "ground",
          points: [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
          ],
          ruleId: p.terrainRules[0].id,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await act("reference", {
          reference: {
            assetId: "house",
            x: 0,
            y: 0,
            width: 160,
            height: 160,
            opacity: 0.3,
            visible: true,
            locked: true,
          },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await act("ui-behavior", {
          interactions: [
            {
              sourceId: "recruit-button",
              action: "toggle",
              targetId: "character-card",
            },
          ],
          translations: { "zh-CN": { "recruit-button": "招募" } },
        })
      ).status,
      200,
    );
    const ui = (await req("/api/project")).data;
    assert.equal(ui.translations["zh-CN"]["recruit-button"], "招募");
    const asset = ui.assets.find((a) => a.kind === "nineSlice");
    assert.equal(
      (
        await act("nine-slice", {
          assetId: asset.id,
          margins: { left: 8, right: 8, top: 8, bottom: 8 },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await act("button-states", {
          nodeId: "recruit-button",
          normal: "button-normal",
          hover: "button-hover",
          pressed: "button-pressed",
          disabled: "button-normal",
        })
      ).status,
      200,
    );
  }));
