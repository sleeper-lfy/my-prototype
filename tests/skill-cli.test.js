import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { zipSync, strToU8, unzipSync } from "fflate";
import { createStudioServer } from "../server/index.js";
import { buildFeedback } from "../src/model.js";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, ".agents/skills/game-ui-studio/scripts/review.mjs");
const artifact = (name) => path.join(root, "artifacts", name);
const feedbackZip = artifact("feedback-sample.zip");
const patchFile = artifact("applied.patch.json");
const projectFile = artifact("feedback-project.json");
const readJson = (filename) => fs.readFile(filename, "utf8").then(JSON.parse);

async function temporary(run) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "studio skill test "),
  );
  try {
    await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function command(args, options = {}) {
  try {
    const result = await exec(
      process.execPath,
      [options.script || cli, ...args],
      {
        cwd: options.cwd || root,
        env: { ...process.env, GAME_UI_STUDIO_ROOT: "", ...options.env },
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    return { code: 0, data: JSON.parse(result.stdout), stderr: result.stderr };
  } catch (error) {
    if (typeof error.code !== "number") throw error;
    return {
      code: error.code,
      data: JSON.parse(error.stderr),
      stdout: error.stdout,
    };
  }
}

test("skill inspects and validates the actual feedback package without mutating source files", async () => {
  const before = await fs.readFile(projectFile);
  const inspection = await command(["inspect", "--feedback", feedbackZip]);
  assert.equal(inspection.code, 0, JSON.stringify(inspection.data));
  assert.equal(inspection.data.baseRevision, 9);
  assert.equal(inspection.data.media.available.length, 2);
  assert.equal(inspection.data.media.visualReviewPerformed, false);
  const scoped = await command([
    "validate",
    "--feedback",
    feedbackZip,
    "--patch",
    patchFile,
  ]);
  assert.equal(scoped.code, 0);
  assert.equal(scoped.data.currentProjectVerified, false);
  const full = await command([
    "validate",
    "--feedback",
    feedbackZip,
    "--patch",
    patchFile,
    "--project",
    projectFile,
  ]);
  assert.equal(full.code, 0, JSON.stringify(full.data));
  assert.equal(full.data.currentProjectVerified, true);
  assert.equal(full.data.onlineProjectVerified, false);
  assert.deepEqual(
    full.data.changes.map((change) => [
      change.nodeId,
      change.path,
      change.before,
      change.after,
    ]),
    [["recruit-button", "style.text", "RECRUIT HERO", "RECRUIT · 240"]],
  );
  assert.deepEqual(await fs.readFile(projectFile), before);
});

test("skill rejects protected, stale, unreviewed and invalid full-model changes", async () =>
  temporary(async (directory) => {
    const original = await readJson(patchFile);
    const cases = [
      {
        patch: {
          ...original,
          changes: [{ nodeId: "recruit-button", set: { "frame.width": 500 } }],
        },
        error: /Protected/,
      },
      { patch: { ...original, baseRevision: 1 }, error: /revision/ },
      {
        patch: {
          ...original,
          changes: [
            { nodeId: "character-card", set: { "style.stroke": "#ffffff" } },
          ],
        },
        error: /Unreviewed/,
      },
      {
        patch: {
          ...original,
          changes: [{ nodeId: "recruit-button", set: { "style.text": false } }],
        },
        error: /Invalid value/,
      },
    ];
    for (let index = 0; index < cases.length; index++) {
      const filename = path.join(directory, `bad-${index}.json`);
      await fs.writeFile(filename, JSON.stringify(cases[index].patch));
      const result = await command([
        "validate",
        "--feedback",
        feedbackZip,
        "--patch",
        filename,
        "--project",
        projectFile,
      ]);
      assert.equal(result.code, 1);
      assert.match(result.data.error, cases[index].error);
    }
    const staleProject = await readJson(projectFile);
    staleProject.revision++;
    const staleFilename = path.join(directory, "stale-project.json");
    await fs.writeFile(staleFilename, JSON.stringify(staleProject));
    const stale = await command([
      "validate",
      "--feedback",
      feedbackZip,
      "--patch",
      patchFile,
      "--project",
      staleFilename,
    ]);
    assert.equal(stale.code, 1);
    assert.match(stale.data.error, /does not match feedback/);
  }));

test("offline preview creates only a new file and extraction never overwrites a directory", async () =>
  temporary(async (directory) => {
    const original = await fs.readFile(projectFile);
    const output = path.join(directory, "preview project.json");
    const args = [
      "preview",
      "--feedback",
      feedbackZip,
      "--patch",
      patchFile,
      "--project",
      projectFile,
      "--out",
      output,
    ];
    const preview = await command(args);
    assert.equal(preview.code, 0, JSON.stringify(preview.data));
    const saved = await readJson(output);
    assert.equal(saved.revision, 10);
    assert.equal(
      saved.reviews.find((review) => review.id === "review-cta").status,
      "modified",
    );
    assert.equal(
      saved.nodes.find((node) => node.id === "recruit-button").style.text,
      "RECRUIT · 240",
    );
    assert.deepEqual(await fs.readFile(projectFile), original);
    const duplicate = await command(args);
    assert.equal(duplicate.code, 1);
    assert.match(duplicate.data.error, /EEXIST/);
    const forbidden = await command([
      ...args.slice(0, -1),
      path.join(directory, "data/project.json"),
    ]);
    assert.equal(forbidden.code, 1);
    assert.match(forbidden.data.error, /active/);
    const extracted = path.join(directory, "new parent", "feedback unpacked");
    const extractArgs = [
      "inspect",
      "--feedback",
      feedbackZip,
      "--extract",
      extracted,
    ];
    assert.equal((await command(extractArgs)).code, 0);
    assert.ok(
      (await fs.stat(path.join(extracted, "screenshots/recruit-button.png")))
        .size > 1000,
    );
    assert.equal((await command(extractArgs)).code, 1);
  }));

test("JSON-only feedback reports missing images and retains effective restrictions", async () =>
  temporary(async (directory) => {
    const files = unzipSync(new Uint8Array(await fs.readFile(feedbackZip)));
    const feedback = JSON.parse(
      Buffer.from(files["feedback.json"]).toString("utf8"),
    );
    feedback.effectiveProtectedProperties["recruit-button"].push("style.text");
    const filename = path.join(directory, "feedback.json");
    await fs.writeFile(filename, JSON.stringify(feedback));
    const result = await command(["inspect", "--feedback", filename]);
    assert.equal(result.code, 0);
    assert.equal(result.data.media.available.length, 0);
    assert.deepEqual(result.data.media.missing.sort(), [
      "character-card",
      "recruit-button",
    ]);
    assert.equal(result.data.media.visualReviewPerformed, false);
    const patch = await command([
      "validate",
      "--feedback",
      filename,
      "--patch",
      patchFile,
    ]);
    assert.equal(patch.code, 1);
    assert.match(patch.data.error, /Protected property/);
  }));

test("ZIP inspection rejects traversal, Windows paths, duplicate targets and expansion bombs before extraction", async () =>
  temporary(async (directory) => {
    const original = unzipSync(new Uint8Array(await fs.readFile(feedbackZip)));
    for (const [index, name] of [
      "../escape.txt",
      "/absolute.txt",
      "C:/drive.txt",
      "assets\\escape.txt",
      "CON.txt",
    ].entries()) {
      const filename = path.join(directory, `unsafe-${index}.zip`);
      await fs.writeFile(
        filename,
        zipSync({ ...original, [name]: strToU8("unsafe") }),
      );
      const result = await command([
        "inspect",
        "--feedback",
        filename,
        "--extract",
        path.join(directory, "unpacked"),
      ]);
      assert.equal(result.code, 1, name);
      assert.match(result.data.error, /Unsafe archive path/);
    }
    const duplicate = path.join(directory, "duplicate.zip");
    await fs.writeFile(
      duplicate,
      zipSync({ ...original, "FEEDBACK.JSON": original["feedback.json"] }),
    );
    assert.match(
      (await command(["inspect", "--feedback", duplicate])).data.error,
      /Duplicate archive target/,
    );
    const bomb = path.join(directory, "too-large.zip");
    await fs.writeFile(
      bomb,
      zipSync({
        "feedback.json": original["feedback.json"],
        "large.bin": new Uint8Array(17 * 1024 * 1024),
      }),
    );
    const rejected = await command(["inspect", "--feedback", bomb]);
    assert.equal(rejected.code, 1);
    assert.match(rejected.data.error, /size limit/);
    await assert.rejects(fs.stat(path.join(directory, "unpacked")), {
      code: "ENOENT",
    });
  }));

test("installed skill works outside the checkout with spaces via explicit root or environment root", async () =>
  temporary(async (directory) => {
    const script = path.join(directory, "Installed Skill", "review.mjs");
    await fs.mkdir(path.dirname(script));
    await fs.copyFile(cli, script);
    const args = [
      "validate",
      "--feedback",
      feedbackZip,
      "--patch",
      patchFile,
      "--project",
      projectFile,
    ];
    const explicit = await command([...args, "--root", root], {
      cwd: directory,
      script,
    });
    assert.equal(explicit.code, 0, JSON.stringify(explicit.data));
    const environment = await command(args, {
      cwd: directory,
      script,
      env: { GAME_UI_STUDIO_ROOT: root },
    });
    assert.equal(environment.code, 0);
    const spacedRoot = path.join(directory, "Application Root With Spaces");
    await fs.mkdir(path.join(spacedRoot, "src"), { recursive: true });
    await fs.writeFile(
      path.join(spacedRoot, "package.json"),
      JSON.stringify({ name: "game-ui-studio", type: "module" }),
    );
    await fs.copyFile(
      path.join(root, "src/model.js"),
      path.join(spacedRoot, "src/model.js"),
    );
    await fs.cp(
      path.join(root, "node_modules/fflate"),
      path.join(spacedRoot, "node_modules/fflate"),
      { recursive: true },
    );
    const spaced = await command([...args, "--root", spacedRoot], {
      cwd: directory,
      script,
    });
    assert.equal(spaced.code, 0, JSON.stringify(spaced.data));
    const missing = await command(args, { cwd: directory, script });
    assert.equal(missing.code, 1);
    assert.match(missing.data.error, /Cannot locate/);
  }));

test("online CLI applies via server, rejects replay, and rolls back persisted reviewed fields", async () =>
  temporary(async (directory) => {
    const studio = await createStudioServer({
      dataDir: path.join(directory, "data"),
      vite: false,
    });
    const server = await new Promise((resolve) => {
      const listening = studio.app.listen(0, "127.0.0.1", () =>
        resolve(listening),
      );
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const get = async () => (await fetch(origin + "/api/project")).json();
    try {
      const project = await get();
      const feedback = path.join(directory, "feedback.json"),
        patch = path.join(directory, "patch.json");
      await fs.writeFile(feedback, JSON.stringify(buildFeedback(project)));
      await fs.copyFile(path.join(root, "examples/recruit.patch.json"), patch);
      const result = await command([
        "apply",
        "--feedback",
        feedback,
        "--patch",
        patch,
        "--url",
        origin,
      ]);
      assert.equal(result.code, 0, JSON.stringify(result.data));
      assert.equal(result.data.status, "applied");
      assert.equal(result.data.reviewStatuses["review-cta"], "modified");
      const disk = await readJson(path.join(directory, "data/project.json"));
      assert.equal(disk.revision, project.revision + 1);
      assert.equal(
        disk.nodes.find((node) => node.id === "recruit-button").style.text,
        "RECRUIT · 240",
      );
      const replay = await command([
        "apply",
        "--feedback",
        feedback,
        "--patch",
        patch,
        "--url",
        origin,
      ]);
      assert.equal(replay.code, 1);
      const rolledBack = await command([
        "rollback",
        "--history-id",
        result.data.historyId,
        "--url",
        origin,
      ]);
      assert.equal(rolledBack.code, 0, JSON.stringify(rolledBack.data));
      assert.equal(rolledBack.data.reviewStatuses["review-cta"], "pending");
      assert.equal(
        (await get()).nodes.find((node) => node.id === "recruit-button").style
          .text,
        "RECRUIT HERO",
      );
      const remote = await command([
        "rollback",
        "--history-id",
        result.data.historyId,
        "--url",
        "https://example.com",
      ]);
      assert.equal(remote.code, 1);
      assert.match(remote.data.error, /localhost/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await studio.close();
    }
  }));
