#!/usr/bin/env node
/** Local review bridge. All document semantics come from the checked-out app model. */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";

const SELF = fileURLToPath(import.meta.url);
const MAX_ARCHIVE = 32 * 1024 * 1024;
const MAX_EXPANDED = 64 * 1024 * 1024;
const MAX_JSON = 16 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const validId = (value) => typeof value === "string" && ID.test(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const requireThat = (condition, message) => {
  if (!condition) throw new Error(message);
};

export const HELP = `Game UI Studio review CLI (Node >=22.12; Node 24 recommended)

inspect  --feedback <zip|json> [--extract <new-directory>]
validate --feedback <zip|json> --patch <json> [--project <complete-project.json>]
preview  --feedback <zip|json> --patch <json> --project <json> --out <new-file.json>
apply    --feedback <zip|json> --patch <json> [--url http://127.0.0.1:4380]
rollback --history-id <id> [--url http://127.0.0.1:4380]

All commands accept --root <Game-UI-Studio-checkout>.
Root discovery: --root, GAME_UI_STUDIO_ROOT, cwd ancestors, script ancestors.
Paths resolve from the current working directory, including paths with spaces.
inspect never claims screenshots were visually reviewed. validate without a full
project checks feedback scope only. preview writes a NEW file and never edits the
active project. apply/rollback use the local server; they never mark work approved.
No annotation, instruction file, or asset from a feedback package is executed.
`;

function parseArgs(argv) {
  if (!argv.length || argv.includes("--help") || argv.includes("-h"))
    return { help: true };
  const [command, ...rest] = argv;
  const allowed = {
    inspect: ["root", "feedback", "extract"],
    validate: ["root", "feedback", "patch", "project"],
    preview: ["root", "feedback", "patch", "project", "out"],
    apply: ["root", "feedback", "patch", "url"],
    rollback: ["root", "history-id", "url"],
  };
  requireThat(
    own(allowed, command),
    `Unknown command: ${command}. Use --help.`,
  );
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    requireThat(
      key.startsWith("--") && allowed[command].includes(key.slice(2)),
      `Unknown option: ${key}`,
    );
    requireThat(!own(options, key.slice(2)), `Repeated option: ${key}`);
    requireThat(
      rest[index + 1] && !rest[index + 1].startsWith("--"),
      `Missing value for ${key}`,
    );
    options[key.slice(2)] = rest[index + 1];
  }
  const required = {
    inspect: ["feedback"],
    validate: ["feedback", "patch"],
    preview: ["feedback", "patch", "project", "out"],
    apply: ["feedback", "patch"],
    rollback: ["history-id"],
  };
  for (const key of required[command])
    requireThat(options[key], `Missing required --${key}`);
  return { command, options };
}

async function isRoot(candidate) {
  try {
    const pkg = JSON.parse(
      await fs.readFile(path.join(candidate, "package.json"), "utf8"),
    );
    return (
      pkg.name === "game-ui-studio" &&
      (await fs.stat(path.join(candidate, "src/model.js"))).isFile()
    );
  } catch {
    return false;
  }
}

export async function discoverRoot(explicit) {
  const preferred = explicit || process.env.GAME_UI_STUDIO_ROOT;
  if (preferred) {
    const resolved = await fs.realpath(path.resolve(preferred));
    requireThat(
      await isRoot(resolved),
      "Selected root is not a Game UI Studio checkout (package.name and src/model.js are required).",
    );
    return resolved;
  }
  for (const start of [process.cwd(), path.dirname(SELF)]) {
    let candidate = path.resolve(start);
    while (true) {
      if (await isRoot(candidate)) return fs.realpath(candidate);
      const parent = path.dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
  }
  throw new Error(
    "Cannot locate Game UI Studio. Pass --root or set GAME_UI_STUDIO_ROOT.",
  );
}

async function loadRuntime(root) {
  const model = await import(
    pathToFileURL(path.join(root, "src/model.js")).href
  );
  const localRequire = createRequire(path.join(root, "package.json"));
  let zip;
  try {
    zip = await import(pathToFileURL(localRequire.resolve("fflate")).href);
  } catch {
    throw new Error(
      "Game UI Studio dependencies are missing. Run npm ci in the application checkout.",
    );
  }
  return { model, unzipSync: zip.unzipSync || zip.default?.unzipSync };
}

async function readLimited(filename, limit) {
  const stat = await fs.stat(filename);
  requireThat(
    stat.isFile() && stat.size <= limit,
    `File is not regular or exceeds ${limit} bytes: ${filename}`,
  );
  return fs.readFile(filename);
}

function assertPlainJson(value, depth = 0) {
  requireThat(depth <= 40, "JSON nesting exceeds the supported limit.");
  if (value === null || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    requireThat(
      !["__proto__", "constructor", "prototype"].includes(key),
      `Unsafe JSON key: ${key}`,
    );
    assertPlainJson(value[key], depth + 1);
  }
}

async function readJson(filename) {
  const value = JSON.parse(
    (await readLimited(filename, MAX_JSON))
      .toString("utf8")
      .replace(/^\uFEFF/, ""),
  );
  assertPlainJson(value);
  return value;
}

export function safeArchivePath(name) {
  requireThat(
    typeof name === "string" &&
      name.length > 0 &&
      !name.includes("\\") &&
      !name.startsWith("/") &&
      !name.includes(":") &&
      !/[\x00-\x1f<>"|?*]/.test(name),
    `Unsafe archive path: ${name}`,
  );
  const pieces = name.replace(/\/$/, "").split("/");
  requireThat(
    pieces.every(
      (piece) =>
        piece &&
        piece !== "." &&
        piece !== ".." &&
        !/[ .]$/.test(piece) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(piece),
    ),
    `Unsafe archive path: ${name}`,
  );
  return name;
}

function centralDirectory(bytes) {
  requireThat(bytes.length >= 22, "Invalid ZIP file.");
  let end = -1;
  for (
    let index = bytes.length - 22;
    index >= Math.max(0, bytes.length - 65557);
    index--
  ) {
    if (
      bytes.readUInt32LE(index) === 0x06054b50 &&
      index + 22 + bytes.readUInt16LE(index + 20) === bytes.length
    ) {
      end = index;
      break;
    }
  }
  requireThat(end >= 0, "ZIP end record is missing.");
  requireThat(
    bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0,
    "Multipart ZIP files are unsupported.",
  );
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  const offset = bytes.readUInt32LE(end + 16);
  requireThat(
    count > 0 &&
      count <= 4096 &&
      bytes.readUInt16LE(end + 8) === count &&
      size !== 0xffffffff &&
      offset !== 0xffffffff &&
      offset + size <= end,
    "ZIP64, excessive entries, or malformed ZIP directory.",
  );
  let position = offset,
    expanded = 0;
  const entries = [],
    seen = new Set();
  for (let index = 0; index < count; index++) {
    requireThat(
      position + 46 <= offset + size &&
        bytes.readUInt32LE(position) === 0x02014b50,
      "Invalid ZIP central directory.",
    );
    const flags = bytes.readUInt16LE(position + 8),
      method = bytes.readUInt16LE(position + 10);
    const compressed = bytes.readUInt32LE(position + 20),
      original = bytes.readUInt32LE(position + 24);
    const filenameLength = bytes.readUInt16LE(position + 28),
      extraLength = bytes.readUInt16LE(position + 30),
      commentLength = bytes.readUInt16LE(position + 32);
    const next = position + 46 + filenameLength + extraLength + commentLength;
    requireThat(
      next <= offset + size && !(flags & 1) && [0, 8].includes(method),
      "Encrypted or unsupported ZIP entry.",
    );
    const name = safeArchivePath(
      bytes.toString("utf8", position + 46, position + 46 + filenameLength),
    );
    const key = name.replace(/\/$/, "").toLowerCase();
    requireThat(!seen.has(key), `Duplicate archive target: ${name}`);
    seen.add(key);
    expanded += original;
    requireThat(
      compressed !== 0xffffffff &&
        original <= MAX_JSON &&
        expanded <= MAX_EXPANDED,
      "ZIP expands beyond the supported size limit.",
    );
    const mode = bytes.readUInt32LE(position + 38) >>> 16;
    requireThat((mode & 0xf000) !== 0xa000, "ZIP symlinks are unsupported.");
    entries.push({ name, original, crc: bytes.readUInt32LE(position + 16) });
    position = next;
  }
  requireThat(
    position === offset + size,
    "Unexpected ZIP central directory data.",
  );
  return entries;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validateFeedback(feedback) {
  assertPlainJson(feedback);
  requireThat(
    record(feedback) &&
      feedback.schemaVersion === 1 &&
      validId(feedback.projectId) &&
      Number.isSafeInteger(feedback.baseRevision) &&
      feedback.baseRevision >= 0,
    "Invalid feedback project or schema.",
  );
  requireThat(
    Array.isArray(feedback.reviews) &&
      Array.isArray(feedback.nodes) &&
      Array.isArray(feedback.context) &&
      record(feedback.tokens) &&
      record(feedback.effectiveProtectedProperties),
    "Feedback is missing review, node, context, token, or effective restriction data.",
  );
  const ids = new Set();
  for (const node of [...feedback.nodes, ...feedback.context]) {
    requireThat(
      record(node) &&
        validId(node.id) &&
        !ids.has(node.id) &&
        typeof node.type === "string" &&
        (node.parentId === null || validId(node.parentId)),
      "Feedback has missing, invalid, or duplicate component IDs/types.",
    );
    ids.add(node.id);
  }
  const targets = new Set(feedback.nodes.map((node) => node.id)),
    reviewIds = new Set();
  for (const review of feedback.reviews) {
    requireThat(
      record(review) &&
        validId(review.id) &&
        !reviewIds.has(review.id) &&
        targets.has(review.nodeId) &&
        review.status === "pending" &&
        Array.isArray(review.protectedProperties) &&
        review.protectedProperties.every((value) => typeof value === "string"),
      "Feedback must contain unique pending reviews and their target components.",
    );
    requireThat(
      typeof review.expected === "string" && typeof review.target === "string",
      "Feedback review lacks target/expected text.",
    );
    reviewIds.add(review.id);
  }
  for (const nodeId of targets)
    requireThat(
      Array.isArray(feedback.effectiveProtectedProperties[nodeId]) &&
        feedback.effectiveProtectedProperties[nodeId].every(
          (value) => typeof value === "string",
        ),
      `Missing effective restrictions for ${nodeId}.`,
    );
  requireThat(
    Array.isArray(feedback.allowedProperties) &&
      feedback.allowedProperties.every((value) => typeof value === "string"),
    "Feedback lacks its allowed property list.",
  );
  return feedback;
}

export async function loadFeedback(filename, runtime) {
  const absolute = path.resolve(filename);
  let files = null,
    feedback;
  if (path.extname(absolute).toLowerCase() === ".zip") {
    const bytes = await readLimited(absolute, MAX_ARCHIVE);
    const entries = centralDirectory(bytes);
    const decoded = runtime.unzipSync(new Uint8Array(bytes));
    files = new Map();
    for (const entry of entries) {
      const value = decoded[entry.name];
      requireThat(
        value && value.length === entry.original && crc32(value) === entry.crc,
        `ZIP size/checksum mismatch: ${entry.name}`,
      );
      files.set(entry.name, Buffer.from(value));
    }
    requireThat(files.has("feedback.json"), "ZIP has no root feedback.json.");
    feedback = JSON.parse(files.get("feedback.json").toString("utf8"));
  } else feedback = await readJson(absolute);
  validateFeedback(feedback);
  const media = {
    declared: 0,
    available: [],
    missing: [],
    visualReviewPerformed: false,
  };
  for (const nodeId of new Set(
    feedback.reviews.map((review) => review.nodeId),
  )) {
    const reference = feedback.screenshots?.[nodeId];
    media.declared++;
    if (typeof reference !== "string") {
      media.missing.push(nodeId);
      continue;
    }
    let bytes;
    if (reference.startsWith("data:image/png;base64,"))
      bytes = Buffer.from(reference.slice(22), "base64");
    else {
      safeArchivePath(reference);
      if (files) bytes = files.get(reference);
      else {
        try {
          bytes = await readLimited(
            path.resolve(path.dirname(absolute), reference),
            MAX_JSON,
          );
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
    if (bytes?.subarray(0, 8).equals(PNG_SIGNATURE))
      media.available.push({
        nodeId,
        reference: reference.startsWith("data:") ? "embedded PNG" : reference,
      });
    else media.missing.push(nodeId);
  }
  return { feedback, files, media, filename: absolute };
}

const restricts = (field, prefix) =>
  field === prefix ||
  field.startsWith(`${prefix}.`) ||
  prefix.startsWith(`${field}.`);

export function lintFeedbackPatch(feedback, patch, model) {
  validateFeedback(feedback);
  assertPlainJson(patch);
  requireThat(
    record(patch) &&
      patch.schemaVersion === 1 &&
      patch.projectId === feedback.projectId,
    "Patch does not match the feedback project/schema.",
  );
  requireThat(
    patch.baseRevision === feedback.baseRevision,
    "Stale/mismatched patch revision: export new feedback; do not rewrite baseRevision.",
  );
  requireThat(
    typeof patch.summary === "string" && patch.summary.trim(),
    "Patch summary is required.",
  );
  requireThat(
    Array.isArray(patch.reviewIds) &&
      patch.reviewIds.length &&
      new Set(patch.reviewIds).size === patch.reviewIds.length,
    "Patch requires unique pending review IDs.",
  );
  requireThat(
    Array.isArray(patch.changes) && patch.changes.length,
    "Patch contains no changes.",
  );
  const reviews = new Map(
    feedback.reviews.map((review) => [review.id, review]),
  );
  const selected = patch.reviewIds.map((id) => {
    requireThat(
      reviews.has(id),
      `Review ${id} is not a pending item in this feedback.`,
    );
    return reviews.get(id);
  });
  const targets = new Set(selected.map((review) => review.nodeId));
  const nodes = new Map(
    [...feedback.nodes, ...feedback.context].map((node) => [node.id, node]),
  );
  const allowed = new Set(
    feedback.allowedProperties.filter((field) =>
      model.PATCH_FIELDS.includes(field),
    ),
  );
  const changed = new Set(),
    seen = new Set();
  for (const change of patch.changes) {
    requireThat(
      record(change) && targets.has(change.nodeId),
      `Unreviewed component: ${change?.nodeId}`,
    );
    requireThat(
      record(change.set) && Object.keys(change.set).length,
      "Each patch change needs explicit scalar properties.",
    );
    const node = nodes.get(change.nodeId);
    const chain = new Set();
    let current = node;
    while (current) {
      requireThat(!chain.has(current.id), "Feedback parent cycle.");
      chain.add(current.id);
      requireThat(
        !current.locked,
        `Locked component or ancestor: ${current.id}`,
      );
      current = nodes.get(current.parentId);
    }
    const protections = [
      ...feedback.effectiveProtectedProperties[node.id],
      ...feedback.reviews
        .filter((review) => review.nodeId === node.id)
        .flatMap((review) => review.protectedProperties),
    ];
    for (const [field, value] of Object.entries(change.set)) {
      requireThat(allowed.has(field), `Unsupported patch property: ${field}`);
      requireThat(
        value === null ||
          ["string", "number", "boolean"].includes(typeof value),
        `Patch values must be scalar: ${field}`,
      );
      requireThat(
        typeof value !== "number" || Number.isFinite(value),
        `Invalid number: ${field}`,
      );
      requireThat(
        !protections.some((prefix) => restricts(field, prefix)),
        `Protected property: ${node.id}.${field}`,
      );
      requireThat(
        !(
          ["frame.x", "frame.y"].includes(field) &&
          nodes.get(node.parentId)?.type.endsWith("Container")
        ),
        `Container controls the position of ${node.id}.`,
      );
      const key = `${node.id}:${field}`;
      requireThat(!seen.has(key), `Duplicate property change: ${key}`);
      seen.add(key);
      changed.add(node.id);
    }
  }
  requireThat(
    selected.every((review) => changed.has(review.nodeId)),
    "Every addressed review must have a component change.",
  );
  return {
    projectId: patch.projectId,
    baseRevision: patch.baseRevision,
    reviewIds: patch.reviewIds,
    nodeIds: [...changed],
    propertyCount: seen.size,
  };
}

function validateAgainstProject(project, feedback, patch, model) {
  model.validateProject(project);
  requireThat(
    project.id === feedback.projectId &&
      project.revision === feedback.baseRevision,
    "Complete project does not match feedback project/revision. Export fresh feedback instead of rebasing the patch.",
  );
  for (const node of feedback.nodes)
    requireThat(
      isDeepStrictEqual(
        project.nodes.find((item) => item.id === node.id),
        node,
      ),
      `Feedback snapshot differs from complete project component ${node.id}.`,
    );
  for (const review of feedback.reviews)
    requireThat(
      isDeepStrictEqual(
        project.reviews.find((item) => item.id === review.id),
        review,
      ),
      `Feedback review ${review.id} differs from the complete project.`,
    );
  requireThat(
    isDeepStrictEqual(project.tokens, feedback.tokens),
    "Feedback design tokens differ from the complete project.",
  );
  return model.applyPatch(project, patch);
}

export function localUrl(value = "http://127.0.0.1:4380") {
  const url = new URL(value);
  requireThat(
    url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash,
    "Use only an HTTP localhost/127.0.0.1 origin without credentials or a path.",
  );
  return url.origin;
}

async function request(origin, endpoint, body) {
  const response = await fetch(origin + endpoint, {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const text = await response.text();
  requireThat(text.length <= MAX_JSON, "Local server response is too large.");
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Local server returned non-JSON (${response.status}).`);
  }
  requireThat(
    response.ok,
    result.error || `Local server returned ${response.status}.`,
  );
  return result;
}

function operationResult(project, kind, previousIds) {
  const entry = [...project.history]
    .reverse()
    .find((item) => item.kind === kind && !previousIds.has(item.id));
  requireThat(
    entry,
    "Server response did not contain a new operation history entry.",
  );
  return {
    projectId: project.id,
    revision: project.revision,
    historyId: entry.id,
    changes: entry.changes,
    reviewStatuses: Object.fromEntries(
      project.reviews
        .filter((review) => entry.reviewIds?.includes(review.id))
        .map((review) => [review.id, review.status]),
    ),
  };
}

async function extractNewDirectory(bundle, directory) {
  requireThat(bundle.files, "--extract requires a ZIP feedback package.");
  const destination = path.resolve(directory);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.mkdir(destination); // Exclusive: an existing target is never merged or overwritten.
  try {
    for (const [name, bytes] of bundle.files) {
      const target = path.join(destination, safeArchivePath(name));
      if (name.endsWith("/")) await fs.mkdir(target, { recursive: true });
      else {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, bytes, { flag: "wx" });
      }
    }
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true });
    throw error;
  }
  return destination;
}

export async function runCli(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) return { help: HELP };
  const { command, options } = parsed;
  const root = await discoverRoot(options.root),
    runtime = await loadRuntime(root),
    { model } = runtime;
  if (command === "rollback") {
    requireThat(ID.test(options["history-id"]), "Invalid history ID.");
    const origin = localUrl(options.url),
      project = await request(origin, "/api/project");
    model.rollbackPatch(project, options["history-id"]);
    const result = await request(origin, "/api/rollback", {
      historyId: options["history-id"],
    });
    model.validateProject(result);
    return {
      status: "rolled-back",
      ...operationResult(
        result,
        "rollback",
        new Set(project.history.map((item) => item.id)),
      ),
    };
  }
  const bundle = await loadFeedback(options.feedback, runtime),
    { feedback, media } = bundle;
  if (command === "inspect") {
    const extractedTo = options.extract
      ? await extractNewDirectory(bundle, options.extract)
      : undefined;
    return {
      status: "inspected",
      root,
      projectId: feedback.projectId,
      baseRevision: feedback.baseRevision,
      reviews: feedback.reviews,
      nodes: feedback.nodes,
      context: feedback.context,
      tokens: feedback.tokens,
      effectiveProtectedProperties: feedback.effectiveProtectedProperties,
      allowedProperties: feedback.allowedProperties,
      assets: feedback.assets,
      media,
      extractedTo,
      note: "Package structure inspected. Open the available local PNGs separately; no visual review or project applicability is claimed.",
    };
  }
  const patch = await readJson(path.resolve(options.patch));
  const scope = lintFeedbackPatch(feedback, patch, model);
  if (command === "apply") {
    const origin = localUrl(options.url),
      project = await request(origin, "/api/project");
    validateAgainstProject(project, feedback, patch, model);
    const result = await request(origin, "/api/patch", patch);
    model.validateProject(result);
    return {
      status: "applied",
      currentProjectVerified: true,
      ...operationResult(
        result,
        "patch",
        new Set(project.history.map((item) => item.id)),
      ),
      media,
      note: "Changes are modified, not approved. Reload Studio and review the actual difference.",
    };
  }
  if (!options.project)
    return {
      status: "feedback-scope-valid",
      ...scope,
      currentProjectVerified: false,
      media,
      note: "Only feedback scope and restrictions were checked. Full model/value validation and current-project applicability require --project or apply against the local server.",
    };
  const projectFile = path.resolve(options.project),
    project = await readJson(projectFile);
  const preview = validateAgainstProject(project, feedback, patch, model);
  const result = {
    status: "project-dry-run-valid",
    ...scope,
    currentProjectVerified: true,
    onlineProjectVerified: false,
    changes: preview.history.at(-1).changes,
    media,
    note: "Validated against the supplied project snapshot; no live project was modified.",
  };
  if (command === "preview") {
    const output = path.resolve(options.out);
    const active = [
      path.join(root, "data/project.json"),
      ...(process.env.STUDIO_DATA_DIR
        ? [path.resolve(process.env.STUDIO_DATA_DIR, "project.json")]
        : []),
    ];
    requireThat(
      !active.some((item) => item.toLowerCase() === output.toLowerCase()) &&
        !/[\\/]data[\\/]project\.json$/i.test(output),
      "Preview cannot write an active data/project.json. Choose a separate new preview file.",
    );
    requireThat(
      output !== projectFile &&
        output !== path.resolve(options.patch) &&
        output !== bundle.filename,
      "Preview must not replace its input files.",
    );
    await fs.mkdir(path.dirname(output), { recursive: true });
    const canonicalOutput = path.join(
      await fs.realpath(path.dirname(output)),
      path.basename(output),
    );
    requireThat(
      !active.some(
        (item) => item.toLowerCase() === canonicalOutput.toLowerCase(),
      ) && !/[\\/]data[\\/]project\.json$/i.test(canonicalOutput),
      "Preview cannot write an active project through an alias. Choose a separate new preview file.",
    );
    await fs.writeFile(output, `${JSON.stringify(preview, null, 2)}\n`, {
      flag: "wx",
    });
    return {
      ...result,
      status: "preview-written",
      output,
      note: "Only the new preview file was written. The active project and input snapshot are unchanged.",
    };
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  runCli(process.argv.slice(2))
    .then((result) =>
      console.log(result.help || JSON.stringify(result, null, 2)),
    )
    .catch((error) => {
      console.error(JSON.stringify({ status: "error", error: error.message }));
      process.exitCode = 1;
    });
}
