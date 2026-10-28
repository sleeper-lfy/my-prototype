# Generated Godot 4 project

Open project.godot in Godot 4, or run: godot --path .

Stable component IDs are in node metadata studio_id and node-map.json.
Free-layout nodes keep offsets. HBox/VBox/containers own child positions; padded box containers use a synthetic MarginContainer wrapper (framePath).

The root capture.gd only runs verification when --studio-verify is passed. Example:

    godot --path . -- --studio-verify --studio-result=runtime-results.json --studio-screenshot=screenshot.png

Screenshot capture needs a rendering display. --headless may validate nodes but cannot produce a screenshot.
Fonts are bundled project assets. Assets retain their original licenses.
This exporter covers the supported static controls only; it does not generate gameplay logic, responsive breakpoints or animation.
