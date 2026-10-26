import { validateProject, computeLayout } from '../src/model.js';

const quote = value => JSON.stringify(String(value));
const num = value => Number(Number(value).toFixed(4));
const vec = (x, y) => `Vector2(${num(x)}, ${num(y)})`;
const painted = value => typeof value === 'string' && value !== 'transparent' && !(/^#[\da-f]{3}0$/i.test(value) || /^#[\da-f]{6}00$/i.test(value));

function color(value = '#ffffff') {
  if (value === 'transparent') return 'Color(0, 0, 0, 0)';
  const hex = value.slice(1);
  const parts = hex.length <= 4 ? [...hex].map(c => c + c) : hex.match(/../g);
  const rgba = [...parts.slice(0, 3).map(v => parseInt(v, 16) / 255), parts[3] ? parseInt(parts[3], 16) / 255 : 1];
  return `Color(${rgba.map(num).join(', ')})`;
}

const CAPTURE_SCRIPT = `extends Control

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
`;

/** Pure, deterministic Godot 4 scene generation. The caller copies returned assets. */
export function createGodotFiles(project) {
  validateProject(project);
  const layout = computeLayout(project);
  const ext = ['[ext_resource type="Script" path="res://capture.gd" id="1_capture"]'];
  const sub = [];
  const sections = [];
  const assets = [];
  const warnings = [];
  const assetMap = new Map(project.assets.map(a => [a.id, a]));
  const resources = new Map();
  let resourceIndex = 2;
  let styleIndex = 1;

  function assetResource(assetId) {
    if (!assetId) return null;
    if (resources.has(assetId)) return resources.get(assetId);
    const asset = assetMap.get(assetId);
    if (!asset) throw new Error(`Unknown asset: ${assetId}`);
    const extension = asset.src.split('.').pop().toLowerCase();
    if (!/^(svg|png|jpg|jpeg|webp|ttf|otf)$/.test(extension)) throw new Error(`Unsupported Godot asset extension: ${extension}`);
    const id = `${resourceIndex++}_asset`;
    const destination = `assets/${asset.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.${extension}`;
    if (assets.some(a => a.destination === destination)) throw new Error('Asset filename collision');
    assets.push({ src: asset.src, destination });
    const type = asset.kind === 'font' ? 'FontFile' : 'Texture2D';
    ext.push(`[ext_resource type="${type}" path=${quote(`res://${destination}`)} id=${quote(id)}]`);
    resources.set(assetId, id);
    return id;
  }

  function styleBox(style, assetId) {
    const id = `Style_${styleIndex++}`;
    const asset = assetMap.get(assetId);
    if (asset) {
      if (asset.kind === 'font') throw new Error(`A font cannot be used as a panel/button texture: ${assetId}`);
      const resource = assetResource(assetId);
      const margins = asset.margins ?? { left: 0, top: 0, right: 0, bottom: 0 };
      sub.push(`[sub_resource type="StyleBoxTexture" id=${quote(id)}]\ntexture = ExtResource(${quote(resource)})\n${['left','top','right','bottom'].map(s => `texture_margin_${s} = ${num(margins[s] ?? 0)}`).join('\n')}\n${['left','top','right','bottom'].map(s => `content_margin_${s} = 0.0`).join('\n')}`);
    } else {
      const border = Math.round(style.strokeWidth ?? 0);
      const radius = Math.round(style.radius ?? 0);
      sub.push(`[sub_resource type="StyleBoxFlat" id=${quote(id)}]\nbg_color = ${color(style.fill ?? '#00000000')}\nborder_color = ${color(style.stroke ?? '#00000000')}\n${['left','top','right','bottom'].map(s => `border_width_${s} = ${border}`).join('\n')}\n${['top_left','top_right','bottom_left','bottom_right'].map(s => `corner_radius_${s} = ${radius}`).join('\n')}\n${['left','top','right','bottom'].map(s => `content_margin_${s} = 0.0`).join('\n')}`);
    }
    return `SubResource(${quote(id)})`;
  }

  const children = new Map();
  for (const node of project.nodes) {
    const parent = node.parentId ?? null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(node);
  }
  const nodeMap = [];
  const names = new Map(project.nodes.map((n, i) => [n.id, `${n.type}_${i + 1}`]));
  function geometry(node, insideContainer) {
    const f = node.frame;
    if (insideContainer) return [`layout_mode = 2`, `custom_minimum_size = ${vec(f.width, f.height)}`, 'size_flags_horizontal = 1', 'size_flags_vertical = 1'];
    return ['layout_mode = 0', `offset_left = ${num(f.x)}`, `offset_top = ${num(f.y)}`, `offset_right = ${num(f.x + f.width)}`, `offset_bottom = ${num(f.y + f.height)}`];
  }

  function emit(node, parentPath, insideContainer, ancestorsVisible) {
    const name = names.get(node.id);
    const isBox = node.type === 'HBoxContainer' || node.type === 'VBoxContainer';
    const isContainer = isBox || node.type === 'MarginContainer';
    const padding = node.layout?.padding ?? 0;
    const hasWrapper = isBox && padding > 0;
    const join = (p, n) => p === '.' ? n : `${p}/${n}`;
    let actualParent = parentPath;
    let framePath = join(parentPath, name);
    if (hasWrapper) {
      const wrapper = `${name}__Padding`;
      framePath = join(parentPath, wrapper);
      sections.push(`[node name=${quote(wrapper)} type="MarginContainer" parent=${quote(parentPath)}]\n${geometry(node, insideContainer).join('\n')}\nvisible = ${node.visible !== false}\n${['left','top','right','bottom'].map(s => `theme_override_constants/margin_${s} = ${Math.round(padding)}`).join('\n')}`);
      actualParent = framePath;
    }
    const path = join(actualParent, name);
    const properties = hasWrapper ? ['layout_mode = 2'] : geometry(node, insideContainer);
    properties.push(`visible = ${node.visible !== false}`, `metadata/studio_id = ${quote(node.id)}`, `metadata/studio_name = ${quote(node.name)}`);
    const style = node.style ?? {};
    // The editor paints nodes independently at computed absolute frames: node
    // opacity affects its own visuals, not descendant component opacity.
    if (style.opacity !== undefined) properties.push(`self_modulate = Color(1, 1, 1, ${num(style.opacity)})`);
    if (!['Panel','Button'].includes(node.type)) {
      if (painted(style.fill)) warnings.push({nodeId:node.id,property:'style.fill',message:`${node.type} background fill is not mapped; use a separate Panel for the background.`});
      if ((style.strokeWidth ?? 0) > 0 && painted(style.stroke)) warnings.push({nodeId:node.id,property:'style.stroke',message:`${node.type} border/radius is not mapped; use a separate Panel for the border.`});
    }
    if (!['Label','Button'].includes(node.type) && style.text) warnings.push({nodeId:node.id,property:'style.text',message:`Text painted on ${node.type} is not mapped; use a child Label.`});
    if (!['TextureRect','Panel','Button'].includes(node.type) && node.assetId) warnings.push({nodeId:node.id,property:'assetId',message:`An image on ${node.type} is not mapped; use a TextureRect or textured Panel.`});
    if (isBox) properties.push(`theme_override_constants/separation = ${Math.round(node.layout?.gap ?? 0)}`);
    if (node.type === 'MarginContainer') properties.push(...['left','top','right','bottom'].map(s => `theme_override_constants/margin_${s} = ${Math.round(padding)}`));
    if (node.type === 'TextureRect') {
      if (assetMap.get(node.assetId)?.kind === 'font') throw new Error(`A font cannot be used by TextureRect: ${node.id}`);
      if (node.assetId) properties.push(`texture = ExtResource(${quote(assetResource(node.assetId))})`);
      properties.push('expand_mode = 1', 'stretch_mode = 0', 'mouse_filter = 2');
    }
    if (node.type === 'Panel') properties.push(`theme_override_styles/panel = ${styleBox(style, node.assetId)}`);
    if (node.type === 'Button' || node.type === 'Label') {
      properties.push(`text = ${quote(style.text ?? '')}`, `theme_override_colors/font_color = ${color(style.color ?? '#ffffff')}`, `theme_override_font_sizes/font_size = ${Math.round(style.fontSize ?? 16)}`);
      const font = project.assets.find(a => a.kind === 'font' && a.name === (style.fontFamily || 'Studio Sans'));
      if (font) properties.push(`theme_override_fonts/font = ExtResource(${quote(assetResource(font.id))})`);
      else if (style.fontFamily) warnings.push({nodeId:node.id,property:'style.fontFamily',message:`No bundled font named ${style.fontFamily}; Godot will use its default font.`});
      for (const [property, defaultValue] of [['fontStyle','normal'], ['letterSpacing',0], ['lineHeight',1]]) {
        if (style[property] !== undefined && style[property] !== defaultValue) warnings.push({nodeId:node.id,property:`style.${property}`,message:`${property} is not mapped by the phase-1 exporter; inspect the rendered text.`});
      }
      if (node.type === 'Label') {
        properties.push(`horizontal_alignment = ${{ left: 0, center: 1, right: 2 }[style.align ?? 'left']}`, 'vertical_alignment = 1', 'clip_text = true', 'mouse_filter = 2');
      } else {
        properties.push('clip_text = true', 'focus_mode = 0', `alignment = ${{ left: 0, center: 1, right: 2 }[style.align ?? 'center']}`);
        for (const state of ['normal', 'hover', 'pressed', 'disabled']) {
          const stateAsset = (state === 'disabled' ? node.disabledAssetId : undefined) ?? node.buttonAssets?.[state] ?? node.buttonAssets?.normal ?? node.assetId;
          properties.push(`theme_override_styles/${state} = ${styleBox(style, stateAsset)}`, `theme_override_colors/font_${state === 'normal' ? '' : state + '_'}color = ${color(style.color ?? '#ffffff')}`);
        }
      }
    }
    sections.push(`[node name=${quote(name)} type=${quote(node.type)} parent=${quote(actualParent)}]\n${properties.join('\n')}`);
    const f = layout.get(node.id);
    nodeMap.push({ id: node.id, name: node.name, type: node.type, path, framePath, frame: f ?? node.frame, opacity:style.opacity ?? 1, visible: node.visible !== false, checkGeometry: ancestorsVisible && node.visible !== false, ...(node.type === 'Button' || node.type === 'Label' ? {text: style.text ?? ''} : {}) });
    for (const child of children.get(node.id) ?? []) emit(child, path, isContainer, ancestorsVisible && node.visible !== false);
  }
  for (const node of children.get(null) ?? []) emit(node, '.', false, true);

  const scene = `[gd_scene load_steps=${ext.length + sub.length + 1} format=3]\n\n${ext.join('\n')}\n\n${sub.join('\n\n')}\n\n[node name="GameUI" type="Control"]\nlayout_mode = 3\nanchors_preset = 15\nanchor_right = 1.0\nanchor_bottom = 1.0\ngrow_horizontal = 2\ngrow_vertical = 2\nscript = ExtResource("1_capture")\nmetadata/studio_project_id = ${quote(project.id)}\n\n[node name="CanvasBackground" type="ColorRect" parent="."]\nlayout_mode = 1\nanchors_preset = 15\nanchor_right = 1.0\nanchor_bottom = 1.0\nmouse_filter = 2\ncolor = ${color(project.canvas.background)}\n\n${sections.join('\n\n')}\n`;
  const config = `; Generated by Game UI Studio. Open with Godot 4.\nconfig_version=5\n\n[application]\nconfig/name=${quote(project.name)}\nrun/main_scene="res://main.tscn"\n\n[display]\nwindow/size/viewport_width=${project.canvas.width}\nwindow/size/viewport_height=${project.canvas.height}\nwindow/size/window_width_override=${project.canvas.width}\nwindow/size/window_height_override=${project.canvas.height}\nwindow/stretch/mode="canvas_items"\n\n[rendering]\nrenderer/rendering_method="gl_compatibility"\nrenderer/rendering_method.mobile="gl_compatibility"\ntextures/default_filters/use_nearest_mipmap_filter=false\nenvironment/defaults/default_clear_color=${color(project.canvas.background)}\n`;
  const readme = `# Generated Godot 4 project\n\nOpen project.godot in Godot 4, or run: godot --path .\n\nStable component IDs are in node metadata studio_id and node-map.json.\nFree-layout nodes keep offsets. HBox/VBox/containers own child positions; padded box containers use a synthetic MarginContainer wrapper (framePath).\n\nThe root capture.gd only runs verification when --studio-verify is passed. Example:\n\n    godot --path . -- --studio-verify --studio-result=runtime-results.json --studio-screenshot=screenshot.png\n\nScreenshot capture needs a rendering display. --headless may validate nodes but cannot produce a screenshot.\nFonts are bundled project assets. Assets retain their original licenses.\nThis exporter covers the supported static controls only; it does not generate gameplay logic, responsive breakpoints or animation.\n`;
  return {
    files: { 'project.godot': config, 'main.tscn': scene, 'capture.gd': CAPTURE_SCRIPT, 'node-map.json': JSON.stringify({ schemaVersion: 1, projectId: project.id, revision: project.revision, canvas: project.canvas, nodes: nodeMap }, null, 2), 'export-warnings.json': JSON.stringify(warnings,null,2), 'README.md': readme },
    assets,
  };
}
