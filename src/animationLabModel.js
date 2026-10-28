import { regenerateAnimation, validateAnimationProject, getAnimationRenderBounds, renderAnimationFrame } from './animationModel.js';

export const PLAYTEST_DEFAULTS = {speed:72,dodgeSpeed:180,comboWindow:.55,maxCombo:3};
export const EVENT_TYPES = ['hitbox-on','hitbox-off','audio','vfx','move','marker'];
const clone=v=>structuredClone(v);
const direction=(x,y,previous)=>Math.abs(x)>Math.abs(y)?(x<0?'left':'right'):y?(y<0?'up':'down'):previous;
const findClip=(project,action,dir)=>project.clips.find(c=>c.action===action&&c.direction===dir)||project.clips.find(c=>c.action===action)||project.clips.find(c=>c.action==='idle'&&c.direction===dir)||project.clips[0];
export function clipTimeline(clip){let time=0;return clip.frames.map((f,index)=>{const entry={frameId:f.id,index,startMs:time,endMs:time+f.durationMs,durationMs:f.durationMs,events:f.events};time+=f.durationMs;return entry;});}
export function moveAnimationEvent(project,clipId,sourceFrameId,eventIndex,targetFrameId){
  const next=clone(project),clip=next.clips.find(c=>c.id===clipId),from=clip?.frames.find(f=>f.id===sourceFrameId),to=clip?.frames.find(f=>f.id===targetFrameId);
  if(!from||!to||!Number.isInteger(eventIndex)||!from.events[eventIndex])throw Error('Unknown event or frame');
  if(from===to)return next;if(to.events.length>=32)throw Error('Target frame already has 32 events');
  const [event]=from.events.splice(eventIndex,1);to.events.push(event);validateAnimationProject(next);return next;
}
export function addPlaytestActions(project){
  let next=clone(project);
  for(const action of ['hurt','dodge'])for(const dir of ['down','up','left','right']){
    if(next.clips.some(c=>c.action===action&&c.direction===dir))continue;
    const source=findClip(next,'idle',dir),id=`${action}-${dir}-reference`;
    if(next.clips.some(c=>c.id===id))throw Error('Reference action ID already exists');
    next.clips.push({id,name:`${action} / ${dir}`,action,direction:dir,loop:false,frames:Array.from({length:4},(_,i)=>({...clone(source.frames[i%source.frames.length]),id:`${id}-${i+1}`,durationMs:80,events:[],image:undefined}))});
    next=regenerateAnimation(next,id);
  }
  validateAnimationProject(next);return next;
}
export function createPlaytestState(project){const clip=findClip(project,'idle','down');return {x:0,y:0,direction:'down',action:'idle',clipId:clip.id,frameId:clip.frames[0].id,elapsedMs:0,phase:'idle',combo:0,queuedAttack:false,events:[],activeHitboxes:{},entered:false,sequence:0};}
export function stepPlaytest(project,state,input={},deltaMs=16){
  const next=clone(state),settings={...PLAYTEST_DEFAULTS,...project.playtest},dt=Math.max(0,Math.min(1000,Number(deltaMs)||0));
  const x=Math.max(-1,Math.min(1,Number(input.x)||0)),y=Math.max(-1,Math.min(1,Number(input.y)||0)),moving=!!(x||y);next.events=[];
  const start=action=>{next.action=action;next.elapsedMs=0;next.entered=false;next.activeHitboxes={};next.sequence++;next.clipId=findClip(project,action,next.direction).id;};
  const locked=['attack','hurt','dodge'].includes(next.action),oldClip=project.clips.find(c=>c.id===next.clipId)||findClip(project,next.action,next.direction),oldDuration=oldClip.frames.reduce((sum,f)=>sum+f.durationMs,0);
  if(!locked)next.direction=direction(x,y,next.direction);
  if(input.hurt&&next.action!=='dodge'){next.combo=0;next.queuedAttack=false;start('hurt');}
  else if(input.dodge&&next.action!=='hurt'&&(next.action!=='attack'||next.elapsedMs/oldDuration>=settings.comboWindow)){next.direction=direction(x,y,next.direction);next.combo=0;next.queuedAttack=false;start('dodge');}
  else if(input.attack){if(!['attack','hurt','dodge'].includes(next.action)){next.combo=1;start('attack');}else if(next.action==='attack'&&next.elapsedMs/oldDuration>=settings.comboWindow&&next.combo<settings.maxCombo)next.queuedAttack=true;}
  if(!['attack','hurt','dodge'].includes(next.action)){const action=moving?'walk':'idle',clip=findClip(project,action,next.direction);if(action!==next.action||clip.id!==next.clipId)start(action);}
  let clip=project.clips.find(c=>c.id===next.clipId)||findClip(project,next.action,next.direction),timeline=clipTimeline(clip),duration=timeline.at(-1).endMs;
  const consume=frame=>{for(const event of frame.events){next.events.push({...clone(event),frameId:frame.frameId,clipId:clip.id});const channel=event.channel||'primary';if(event.type==='hitbox-on')next.activeHitboxes[channel]=clone(event.hitbox);if(event.type==='hitbox-off')delete next.activeHitboxes[channel];if(event.type==='move'){next.x+=event.delta.x;next.y+=event.delta.y;}}};
  if(!next.entered){consume(timeline[0]);next.entered=true;}
  const before=next.elapsedMs,after=before+dt;
  for(const frame of timeline)if(frame.startMs>before&&frame.startMs<=Math.min(after,duration))consume(frame);
  next.elapsedMs=after;
  if(after>=duration){
    if(next.action==='attack'&&next.queuedAttack){next.combo++;next.queuedAttack=false;start('attack');}
    else if(['attack','hurt','dodge'].includes(next.action)){next.combo=0;start(moving?'walk':'idle');}
    else {next.elapsedMs=after%duration;consume(timeline[0]);for(const frame of timeline)if(frame.startMs>0&&frame.startMs<=next.elapsedMs)consume(frame);}
    clip=project.clips.find(c=>c.id===next.clipId);timeline=clipTimeline(clip);duration=timeline.at(-1).endMs;
  }
  const entry=timeline.find(f=>next.elapsedMs<f.endMs)||timeline.at(-1);next.frameId=entry.frameId;
  if(next.action==='walk'){const norm=Math.hypot(x,y)||1;next.x+=x/norm*settings.speed*dt/1000;next.y+=y/norm*settings.speed*dt/1000;}
  if(next.action==='dodge'){const vector={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]}[next.direction];next.x+=vector[0]*settings.dodgeSpeed*dt/1000;next.y+=vector[1]*settings.dodgeSpeed*dt/1000;}
  const hits=timeline.filter(f=>f.events.some(e=>e.hitbox)),first=hits[0]?.startMs??duration*.35,last=hits.at(-1)?.endMs??duration*.55;
  next.phase=next.action==='attack'?(Object.keys(next.activeHitboxes).length||next.elapsedMs>=first&&next.elapsedMs<last?'active':next.elapsedMs<first?'startup':'recovery'):next.action;
  next.fallback=clip.action!==next.action;return next;
}
export function createDemoEquipment(kind='weapon',id=`equipment-${kind}`){
  const sizes={weapon:[7,34],shield:[16,22],clothes:[20,22],hair:[18,10],accessory:[9,9]},[width,height]=sizes[kind]||sizes.weapon,pixels=Array(width*height*4).fill(0);
  const rgb=kind==='weapon'?[168,200,202]:kind==='shield'?[215,187,120]:kind==='clothes'?[102,62,67]:[180,129,87];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){if(kind==='weapon'&&x!==3&&y!==height-6)continue;if(kind==='shield'&&((y<3||y>height-4)&&(x<3||x>width-4)))continue;pixels.splice((y*width+x)*4,4,...(x===0||x===width-1||y===0||y===height-1?[21,38,53]:rgb),255);}
  return {id,name:kind,slot:kind,boneId:kind==='weapon'?'rightForearm':kind==='shield'?'leftForearm':kind==='hair'?'head':'torso',width,height,pixels,pivot:{x:Math.floor(width/2),y:kind==='weapon'?height-4:kind==='hair'?height:0},offset:{x:0,y:0},angle:0,enabled:true,layer:kind==='clothes'?-1:1,source:{kind:'procedural-reference',license:'MIT'}};
}
export function inspectEquipment(project){
  validateAnimationProject(project);const bounds=getAnimationRenderBounds(project),reports=[];
  for(const item of project.equipment||[]){const visible=item.pixels.filter((v,i)=>i%4===3&&v).length;reports.push({itemId:item.id,code:visible?'attachment-review':'empty-equipment',severity:visible?'info':'warning',boneId:item.boneId,frames:project.clips.filter(c=>!item.direction||c.direction===item.direction).reduce((n,c)=>n+c.frames.length,0)});}
  for(const clip of project.clips){let outside=0;for(const frame of clip.frames){const rendered=renderAnimationFrame(project,clip.id,frame.id,bounds);for(let y=0;y<rendered.height;y++)for(let x=0;x<rendered.width;x++)if(rendered.pixels[(y*rendered.width+x)*4+3]&&(x+bounds.x<0||x+bounds.x>=project.canvas.width||y+bounds.y<0||y+bounds.y>=project.canvas.height))outside++;}reports.push({clipId:clip.id,code:'bounds-checked',severity:'info',outsideBodyPixels:outside,frames:clip.frames.length});}
  return {bounds,reports,artApproval:'pending'};
}
