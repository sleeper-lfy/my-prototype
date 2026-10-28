import { validateAnimationProject, renderAnimationFrame, getAnimationRenderBounds } from '../src/animationModel.js';
import { encodeAnimationPng } from './animationPng.js';
import { MOTION_SOURCE, MOTION_LICENSE_NOTICE } from '../src/motionPresets.js';

const quote = value => JSON.stringify(String(value));
/** Exports immutable rendered pixels with an executable event adapter and verifier. */
export function createAnimationGodotFiles(project) {
  validateAnimationProject(project);
  const renderBounds = getAnimationRenderBounds(project);
  const origin = {x: -renderBounds.x, y: -renderBounds.y};
  const files={},resources=[],animations=[],mapping={schemaVersion:1,projectId:project.id,revision:project.revision,canvas:project.canvas,renderBounds,origin,equipment:(project.equipment||[]).map(({pixels,...item})=>item),playtest:project.playtest||null,clips:[]};
  let resourceIndex=1;
  for(const clip of project.clips){
    const records=[],frames=[];
    for(const frame of clip.frames){
      const id=String(resourceIndex++),texture=`frames/${clip.id}/${frame.id}.png`;
      files[texture]=encodeAnimationPng(renderAnimationFrame(project,clip.id,frame.id,renderBounds));
      resources.push(`[ext_resource type="Texture2D" path=${quote('res://'+texture)} id=${quote(id)}]`);
      frames.push(`{\n"duration": ${frame.durationMs/1000},\n"texture": ExtResource(${quote(id)})\n}`);
      records.push({id:frame.id,durationMs:frame.durationMs,texture,events:frame.events||[],contacts:frame.contacts||[]});
    }
    animations.push(`{\n"frames": [${frames.join(',\n')}],\n"loop": ${!!clip.loop},\n"name": &${quote(clip.id)},\n"speed": 1.0\n}`);
    mapping.clips.push({id:clip.id,name:clip.name,action:clip.action,direction:clip.direction,loop:!!clip.loop,...(clip.motionSource ? {motionSource:structuredClone(clip.motionSource)} : {}),frames:records});
  }
  const initial=project.clips[0].id;
  files['MOTION-SOURCE.json']=JSON.stringify({availableSource:MOTION_SOURCE,usedClips:mapping.clips.filter(c=>c.motionSource).map(c=>({clipId:c.id,...c.motionSource}))},null,2)+'\n';
  files['MOTION-LICENSE.txt']=MOTION_LICENSE_NOTICE;
  files['character.tres']=`[gd_resource type="SpriteFrames" load_steps=${resources.length+1} format=3]\n${resources.join('\n')}\n[resource]\nanimations = [${animations.join(',\n')}]\n`;
  files['animation-map.json']=JSON.stringify(mapping,null,2)+'\n';
  files['animation_player.gd']=`extends AnimatedSprite2D
signal animation_event(event_name: String, payload: Dictionary)
signal movement_requested(delta_pixels: Vector2)
signal resource_event(kind: String, resource_id: String, payload: Dictionary)
var studio_data: Dictionary = {}
var emitted_events: Array = []
var emitted_payloads: Array = []
var active_hitboxes: Dictionary = {}
var _events_pending: bool = false
func _ready():
    studio_data = JSON.parse_string(FileAccess.get_file_as_string("res://animation-map.json"))
    frame_changed.connect(_schedule_events)
    animation_changed.connect(_on_animation_changed)
    animation_looped.connect(_schedule_events)
    play(${quote(initial)})
    _schedule_events()
func _schedule_events():
    if not _events_pending:
        _events_pending = true
        _emit_frame_events.call_deferred()
func _on_animation_changed():
    active_hitboxes.clear()
    _schedule_events()
func _emit_frame_events():
    _events_pending = false
    for clip in studio_data.get("clips", []):
        if clip.id == str(animation) and frame >= 0 and frame < clip.frames.size():
            for event in clip.frames[frame].get("events", []):
                var payload: Dictionary = event if event is Dictionary else {"name": str(event)}
                var event_name: String = str(payload.get("name", payload.get("type", "event")))
                emitted_events.append({"clipId": clip.id, "frameId": clip.frames[frame].id, "name": event_name})
                emitted_payloads.append(payload.duplicate(true))
                var channel: String = str(payload.get("channel", "primary"))
                match str(payload.get("type", "marker")):
                    "hitbox-on": active_hitboxes[channel] = payload.get("hitbox", {}).duplicate(true)
                    "hitbox-off": active_hitboxes.erase(channel)
                    "move":
                        var delta: Dictionary = payload.get("delta", {})
                        movement_requested.emit(Vector2(float(delta.get("x", 0)), float(delta.get("y", 0))))
                    "audio", "vfx": resource_event.emit(str(payload.type), str(payload.get("resource", "")), payload)
                animation_event.emit(event_name, payload)
func set_clip(clip_id: String):
    if sprite_frames.has_animation(clip_id):
        play(clip_id)
`;
  files['main.tscn']=`[gd_scene load_steps=4 format=3]\n[ext_resource type="SpriteFrames" path="res://character.tres" id="1"]\n[ext_resource type="Script" path="res://animation_player.gd" id="2"]\n[ext_resource type="Script" path="res://preview.gd" id="3"]\n[node name="AnimationPreview" type="Node2D"]\nscript = ExtResource("3")\n[node name="Character" type="AnimatedSprite2D" parent="."]\nposition = Vector2(${16 - renderBounds.x * 4}, ${48 - renderBounds.y * 4})\ncentered = false\noffset = Vector2(${renderBounds.x}, ${renderBounds.y})\nscale = Vector2(4, 4)\ntexture_filter = 1\nsprite_frames = ExtResource("1")\nanimation = &${quote(initial)}\nscript = ExtResource("2")\nmetadata/studio_id = ${quote(project.id)}\n[node name="Instructions" type="Label" parent="."]\noffset_left = 12.0\noffset_top = 8.0\ntext = "Arrow keys: change clip"\n`;
  files['project.godot']=`config_version=5\n[application]\nconfig/name=${quote(project.name+' — pixel animation')}\nrun/main_scene="res://main.tscn"\n[display]\nwindow/size/viewport_width=${renderBounds.width * 4 + 32}\nwindow/size/viewport_height=${renderBounds.height * 4 + 64}\n[rendering]\nrenderer/rendering_method="gl_compatibility"\ntextures/default_filters/use_nearest_mipmap_filter=false\nenvironment/defaults/default_clear_color=Color(0.055, 0.075, 0.09, 1)\n`;
  files['preview.gd']=`extends Node2D
var selected: int = 0
func _ready():
    if "--studio-verify" in OS.get_cmdline_user_args():
        verify.call_deferred()
func _unhandled_key_input(event):
    if event.is_pressed() and not event.is_echo():
        if event.keycode == KEY_RIGHT or event.keycode == KEY_DOWN:
            selected += 1
        elif event.keycode == KEY_LEFT or event.keycode == KEY_UP:
            selected -= 1
        else:
            return
        var clips: Array = $Character.studio_data.clips
        selected = posmod(selected, clips.size())
        $Character.set_clip(clips[selected].id)
func verify():
    var result_path: String = ""
    var screenshot_path: String = ""
    var capture_clip: String = ""
    var capture_frame: int = 0
    for arg in OS.get_cmdline_user_args():
        if arg.begins_with("--studio-result="): result_path = arg.trim_prefix("--studio-result=")
        if arg.begins_with("--studio-screenshot="): screenshot_path = arg.trim_prefix("--studio-screenshot=")
        if arg.begins_with("--studio-capture-clip="): capture_clip = arg.trim_prefix("--studio-capture-clip=")
        if arg.begins_with("--studio-capture-frame="): capture_frame = int(arg.trim_prefix("--studio-capture-frame="))
    var failures: Array = []
    if $Character.centered: failures.append("sprite centered unexpectedly")
    var expected_offset: Vector2 = Vector2($Character.studio_data.renderBounds.x, $Character.studio_data.renderBounds.y)
    if $Character.offset != expected_offset: failures.append("body origin changed")
    var checked_frames: int = 0
    var expected_events: int = 0
    $Character.stop()
    $Character.emitted_events.clear()
    for clip in $Character.studio_data.clips:
        if not $Character.sprite_frames.has_animation(clip.id):
            failures.append("missing clip " + clip.id)
            continue
        if $Character.sprite_frames.get_frame_count(clip.id) != clip.frames.size(): failures.append("frame count " + clip.id)
        if $Character.sprite_frames.get_animation_loop(clip.id) != clip.loop: failures.append("loop " + clip.id)
        for index in range(clip.frames.size()):
            var frame: Dictionary = clip.frames[index]
            var texture: Texture2D = $Character.sprite_frames.get_frame_texture(clip.id, index)
            if texture.get_width() != int($Character.studio_data.renderBounds.width) or texture.get_height() != int($Character.studio_data.renderBounds.height): failures.append("texture dimensions " + frame.id)
            var seconds: float = $Character.sprite_frames.get_frame_duration(clip.id, index) / $Character.sprite_frames.get_animation_speed(clip.id)
            if abs(seconds - float(frame.durationMs)/1000.0) > 0.00001: failures.append("duration " + frame.id)
            $Character.emitted_events.clear()
            $Character.animation = clip.id
            if $Character.frame == index:
                $Character.set_frame_and_progress(posmod(index + 1, clip.frames.size()), 0.0)
            $Character.set_frame_and_progress(index, 0.0)
            await get_tree().process_frame
            await get_tree().process_frame
            expected_events += frame.events.size()
            if $Character.emitted_events.size() != frame.events.size(): failures.append("events " + frame.id)
            checked_frames += 1
    for clip in $Character.studio_data.clips:
        if clip.action != "attack": continue
        $Character.stop()
        $Character.animation = clip.id
        $Character.set_frame_and_progress(0, 0.0)
        await get_tree().process_frame
        await get_tree().process_frame
        $Character.emitted_events.clear()
        var expected_attack_events: int = 0
        var attack_duration: float = 0.0
        for frame in clip.frames:
            attack_duration += float(frame.durationMs)/1000.0
            expected_attack_events += frame.events.size()
        $Character.animation = $Character.studio_data.clips[0].id
        $Character.play(clip.id)
        await get_tree().create_timer(attack_duration + 0.08).timeout
        if $Character.emitted_events.size() != expected_attack_events: failures.append("duplicate or missed playback event " + clip.id)
        break
    $Character.animation = $Character.studio_data.clips[0].id
    $Character.set_frame_and_progress(0, 0.0)
    $Character.play()
    var changes: Array = [0]
    var count_change = func(): changes[0] += 1
    $Character.frame_changed.connect(count_change)
    var first_duration: float = $Character.sprite_frames.get_frame_duration($Character.animation, 0) / $Character.sprite_frames.get_animation_speed($Character.animation)
    await get_tree().create_timer(first_duration + 0.1).timeout
    $Character.frame_changed.disconnect(count_change)
    var playback_advanced: bool = changes[0] > 0
    if not playback_advanced: failures.append("playback did not advance")
    $Character.stop()
    if capture_clip != "": $Character.animation = capture_clip
    $Character.set_frame_and_progress(capture_frame, 0.0)
    await RenderingServer.frame_post_draw
    if screenshot_path != "": get_viewport().get_texture().get_image().save_png(screenshot_path)
    var report: Dictionary = {"passed": failures.is_empty(), "failures": failures, "checkedFrames": checked_frames, "checkedEvents": expected_events, "playbackAdvanced": playback_advanced, "projectId": $Character.studio_data.projectId, "revision": $Character.studio_data.revision, "renderBounds": $Character.studio_data.renderBounds, "origin": $Character.studio_data.origin, "fixedOrigin": not $Character.centered and $Character.offset == expected_offset}
    if result_path != "":
        var file = FileAccess.open(result_path, FileAccess.WRITE)
        file.store_string(JSON.stringify(report, "  "))
    print(JSON.stringify(report))
    get_tree().quit(0 if failures.is_empty() else 1)
`;
  files['README.md']='# Pixel animation export\n\nOpen project.godot in Godot 4.3+. Arrow keys cycle animations. The 64×96 body reference does not clip frame contents. All frames share one union render rectangle and a fixed body origin; AnimatedSprite2D centered=false and offset preserve body coordinates across actions. AnimatedSprite2D uses lossless original-size textures with nearest filtering and variable frame duration. Connect animation_event to game logic; typed events also maintain active_hitboxes, emit movement_requested(delta_pixels), and emit resource_event(kind, resource_id, payload) for audio/VFX. Resources are identifiers and are not loaded or executed automatically. Equipment is baked into frame pixels and attachment metadata is recorded in animation-map.json. Frames retain stable IDs in animation-map.json. Events are data and do not execute supplied code. Imported art retains its original license.\n\nTest with: godot --headless --editor --path . --import, then godot --path . -- --studio-verify --studio-result=/absolute/result.json --studio-screenshot=/absolute/frame.png. A graphical display is required for screenshots.\n';
  files['export-warnings.json']=JSON.stringify(['Rendered sprite frames are exported; editable rig and IK remain in the Studio project JSON.','Contact markers and active_hitboxes are metadata; collision geometry, movement and audio/VFX resource binding must be integrated with game logic.'],null,2);
  return {files,warnings:JSON.parse(files['export-warnings.json'])};
}
