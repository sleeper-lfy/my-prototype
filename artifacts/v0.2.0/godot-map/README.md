# Godot map verification — v0.2.0

Actual Godot 4.6.3.stable.official.7d41c59c4 import, headless execution and graphical rendering passed on Linux. This is not a Windows engine test. The source snapshot is [source-map.json](source-map.json); its SHA256 is `3281762637d58a324c4e90f3858ac14076667875d6a730c0530fc675b9ce0278`. The map includes explicit asset footprints and actor-layer metadata.

- Native editable TileMapLayer: 328 cells in 4 layers.
- 8 Sprite2D objects: stable IDs, image sizes, foot anchors, visibility and actual layer Z bands verified.
- All 256 grid walkability cells match Studio; all 38 blocked cells have actual Godot physics shapes. Hidden layers retain collision.
- The preview character actually walks 14 steps to the exit. A second click during an in-flight tween is exercised, and attempted movement into blocked cells is rejected.
- The actor uses the configured layer band; foot sorting applies within each band.

[Runnable Godot ZIP](godot-map.zip) · [Rendered screenshot](map.png) · [Complete results](results.json)

## Matched editor comparison

The reference is the actual exported MapScene React/Konva component rendered in Chromium using the same source map, assets, 1280×800 viewport and transform. Markers, selection and the preview player are hidden in both images. It is not an independent HTML reconstruction.

Mean absolute RGB error: **0.27763%**. Pixels with a channel difference above 10%: **0.15088%**. The images are not pixel-perfect; SVG rasterization and texture filtering differ. Functional checks and numerical fidelity do not approve the art direction.

[Editor reference](comparison/editor-reference.png) · [Godot render](comparison/map.png) · [Difference ×4](comparison/difference.png) · [Measured results](comparison/results.json)

## Additional fixtures

- [Crop fixture](crop-fixture/results.json): real atlas crops, fractional object sizes/anchors, hidden objects and hidden actor layer with retained collision. Includes a source snapshot and runnable ZIP.
- [Layer/placement fixture](layer-placement-fixture/results.json): the shared placement helper creates a one-cell tree in the decoration layer and a two-by-two house in a foreground layer. The tree has a deeper foot position; the foreground house still draws above it. A foreground tile, explicit actor layer, native occupied-cell collision and actual editor/Godot pixel comparison are checked. Includes its source snapshot and runnable ZIP.

## Reproduce

From the source checkout with dependencies installed and a graphical desktop/display:

```text
npm run test:map-godot
npm run test:map-godot -- --compare-editor
npm run test:map-godot -- --compare-editor --project artifacts/v0.2.0/godot-map/layer-placement-fixture/source-map.json --out data/validation/layer-placement
```

Set GODOT_BIN if Godot is not on PATH. The optional --compare-editor requires Python with Playwright and an installed Chromium; PYTHON_BIN and CHROMIUM_BIN can select their executables. Use --headless-only only when explicitly skipping render validation. Custom local imports can be resolved using --data-dir. Read [export warnings](export-warnings.json): this exports flat isometric 2D, static collision and grid BFS, not elevation, a 3D terrain, or a baked navigation mesh.
