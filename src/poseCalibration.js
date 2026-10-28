import { renderAnimationFrame } from './animationModel.js';

export const LANDMARK_NAMES = Object.freeze(['pelvis','neck','head','leftShoulder','leftElbow','leftWrist','rightShoulder','rightElbow','rightWrist','leftHip','leftKnee','leftAnkle','leftToe','rightHip','rightKnee','rightAnkle','rightToe']);
const clone = value => structuredClone(value);
const fail = message => { throw new Error(message); };
const coordinate = n => Number.isFinite(n) && n >= -1024 && n <= 2048;
const point = (x,y) => ({x,y});
const sources = ['rig','silhouette','ai','manual','import'];

/** Import only known fields; inferred points always need an explicit human confirmation. */
export function validateLandmarks(value) {
  if (!value || value.schemaVersion !== 1 || value.kind !== 'studio-pose-landmarks') fail('Unsupported pose landmarks document');
  if (!value.points || typeof value.points !== 'object' || Array.isArray(value.points) || Object.keys(value.points).length !== LANDMARK_NAMES.length || Object.keys(value.points).some(key => !LANDMARK_NAMES.includes(key))) fail('Expected exactly 17 named body landmarks');
  const points = {};
  for (const name of LANDMARK_NAMES) {
    const p = value.points[name];
    if (!p || !coordinate(p.x) || !coordinate(p.y)) fail(`Invalid landmark coordinates: ${name}`);
    points[name] = point(p.x,p.y);
  }
  const src = value.source;
  if (!src || !sources.includes(src.kind) || typeof src.label !== 'string' || src.label.length > 256) fail('Invalid landmark source metadata');
  const source = {kind:src.kind,label:src.label};
  for (const key of ['clipId','frameId','model']) if (src[key] !== undefined) {
    if (typeof src[key] !== 'string' || src[key].length > 256) fail('Invalid landmark source metadata');
    source[key]=src[key];
  }
  if (value.status !== undefined && !['suggested','confirmed'].includes(value.status)) fail('Invalid landmark status');
  if (value.warnings !== undefined && (!Array.isArray(value.warnings) || value.warnings.length > 16 || value.warnings.some(w=>typeof w !== 'string' || w.length > 500))) fail('Invalid landmark warnings');
  return {schemaVersion:1,kind:'studio-pose-landmarks',points,source,status:value.status || 'suggested',...(value.warnings ? {warnings:[...value.warnings]} : {})};
}

export function getRigLandmarks(project, clipId = project.clips[0]?.id, frameId) {
  const clip = project.clips.find(c=>c.id===clipId);
  if (!clip) fail('Unknown calibration clip');
  frameId ||= clip.frames[0]?.id;
  const bones = new Map(renderAnimationFrame(project,clipId,frameId).bones.map(b=>[b.id,b]));
  const end = id => {const b=bones.get(id);if(!b)fail(`Calibration requires bone ${id}`);return point(b.x,b.y);};
  const start = id => {const b=bones.get(id);if(!b)fail(`Calibration requires bone ${id}`);return point(b.parentX,b.parentY);};
  return validateLandmarks({schemaVersion:1,kind:'studio-pose-landmarks',source:{kind:'rig',label:'Current rig pose',clipId,frameId},status:'suggested',points:{
    pelvis:end('pelvis'),neck:end('torso'),head:end('head'),
    leftShoulder:start('leftUpperArm'),leftElbow:end('leftUpperArm'),leftWrist:end('leftForearm'),
    rightShoulder:start('rightUpperArm'),rightElbow:end('rightUpperArm'),rightWrist:end('rightForearm'),
    leftHip:start('leftThigh'),leftKnee:end('leftThigh'),leftAnkle:end('leftShin'),leftToe:end('leftFoot'),
    rightHip:start('rightThigh'),rightKnee:end('rightThigh'),rightAnkle:end('rightShin'),rightToe:end('rightFoot'),
  }});
}

/** A transparent silhouette is a rough tool proposal, never a semantic/AI pose result. */
export function proposeImageLandmarks(image) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > 1024 || image.height > 1024 || !image.pixels || image.pixels.length !== image.width*image.height*4) fail('Invalid calibration image');
  if (![...image.pixels].every(v=>Number.isInteger(v)&&v>=0&&v<=255)) fail('Invalid calibration pixels');
  const offset=image.offset || {x:0,y:0};
  if (!coordinate(offset.x) || !coordinate(offset.y)) fail('Invalid calibration image offset');
  let minX=image.width,minY=image.height,maxX=-1,maxY=-1;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(image.pixels[(y*image.width+x)*4+3]>0){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  if(maxX<minX || maxY<minY)fail('No visible foreground in calibration image');
  if(maxX-minX<3 || maxY-minY<7)fail('Foreground is too small for a body landmark estimate');
  const at=(x,y)=>point(offset.x+minX+(maxX-minX)*x,offset.y+minY+(maxY-minY)*y);
  return validateLandmarks({schemaVersion:1,kind:'studio-pose-landmarks',source:{kind:'silhouette',label:'Alpha silhouette proportions'},status:'suggested',warnings:['Estimates require human confirmation, not semantic AI. Weapons, hair, opaque backgrounds and unusual poses can bias the silhouette.'],points:{
    pelvis:at(.5,.54),neck:at(.5,.24),head:at(.5,.12),
    leftShoulder:at(.28,.27),leftElbow:at(.20,.40),leftWrist:at(.15,.54),rightShoulder:at(.72,.27),rightElbow:at(.80,.40),rightWrist:at(.85,.54),
    leftHip:at(.40,.54),leftKnee:at(.39,.73),leftAnkle:at(.38,.94),leftToe:at(.28,.98),rightHip:at(.60,.54),rightKnee:at(.61,.73),rightAnkle:at(.62,.94),rightToe:at(.72,.98),
  }});
}

/** Invoke only after the human confirms the editable proposal. Source frame angles are removed from rest angles to avoid double posing. */
export function applyRigCalibration(project, landmarks) {
  const document=validateLandmarks(landmarks), next=clone(project), points=document.points;
  if(document.source.clipId && !next.clips.some(c=>c.id===document.source.clipId))fail('Unknown calibration source clip');
  if(document.source.frameId && !document.source.clipId)fail('Calibration source frame requires clipId');
  const sourceClip=next.clips.find(c=>c.id===document.source.clipId) || next.clips.find(c=>c.action==='idle'&&c.direction==='down') || next.clips[0];
  if(document.source.frameId && !sourceClip?.frames.some(f=>f.id===document.source.frameId))fail('Unknown calibration source frame');
  const sourceFrame=sourceClip?.frames.find(f=>f.id===document.source.frameId) || sourceClip?.frames[0];
  if(!sourceFrame)fail('No reference animation frame');
  const bones=new Map(next.bones.map(b=>[b.id,b]));
  const segments=[['torso','pelvis','neck'],['head','neck','head'],['leftUpperArm','leftShoulder','leftElbow'],['leftForearm','leftElbow','leftWrist'],['rightUpperArm','rightShoulder','rightElbow'],['rightForearm','rightElbow','rightWrist'],['leftThigh','leftHip','leftKnee'],['leftShin','leftKnee','leftAnkle'],['leftFoot','leftAnkle','leftToe'],['rightThigh','rightHip','rightKnee'],['rightShin','rightKnee','rightAnkle'],['rightFoot','rightAnkle','rightToe']];
  const root=bones.get('pelvis');if(!root)fail('Calibration requires pelvis bone');root.length=0;root.angle=0;root.offset=point(0,0);
  const delta=point(points.pelvis.x-sourceFrame.root.x,points.pelvis.y-sourceFrame.root.y);
  for(const [id,start,end] of segments){
    const b=bones.get(id);if(!b)fail(`Calibration requires bone ${id}`);
    const a=points[start],z=points[end],dx=z.x-a.x,dy=z.y-a.y,length=Math.hypot(dx,dy);
    if(length<.25 || length>256)fail(`Calibrated bone length must be 0.25..256: ${id}`);
    b.length=length;b.angle=Math.atan2(dy,dx)*180/Math.PI-(sourceFrame.pose[id]||0);
    while(b.angle>180)b.angle-=360;while(b.angle< -180)b.angle+=360;
    const parentPoint=id.endsWith('UpperArm')?points.neck:id.endsWith('Thigh')?points.pelvis:a;
    b.offset=point(a.x-parentPoint.x,a.y-parentPoint.y);
    if(Math.abs(b.offset.x)>256||Math.abs(b.offset.y)>256)fail(`Calibrated attachment offset exceeds 256: ${id}`);
  }
  for(const clip of next.clips)for(const frame of clip.frames){frame.root.x+=delta.x;frame.root.y+=delta.y;if(frame.root.x< -256||frame.root.x>512||frame.root.y< -256||frame.root.y>512)fail('Calibrated root position exceeds supported animation coordinates');}
  next.rigCalibration={schemaVersion:1,points:clone(points),source:clone(document.source),status:'confirmed',contacts:{leftFoot:clone(points.leftAnkle),rightFoot:clone(points.rightAnkle)}};
  return next;
}
