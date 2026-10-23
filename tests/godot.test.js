import test from 'node:test';
import assert from 'node:assert/strict';
import { createGodotFiles } from '../server/godot.js';
import { comparePng, encodePng, decodePng } from '../scripts/compare-png.js';

const fixture=()=>({schemaVersion:1,id:'test',name:'"Quoted" scene',revision:1,canvas:{width:640,height:360,background:'#123'},tokens:{},assets:[],reviews:[],history:[],nodes:[
  {id:'group',name:'Group',type:'Control',parentId:null,frame:{x:20,y:30,width:200,height:100},style:{},visible:true},
  {id:'text',name:'Text',type:'Label',parentId:'group',frame:{x:7,y:9,width:100,height:20},style:{text:'say "hi"\nnext',color:'#ffff',fontSize:16}},
  {id:'row',name:'Row',type:'HBoxContainer',parentId:null,frame:{x:250,y:20,width:300,height:60},layout:{mode:'horizontal',padding:8,gap:10}},
  {id:'button',name:'Button',type:'Button',parentId:'row',frame:{x:99,y:99,width:100,height:36},style:{text:'Go',fill:'transparent'}},
]});

test('exports real native controls, parent-relative free offsets, stable mapping and escaped text',()=>{
  const {files}=createGodotFiles(fixture());
  assert.match(files['main.tscn'],/type="Control"/);
  assert.match(files['main.tscn'],/text = "say \\"hi\\"\\nnext"/);
  assert.match(files['main.tscn'],/offset_left = 7/);
  const map=JSON.parse(files['node-map.json']);
  assert.equal(map.nodes.length,4);
  assert.equal(map.nodes.find(n=>n.id==='text').path,'Control_1/Label_2');
  assert.equal(map.nodes.find(n=>n.id==='text').frame.x,27);
  assert.equal(map.nodes.find(n=>n.id==='button').frame.x,258);
});

test('padded native containers retain a frame wrapper and own child layout',()=>{
  const {files}=createGodotFiles(fixture()),map=JSON.parse(files['node-map.json']);
  const row=map.nodes.find(n=>n.id==='row');
  assert.notEqual(row.path,row.framePath);
  assert.match(files['main.tscn'],/theme_override_constants\/margin_left = 8/);
  assert.match(files['main.tscn'],/theme_override_constants\/separation = 10/);
  assert.match(files['main.tscn'],/custom_minimum_size = Vector2\(100, 36\)/);
  assert.match(files['main.tscn'],/size_flags_horizontal = 1/);
});

test('nine-slice panels, button states and fonts reference copied local assets',()=>{
  const p=fixture();p.assets=[{id:'panel',name:'Panel',kind:'nineSlice',src:'/assets/panel.svg',margins:{left:12,top:12,right:12,bottom:12}},{id:'font',name:'Studio Serif',kind:'font',src:'/assets/serif.ttf'}];
  p.nodes[0].type='Panel';p.nodes[0].assetId='panel';p.nodes[1].style.fontFamily='Studio Serif';p.nodes[3].buttonAssets={normal:'panel',hover:'panel',pressed:'panel'};
  const {files,assets}=createGodotFiles(p);
  assert.match(files['main.tscn'],/type="StyleBoxTexture"/);
  assert.match(files['main.tscn'],/texture_margin_left = 12/);
  assert.match(files['main.tscn'],/theme_override_styles\/pressed/);
  assert.match(files['main.tscn'],/type="FontFile"/);
  assert.equal(assets.length,2);
});

test('PNG comparison measures differences and rejects mismatched sizes',()=>{
  const a=encodePng({width:2,height:1,rgba:Buffer.from([0,0,0,255,255,255,255,255])});
  assert.equal(decodePng(a).width,2);
  assert.equal(comparePng(a,a).metrics.meanAbsoluteError,0);
  const b=encodePng({width:2,height:1,rgba:Buffer.from([255,0,0,255,255,255,255,255])});
  assert.ok(comparePng(a,b).metrics.meanAbsoluteError>0);
  const small=encodePng({width:1,height:1,rgba:Buffer.from([0,0,0,255])});
  assert.throws(()=>comparePng(a,small),/size mismatch/);
});

test('reports unmapped visible styles and exports local opacity without inheriting it',()=>{
  const p=fixture();p.nodes[0].style={fill:'#112233',stroke:'#ff0',strokeWidth:2,text:'group annotation',opacity:0.4};
  p.nodes[1].style.fill='transparent';
  const {files}=createGodotFiles(p);
  const warnings=JSON.parse(files['export-warnings.json']);
  assert.ok(warnings.some(w=>w.nodeId==='group'&&w.property==='style.fill'));
  assert.ok(warnings.some(w=>w.nodeId==='group'&&w.property==='style.stroke'));
  assert.ok(warnings.some(w=>w.nodeId==='group'&&w.property==='style.text'));
  assert.ok(!warnings.some(w=>w.nodeId==='text'&&w.property==='style.fill'));
  assert.match(files['main.tscn'],/self_modulate = Color\(1, 1, 1, 0.4\)/);
  assert.equal(JSON.parse(files['node-map.json']).nodes.find(n=>n.id==='group').opacity,0.4);
});
