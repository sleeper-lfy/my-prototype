import { analyzeMapPlayability } from '../src/mapPlayability.js';
import { validateMap, isoToScreen, isWalkable, findPath, getActorLayerId, getMapRenderLayers, getActorFootprint, getObjectCollision, getObjectOcclusion, getMapCollisionBitmap } from '../src/mapModel.js';

const quote = value => JSON.stringify(String(value));
const num = value => Number(Number(value).toFixed(6));
const vec = (x, y) => `Vector2(${num(x)}, ${num(y)})`;
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const polygon = points => `PackedVector2Array(${points.flatMap(point => [num(point.x), num(point.y)]).join(', ')})`;

// TileMapLayer's version-0 serialization: a uint16 version followed by 12-byte cells.
// Keeping the cells in the scene makes the exported map editable in Godot's tile editor.
function cellBytes(cells, sourceIds) {
  const entries = Object.entries(cells);
  const bytes = Buffer.alloc(2 + entries.length * 12);
  entries.forEach(([key, id], index) => {
    const [x, y] = key.split(',').map(Number), offset = 2 + index * 12;
    bytes.writeInt16LE(x, offset); bytes.writeInt16LE(y, offset + 2);
    bytes.writeUInt16LE(sourceIds.get(id), offset + 4);
  });
  return `PackedByteArray(${[...bytes].join(', ')})`;
}

const TILE_SCRIPT = `@tool
extends TileMapLayer

# Normalize display size and optional atlas crop from the unmodified source texture.
# Runs in the editor too, so imported/custom tiles have the same dimensions there.
func _ready() -> void:
    if tile_set == null:
        return
    for index in range(tile_set.get_source_count()):
        var source = tile_set.get_source(tile_set.get_source_id(index))
        if not source is TileSetAtlasSource or source.has_meta("studio_normalized"):
            continue
        var image = source.texture.get_image()
        var region: Rect2i = source.get_meta("studio_crop")
        if region.size != Vector2i.ZERO:
            if not Rect2i(Vector2i.ZERO, image.get_size()).encloses(region):
                push_error("Map tile atlas region exceeds image bounds")
                continue
            image = image.get_region(region)
        var display: Vector2i = source.get_meta("studio_size")
        if image.get_size() != display:
            image.resize(display.x, display.y, Image.INTERPOLATE_LANCZOS)
        source.texture = ImageTexture.create_from_image(image)
        source.texture_region_size = display
        source.set_meta("studio_normalized", true)
`;

const SPRITE_SCRIPT = `@tool
extends Sprite2D

@export var studio_source: Texture2D
@export var studio_size: Vector2 = Vector2(64, 64)
@export var studio_anchor: Vector2 = Vector2(0.5, 1.0)
@export var studio_crop: Rect2i = Rect2i()
@export var studio_sort_offset: Vector2 = Vector2.ZERO

func _ready() -> void:
    if studio_source == null:
        return
    var image = studio_source.get_image()
    if studio_crop.size != Vector2i.ZERO:
        if not Rect2i(Vector2i.ZERO, image.get_size()).encloses(studio_crop):
            push_error("Map object atlas region exceeds image bounds")
            return
        image = image.get_region(studio_crop)
    # A Sprite2D transform preserves fractional display sizes without rounding.
    texture = ImageTexture.create_from_image(image)
    centered = false
    scale = studio_size / Vector2(image.get_size())
    offset = -Vector2(image.get_size()) * studio_anchor - studio_sort_offset / scale
`;

const RUNTIME_SCRIPT = `extends Node2D

signal marker_entered(stable_id: String, marker_type: String)

var document: Dictionary
var blocked: Dictionary = {}
var actor_size := Vector2i.ONE
var node_mapping: Dictionary = {}
var player_cell := Vector2i.ZERO
var moving_to := Vector2i.ZERO
var route: Array = []
var moving := false
var preview_enabled := true
var cell_step := 0.16
@onready var map_root: Node2D = $Map
@onready var player: Node2D = $Map/Actors/Player

func iso(cell: Vector2) -> Vector2:
    return Vector2((cell.x - cell.y) * document.grid.tileWidth / 2.0, (cell.x + cell.y) * document.grid.tileHeight / 2.0)

func local_to_cell(point: Vector2) -> Vector2i:
    return Vector2i(roundi(point.x / document.grid.tileWidth + point.y / document.grid.tileHeight), roundi(point.y / document.grid.tileHeight - point.x / document.grid.tileWidth))

func walkable(cell: Vector2i) -> bool:
    if cell.x < 0 or cell.y < 0 or cell.x + actor_size.x > document.grid.width or cell.y + actor_size.y > document.grid.height:
        return false
    for x in range(cell.x, cell.x + actor_size.x):
        for y in range(cell.y, cell.y + actor_size.y):
            if blocked.has(Vector2i(x, y)):
                return false
    return true

func path_to(start: Vector2i, finish: Vector2i) -> Array:
    if not walkable(start) or not walkable(finish):
        return []
    var visited: Dictionary = {start: null}
    var queue: Array = [start]
    var head := 0
    while head < queue.size():
        var current: Vector2i = queue[head]
        head += 1
        if current == finish:
            var found: Array = []
            var cursor = finish
            while cursor != null:
                found.push_front(cursor)
                cursor = visited[cursor]
            return found
        for direction in [Vector2i.RIGHT, Vector2i.DOWN, Vector2i.LEFT, Vector2i.UP]:
            var next: Vector2i = current + direction
            if not visited.has(next) and walkable(next):
                visited[next] = current
                queue.append(next)
    return []

func _ready() -> void:
    document = JSON.parse_string(FileAccess.get_file_as_string("res://map.json"))
    for key in document.blocked:
        var parts = key.split(",")
        blocked[Vector2i(int(parts[0]), int(parts[1]))] = true
    var actor = document.get("playability", {}).get("actor", {"width": 1, "height": 1})
    actor_size = Vector2i(actor.width, actor.height)
    for object in document.objects:
        if object.blocking:
            var region = object.get("collision", {"x": 0, "y": 0, "width": object.footprint.width, "height": object.footprint.height})
            for x in range(int(object.x + region.x), int(object.x + region.x + region.width)):
                for y in range(int(object.y + region.y), int(object.y + region.y + region.height)):
                    blocked[Vector2i(x, y)] = true
    var mapping = JSON.parse_string(FileAccess.get_file_as_string("res://node-map.json"))
    node_mapping = mapping
    player_cell = Vector2i(mapping.spawn.x, mapping.spawn.y)
    preview_enabled = walkable(player_cell)
    player.visible = preview_enabled and mapping.actorVisible
    player.position = iso(Vector2(player_cell))
    if "--studio-verify" in OS.get_cmdline_user_args():
        call_deferred("verify_scene")

func _unhandled_input(event: InputEvent) -> void:
    if not preview_enabled:
        return
    if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
        var target := local_to_cell(map_root.get_local_mouse_position())
        set_destination(target)
    if event is InputEventKey and event.pressed and not event.echo and not moving:
        if event.keycode == KEY_E:
            for marker in document.markers:
                if marker.type == "interaction" and absi(int(marker.x) - player_cell.x) + absi(int(marker.y) - player_cell.y) <= 1:
                    marker_entered.emit(marker.id, marker.type)
        var direction := Vector2i.ZERO
        match event.keycode:
            KEY_RIGHT, KEY_D: direction = Vector2i.RIGHT
            KEY_DOWN, KEY_S: direction = Vector2i.DOWN
            KEY_LEFT, KEY_A: direction = Vector2i.LEFT
            KEY_UP, KEY_W: direction = Vector2i.UP
        if direction != Vector2i.ZERO and walkable(player_cell + direction):
            route = [player_cell + direction]

func set_destination(target: Vector2i) -> void:
    # A click during a step starts its new path at the in-flight destination.
    # Starting at player_cell would queue that destination twice and cancel it.
    route = path_to(moving_to if moving else player_cell, target)
    if not route.is_empty():
        route.pop_front()

func _process(_delta: float) -> void:
    update_occlusion()
    if moving or route.is_empty() or not preview_enabled:
        return
    var next: Vector2i = route.pop_front()
    if not walkable(next) or absi(next.x - player_cell.x) + absi(next.y - player_cell.y) != 1:
        route.clear()
        return
    moving = true
    moving_to = next
    var tween := create_tween()
    tween.tween_property(player, "position", iso(Vector2(next)), cell_step)
    tween.finished.connect(func():
        player_cell = next
        moving = false
        for marker in document.markers:
            if marker.type != "interaction" and Vector2i(marker.x, marker.y) == player_cell:
                marker_entered.emit(marker.id, marker.type)
    )

func update_occlusion() -> void:
    for entry in node_mapping.get("objects", []):
        var region: Dictionary = entry.occlusion
        var sprite = get_node_or_null(NodePath(entry.path))
        if sprite != null:
            var covered: bool = region.fade and player_cell.x >= entry.cell.x + region.x and player_cell.y >= entry.cell.y + region.y and player_cell.x < entry.cell.x + region.x + region.width and player_cell.y < entry.cell.y + region.y + region.height
            sprite.modulate.a = 0.3 if covered and preview_enabled and player.visible else 1.0

func verify_scene() -> void:
    var result_path := "res://runtime-results.json"
    var screenshot_path := ""
    for arg in OS.get_cmdline_user_args():
        if arg.begins_with("--studio-result="):
            result_path = arg.trim_prefix("--studio-result=")
        if arg.begins_with("--studio-screenshot="):
            screenshot_path = arg.trim_prefix("--studio-screenshot=")
    for frame in range(8):
        await get_tree().process_frame
    var mapping = JSON.parse_string(FileAccess.get_file_as_string("res://node-map.json"))
    var errors: Array = []
    var checks: Array = []
    for layer_entry in mapping.layers:
        var layer = get_node_or_null(NodePath(layer_entry.path))
        var passed: bool = layer is TileMapLayer and layer.get_meta("studio_id", "") == layer_entry.id and layer.visible == layer_entry.visible and layer.z_index == layer_entry.zIndex
        if passed:
            passed = layer.get_used_cells().size() == layer_entry.cells.size()
            for cell in layer_entry.cells:
                var coords := Vector2i(cell.x, cell.y)
                var expected := iso(Vector2(coords))
                if layer.position.distance_to(-Vector2(document.grid.tileWidth, document.grid.tileHeight) / 2.0) > 0.01 or (layer.map_to_local(coords) + layer.position).distance_to(expected) > 0.01 or layer.get_cell_source_id(coords) != cell.sourceId:
                    passed = false
        checks.append({"kind": "tile-layer", "id": layer_entry.id, "passed": passed})
        if not passed: errors.append("Tile layer mismatch: " + layer_entry.id)
    for object_entry in mapping.objects:
        var sprite = get_node_or_null(NodePath(object_entry.path))
        var passed: bool = sprite is Sprite2D and sprite.get_meta("studio_id", "") == object_entry.id and sprite.visible == object_entry.visible and sprite.z_index == object_entry.zIndex
        if passed:
            var size: Vector2 = sprite.texture.get_size() * sprite.scale
            passed = sprite.position.distance_to(Vector2(object_entry.position.x, object_entry.position.y)) < 0.01 and size.distance_to(Vector2(object_entry.size.x, object_entry.size.y)) < 0.01 and (sprite.offset * sprite.scale).distance_to(Vector2(object_entry.offset.x, object_entry.offset.y)) < 0.01
        checks.append({"kind": "sprite", "id": object_entry.id, "passed": passed})
        if not passed: errors.append("Object mismatch: " + object_entry.id)
    for collider in mapping.colliders:
        var body = get_node_or_null(NodePath(collider.path))
        var shape = body.get_node_or_null("Shape") if body != null else null
        var passed: bool = body is StaticBody2D and shape is CollisionPolygon2D and shape.polygon.size() == 4
        checks.append({"kind": "collision", "id": collider.id, "passed": passed})
        if not passed: errors.append("Collision missing: " + collider.id)
    for marker in mapping.markers:
        var node = get_node_or_null(NodePath(marker.path))
        var passed: bool = node != null and node.get_meta("studio_id", "") == marker.id and node.get_meta("studio_type", "") == marker.type
        checks.append({"kind": "marker", "id": marker.id, "passed": passed})
        if not passed: errors.append("Marker missing: " + marker.id)
    var occupancy: Array = []
    for y in range(int(document.grid.height)):
        for x in range(int(document.grid.width)):
            occupancy.append(walkable(Vector2i(x, y)))
    if occupancy != mapping.walkability:
        errors.append("Grid walkability differs from Studio model")
    if walkable(Vector2i(-1, 0)) or walkable(Vector2i(int(document.grid.width), 0)):
        errors.append("Map bounds permit walking outside")
    var physics_blocked := 0
    for y in range(int(document.grid.height)):
        for x in range(int(document.grid.width)):
            if not blocked.has(Vector2i(x, y)):
                continue
            var query := PhysicsPointQueryParameters2D.new()
            query.position = map_root.to_global(iso(Vector2(x, y)))
            query.collision_mask = 1
            query.collide_with_areas = false
            if get_world_2d().direct_space_state.intersect_point(query).is_empty():
                errors.append("Physics collision absent at " + str(Vector2i(x, y)))
            else:
                physics_blocked += 1
    var test_route: Array = []
    if not mapping.testPath.is_empty():
        for point in mapping.testPath: test_route.append(Vector2i(point.x, point.y))
        if path_to(test_route[0], test_route[-1]) != test_route:
            errors.append("Runtime path differs from Studio BFS path")
        player_cell = test_route[0]
        player.position = iso(Vector2(player_cell))
        cell_step = 0.1
        set_destination(test_route[-1])
        for frame in range(3):
            await get_tree().process_frame
            if moving: break
        if test_route.size() > 1 and not moving:
            errors.append("Movement never started")
        # Exercise a second click while a tween is in flight, not only idle walks.
        set_destination(test_route[-1])
        cell_step = 0.001
        var ticks := 0
        while (moving or not route.is_empty()) and ticks < 2000:
            await get_tree().process_frame
            ticks += 1
        if player_cell != test_route[-1] or player.position.distance_to(iso(Vector2(test_route[-1]))) > 0.01:
            errors.append("Player did not finish the walk route")
        # A queued blocked destination must be rejected by the actual movement loop.
        if not blocked.is_empty():
            var previous := player_cell
            route = [blocked.keys()[0]]
            await get_tree().process_frame
            await get_tree().process_frame
            if player_cell != previous: errors.append("Movement entered a blocked cell")
    if not $Map/Actors.y_sort_enabled or player.z_index != mapping.actorZ:
        errors.append("Foot-based actor sorting disabled")
    if player.visible != (walkable(Vector2i(mapping.spawn.x, mapping.spawn.y)) and mapping.actorVisible):
        errors.append("Actor layer visibility differs from Studio")
    for entry in mapping.objects:
        var sprite = get_node(NodePath(entry.path))
        if sprite.z_index != entry.zIndex: errors.append("Object layer band differs from Studio: " + entry.id)
    # Return to the true spawn so the capture is reproducible.
    player_cell = Vector2i(mapping.spawn.x, mapping.spawn.y)
    player.position = iso(Vector2(player_cell))
    route.clear()
    if "--studio-map-only" in OS.get_cmdline_user_args():
        player.visible = false
    update_occlusion()
    var screenshot := {"requested": not screenshot_path.is_empty(), "written": false}
    if not screenshot_path.is_empty():
        if DisplayServer.get_name() == "headless":
            errors.append("A graphical display is required for map screenshots")
        else:
            await RenderingServer.frame_post_draw
            await RenderingServer.frame_post_draw
            var image := get_viewport().get_texture().get_image()
            var error := image.save_png(screenshot_path)
            screenshot = {"requested": true, "written": error == OK, "width": image.get_width(), "height": image.get_height()}
            if error != OK: errors.append("Screenshot save failed")
    var result := {"passed": errors.is_empty(), "godot": Engine.get_version_info().string, "display": DisplayServer.get_name(), "projectId": document.id, "revision": document.revision, "checks": checks, "cellCount": mapping.cellCount, "walkabilityCells": occupancy.size(), "physicsBlockedCells": physics_blocked, "walkedSteps": maxi(0, test_route.size() - 1), "ySortEnabled": $Map/Actors.y_sort_enabled, "errors": errors, "screenshot": screenshot}
    var file := FileAccess.open(result_path, FileAccess.WRITE)
    if file == null:
        push_error("Cannot write map verification result")
        get_tree().quit(2)
        return
    file.store_string(JSON.stringify(result, "  "))
    file.close()
    print("STUDIO_MAP_VERIFY passed=" + str(result.passed))
    get_tree().quit(0 if result.passed else 1)
`;

/** Deterministic native Godot 4.3+ map scene; no filesystem access or Godot dependency. */
export function createMapGodotFiles(project) {
  validateMap(project);
  const assets = [], resourceIds = new Map(), sourceIds = new Map();
  const ext = [
    '[ext_resource type="Script" path="res://map_runtime.gd" id="1_runtime"]',
    '[ext_resource type="Script" path="res://tile_display.gd" id="2_tiles"]',
    '[ext_resource type="Script" path="res://sprite_display.gd" id="3_sprites"]',
  ];
  const sub = [], nodes = [], mapping = { schemaVersion: 1, projectId: project.id, revision: project.revision, minimumGodot: '4.3', layers: [], objects: [], markers: [], colliders: [], cellCount: 0, walkability: [], testPath: [] };
  const assetMap = new Map(project.assets.map(asset => [asset.id, asset]));
  const renderLayers = getMapRenderLayers(project);
  const layerBands = new Map(renderLayers.map(band => [band.layer.id,band]));
  const actorBand = layerBands.get(getActorLayerId(project));
  mapping.actorFootprint = getActorFootprint(project); mapping.collisionCells = [...getMapCollisionBitmap(project)];
  mapping.actorLayerId = actorBand.layer.id; mapping.actorZ = actorBand.objectZ; mapping.actorVisible = actorBand.layer.visible;
  const used = new Set([...project.layers.flatMap(layer => Object.values(layer.cells)), ...project.objects.map(object => object.assetId)]);
  for (const asset of project.assets.filter(asset => used.has(asset.id))) {
    const extension = asset.src.split('.').pop().toLowerCase();
    const destination = `assets/${asset.id}.${extension}`, resourceId = `asset_${resourceIds.size}`;
    assets.push({ src: asset.src, destination }); resourceIds.set(asset.id, resourceId);
    ext.push(`[ext_resource type="Texture2D" path=${quote(`res://${destination}`)} id=${quote(resourceId)}]`);
    if (asset.kind === 'tile') {
      const index = sourceIds.size; sourceIds.set(asset.id, index);
      const crop = asset.atlas || { x: 0, y: 0, width: 0, height: 0 };
      sub.push(`[sub_resource type="TileSetAtlasSource" id="TileSource_${index}"]\ntexture = ExtResource(${quote(resourceId)})\ntexture_region_size = Vector2i(1, 1)\n0:0/0 = 0\nmetadata/studio_size = Vector2i(${Math.round(asset.width)}, ${Math.round(asset.height)})\nmetadata/studio_crop = Rect2i(${crop.x}, ${crop.y}, ${crop.width}, ${crop.height})\nmetadata/studio_id = ${quote(asset.id)}`);
    }
  }
  sub.push(`[sub_resource type="TileSet" id="MapTiles"]\ntile_shape = 1\ntile_layout = 5\ntile_size = Vector2i(${project.grid.tileWidth}, ${project.grid.tileHeight})\n${[...sourceIds.values()].map(index => `sources/${index} = SubResource("TileSource_${index}")`).join('\n')}`);
  const corners = [[-.5,-.5],[project.grid.width-.5,-.5],[project.grid.width-.5,project.grid.height-.5],[-.5,project.grid.height-.5]].map(([x,y]) => isoToScreen(x,y,project.grid));
  const bounds = [...corners];
  for (const object of project.objects) {
    if (!project.layers.find(layer => layer.id === object.layerId).visible) continue;
    const point = isoToScreen(object.x, object.y, project.grid);
    bounds.push({x:point.x-object.anchorX*object.width,y:point.y-object.anchorY*object.height}, {x:point.x+(1-object.anchorX)*object.width,y:point.y+(1-object.anchorY)*object.height});
  }
  const minX = Math.min(...bounds.map(p => p.x)), maxX = Math.max(...bounds.map(p => p.x));
  const minY = Math.min(...bounds.map(p => p.y)), maxY = Math.max(...bounds.map(p => p.y));
  const zoom = Math.min(1.2, 1120/(maxX-minX), 650/(maxY-minY));
  const origin = {x:640-(minX+maxX)/2*zoom,y:435-(minY+maxY)/2*zoom};
  mapping.viewport = {width:1280,height:800,background:'#0b1310'}; mapping.transform = {origin,zoom};
  nodes.push(`[node name="GameMap" type="Node2D"]\nscript = ExtResource("1_runtime")\nmetadata/studio_id = ${quote(project.id)}`,
    `[node name="Map" type="Node2D" parent="."]\nposition = ${vec(origin.x,origin.y)}\nscale = ${vec(zoom,zoom)}`,
    '[node name="Terrain" type="Node2D" parent="Map"]');
  project.layers.forEach((layer,index) => {
    const name = `Layer_${index}`, path = `Map/Terrain/${name}`;
    const zIndex=layerBands.get(layer.id).terrainZ;
    nodes.push(`[node name=${quote(name)} type="TileMapLayer" parent="Map/Terrain"]\nvisible = ${layer.visible}\nz_index = ${zIndex}\nposition = ${vec(-project.grid.tileWidth/2,-project.grid.tileHeight/2)}\ntile_map_data = ${cellBytes(layer.cells,sourceIds)}\ntile_set = SubResource("MapTiles")\nscript = ExtResource("2_tiles")\nmetadata/studio_id = ${quote(layer.id)}\nmetadata/studio_name = ${quote(layer.name)}\nmetadata/studio_locked = ${layer.locked}`);
    const cells = Object.entries(layer.cells).map(([key,assetId])=>{const[x,y]=key.split(',').map(Number);return {x,y,assetId,sourceId:sourceIds.get(assetId)};});
    mapping.layers.push({id:layer.id,path,visible:layer.visible,zIndex,cells});mapping.cellCount+=cells.length;
  });
  nodes.push('[node name="Actors" type="Node2D" parent="Map"]\ny_sort_enabled = true');
  // Stable document order resolves equal-Y ties, matching the editor.
  project.objects.forEach((object,index) => {
    const name=`Object_${index}`,asset=assetMap.get(object.assetId),basePosition=isoToScreen(object.x,object.y,project.grid),occlusion=getObjectOcclusion(object),sortOffset={x:0,y:occlusion.depthOffset*project.grid.tileHeight/2},position={x:basePosition.x,y:basePosition.y+sortOffset.y};
    const band=layerBands.get(object.layerId),visible=band.layer.visible,zIndex=band.objectZ,crop=asset.atlas||{x:0,y:0,width:0,height:0};
    nodes.push(`[node name=${quote(name)} type="Sprite2D" parent="Map/Actors"]\nvisible = ${visible}\nz_index = ${zIndex}\nposition = ${vec(position.x,position.y)}\ntexture = ExtResource(${quote(resourceIds.get(asset.id))})\nscript = ExtResource("3_sprites")\nstudio_source = ExtResource(${quote(resourceIds.get(asset.id))})\nstudio_size = ${vec(object.width,object.height)}\nstudio_anchor = ${vec(object.anchorX,object.anchorY)}\nstudio_sort_offset = ${vec(sortOffset.x,sortOffset.y)}\nstudio_crop = Rect2i(${crop.x}, ${crop.y}, ${crop.width}, ${crop.height})\nmetadata/studio_id = ${quote(object.id)}\nmetadata/studio_name = ${quote(object.name)}\nmetadata/studio_layer = ${quote(object.layerId)}`);
    mapping.objects.push({id:object.id,path:`Map/Actors/${name}`,assetId:asset.id,layerId:object.layerId,visible,zIndex,position,size:{x:object.width,y:object.height},offset:{x:-object.width*object.anchorX-sortOffset.x,y:-object.height*object.anchorY-sortOffset.y},cell:{x:object.x,y:object.y},footprint:object.footprint,collision:getObjectCollision(object),occlusion});
  });
  nodes.push(`[node name="Player" type="Node2D" parent="Map/Actors"]\nz_index = ${actorBand.objectZ}\nvisible = ${actorBand.layer.visible}\nmetadata/studio_layer = ${quote(actorBand.layer.id)}\nmetadata/studio_preview = true`,
    '[node name="Shadow" type="Polygon2D" parent="Map/Actors/Player"]\ncolor = Color(0.015, 0.03, 0.02, 0.5)\npolygon = PackedVector2Array(-12,0,0,-5,12,0,0,5)',
    '[node name="Cape" type="Polygon2D" parent="Map/Actors/Player"]\ncolor = Color(0.7,0.28,0.17,1)\npolygon = PackedVector2Array(-4,-26,5,-26,10,-3,0,0,-10,-3)',
    '[node name="Head" type="Polygon2D" parent="Map/Actors/Player"]\ncolor = Color(0.94,0.78,0.5,1)\npolygon = PackedVector2Array(-5,-29,-3,-35,3,-35,5,-29,3,-25,-3,-25)');
  nodes.push('[node name="Collisions" type="Node2D" parent="Map"]');
  const addCollider=(id,x,y,width,height)=>{
    const index=mapping.colliders.length,name=`Collider_${index}`,position=isoToScreen(x,y,project.grid);
    const points=[[-.5,-.5],[width-.5,-.5],[width-.5,height-.5],[-.5,height-.5]].map(([a,b])=>isoToScreen(a,b,project.grid));
    nodes.push(`[node name=${quote(name)} type="StaticBody2D" parent="Map/Collisions"]\nposition = ${vec(position.x,position.y)}\ncollision_layer = 1\ncollision_mask = 0\nmetadata/studio_id = ${quote(id)}`,`[node name="Shape" type="CollisionPolygon2D" parent=${quote(`Map/Collisions/${name}`)}]\npolygon = ${polygon(points)}`);
    mapping.colliders.push({id,path:`Map/Collisions/${name}`});
  };
  for(const object of project.objects)if(object.blocking){const region=getObjectCollision(object);addCollider(object.id,object.x+region.x,object.y+region.y,region.width,region.height);}
  for(const key of project.blocked){const[x,y]=key.split(',').map(Number);addCollider(`blocked:${key}`,x,y,1,1);}
  nodes.push('[node name="Markers" type="Node2D" parent="Map"]');
  project.markers.forEach((marker,index)=>{
    const name=`Marker_${index}`,position=isoToScreen(marker.x,marker.y,project.grid),type=marker.type==='spawn'?'Marker2D':'Area2D';
    nodes.push(`[node name=${quote(name)} type=${quote(type)} parent="Map/Markers"]\nposition = ${vec(position.x,position.y)}\n${type==='Area2D'?'collision_layer = 2\ncollision_mask = 0\n':''}metadata/studio_id = ${quote(marker.id)}\nmetadata/studio_type = ${quote(marker.type)}\nmetadata/studio_name = ${quote(marker.name)}`);
    if(type==='Area2D')nodes.push(`[node name="Shape" type="CollisionPolygon2D" parent=${quote(`Map/Markers/${name}`)}]\npolygon = ${polygon([[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].map(([x,y])=>isoToScreen(x,y,project.grid)))}`);
    mapping.markers.push({id:marker.id,path:`Map/Markers/${name}`,type:marker.type});
  });
  const spawn=project.markers.find(marker=>marker.type==='spawn');
  let fallback;
  for(let y=0;y<project.grid.height;y++)for(let x=0;x<project.grid.width;x++){const allowed=isWalkable(project,x,y);mapping.walkability.push(allowed);if(allowed&&!fallback)fallback={x,y};}
  mapping.spawn=spawn?{x:spawn.x,y:spawn.y}:fallback||{x:0,y:0};
  const exit=project.markers.find(marker=>marker.type==='exit');
  if(exit)mapping.testPath=findPath(project,mapping.spawn,{x:exit.x,y:exit.y});
  const playability = analyzeMapPlayability(project);
  const exitReachable = exit ? mapping.testPath.length > 0 : null;
  if(mapping.testPath.length<2 && isWalkable(project,mapping.spawn.x,mapping.spawn.y)){
    // One adjacent reachable cell is enough to exercise movement when no exit is
    // reachable. Avoid an entire BFS per candidate on a large/enclosed map.
    for(const[dx,dy]of[[1,0],[0,1],[-1,0],[0,-1]]){
      const destination={x:mapping.spawn.x+dx,y:mapping.spawn.y+dy};
      if(isWalkable(project,destination.x,destination.y)){mapping.testPath=[mapping.spawn,destination];break;}
    }
  }
  const warnings=[
    {code:'isometric-2d',message:'This is a flat isometric 2D map. Elevation, 3D cameras and terrain meshes are not represented.'},
    {code:'grid-navigation',message:'Preview uses four-neighbour grid BFS with the configured actor footprint and independent static object collision polygons. It does not generate a navigation mesh or continuous CharacterBody2D movement.'},
    {code:'marker-hooks',message:'Spawn, exit, trigger and interaction IDs are retained. Enter exits/triggers or press E beside interactions to emit marker_entered; connect game-specific actions yourself.'},
  ];
  if(!isWalkable(project,mapping.spawn.x,mapping.spawn.y))warnings.push({code:'blocked-spawn',message:'Spawn is blocked. The preview player is hidden until its spawn is moved to a walkable cell.'});
  for(const issue of playability.issues)if(issue.code==='unreachable-marker')warnings.push({code:issue.code,message:`Marker ${issue.markerId} is unreachable for the configured actor.`});
  if(exitReachable===false)warnings.push({code:'unreachable-exit',message:'The first exit cannot be reached from the preview spawn using the current walkability map.'});
  if(project.assets.some(asset=>asset.kind==='tile'&&(!Number.isInteger(asset.width)||!Number.isInteger(asset.height))))warnings.push({code:'fractional-tile-size',message:'Godot tile textures use whole pixels; fractional tile image display dimensions are rounded.'});
  const scene=`[gd_scene load_steps=${ext.length+sub.length+1} format=3]\n\n${ext.join('\n')}\n\n${sub.join('\n\n')}\n\n${nodes.join('\n\n')}\n`;
  return {assets,files:{
    'playability-report.json':json(playability),
    'project.godot':`; Game UI Studio map export; requires Godot 4.3 or newer.\nconfig_version=5\n\n[application]\nconfig/name=${quote(project.name)}\nrun/main_scene="res://map.tscn"\nconfig/features=PackedStringArray("4.3", "GL Compatibility")\n\n[display]\nwindow/size/viewport_width=1280\nwindow/size/viewport_height=800\nwindow/stretch/mode="canvas_items"\n\n[rendering]\nrenderer/rendering_method="gl_compatibility"\nrenderer/rendering_method.mobile="gl_compatibility"\nenvironment/defaults/default_clear_color=Color(0.045, 0.075, 0.065, 1)\ntextures/default_filters/use_nearest_mipmap_filter=false\n`,
    'map.tscn':scene,'map_runtime.gd':RUNTIME_SCRIPT,'tile_display.gd':TILE_SCRIPT,'sprite_display.gd':SPRITE_SCRIPT,
    'map.json':json(project),'node-map.json':json(mapping),'export-warnings.json':json(warnings),
    'README.md':`# Game UI Studio — Godot map export\n\nOpen project.godot with Godot 4.3 or newer, then run the project (F6 runs map.tscn). Click a cell to walk, or use WASD/arrow keys along grid axes. The red-caped preview character sorts with buildings and trees by its feet within the configured actor layer.\n\nTerrain uses native, editable TileMapLayer nodes and TileSet atlas sources. Objects are Sprite2D nodes; studio_size, studio_anchor and studio_crop preserve image dimensions and anchors. The @tool display scripts normalize original textures in the editor and runtime. Layers follow the Studio back-to-front order: each terrain band is followed by its object band; foot sorting applies within that band. The configured actor layer determines the player band. Asset footprint defaults are retained in map.json; each placed object has its own occupied-cell footprint and native collision polygon. Every map layer, object and marker carries studio_id metadata; node-map.json maps it to a Godot node path. Cell identity is layer ID plus grid coordinate.\n\nStaticBody2D footprint polygons and blocked cells are real physics shapes on collision layer 1. Hidden layers retain collision, matching Studio. Exit/trigger Area2D nodes use layer 2; the preview emits marker_entered(id,type), without inventing gameplay or teleport destinations. Grid navigation is not a NavigationRegion2D bake.\n\nFunctional validation, export fidelity and art approval are separate. Read export-warnings.json. This is a flat isometric 2D map, not a height-aware 3D terrain editor.\n\nVerify with your Godot executable:\n\n\`\`\`text\ngodot --headless --editor --path "<EXPORT>" --import\ngodot --path "<EXPORT>" --audio-driver Dummy --rendering-method gl_compatibility -- --studio-verify --studio-result=<ABS_RESULT_JSON> --studio-screenshot=<ABS_PNG>\n\`\`\`\n\nUse absolute output paths and a graphical display for screenshots. Headless runs validate scene structure, all cells, walkability, physics blockers and actual character movement but cannot validate a rendered image.\n`,
  }};
}
