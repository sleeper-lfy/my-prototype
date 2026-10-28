import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnimationProject,validateAnimationProject,renderAnimationFrame,checkAnimationProject,regenerateAnimation,animationDiff,applyAnimationPatch,createAnimationFeedback} from '../src/animationModel.js';
const review = (p, extra={}) => ({id:'review-one',clipId:p.clips[0].id,frameIds:[p.clips[0].frames[0].id],partId:'head',target:'Head timing',expected:'Hold longer',priority:'high',status:'pending',protectedProperties:['pose.head'],...extra});
const patch = (p, operations, reviewIds=[]) => ({kind:'studio-animation-patch',schemaVersion:1,projectId:p.id,baseRevision:p.revision,operations,reviewIds});
const op = (p,path,value,index=0) => ({clipId:p.clips[0].id,frameId:p.clips[0].frames[index].id,path,value});
test('64x96 presets render deterministic discrete pixels in four directions with reachable contacts and no clipping',()=>{
 const p=createAnimationProject();validateAnimationProject(p);assert.deepEqual(p.canvas,{width:64,height:96});assert.equal(p.clips.length,12);assert.deepEqual(checkAnimationProject(p),[]);
 for(const clip of p.clips) {const f=clip.frames[0], a=renderAnimationFrame(p,clip.id,f.id),b=renderAnimationFrame(p,clip.id,f.id);assert.deepEqual(a.pixels,b.pixels);assert.equal(a.pixels.length,64*96*4);assert.ok(a.pixels.some(x=>x>0));assert.ok([...a.pixels].filter((_,i)=>i%4===3).every(a=>a===0||a===255));}
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
 assert.deepEqual([...renderAnimationFrame(p,c.id,f.id).pixels],f.image.pixels);
 const next=regenerateAnimation(p,c.id);assert.deepEqual(next.clips[0].frames.map(f=>f.id),c.frames.map(f=>f.id));assert.deepEqual(next.clips[0].frames[0].image,f.image);assert.deepEqual(next.reviews,p.reviews);
});
test('part mapping replaces default head geometry and reports clipped user art',()=>{
 const p=createAnimationProject(),c=p.clips[0],f=c.frames[0],base=renderAnimationFrame(p,c.id,f.id);p.parts=[{id:'new-head',boneId:'head',width:1,height:1,pixels:[255,0,0,255],pivot:{x:0,y:0}}];validateAnimationProject(p);
 const replaced=renderAnimationFrame(p,c.id,f.id);const count=image=>[...image.pixels].filter((v,i)=>i%4===3&&v).length;assert.ok(count(replaced)<count(base)-100);assert.ok([...replaced.pixels].some((v,i)=>i%4===0&&v===255&&replaced.pixels[i+1]===0));
 p.parts[0].pivot.x=100;assert.ok(checkAnimationProject(p).some(f=>f.code==='clipping'));
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
