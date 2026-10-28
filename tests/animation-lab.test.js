import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnimationProject,validateAnimationProject,renderAnimationFrame,getAnimationRenderBounds,animationDiff,createAnimationFeedback,regenerateAnimation} from '../src/animationModel.js';
import {createPlaytestState,stepPlaytest,addPlaytestActions,clipTimeline,moveAnimationEvent,createDemoEquipment,inspectEquipment} from '../src/animationLabModel.js';
import {createAnimationGodotFiles} from '../server/animationGodot.js';

test('trial moves at pixel speed, exposes startup/active/recovery, buffers combos, interrupts and dodges',()=>{
  const p=addPlaytestActions(createAnimationProject());assert.equal(p.clips.length,20);assert.ok(p.clips.filter(c=>c.action==='dodge').every(c=>c.frames.some(f=>f.pose.torso)));
  let s=createPlaytestState(p);s=stepPlaytest(p,s,{x:1},100);assert.equal(s.action,'walk');assert.equal(s.direction,'right');assert.equal(s.x,7.2);
  s=stepPlaytest(p,s,{attack:true},10);assert.equal(s.action,'attack');assert.equal(s.phase,'startup');assert.equal(s.combo,1);
  s=stepPlaytest(p,s,{},300);assert.equal(s.phase,'active');assert.ok(s.events.some(e=>e.name==='hit'));
  s=stepPlaytest(p,s,{},180);assert.equal(s.phase,'recovery');s=stepPlaytest(p,s,{attack:true},1);assert.equal(s.queuedAttack,true);s=stepPlaytest(p,s,{},300);assert.equal(s.action,'attack');assert.equal(s.combo,2);
  s=stepPlaytest(p,s,{hurt:true},1);assert.equal(s.action,'hurt');assert.equal(s.combo,0);assert.equal(s.queuedAttack,false);
  s=stepPlaytest(p,s,{},600);s=stepPlaytest(p,s,{dodge:true,x:-1},50);assert.equal(s.action,'dodge');assert.equal(s.direction,'left');const x=s.x;s=stepPlaytest(p,s,{hurt:true},20);assert.equal(s.action,'dodge');assert.ok(s.x<x);
});
test('events fire once on frame entry and hitbox channels close independently with motion deltas',()=>{
  const p=createAnimationProject(),c=p.clips.find(c=>c.id==='attack-down');c.frames.forEach(f=>f.events=[]);
  c.frames[0].events=[{id:'open-main',name:'open',type:'hitbox-on',channel:'main',hitbox:{x:10,y:10,width:40,height:30}},{id:'open-side',name:'open-side',type:'hitbox-on',channel:'side',hitbox:{x:0,y:0,width:1,height:1}}];
  c.frames[1].events=[{id:'move',name:'lunge',type:'move',delta:{x:20,y:-2}}];c.frames[2].events=[{id:'close',name:'close',type:'hitbox-off',channel:'main'}];validateAnimationProject(p);
  let s=stepPlaytest(p,createPlaytestState(p),{attack:true},20);assert.equal(s.events.length,2);assert.equal(Object.keys(s.activeHitboxes).length,2);
  s=stepPlaytest(p,s,{},20);assert.equal(s.events.length,0);s=stepPlaytest(p,s,{},70);assert.equal(s.x,20);assert.equal(s.y,-2);assert.equal(s.events[0].name,'lunge');
  s=stepPlaytest(p,s,{},100);assert.ok(!s.activeHitboxes.main);assert.ok(s.activeHitboxes.side);s=stepPlaytest(p,s,{hurt:true},1);assert.deepEqual(s.activeHitboxes,{});
});
test('timeline preserves all event payload and identity while moving and rejects invalid destinations',()=>{
  const p=createAnimationProject(),c=p.clips[0],event={id:'slash-sound',name:'slash',type:'audio',resource:'res://sfx/slash.ogg',channel:'weapon',custom:{volume:.7}};c.frames[0].events=[event];
  const before=structuredClone(p),next=moveAnimationEvent(p,c.id,c.frames[0].id,0,c.frames[2].id);
  assert.deepEqual(p,before);assert.equal(next.clips[0].frames[0].events.length,0);assert.deepEqual(next.clips[0].frames[2].events[0],event);assert.deepEqual(next.clips[0].frames.map(f=>f.id),c.frames.map(f=>f.id));
  assert.equal(clipTimeline(c)[2].startMs,c.frames[0].durationMs+c.frames[1].durationMs);assert.throws(()=>moveAnimationEvent(p,c.id,c.frames[0].id,3,c.frames[2].id),/Unknown/);
  assert.deepEqual(regenerateAnimation(next,c.id).clips[0].frames[2].events,[event]);
});
test('equipment follows bone endpoints, preserves pixels, layers and expands output beyond body',()=>{
  const p=createAnimationProject(),item=createDemoEquipment('weapon','greatsword');item.offset.x=100;p.equipment=[item];validateAnimationProject(p);const b=getAnimationRenderBounds(p);assert.ok(b.width>140);assert.deepEqual(p.canvas,{width:64,height:96});
  const first=renderAnimationFrame(p,'attack-right','attack-right-1',b),swing=renderAnimationFrame(p,'attack-right','attack-right-4',b);assert.notDeepEqual(first.pixels,swing.pixels);assert.equal(first.clippedPixels,0);
  const image={width:1,height:1,pixels:[255,0,0,255]},f=p.clips[0].frames[0];f.image=image;const saved=structuredClone(image);renderAnimationFrame(p,p.clips[0].id,f.id);assert.deepEqual(f.image,saved);
  p.equipment[0].enabled=false;assert.ok(getAnimationRenderBounds(p).width<b.width);assert.deepEqual(item.pixels,createDemoEquipment('weapon','other').pixels);
  const next=structuredClone(p);next.equipment[0].enabled=true;assert.ok(animationDiff(p,next).some(d=>d.path==='equipment'));
});
test('front and rear equipment compose around imported opaque and transparent pixels',()=>{
  const p=createAnimationProject(),c=p.clips[0],f=c.frames[0];const body=renderAnimationFrame(p,c.id,f.id),bone=body.bones.find(b=>b.id==='pelvis'),x=Math.round(bone.x),y=Math.round(bone.y);
  f.image={width:64,height:96,pixels:Array(64*96*4).fill(0)};f.image.pixels.splice((y*64+x)*4,4,255,0,0,255);
  p.equipment=[{...createDemoEquipment('accessory','jewel'),boneId:'pelvis',width:2,height:1,pixels:[0,255,0,255,0,0,255,255],pivot:{x:0,y:0},layer:-1}];
  let r=renderAnimationFrame(p,c.id,f.id);const at=(y*r.width+x)*4;assert.deepEqual([...r.pixels.slice(at,at+8)],[255,0,0,255,0,0,255,255]);p.equipment[0].layer=1;r=renderAnimationFrame(p,c.id,f.id);assert.deepEqual([...r.pixels.slice(at,at+4)],[0,255,0,255]);
});
test('invalid equipment, event channels and duplicate identities are rejected before persistence',()=>{
  const p=createAnimationProject();p.equipment=[createDemoEquipment()];p.equipment[0].boneId='missing';assert.throws(()=>validateAnimationProject(p),/equipment/);p.equipment[0].boneId='rightForearm';p.equipment.push(structuredClone(p.equipment[0]));assert.throws(()=>validateAnimationProject(p),/equipment/);p.equipment=[];
  p.clips[0].frames[0].events=[{id:'same',name:'first'},{id:'same',name:'second'}];assert.throws(()=>validateAnimationProject(p),/duplicate/);
  p.clips[0].frames[0].events=[{name:'open',type:'hitbox-on'}];assert.throws(()=>validateAnimationProject(p),/rectangle/);p.clips[0].frames[0].events=[{name:'move',type:'move',delta:{x:9999,y:0}}];assert.throws(()=>validateAnimationProject(p),/delta/);
});
test('feedback includes equipment context; export carries every typed payload and runtime adapters',()=>{
  const p=createAnimationProject();p.equipment=[createDemoEquipment()];p.equipment[0].offset.x=80;p.playtest={speed:72,dodgeSpeed:180,comboWindow:.55,maxCombo:3};p.paletteVariants=[{id:'saved',name:'Original',colors:[...p.palette]}];
  const c=p.clips[0],f=c.frames[0];f.events=[{id:'sound',name:'swing',type:'audio',resource:'res://audio/swing.ogg'},{id:'move',name:'lunge',type:'move',delta:{x:12,y:0}},{id:'on',name:'on',type:'hitbox-on',channel:'sword',hitbox:{x:40,y:30,width:80,height:20}}];
  p.reviews=[{id:'review',clipId:c.id,frameIds:[f.id],partId:'rightForearm',target:'Grip',expected:'Review weapon',priority:'high',status:'pending',protectedProperties:['equipment']}];
  const feedback=createAnimationFeedback(p);assert.deepEqual(feedback.equipment,p.equipment);assert.deepEqual(feedback.paletteVariants,p.paletteVariants);assert.deepEqual(feedback.playtest,p.playtest);
  const exported=createAnimationGodotFiles(p),mapping=JSON.parse(exported.files['animation-map.json']);assert.deepEqual(mapping.clips[0].frames[0].events,f.events);assert.equal(mapping.equipment[0].id,p.equipment[0].id);assert.equal(mapping.equipment[0].pixels,undefined);assert.match(exported.files['animation_player.gd'],/signal movement_requested/);assert.match(exported.files['animation_player.gd'],/active_hitboxes\[channel\]/);assert.match(exported.files['animation_player.gd'],/resource_event.emit/);
  const report=inspectEquipment(p);assert.equal(report.artApproval,'pending');assert.equal(report.reports.filter(r=>r.clipId).length,12);assert.ok(report.reports.some(r=>r.outsideBodyPixels>0));
});
