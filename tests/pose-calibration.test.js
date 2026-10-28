import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnimationProject,validateAnimationProject,renderAnimationFrame,regenerateAnimation,applyMotionPreset,createAnimationFeedback,animationDiff} from '../src/animationModel.js';
import {MOTION_PRESETS} from '../src/motionPresets.js';
import {LANDMARK_NAMES,getRigLandmarks,proposeImageLandmarks,validateLandmarks,applyRigCalibration} from '../src/poseCalibration.js';

test('rig proposal exposes 17 world landmarks without claiming confirmed detection',()=>{
 const p=createAnimationProject(),d=getRigLandmarks(p,'idle-down','idle-down-1');assert.deepEqual(Object.keys(d.points),LANDMARK_NAMES);assert.equal(d.status,'suggested');assert.equal(d.source.kind,'rig');assert.ok(d.points.head.y<d.points.pelvis.y);assert.ok(d.points.leftShoulder.x<d.points.rightShoulder.x);assert.deepEqual(validateLandmarks(JSON.parse(JSON.stringify(d))),d);
});
test('alpha tool rejects blank input and estimates offset silhouette with honest source',()=>{
 const image={width:64,height:96,pixels:Array(64*96*4).fill(0),offset:{x:-8,y:4}};assert.throws(()=>proposeImageLandmarks(image),/foreground/);
 for(let y=10;y<86;y++)for(let x=16;x<48;x++)image.pixels[(y*64+x)*4+3]=255;
 const d=proposeImageLandmarks(image);assert.equal(d.source.kind,'silhouette');assert.equal(d.status,'suggested');assert.ok(d.warnings[0].includes('not semantic AI'));assert.equal(d.points.pelvis.x,23.5);assert.ok(d.points.leftAnkle.y>d.points.pelvis.y);
});
test('unknown points, invalid values and unsafe metadata cannot enter calibration',()=>{
 const d=getRigLandmarks(createAnimationProject());assert.throws(()=>validateLandmarks({...d,points:{...d.points,extra:{x:1,y:2}}}),/17/);assert.throws(()=>validateLandmarks({...d,points:{...d.points,head:{x:Infinity,y:2}}}),/coordinates/);assert.throws(()=>validateLandmarks({...d,source:{kind:'verified-ai',label:'x'}}),/metadata/);assert.throws(()=>validateLandmarks({...d,status:'auto-approved'}),/status/);const safe=validateLandmarks({...d,source:{...d.source,executable:'do not preserve'}});assert.equal(safe.source.executable,undefined);
});
test('human-adjusted points update rig geometry preserving all clips, frames, comments and image bytes',()=>{
 const p=createAnimationProject(),f=p.clips[0].frames[0];f.image={width:1,height:1,pixels:[1,2,3,255]};p.reviews=[{id:'review',clipId:p.clips[0].id,frameIds:[f.id],partId:'head',target:'Head',expected:'Preserve',priority:'normal',status:'pending',protectedProperties:[]}];
 const d=getRigLandmarks(p);d.points.head.y-=4;const before=structuredClone(p),next=applyRigCalibration(p,d);assert.deepEqual(p,before);assert.equal(next.rigCalibration.status,'confirmed');assert.equal(next.bones.find(b=>b.id==='head').length,p.bones.find(b=>b.id==='head').length+4);assert.deepEqual(next.clips,p.clips);assert.deepEqual(next.reviews,p.reviews);assert.deepEqual(next.rigCalibration.contacts.leftFoot,d.points.leftAnkle);validateAnimationProject(next);
});
test('calibrating a non-neutral source pose subtracts its additive rotation and shifts roots consistently',()=>{
 const p=createAnimationProject(),c=p.clips[0],f=c.frames[0];f.pose.head=25;const d=getRigLandmarks(p,c.id,f.id),next=applyRigCalibration(p,d);assert.ok(Math.abs(next.bones.find(b=>b.id==='head').angle-p.bones.find(b=>b.id==='head').angle)<1e-8);const roundtrip=getRigLandmarks(next,c.id,f.id);for(const name of LANDMARK_NAMES){assert.ok(Math.abs(roundtrip.points[name].x-d.points[name].x)<.02,name+' x');assert.ok(Math.abs(roundtrip.points[name].y-d.points[name].y)<.02,name+' y');}assert.throws(()=>applyRigCalibration(p,{...d,source:{...d.source,clipId:'missing'}}),/source clip/);assert.throws(()=>applyRigCalibration(p,{...d,source:{...d.source,frameId:'missing'}}),/source frame/);
 for(const point of Object.values(d.points)){point.x+=8;point.y+=3;}
 const shifted=applyRigCalibration(p,d);assert.equal(shifted.clips[3].frames[2].root.x,p.clips[3].frames[2].root.x+8);assert.equal(shifted.clips[3].frames[2].root.y,p.clips[3].frames[2].root.y+3);assert.deepEqual(shifted.clips[0].frames[0].pose,f.pose);
});

test('calibration contact and body origin feed regeneration, motion retargeting and feedback',()=>{
 const p=createAnimationProject(),d=getRigLandmarks(p);for(const point of Object.values(d.points)){point.x+=5;point.y+=9;}const next=applyRigCalibration(p,d),clip=next.clips[0],frame=clip.frames[0];
 const rendered=renderAnimationFrame(next,clip.id,frame.id);const ankle=rendered.bones.find(b=>b.id==='leftShin');assert.ok(Math.abs(ankle.y-d.points.leftAnkle.y)<.01);assert.ok(Math.abs(ankle.x-d.points.leftAnkle.x)<.01);
 const regenerated=regenerateAnimation(next,clip.id);assert.equal(regenerated.clips[0].frames[0].root.x,d.points.pelvis.x);assert.equal(regenerated.clips[0].frames[0].root.y,d.points.pelvis.y);
 const preset=MOTION_PRESETS[0],retargeted=applyMotionPreset(next,preset.id,clip.id);assert.ok(Math.abs(retargeted.clips[0].frames[0].root.x-d.points.pelvis.x-preset.framesByDirection.down[0].root.x)<.001);
 next.reviews=[{id:'calibration-review',clipId:clip.id,frameIds:[frame.id],partId:'head',target:'Head',expected:'Check calibration',priority:'normal',status:'pending',protectedProperties:[]}];assert.deepEqual(createAnimationFeedback(next).rigCalibration,next.rigCalibration);assert.ok(animationDiff(p,next).some(d=>d.path==='rigCalibration'));
});
