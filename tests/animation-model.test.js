import test from 'node:test';
import assert from 'node:assert/strict';
import {MOTION_PRESETS} from '../src/motionPresets.js';
import {createAnimationProject,validateAnimationProject,getAnimationRenderBounds,renderAnimationFrame,checkAnimationProject,regenerateAnimation,applyMotionPreset,animationDiff,applyAnimationPatch,createAnimationFeedback} from '../src/animationModel.js';
const review = (p, extra={}) => ({id:'review-one',clipId:p.clips[0].id,frameIds:[p.clips[0].frames[0].id],partId:'head',target:'Head timing',expected:'Hold longer',priority:'high',status:'pending',protectedProperties:['pose.head'],...extra});
const patch = (p, operations, reviewIds=[]) => ({kind:'studio-animation-patch',schemaVersion:1,projectId:p.id,baseRevision:p.revision,operations,reviewIds});
const op = (p,path,value,index=0) => ({clipId:p.clips[0].id,frameId:p.clips[0].frames[index].id,path,value});
test('64x96 body presets retain natural attack extension with shared frame bounds and reachable contacts',()=>{
 const p=createAnimationProject();validateAnimationProject(p);assert.deepEqual(p.canvas,{width:64,height:96});assert.equal(p.clips.length,12);assert.deepEqual(checkAnimationProject(p),[]);const bounds=getAnimationRenderBounds(p);assert.ok(bounds.width>64);assert.equal(bounds.height,96);
 for(const clip of p.clips) {const f=clip.frames[0], a=renderAnimationFrame(p,clip.id,f.id,bounds),b=renderAnimationFrame(p,clip.id,f.id,bounds);assert.deepEqual(a.pixels,b.pixels);assert.equal(a.pixels.length,bounds.width*bounds.height*4);assert.deepEqual(a.bounds,bounds);assert.deepEqual(a.origin,{x:0,y:0});assert.ok(a.pixels.some(x=>x>0));assert.ok([...a.pixels].filter((_,i)=>i%4===3).every(a=>a===0||a===255));}
 assert.notDeepEqual(renderAnimationFrame(p,'idle-down','idle-down-1').pixels,renderAnimationFrame(p,'idle-up','idle-up-1').pixels);
});
test('review patches require matching project and revision, enforce scope and protected fields, and preserve original',()=>{
 const p=createAnimationProject();p.reviews=[review(p)];const before=structuredClone(p);
 assert.throws(()=>applyAnimationPatch(p,{...patch(p,[op(p,'durationMs',220)]),projectId:'other'}),/projectId/);
 assert.throws(()=>applyAnimationPatch(p,{...patch(p,[op(p,'durationMs',220)]),baseRevision:9}),/Stale/);
 assert.throws(()=>applyAnimationPatch(p,patch(p,[op(p,'pose.head',20)],['review-one'])),/Protected/);
 assert.throws(()=>applyAnimationPatch(p,patch(p,[op(p,'durationMs',220,1)],['review-one'])),/scope/);
 assert.throws(()=>applyAnimationPatch(p,patch(p,[op(p,'__proto__.polluted',true)])),/forbidden/);
 const result=applyAnimationPatch(p,patch(p,[op(p,'durationMs',220)],['review-one']));assert.equal(result.project.revision,1);assert.equal(result.project.clips[0].frames[0].durationMs,220);assert.equal(result.project.reviews[0].status,'modified');assert.deepEqual(p,before);assert.ok(result.diff.some(d=>d.path==='durationMs'));
});
test('feedback includes only pending frame targets and effective overlapping constraints',()=>{
 const p=createAnimationProject();p.reviews=[review(p),review(p,{id:'other-constraint',status:'acceptance',protectedProperties:['root']}),review(p,{id:'done',status:'approved'})];
 const f=createAnimationFeedback(p);assert.equal(f.reviews.length,1);assert.equal(f.constraints.length,2);assert.equal(f.clips.length,1);assert.equal(f.clips[0].frames.length,1);
 assert.throws(()=>applyAnimationPatch(p,patch(p,[op(p,'root.x',33)],['review-one'])),/Protected/);
});
test('sprite overrides preserve exact bytes and survive regeneration while IDs and comments stay stable',()=>{
 const p=createAnimationProject(),c=p.clips[0],f=c.frames[0];f.image={width:64,height:96,pixels:Array(64*96*4).fill(0)};f.image.pixels.splice(100*4,4,18,100,160,255);p.reviews=[review(p)];
 const output=renderAnimationFrame(p,c.id,f.id);for(let y=0;y<96;y++)assert.deepEqual([...output.pixels.slice(y*output.width*4,(y*output.width+64)*4)],f.image.pixels.slice(y*64*4,(y+1)*64*4));
 const next=regenerateAnimation(p,c.id);assert.deepEqual(next.clips[0].frames.map(f=>f.id),c.frames.map(f=>f.id));assert.deepEqual(next.clips[0].frames[0].image,f.image);assert.deepEqual(next.reviews,p.reviews);
});
test('part mapping replaces default head geometry and expands bounds for outside-body artwork',()=>{
 const p=createAnimationProject(),c=p.clips[0],f=c.frames[0],base=renderAnimationFrame(p,c.id,f.id);p.parts=[{id:'new-head',boneId:'head',width:1,height:1,pixels:[255,0,0,255],pivot:{x:0,y:0}}];validateAnimationProject(p);
 const replaced=renderAnimationFrame(p,c.id,f.id);const count=image=>[...image.pixels].filter((v,i)=>i%4===3&&v).length;assert.ok(count(replaced)<count(base)-100);assert.ok([...replaced.pixels].some((v,i)=>i%4===0&&v===255&&replaced.pixels[i+1]===0));
 p.parts[0].pivot.x=100;assert.ok(getAnimationRenderBounds(p).x<0);assert.ok(!checkAnimationProject(p).some(f=>f.code==='clipping'));const enlarged=renderAnimationFrame(p,c.id,f.id);assert.ok(enlarged.origin.x>0);
});
test('checks detect imported transparency/palette drift, empty frames, and unreachable contact without treating warnings as art approval',()=>{
 const p=createAnimationProject(),f=p.clips[0].frames[0];f.image={width:64,height:96,pixels:Array(64*96*4).fill(0)};
 assert.ok(checkAnimationProject(p).some(f=>f.code==='empty-frame'));f.image.pixels.splice(0,4,255,0,255,128);f.root.y=10;const findings=checkAnimationProject(p);for(const code of ['alpha','palette','contact-unreachable'])assert.ok(findings.some(f=>f.code===code),code);
});
test('validation rejects dangling frame reviews, cyclic bones, invalid pixels and oversized render budgets',()=>{
 const p=createAnimationProject();p.reviews=[review(p,{frameIds:['missing']})];assert.throws(()=>validateAnimationProject(p),/target/);p.reviews=[];
 p.bones[0].parent='head';assert.throws(()=>validateAnimationProject(p),/hierarchy/);p.bones[0].parent=null;
 p.clips[0].frames[0].image={width:64,height:96,pixels:[]};assert.throws(()=>validateAnimationProject(p),/RGBA/);delete p.clips[0].frames[0].image;
 p.canvas={width:256,height:256};p.clips[0].frames=Array.from({length:120},(_,i)=>({...structuredClone(p.clips[0].frames[0]),id:'large-'+i}));p.clips[1].frames=Array.from({length:120},(_,i)=>({...structuredClone(p.clips[1].frames[0]),id:'more-'+i}));assert.throws(()=>validateAnimationProject(p),/budget/);
});
test('history diffs include review, skeleton, palette, part, clip and deleted frame changes',()=>{
 const p=createAnimationProject(),next=structuredClone(p);next.reviews=[review(p)];next.palette[0]='#000000';next.bones[1].length++;next.clips[0].loop=false;next.clips[1].frames.pop();const diff=animationDiff(p,next);
 for(const key of ['reviews','palette','bones','loop','frame'])assert.ok(diff.some(d=>d.path===key),key);
});

test('large imported images retain full rectangle, transparent padding, offsets and exact RGBA with uniform origin',()=>{
 const p=createAnimationProject(),f=p.clips[0].frames[0];f.image={width:128,height:128,offset:{x:-32,y:-16},pixels:Array(128*128*4).fill(0)};
 f.image.pixels.splice(0,4,3,4,5,0);f.image.pixels.splice((127*128+127)*4,4,255,0,0,255);
 validateAnimationProject(p);const bounds=getAnimationRenderBounds(p);assert.deepEqual(bounds,{x:-32,y:-16,width:128,height:128});
 const rendered=renderAnimationFrame(p,p.clips[0].id,f.id,bounds);assert.deepEqual([...rendered.pixels],f.image.pixels);assert.deepEqual(rendered.origin,{x:32,y:16});
 const other=renderAnimationFrame(p,'attack-down','attack-down-4',bounds);assert.deepEqual(other.bounds,bounds);assert.deepEqual(other.origin,rendered.origin);assert.deepEqual(p.canvas,{width:64,height:96});
 assert.ok(!checkAnimationProject(p).some(f=>f.code==='clipping'));
});
test('event extents and negative artwork expand shared bounds, and restrictive explicit bounds never silently crop',()=>{
 const p=createAnimationProject(),f=p.clips[0].frames[0];f.events=[{name:'wide-strike',hitbox:{x:-80,y:-20,width:200,height:140}}];
 const bounds=getAnimationRenderBounds(p);assert.ok(bounds.x<=-80&&bounds.y<=-20&&bounds.x+bounds.width>=120&&bounds.y+bounds.height>=120);
 assert.throws(()=>renderAnimationFrame(p,'attack-down','attack-down-4',{x:0,y:0,width:64,height:96}),/crop/);
 const natural=renderAnimationFrame(p,'attack-down','attack-down-4',bounds);let outside=0;for(let y=0;y<natural.height;y++)for(let x=0;x<natural.width;x++)if(x+bounds.x>=64&&natural.pixels[(y*natural.width+x)*4+3])outside++;
 assert.ok(outside>0,'natural slash pixels beyond the body must survive');
 f.image={width:1024,height:1024,offset:{x:-1024,y:-1024},pixels:Array(1024*1024*4).fill(0)};
 assert.throws(()=>getAnimationRenderBounds(p),/resource limit/);
});

test('verified CC0 source motion applies explicit real samples while preserving frame IDs, reviews, images and events',()=>{
 const p=createAnimationProject(),clip=p.clips[0];p.reviews=[review(p)];clip.frames[1].image={width:64,height:96,pixels:Array(64*96*4).fill(0)};clip.frames[2].events=[{name:'user-event'}];
 const preset=MOTION_PRESETS.find(p=>p.id==='quaternius-idle');assert.ok(preset);assert.equal(preset.source.license,'CC0-1.0');assert.equal(preset.source.sha256,'047f5e5fb3bb6d378bd1df16ca6137f2a596c99b3a1b5690b4020c05aaf6f319');
 const applied=applyMotionPreset(p,preset.id,clip.id),actual=applied.clips[0];validateAnimationProject(applied);
 assert.equal(applied.revision,p.revision);assert.deepEqual(actual.frames.map(f=>f.id),clip.frames.map(f=>f.id));assert.deepEqual(applied.reviews,p.reviews);assert.deepEqual(actual.frames[1].image,clip.frames[1].image);assert.deepEqual(actual.frames[2].events,clip.frames[2].events);
 assert.equal(actual.motionSource.clip,preset.source.clip);assert.equal(actual.motionSource.presetId,preset.id);assert.equal(actual.motionSource.url,preset.source.url);assert.equal(actual.motionSource.sha256,preset.source.sha256);
 const first=preset.framesByDirection.down[0];for(const [bone,value] of Object.entries(first.pose))assert.ok(Math.abs(actual.frames[0].pose[bone]-((((value+540)%360)-180)))<.001,bone);
 assert.ok(actual.frames.some((f,i)=>JSON.stringify(f.pose)!==JSON.stringify(clip.frames[i].pose)));assert.ok(Math.abs(actual.frames.reduce((n,f)=>n+f.durationMs,0)-preset.durationMs)<.001);
 assert.deepEqual(regenerateAnimation(applied,clip.id).clips[0],actual);assert.equal(createAnimationFeedback(applied).clips[0].motionSource.sha256,preset.source.sha256);assert.ok(animationDiff(p,applied).some(d=>d.path==='motionSource'));
 const stale=structuredClone(applied);stale.clips[0].motionSource.sha256='0'.repeat(64);assert.throws(()=>regenerateAnimation(stale,clip.id),/version/);assert.throws(()=>applyMotionPreset(p,'missing',clip.id),/Unknown/);
});
test('all verified source clips retarget four directions with bounded actual motion and preserved provenance',()=>{
 for(const preset of MOTION_PRESETS)for(const direction of ['down','up','left','right']){
  const p=createAnimationProject(),id='idle-'+direction,applied=applyMotionPreset(p,preset.id,id),clip=applied.clips.find(c=>c.id===id);
  validateAnimationProject(applied);assert.equal(clip.motionSource.license,'CC0-1.0');assert.equal(clip.loop,preset.loop);assert.ok(clip.frames.every(f=>Object.values(f.pose).every(a=>Number.isFinite(a)&&Math.abs(a)<=180)));
  const bounds=getAnimationRenderBounds(applied),output=renderAnimationFrame(applied,id,clip.frames[0].id,bounds);assert.ok(output.pixels.some(v=>v));
 }
});

test('structurally valid projects exceeding measured output bounds are rejected before persistence',()=>{
 const p=createAnimationProject();p.clips[0].frames[0].image={width:1024,height:1,offset:{x:1024,y:0},pixels:Array(1024*4).fill(0)};p.clips[1].frames[0].image={width:1,height:1,offset:{x:-1,y:0},pixels:[0,0,0,255]};
 assert.throws(()=>validateAnimationProject(p),/render bounds exceed resource limit/);
});
