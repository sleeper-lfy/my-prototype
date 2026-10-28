import { useEffect, useRef, useState } from 'react';
import { getAnimationRenderBounds, renderAnimationFrame, validateAnimationProject } from './animationModel.js';

/** Saved animation pixels are displayed with their shared origin, including oversized weapons. */
export default function useMapAvatar(active, player) {
  const [source,setSource]=useState(null),[avatar,setAvatar]=useState(null),[error,setError]=useState('');
  const latest=useRef({player:null,direction:'down',movedAt:0});
  useEffect(()=>{
    if(!active)return;
    let live=true;
    fetch('/api/animation').then(async response=>{if(!response.ok)throw new Error('Animation unavailable');const data=await response.json();const project=data.project||data;validateAnimationProject(project);return {project,bounds:getAnimationRenderBounds(project)};}).then(data=>{if(live){setSource(data);setError('');}}).catch(failure=>{if(live){setSource(null);setError(failure.message);}});
    return()=>{live=false;};
  },[active]);
  useEffect(()=>{
    const prev=latest.current.player;
    if(player&&prev&&(player.x!==prev.x||player.y!==prev.y)) {
      const dx=player.x-prev.x,dy=player.y-prev.y;
      latest.current.direction=Math.abs(dx)>=Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up');
      latest.current.movedAt=performance.now();
    }
    latest.current.player=player;
  },[player]);
  useEffect(()=>{
    if(!active||!source){setAvatar(null);return;}
    const cache=new Map();let timer;
    const draw=()=>{
      const now=performance.now(),{direction,movedAt}=latest.current,action=now-movedAt<230?'walk':'idle';
      const clip=source.project.clips.find(c=>c.action===action&&c.direction===direction)||source.project.clips.find(c=>c.action===action)||source.project.clips[0];
      if(!clip)return;
      const total=clip.frames.reduce((n,f)=>n+f.durationMs,0);let time=now%total,frame=clip.frames.at(-1);
      for(const candidate of clip.frames){if(time<candidate.durationMs){frame=candidate;break;}time-=candidate.durationMs;}
      const key=`${clip.id}:${frame.id}`;
      try {
        if(!cache.has(key)) {
          const rendered=renderAnimationFrame(source.project,clip.id,frame.id,source.bounds),canvas=document.createElement('canvas');canvas.width=rendered.width;canvas.height=rendered.height;
          canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rendered.pixels),rendered.width,rendered.height),0,0);
          cache.set(key,{image:canvas,x:source.bounds.x-source.project.canvas.width/2,y:source.bounds.y-source.project.canvas.height,clipId:clip.id,frameId:frame.id});
        }
        setAvatar(cache.get(key));
      }catch(failure){setError(failure.message);setAvatar(null);clearInterval(timer);}
    };
    draw();timer=setInterval(draw,80);return()=>clearInterval(timer);
  },[active,source]);
  return {avatar,error};
}
