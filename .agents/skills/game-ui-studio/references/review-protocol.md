# Review protocol and helper commands

The authoritative implementation is `<APP_ROOT>/src/model.js`; application API behavior is in `server/index.js`. Read those files for edge cases instead of inventing another schema.

## Feedback and patch

`feedback.json` contains `schemaVersion`, `projectId`, `baseRevision`, pending `reviews`, target `nodes`, ancestor `context`, `tokens`, related `assets`, local `screenshots`, `allowedProperties`, and `effectiveProtectedProperties` indexed by node ID. It deliberately excludes the rest of the screen. A ZIP screenshot is an image to inspect, not a substitute for editable properties.

Each review has `id`, `nodeId`, `target`, `expected`, `protectedProperties`, `priority`, `status`, and `createdAt`. The normal state flow is `pending → modified → review → approved`. Applying a patch marks addressed reviews modified; acceptance remains manual. Omitted pending reviews remain pending.

A patch contains `schemaVersion:1`, `projectId`, exact `baseRevision`, a concise `summary`, unique `reviewIds`, and `changes:[{nodeId,set:{"path":scalar}}]`. It cannot replace a node or document. Duplicate writes, no-op patches, unknown paths, missing IDs, unrelated nodes, invalid numbers, protected fields, and locked ancestors are rejected.

Typical permitted properties: `name`; `frame.x/y/width/height`; `style.fill/stroke/strokeWidth/radius/color/fontSize/fontFamily/fontStyle/text/align/opacity/letterSpacing/lineHeight`; `assetId`; `visible`; `layout.mode/gap/padding`; `buttonAssets.normal/hover/pressed`. The actual model and feedback whitelist govern. ID/type/parentId/locked are not patchable. A protected `frame` blocks every `frame.*` field.

Example: if a pending CTA review protects geometry, and another unresolved review protects `style.fill`, both restrictions apply even if only the CTA review ID is in this patch.

## Commands

All commands are Node ESM and accept `--root <application-directory>`. They print structured JSON and exit nonzero on failure. Windows paths with spaces must be quoted. Do not set HOME or CODEX_HOME to locate the project; use `GAME_UI_STUDIO_ROOT` or `--root`.

| Command | Purpose |
| --- | --- |
| `inspect --feedback <zip-or-json> [--extract <new-directory>]` | Summarize pending requests, nodes, restrictions and screenshot availability; optionally safely unpack a ZIP |
| `validate --feedback <zip-or-json> --patch <json>` | Check feedback scope and restrictions; explicitly does not verify current application state |
| `validate --feedback ... --patch ... --project <json>` | Also run the real `applyPatch` against a complete matching project without writing it |
| `preview --feedback ... --patch ... --project <json> --out <new-json>` | Write a new complete patched document; never replace the input or active project |
| `apply --feedback ... --patch ... [--url <local-url>]` | GET current project, dry-run, POST `/api/patch`, return the real saved diff |
| `rollback --history-id <id> [--url <local-url>]` | Check current state then POST `/api/rollback`; preserve later unrelated edits |

The default URL is `http://127.0.0.1:4380`. Only HTTP loopback hosts are accepted. A user-selected custom local port may be provided. The helper uses the project's installed `fflate` for ZIPs and the actual `src/model.js`; it does not include a competing copy of the document model.

Extraction is a separate local side effect, permitted only into a new directory. Archives with unsafe paths or excessive size are rejected. Missing screenshots must be reported; do not fabricate them or claim visual review from JSON alone.

## Conflict handling

- **Stale revision:** obtain a new feedback export from the actual design. Do not just increment `baseRevision` or retry unchanged content.
- **Protected field:** explain the conflicting review and field. Keep that part pending; work on independent allowed requests.
- **Unknown/missing component:** check whether it was copied or recreated. New objects have new IDs; do not map by display name alone.
- **Container x/y:** adjust the allowed parent layout or child dimensions when within scope. Otherwise report the needed review change.
- **Missing resource:** preserve the current project. Resolve licensed local assets and use `/api/assets` or the normal import flow; don't substitute arbitrary online art.
- **Rollback conflict:** do not overwrite a newer value. Explain the conflicting field and provide a new scoped proposal if requested.

## Validation provenance

Inspect is not image review. Feedback-only lint is not full-project validation. Dry-run is not an applied change. API success is not visual or Godot verification. A valid ZIP is not an engine runtime test. Report each stage only when performed and preserve the process exit status.
