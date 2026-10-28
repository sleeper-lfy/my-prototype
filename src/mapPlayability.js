import { validateMap, getActorFootprint, getReachableCells, traceMapPath, getObjectOcclusion } from './mapModel.js';

/** One flood fill for every destination; interaction points may be used from an adjacent cell. */
export function analyzeMapPlayability(map, spawnId) {
  validateMap(map);
  const spawns=map.markers.filter(m=>m.type==='spawn'),spawn=spawns.find(m=>m.id===spawnId)||spawns[0];
  const reached=getReachableCells(map,spawn||{x:-1,y:-1});
  const issues=[];
  if(!spawn)issues.push({code:'missing-spawn',severity:'error'});
  else if(!reached.cells.length)issues.push({code:'blocked-spawn',severity:'error',markerId:spawn.id});
  if(!map.markers.some(m=>m.type==='exit'))issues.push({code:'missing-exit',severity:'warning'});
  const destinations=map.markers.filter(m=>m.type!=='spawn').map(marker=>{
    const candidates=[{x:marker.x,y:marker.y}];
    if(marker.type==='interaction')for(const[dx,dy]of[[1,0],[0,1],[-1,0],[0,-1]])candidates.push({x:marker.x+dx,y:marker.y+dy});
    const routes=candidates.map(end=>traceMapPath(map,reached.parents,end)).filter(route=>route.length).sort((a,b)=>a.length-b.length);
    const route=routes[0]||[];
    if(!route.length)issues.push({code:marker.type==='exit'?'unreachable-exit':'unreachable-marker',severity:marker.type==='exit'?'error':'warning',markerId:marker.id});
    return {markerId:marker.id,type:marker.type,name:marker.name,reachable:route.length>0,steps:route.length?route.length-1:null,route};
  });
  return {schemaVersion:1,projectId:map.id,revision:map.revision,actor:{...getActorFootprint(map)},spawn:spawn?{id:spawn.id,x:spawn.x,y:spawn.y}:null,reachable:reached.cells,walkability:[...reached.walkable],destinations,issues,passed:!issues.some(i=>i.severity==='error')};
}
export function objectOccludesActor(object, player) {
  if(!player)return false;
  const region=getObjectOcclusion(object);
  return region.fade && player.x>=object.x+region.x && player.y>=object.y+region.y && player.x<object.x+region.x+region.width && player.y<object.y+region.y+region.height;
}
