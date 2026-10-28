import React from 'react';
import { getActorFootprint } from './mapModel.js';

export default function MapPlayabilityPanel({project,locale,report,showReachable,onShowReachable,onChange,onRoute,onWalk,onExport,disabled=false}) {
  const z=locale==='zh-CN',L=(zh,en)=>z?zh:en,actor=getActorFootprint(project);
  const labels={spawn:L('出生点','Spawn'),exit:L('出口','Exit'),trigger:L('触发点','Trigger'),interaction:L('交互点','Interaction')};
  const issueText={'missing-spawn':L('请放置出生点。','Place a spawn marker.'),'blocked-spawn':L('出生点无法容纳当前角色碰撞轮廓。','The actor footprint cannot fit at the spawn.'),'missing-exit':L('尚未放置出口。','No exit marker exists.'),'unreachable-exit':L('出口不可达。','Exit is unreachable.'),'unreachable-marker':L('交互或触发点不可达。','Interaction or trigger is unreachable.')};
  return <div className="map-playability-panel" data-testid="map-playability-panel">
    <p>{L('角色按整数格占地，左上格为定位点。图片、占地、碰撞和遮挡分别编辑；交互点允许从相邻格使用。','The actor occupies whole cells, anchored at its first cell. Artwork, occupancy, collision and occlusion are independent. Interactions can be used from an adjacent cell.')}</p>
    <div className="map-two">{['width','height'].map(field=><label key={field}>{field==='width'?L('角色碰撞宽（格）','Actor width (cells)'):L('角色碰撞高（格）','Actor height (cells)')}<input data-testid={`map-actor-${field}`} type="number" min="1" max={project.grid[field]} value={actor[field]} disabled={disabled} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=project.grid[field])onChange(next=>{next.playability={...next.playability,actor:{...actor,[field]:n}};});}}/></label>)}</div>
    <label className="check"><input type="checkbox" data-testid="map-reachable-toggle" checked={showReachable} onChange={e=>onShowReachable(e.target.checked)}/>{L('画布显示可达格子、当前路线和角色轮廓','Show reachable cells, route and actor footprint')}</label>
    <div className="map-row"><strong data-testid="map-reachable-count">{L('可达位置','Reachable positions')}: {report.reachable.length}</strong><button data-testid="map-playability-export" onClick={onExport}>{L('导出检查报告','Export report')}</button><button data-testid="map-playability-walk" disabled={!report.reachable.length} onClick={()=>onWalk(report.spawn)}>{L('从出生点试走','Walk from spawn')}</button></div>
    <p className="map-muted">{L('关闭面板后用方向键或 WASD 移动，点击地图寻路。交互点按 E，出口和触发点走入触发。绿色为可达格；红色为实际碰撞；黄色为占地；蓝色为遮挡。','Close this panel, then use arrows or WASD, or click to route. Press E near interactions; exits and triggers fire on entry. Green: reachable; red: collision; gold: occupancy; blue: occlusion.')}</p>
    <ul data-testid="map-playability-issues">{report.issues.length?report.issues.map((issue,i)=><li key={i} className={issue.severity==='error'?'map-check-error':''}>{issueText[issue.code]} {project.markers.find(m=>m.id===issue.markerId)?.name}</li>):<li>{L('所有出口和交互点均可达。','Every exit and interaction is reachable.')}</li>}</ul>
    <div className="map-playability-destinations">{report.destinations.map(d=><button key={d.markerId} data-testid={`map-route-${d.markerId}`} disabled={!d.reachable} onClick={()=>onRoute(d.route)}>{d.name} · {d.reachable?`${d.steps} ${L('步','steps')}`:L('不可达','Unreachable')}</button>)}</div>
    <h3>{L('标记位置与类型','Marker positions and types')}</h3>
    {project.markers.map(marker=><div key={marker.id} className="map-marker-edit" data-testid={`map-marker-edit-${marker.id}`}>
      <input aria-label={L('标记名称','Marker name')} value={marker.name} disabled={disabled} onChange={e=>{const name=e.target.value;if(name.trim())onChange(next=>{next.markers.find(m=>m.id===marker.id).name=name;});}}/>
      <select aria-label={L('标记类型','Marker type')} value={marker.type} disabled={disabled} onChange={e=>onChange(next=>{next.markers.find(m=>m.id===marker.id).type=e.target.value;})}>{Object.entries(labels).map(([type,label])=><option key={type} value={type}>{label}</option>)}</select>
      {['x','y'].map(field=><label key={field}>{field}<input data-testid={`map-marker-${marker.id}-${field}`} type="number" min="0" max={project.grid[field==='x'?'width':'height']-1} value={marker[field]} disabled={disabled} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=0&&n<project.grid[field==='x'?'width':'height'])onChange(next=>{next.markers.find(m=>m.id===marker.id)[field]=n;});}}/></label>)}
    </div>)}
  </div>;
}
