import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createWorkspaceGodot } from "../server/godotSync.js";
import { createVillageMap } from "../src/mapModel.js";
import { decodePng } from "./compare-png.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  out = path.join(root, "artifacts/v0.3.0/godot-update"),
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "studio-godot-update-")),
  game = path.join(temp, "game"),
  incoming = path.join(temp, "update");
await fs.mkdir(out, { recursive: true });
await fs.mkdir(game);
await fs.mkdir(incoming);
const report = {
  passed: false,
  checks: [],
  nativeWindows: false,
  scope:
    "Actual Godot generated subdirectory under a user-owned scene, before and after incremental update",
};
const run = (label, exe, args) => {
  const p = spawnSync(exe, args, {
    encoding: "utf8",
    timeout: 120000,
    env: {
      ...process.env,
      XDG_DATA_HOME: path.join(temp, "data"),
      XDG_CONFIG_HOME: path.join(temp, "config"),
      XDG_CACHE_HOME: path.join(temp, "cache"),
    },
  });
  report.checks.push({
    label,
    status: p.status,
    stdout: p.stdout,
    stderr: p.stderr,
  });
  if (
    p.status !== 0 ||
    /SCRIPT ERROR|Parse Error|^ERROR:/m.test(p.stderr || "")
  )
    throw Error(label + ": " + (p.stderr || p.error));
  return p;
};
try {
  const ui = JSON.parse(
      await fs.readFile(path.join(root, "examples/character.project.json")),
    ),
    map = createVillageMap(),
    workspace = {
      id: "update-test",
      name: "Incremental game",
      uiPages: [ui],
      maps: [map],
    };
  const write = async () => {
    const g = await createWorkspaceGodot(workspace, (src) =>
      fs.readFile(path.join(root, "public", src)),
    );
    for (const [n, b] of Object.entries(g.files)) {
      const file = path.join(incoming, "incoming", n);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, b);
    }
    await fs.writeFile(path.join(incoming, "sync.mjs"), g.syncScript);
    await fs.writeFile(
      path.join(incoming, "incoming-manifest.json"),
      JSON.stringify(g.manifest),
    );
    await fs.writeFile(path.join(incoming, "starter-project.godot"), g.starter);
    return g;
  };
  const generated = await write();
  const userScript =
    'extends Node\nfunc _ready():\n    print("USER_GAMEPLAY_PRESERVED")\n';
  await fs.writeFile(path.join(game, "user_gameplay.gd"), userScript);
  const config = generated.starter.replace(
    /run\/main_scene="[^"]+"/,
    'run/main_scene="res://user_scene.tscn"',
  );
  await fs.writeFile(path.join(game, "project.godot"), config);
  const userScene =
    '[gd_scene load_steps=3 format=3]\n[ext_resource type="PackedScene" path="res://studio_generated/ui/ashfall/main.tscn" id="1"]\n[ext_resource type="Script" path="res://user_gameplay.gd" id="2"]\n[node name="UserGame" type="Node"]\nscript = ExtResource("2")\n[node name="DesignedUI" parent="." instance=ExtResource("1")]\n[node name="CustomGameNode" type="Node" parent="."]\nmetadata/user_authored = true\n';
  await fs.writeFile(path.join(game, "user_scene.tscn"), userScene);
  run("first managed import", process.execPath, [
    path.join(incoming, "sync.mjs"),
    "--project",
    game,
    "--apply",
  ]);
  run("Godot version", process.env.GODOT_BIN || "godot", ["--version"]);
  const engine = (label, scene, suffix) => {
    run(label + " resource import", process.env.GODOT_BIN || "godot", [
      "--headless",
      "--editor",
      "--path",
      game,
      "--import",
    ]);
    const result = path.join(out, suffix + ".json"),
      png = path.join(out, suffix + ".png");
    const p = run(label, process.env.GODOT_BIN || "godot", [
      "--path",
      game,
      "--audio-driver",
      "Dummy",
      "--rendering-method",
      "gl_compatibility",
      ...(scene ? [scene, "--resolution", "1280x800"] : []),
      "--",
      "--studio-verify",
      "--studio-result=" + result,
      "--studio-screenshot=" + png,
    ]);
    return fs.readFile(result, "utf8").then(async (text) => {
      const r = JSON.parse(text);
      if (!r.passed) throw Error(label + " assertions failed");
      const image = decodePng(await fs.readFile(png));
      return {
        passed: true,
        width: image.width,
        height: image.height,
        customGameplay: p.stdout.includes("USER_GAMEPLAY_PRESERVED"),
      };
    });
  };
  report.before = await engine(
    "original user-owned scene renders",
    null,
    "before",
  );
  if (!report.before.customGameplay) throw Error("User gameplay did not run");
  workspace.uiPages[0].nodes.find((n) => n.id === "recruit-button").style.text =
    "UPDATED WITH USER LOGIC";
  await write();
  run("incremental managed update", process.execPath, [
    path.join(incoming, "sync.mjs"),
    "--project",
    game,
    "--apply",
  ]);
  report.after = await engine(
    "updated user-owned scene renders",
    null,
    "after",
  );
  report.map = await engine(
    "managed native TileMapLayer map renders",
    "res://studio_generated/maps/village-gate/map.tscn",
    "map",
  );
  if (
    (await fs.readFile(path.join(game, "user_gameplay.gd"), "utf8")) !==
      userScript ||
    (await fs.readFile(path.join(game, "user_scene.tscn"), "utf8")) !==
      userScene ||
    (await fs.readFile(path.join(game, "project.godot"), "utf8")) !== config
  )
    throw Error("User files changed");
  report.userFilesPreserved = true;
  report.scriptSha256 = createHash("sha256").update(userScript).digest("hex");
  report.passed = true;
  console.log(
    "Godot update verification passed: original and updated user scenes, user gameplay script, native map and screenshots.",
  );
} catch (e) {
  report.error = e.message;
  process.exitCode = 1;
  console.error(e.message);
} finally {
  await fs.writeFile(
    path.join(out, "results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await fs.rm(temp, { recursive: true, force: true });
}
