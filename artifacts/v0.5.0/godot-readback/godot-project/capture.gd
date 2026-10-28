extends Control

func _ready() -> void:
    var args := OS.get_cmdline_user_args()
    if not "--studio-verify" in args:
        return
    var result_path := "res://runtime-results.json"
    var screenshot_path := ""
    for arg in args:
        if arg.begins_with("--studio-result="):
            result_path = arg.trim_prefix("--studio-result=")
        if arg.begins_with("--studio-screenshot="):
            screenshot_path = arg.trim_prefix("--studio-screenshot=")
    for frame in range(8):
        await get_tree().process_frame
    var document = JSON.parse_string(FileAccess.get_file_as_string("res://node-map.json"))
    var checks: Array = []
    var failures: Array = []
    for entry in document.nodes:
        var node = get_node_or_null(NodePath(entry.path))
        var errors: Array = []
        if node == null:
            errors.append("missing node")
        else:
            if not node.is_class(entry.type):
                errors.append("wrong class: " + node.get_class())
            if node.get_meta("studio_id", "") != entry.id:
                errors.append("missing stable ID")
            if node.visible != entry.visible:
                errors.append("visibility mismatch")
            if not is_equal_approx(node.self_modulate.a, entry.opacity):
                errors.append("local opacity mismatch")
            if entry.has("text") and node.text != entry.text:
                errors.append("text mismatch")
            var frame_node = get_node(NodePath(entry.framePath))
            if entry.checkGeometry:
                var expected_position := Vector2(entry.frame.x, entry.frame.y)
                var expected_size := Vector2(entry.frame.width, entry.frame.height)
                if frame_node.global_position.distance_to(expected_position) > 1.1:
                    errors.append("position: " + str(frame_node.global_position) + " expected " + str(expected_position))
                if frame_node.size.distance_to(expected_size) > 1.5:
                    errors.append("size: " + str(frame_node.size) + " expected " + str(expected_size))
        checks.append({"id": entry.id, "path": entry.path, "type": entry.type, "passed": errors.is_empty(), "errors": errors})
        if not errors.is_empty():
            failures.append({"id": entry.id, "errors": errors})
    var screenshot := {"requested": not screenshot_path.is_empty(), "written": false}
    if not screenshot_path.is_empty():
        if DisplayServer.get_name() == "headless":
            failures.append({"screenshot": "Headless display cannot supply a rendered screenshot"})
        else:
            await RenderingServer.frame_post_draw
            await RenderingServer.frame_post_draw
            var image := get_viewport().get_texture().get_image()
            var error := image.save_png(screenshot_path)
            screenshot = {"requested": true, "written": error == OK, "path": screenshot_path, "width": image.get_width(), "height": image.get_height(), "error": error}
            if error != OK:
                failures.append({"screenshot": error})
    var result := {"passed": failures.is_empty(), "godot": Engine.get_version_info().string, "display": DisplayServer.get_name(), "nodeCount": checks.size(), "checks": checks, "failures": failures, "screenshot": screenshot}
    var file := FileAccess.open(result_path, FileAccess.WRITE)
    if file == null:
        push_error("Cannot write test result to " + result_path)
        get_tree().quit(2)
        return
    file.store_string(JSON.stringify(result, "  "))
    file.close()
    print("STUDIO_VERIFY " + str(checks.size()) + " nodes; passed=" + str(failures.is_empty()))
    get_tree().quit(0 if failures.is_empty() else 1)
