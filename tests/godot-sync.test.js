import os from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createWorkspaceGodot, planGodotSync } from "../server/godotSync.js";
import { createVillageMap } from "../src/mapModel.js";
const exec = promisify(execFile),
  ui = JSON.parse(
    await fs.readFile(
      new URL("../examples/character.project.json", import.meta.url),
    ),
  );
async function writeUpdate(dir, generated) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "sync.mjs"), generated.syncScript);
  await fs.writeFile(
    path.join(dir, "incoming-manifest.json"),
    JSON.stringify(generated.manifest),
  );
  await fs.writeFile(
    path.join(dir, "starter-project.godot"),
    generated.starter,
  );
  for (const [n, b] of Object.entries(generated.files)) {
    const file = path.join(dir, "incoming", n);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, b);
  }
}
const readAsset = (src) =>
  fs.readFile(new URL("../public" + src, import.meta.url));
test("incremental Godot sync previews conflicts, preserves user scripts, accepts only explicit paths and backs up modified generated scenes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studio-sync-")),
    target = path.join(dir, "game"),
    update = path.join(dir, "update");
  try {
    await fs.mkdir(target);
    await fs.writeFile(
      path.join(target, "player.gd"),
      "extends Node\n# user gameplay",
    );
    const workspace = {
        id: "game",
        name: "Game",
        uiPages: [ui],
        maps: [createVillageMap()],
      },
      first = await createWorkspaceGodot(workspace, readAsset);
    await writeUpdate(update, first);
    const run = (...args) =>
      exec(process.execPath, [
        path.join(update, "sync.mjs"),
        "--project",
        target,
        ...args,
      ]);
    const preview = await run();
    assert.match(preview.stdout, /"action": "write"/);
    await run("--apply");
    assert.equal(
      await fs.readFile(path.join(target, "player.gd"), "utf8"),
      "extends Node\n# user gameplay",
    );
    const scene = "studio_generated/ui/ashfall/main.tscn";
    await fs.appendFile(path.join(target, scene), "\n# user change\n");
    workspace.uiPages = structuredClone(workspace.uiPages);
    workspace.uiPages[0].nodes.find(
      (n) => n.id === "recruit-button",
    ).style.text = "New label";
    const second = await createWorkspaceGodot(workspace, readAsset);
    await writeUpdate(update, second);
    assert.match((await run()).stdout, /"action": "conflict"/);
    await assert.rejects(() => run("--apply"), /Unaccepted conflicts/);
    assert.match(
      await fs.readFile(path.join(target, scene), "utf8"),
      /# user change/,
    );
    await run("--apply", "--accept", scene);
    assert.match(
      await fs.readFile(path.join(target, scene), "utf8"),
      /New label/,
    );
    const backups = await fs.readdir(path.join(target, ".studio-backups"));
    assert.ok(backups.length);
    assert.match(
      await fs.readFile(
        path.join(target, ".studio-backups", backups.at(-1), scene),
        "utf8",
      ),
      /# user change/,
    );
    assert.equal(
      await fs.readFile(path.join(target, "player.gd"), "utf8"),
      "extends Node\n# user gameplay",
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("sync plan never accepts unmanaged paths and flags locally modified generated files", () => {
  assert.throws(
    () =>
      planGodotSync({ files: {} }, { files: { "../player.gd": "new" } }, {}),
    /Invalid/,
  );
  assert.throws(
    () => planGodotSync({ files: {} }, { files: { "player.gd": "new" } }, {}),
    /Invalid/,
  );
  assert.equal(
    planGodotSync(
      { files: { "studio_generated/main.tscn": "old" } },
      { files: { "studio_generated/main.tscn": "new" } },
      { "studio_generated/main.tscn": "user" },
    )[0].action,
    "conflict",
  );
});
test("starter opens the active page or map with the matching viewport", async () => {
  const inactive = structuredClone(ui);
  inactive.id = "inactive-page";
  const active = structuredClone(ui);
  active.canvas.width = 1440;
  active.canvas.height = 900;
  const map = createVillageMap();
  const otherMap = structuredClone(map);
  otherMap.id = "inactive-map";
  const workspace = {
    id: "game",
    name: "Game",
    uiPages: [inactive, active],
    maps: [otherMap, map],
    activeUIId: active.id,
    activeMapId: map.id,
  };
  const readAsset = async () => Buffer.from("test asset");
  const generated = await createWorkspaceGodot(workspace, readAsset);
  assert.ok(
    generated.starter.includes(
      `res://studio_generated/ui/${active.id}/main.tscn`,
    ),
  );
  assert.match(
    generated.starter,
    /viewport_width=1440\nwindow\/size\/viewport_height=900/,
  );
  const mapExport = await createWorkspaceGodot(workspace, readAsset, {
    kind: "map",
  });
  assert.ok(
    mapExport.starter.includes(
      `res://studio_generated/maps/${map.id}/map.tscn`,
    ),
  );
  assert.match(
    mapExport.starter,
    /viewport_width=1280\nwindow\/size\/viewport_height=800/,
  );
});
