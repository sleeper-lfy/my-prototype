# Game art, layout, and Godot verification

## Design scope

Use the project's tokens, rules, fonts, textures, and component examples. For this sample, `examples/character.project.json` defines the Ashfall direction. Other projects may use a completely different style; do not force Ashfall colours onto them.

Prioritize hierarchy, silhouette, composition, readable typography, material-aware panels, icon language and button states. A web dashboard full of equivalent rectangular cards is not the default game UI. Keep licensed character/background art replaceable and editable labels/HUD/buttons as actual nodes. Match requested changes to stable component IDs.

The supported nodes are `Control`, `TextureRect`, `Label`, `Button`, `Panel`, `HBoxContainer`, `VBoxContainer`, `MarginContainer`. Groups are Control nodes. Comments survive movement because they reference IDs, not screen coordinates. Component templates copy subtrees and receive new IDs; they are not linked instances.

- Free-layout frames are parent-relative. A Control parent preserves child offsets.
- Container children receive their positions from layout. Use parent padding/gap and child minimum sizes; never promise that editing a child x/y overrides a Container.
- Use `kind:nineSlice` assets and four margins for scalable panels. Preserve corners.
- Button skins use `buttonAssets.normal/hover/pressed`; do not replace them with a flat colour unless requested.
- Match `style.fontFamily` to the name of a bundled `kind:font` asset so the canvas and Godot can use the same font.
- Parent opacity in this experimental editor is per-node; Godot uses `self_modulate` accordingly. This is not a general nested compositor.

## Run the matching design in Godot

For the standard workspace, from the application root:

```text
npm run test:godot -- --project "data/project.json" --reference "data/review/round-01.canvas.png" --out "data/review/round-01-godot"
```

Use a freshly exported, original-size editor canvas PNG from the same project revision, with selection and review overlays hidden. Do not compare a modified project to the bundled original screenshot. On Windows, use `npm.cmd` and set `GODOT_BIN` to the Godot console executable if it is not on PATH. A Windows desktop supplies the rendering display. On Linux, use an available X11/virtual display for screenshots; do not assume DISPLAY=:93 exists on another machine.

The runner defaults to the immutable example if `--project` is omitted. That does not validate a user's current work. It creates a Godot ZIP, runs actual import and node checks, captures a rendered image when a display is available, and writes `godot-results.json`. Read its project identity/revision, hashes, exit codes, node counts, screenshot status and measured comparison. A nonzero exit is a failed run even if an older screenshot exists.

The current runner resolves `/local-assets/` under `<APP_ROOT>/data/assets`. For a custom `STUDIO_DATA_DIR`, use the editor's Godot ZIP (the server resolves its own asset directory), extract it to a new directory, and run that generated project's verification directly:

```text
godot --headless --editor --path "<EXPORT_DIR>" --import
godot --path "<EXPORT_DIR>" --audio-driver Dummy --rendering-method gl_compatibility -- --studio-verify --studio-result="<ABS_RESULT_JSON>" --studio-screenshot="<ABS_SCREENSHOT_PNG>"
```

Supply actual absolute paths; on Windows the executable may be `Godot_v4.x-stable_win64_console.exe`. Preserve arguments as separate arguments when invoking a subprocess. Check both exit status and new result files.

## Interpret the results honestly

Read `export-warnings.json` before claiming fidelity. Unsupported backgrounds/borders/text/images and unmapped font features can be reported there. Check node class, studio_id, text, position, dimensions, visibility and opacity; inspect the actual image as well.

Pure headless node assertions are useful but cannot prove rendered screenshots. A nonempty image is not enough to approve art. The original sample's measured pixel error is a baseline for that sample only, not a universal acceptance threshold.

Keep three conclusions separate: functional workflow; Godot mapping/rendering fidelity; independent art direction. Report typography/contrast/clipping/texture issues concretely. The user's visual approval is not supplied by a passing test or elapsed time.

Penpot is an optional future adapter: current official MCP lives in `penpot/penpot/mcp`, requires a connected browser plugin, and does not automatically implement this review contract. Refer to the application's `docs/TECHNICAL-DECISION.md` when discussing it. Do not claim the unimplemented Penpot adapter is available.
