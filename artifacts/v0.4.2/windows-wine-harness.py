import os,json,pathlib,subprocess,time,urllib.request,hashlib,base64,socket,threading,traceback,io,zipfile
from playwright.sync_api import sync_playwright,expect
B=pathlib.Path('/tmp/studio-v042-tools');R=pathlib.Path('/workspace/my-prototype');W=B/'wine64';PREFIX=pathlib.Path('/tmp/studio-v040-tools/prefix-v040')
INSTALL=B/'安装 测试/Game UI Studio';WININSTALL='Z:\\tmp\\studio-v042-tools\\安装 测试\\Game UI Studio'
STUDIO_TEST_HOME=PREFIX/'drive_c/users/agent/AppData/Local/GameUIStudio';STATE=STUDIO_TEST_HOME/'runtime/state.json';DATA=STUDIO_TEST_HOME/'data'
EXE=R/'releases/v0.4.2/Game-UI-Studio-Setup-0.4.2-x64.exe';M=json.loads((EXE.parent/'windows-manifest.json').read_text())
RESULT={'schemaVersion':1,'environment':{'host':'Debian 13 x86_64','windowsCompatibility':'Wine 10.0, Windows 10.0.19043 profile','nativeWindows':False,'runtime':'Windows Node.js v24.19.0 x64','browser':'Linux Chromium accessing the installed Windows Node service'},'installer':{'file':EXE.name,'sha256':hashlib.sha256(EXE.read_bytes()).hexdigest(),'bytes':EXE.stat().st_size},'installPath':WININSTALL,'checks':[],'status':'running','limitations':['This is Wine compatibility testing, not a native Windows machine.','Default Windows browser association and SmartScreen were not exercised. No screenshots were generated.']}
os.environ['WINEPREFIX']=str(PREFIX)
procs=[];logs=[];base=None

def wait(fn,why,timeout=25):
 end=time.monotonic()+timeout;err=None
 while time.monotonic()<end:
  try:
   v=fn()
   if v:return v
  except Exception as e:err=str(e)
  time.sleep(.1)
 raise AssertionError(why+': '+str(err))
def check(name,fn):
 t=time.monotonic()
 try:
  value=fn();RESULT['checks'].append({'name':name,'status':'passed','seconds':round(time.monotonic()-t,3),'details':value});print('PASS',name,flush=True);return value
 except Exception as e:
  RESULT['checks'].append({'name':name,'status':'failed','error':str(e)});raise

def run(args,name,env=None,timeout=100,expected=0):
 p=B/(name+'.log')
 with p.open('w') as f:r=subprocess.run([str(W)]+list(map(str,args)),stdout=f,stderr=subprocess.STDOUT,env=env,timeout=timeout)
 assert r.returncode==expected,f'{name} returned {r.returncode}; '+p.read_text(errors='replace')[-1000:]
 return p

def start(args,name):
 f=(B/(name+'.log')).open('w');logs.append(f)
 p=subprocess.Popen([str(W)]+list(map(str,args)),stdout=f,stderr=subprocess.STDOUT);procs.append(p);return p

def req(route,method='GET',body=None):
 raw=None if body is None else json.dumps(body).encode()
 request=urllib.request.Request(base+route,method=method,data=raw,headers={'Content-Type':'application/json'} if body is not None else {})
 with urllib.request.urlopen(request,timeout=10) as r:
  data=r.read()
  return json.loads(data) if 'json' in r.headers.get('Content-Type','') else data

def ready():
 if not STATE.exists():return None
 s=json.loads(STATE.read_text())
 if s.get('phase')!='ready':return None
 with urllib.request.urlopen(s['url']+'/api/health',timeout=2) as r:
  if json.load(r).get('ok'):return s

def launch(name,wrapper=True):
 args=['wscript.exe','//B','//NoLogo',WININSTALL+'\\launch.vbs','--no-open'] if wrapper else [WININSTALL+'\\node.exe',WININSTALL+'\\app\\scripts\\desktop-launcher.mjs','--no-open']
 p=start(args,name);s=wait(ready,'launcher ready',45);assert p.poll() is None
 return p,s

def install():
 command='Z:\\workspace\\my-prototype\\releases\\v0.4.2\\'+EXE.name+' /S /D='+WININSTALL
 run(['cmd','/c',command],'installer-final')
 assert (INSTALL/'node.exe').is_file()
 for rel,item in M['payload'].items():
  raw=(INSTALL/rel).read_bytes();sha=item['sha256'] if isinstance(item,dict) else item
  assert hashlib.sha256(raw).hexdigest()==sha,rel
 assert not (INSTALL/'app/data').exists()
 return {'exitCode':0,'payloadFilesVerified':len(M['payload']),'unicodeAndSpacesPath':True}

def registration():
 # The script reads real Windows Shell shortcut objects and registry values.
 vbs='''Option Explicit
Dim sh,fs,out,item,link,folder
Set sh=CreateObject("WScript.Shell")
Set fs=CreateObject("Scripting.FileSystemObject")
Set out=fs.CreateTextFile("Z:\\tmp\\studio-v042-tools\\shortcut-properties.txt",True,True)
out.WriteLine "InstallLocation=" & sh.RegRead("HKCU\\Software\\GameUIStudio\\InstallLocation")
out.WriteLine "DisplayVersion=" & sh.RegRead("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\GameUIStudio\\DisplayVersion")
out.WriteLine "DisplayIcon=" & sh.RegRead("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\GameUIStudio\\DisplayIcon")
Set link=sh.CreateShortcut(sh.SpecialFolders("Desktop") & "\\Game UI Studio.lnk")
out.WriteLine "Desktop|" & link.TargetPath & "|" & link.Arguments
Set folder=fs.GetFolder(sh.SpecialFolders("Programs") & "\\Game UI Studio")
For Each item In folder.Files
 Set link=sh.CreateShortcut(item.Path)
 out.WriteLine item.Name & "|" & link.TargetPath & "|" & link.Arguments
Next
out.Close
'''
 (B/'shortcut-properties.vbs').write_text(vbs)
 run(['cscript.exe','//NoLogo','Z:\\tmp\\studio-v042-tools\\shortcut-properties.vbs'],'shortcut-properties')
 text=(B/'shortcut-properties.txt').read_text(encoding='utf-16')
 assert 'InstallLocation='+WININSTALL in text,text
 assert 'DisplayVersion=0.4.2' in text
 def parse_link(path):
  import struct
  raw=path.read_bytes();assert struct.unpack_from('<I',raw)[0]==76
  flags=struct.unpack_from('<I',raw,20)[0];pos=76;values={'iconIndex':struct.unpack_from('<i',raw,56)[0]}
  if flags & 1:pos+=2+struct.unpack_from('<H',raw,pos)[0]
  if flags & 2:
   size,header=struct.unpack_from('<II',raw,pos)
   offset=struct.unpack_from('<I',raw,pos+16)[0]
   values['target']=raw[pos+offset:pos+size].split(bytes([0]))[0].decode('utf-8',errors='replace')
   pos+=size
  for flag,name in [(4,'name'),(8,'relative'),(16,'cwd'),(32,'args'),(64,'icon')]:
   if flags & flag:
    count=struct.unpack_from('<H',raw,pos)[0];pos+=2;size=count*(2 if flags&128 else 1)
    values[name]=raw[pos:pos+size].decode('utf-16le' if flags&128 else 'utf-8').rstrip(chr(0));pos+=size
  return values
 links=[PREFIX/'drive_c/users/agent/Desktop/Game UI Studio.lnk']+list((PREFIX/'drive_c/users/agent/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Game UI Studio').glob('*.lnk'))
 assert len(links)==5
 properties={str(x.name)+(' desktop' if x.parent.name=='Desktop' else ''):parse_link(x) for x in links}
 launches=[x for x in properties.values() if 'wscript.exe' in x.get('target','').lower()]
 assert len(launches)==3,properties
 assert sum(x['args']=='"'+WININSTALL+'\\launch.vbs"' for x in launches)==2
 assert sum(x['args']=='"'+WININSTALL+'\\launch.vbs" --stop' for x in launches)==1
 (B/'shortcut-parsed.json').write_text(json.dumps(properties,ensure_ascii=False,indent=2))
 return {'registryVersion':'0.4.2','desktopShortcut':True,'startMenuShortcuts':4,'targetsAndArgumentsVerified':True,'method':'Parsed actual .lnk binary; Wine WScript Shell shortcut enumeration unavailable'}

def browser():
 errors=[]
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=b.new_page(viewport={'width':1366,'height':768});page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(base,wait_until='networkidle')
  expect(page.get_by_test_id('import-ui')).to_have_text('导入 UI')
  assert page.locator('.konvajs-content canvas').count()>=2
  before=req('/api/project')
  page.get_by_test_id('language-select').select_option('en')
  expect(page.get_by_test_id('import-ui')).to_have_text('Import UI')
  wait(lambda:req('/api/preferences')['locale']=='en','language setting on disk')
  assert req('/api/project')==before
  # Exercise the visible import entry in the installed production frontend.
  page.get_by_test_id('import-ui').click();dialog=page.get_by_role('dialog')
  expect(dialog.get_by_role('heading',name='Import UI',exact=True)).to_be_visible()
  box=dialog.bounding_box();assert box['y']>=0 and box['y']+box['height']<=769
  value=json.loads(json.dumps(before));value['id']='wine-import-ui';value['name']='Wine imported UI 导入验证'
  page.get_by_test_id('project-file').set_input_files({'name':'wine.project.json','mimeType':'application/json','buffer':json.dumps(value,ensure_ascii=False).encode()})
  expect(dialog.get_by_role('status')).to_contain_text('Project format is valid')
  dialog.get_by_role('checkbox').uncheck();dialog.get_by_test_id('confirm-import').click();expect(dialog).not_to_be_visible()
  assert req('/api/project')['id']=='wine-import-ui'
  page.get_by_test_id('layer-details-button').click();page.get_by_role('button',name='Properties',exact=True).click()
  width=next(n for n in req('/api/project')['nodes'] if n['id']=='details-button')['frame']['width']
  page.get_by_label('W',exact=True).fill(str(width+16));page.get_by_label('W',exact=True).press('Tab')
  wait(lambda:next(n for n in req('/api/project')['nodes'] if n['id']=='details-button')['frame']['width']==width+16,'UI width persistence')
  page.evaluate('localStorage.clear()');page.reload(wait_until='networkidle')
  expect(page.get_by_test_id('import-ui')).to_have_text('Import UI')
  assert len(req('/api/project')['nodes'])==36
  page.get_by_test_id('language-select').select_option('zh-CN')
  expect(page.get_by_test_id('import-ui')).to_have_text('导入 UI')
  wait(lambda:req('/api/preferences')['locale']=='zh-CN','Chinese stored')
  page.get_by_role('button',name='属性',exact=True).click()
  page.get_by_test_id('language-select').select_option('en')
  wait(lambda:req('/api/preferences')['locale']=='en','English stored for restart')
  assert not errors,errors
  version=b.version;b.close()
 return {'canvasLayers':2,'nodes':36,'propertyEditAndReload':True,'nativeProjectImportViaVisibleEntry':True,'bothLanguages':True,'languageSurvivesClearedBrowserStorage':True,'smallViewportDialogFits':True,'pageErrors':errors,'chromiumVersion':version,'screenshotsGenerated':False}

def branding():
 import struct
 ico=(R/'packaging/windows/game-ui-studio.ico').read_bytes();reserved,kind,count=struct.unpack_from('<HHH',ico)
 assert reserved==0 and kind==1
 expected=[];sizes=[]
 for i in range(count):
  w,h,colors,reserved,planes,bpp,size,offset=struct.unpack_from('<BBBBHHII',ico,6+16*i)
  sizes.append((w or 256,h or 256));expected.append(hashlib.sha256(ico[offset:offset+size]).hexdigest())
 assert set(sizes)=={(x,x) for x in [16,24,32,48,64,128,256]}
 assert (INSTALL/'game-ui-studio.ico').read_bytes()==ico
 original=(R/'previews/branding/game-ui-studio-logo.png').read_bytes()
 assert (INSTALL/'app/public/assets/game-ui-studio-logo.png').read_bytes()==original
 def resources(executable):
  raw=executable.read_bytes();pe=struct.unpack_from('<I',raw,60)[0];assert raw[pe:pe+4]==b'PE\0\0'
  sections=struct.unpack_from('<H',raw,pe+6)[0];optlen=struct.unpack_from('<H',raw,pe+20)[0];opt=pe+24;magic=struct.unpack_from('<H',raw,opt)[0]
  assert magic in [0x10b,0x20b]
  rva=struct.unpack_from('<I',raw,opt+(112 if magic==0x20b else 96)+16)[0]
  def offset(address):
   for j in range(sections):
    at=opt+optlen+j*40;virtual_size,virtual_address,data_size,data_offset=struct.unpack_from('<IIII',raw,at+8)
    if virtual_address<=address<virtual_address+max(virtual_size,data_size):return data_offset+address-virtual_address
   raise AssertionError('Missing resource section')
  base=offset(rva);found={}
  def visit(relative,keys=()):
   at=base+relative;n,m=struct.unpack_from('<HH',raw,at+12)
   for j in range(n+m):
    name,entry=struct.unpack_from('<II',raw,at+16+j*8);path=keys+(name,)
    if entry&0x80000000:visit(entry&0x7fffffff,path)
    else:
     data,size=struct.unpack_from('<II',raw,base+entry);start=offset(data);found[path]=raw[start:start+size]
  visit(0)
  icons=[payload for keys,payload in found.items() if keys[0]==3];groups=[payload for keys,payload in found.items() if keys[0]==14]
  hashes={hashlib.sha256(payload).hexdigest() for payload in icons};assert set(expected)<=hashes,'Custom image data missing in '+executable.name
  assert any(struct.unpack_from('<H',g,4)[0]==count for g in groups),'Custom icon group missing'
  return {'iconImages':len(icons),'iconGroups':len(groups),'allOriginalIconImagesEmbedded':True}
 installer=resources(EXE);uninstaller=resources(INSTALL/'Uninstall.exe')
 links=json.loads((B/'shortcut-parsed.json').read_text());relevant=[v for k,v in links.items() if not k.startswith('Project data')]
 assert len(relevant)==4
 for link in relevant:assert link['icon'].lower()==(WININSTALL+'\\game-ui-studio.ico').lower() and link['iconIndex']==0,link
 registry=(B/'shortcut-properties.txt').read_text(encoding='utf-16');assert 'DisplayIcon="'+WININSTALL+'\\game-ui-studio.ico",0' in registry,registry
 return {'installerPE':installer,'uninstallerPE':uninstaller,'sizes':[size[0] for size in sizes],'customShortcutIcons':4,'uninstallDisplayIcon':True,'originalLogoBytesPreserved':True,'icoSha256':hashlib.sha256(ico).hexdigest()}

def legacy_upgrade():
 global base
 legacy=R/'releases/v0.4.1/Game-UI-Studio-Setup-0.4.1-x64.exe'
 cmd='Z:'+str(legacy).replace('/','\\')+' /S /D='+WININSTALL
 run(['cmd','/c',cmd],'legacy-v041-install')
 owner,info=launch('legacy-v041-start',True);base=info['url']
 project=req('/api/project');project['name']='v0.4.1 upgrade sentinel 保留';project['revision']+=1;req('/api/project','PUT',project)
 original=(DATA/'project.json').read_bytes()
 install();owner.wait(timeout=20);assert owner.returncode==0
 assert not STATE.exists();assert (DATA/'project.json').read_bytes()==original
 return {'fromVersion':'0.4.1','toVersion':'0.4.2','oldActiveProcessStopped':True,'projectBytesPreserved':True}

try:
 check('upgrade from running v0.4.1 preserves the existing project',legacy_upgrade)
 check('installer runs and preserves all payload hashes in Unicode/space path',install)
 check('HKCU uninstall registration and actual Shell shortcut targets',registration)
 check('actual installer/uninstaller PE resources, shortcut icons and uninstall registry use the original branding',branding)
 p,s=launch('launch-vbs',True);base=s['url'];check('installed wscript launch.vbs starts bundled Windows Node',lambda:{'pid':s['pid'],'dataOutsideInstallDirectory':not str(DATA).startswith(str(INSTALL))})
 def reject_other_directory():
  other='Z:\\tmp\\studio-v042-tools\\Other installation'
  command='Z:\\workspace\\my-prototype\\releases\\v0.4.2\\'+EXE.name+' /S /D='+other
  run(['cmd','/c',command],'reject-other-directory',expected=2)
  assert not (B/'Other installation').exists()
  current=ready();assert current['pid']==s['pid'] and current['url']==s['url']
  registration()
  return {'exitCode':2,'originalServiceStillRunning':True,'registrationAndShortcutsUnchanged':True,'newDirectoryCreated':False}
 check('second install directory is refused while original app remains intact',reject_other_directory)
 check('local health, built frontend and bundled artwork are served',lambda:{'health':req('/api/health'),'htmlBytes':len(req('/')),'svgBytes':len(req('/assets/warden.svg'))})
 check('installed UI imports editable projects and switches Chinese/English with durable preference',browser)
 def save_patch_asset():
  project=req('/api/project');project['name']='Windows installed persistence 验收';project['revision']+=1;req('/api/project','PUT',project)
  patch=req('/api/example-patch');patched=req('/api/patch','POST',patch)
  assert next(n for n in patched['nodes'] if n['id']=='recruit-button')['style']['text']=='RECRUIT · 240'
  asset=req('/api/assets','POST',{'name':'Existing sample leaf','kind':'icon','dataUrl':'data:image/svg+xml;base64,'+base64.b64encode((R/'public/assets/leaf.svg').read_bytes()).decode()})
  saved=json.loads((DATA/'project.json').read_text());assert saved['name']==project['name']
  imported=DATA/'assets'/pathlib.PurePosixPath(asset['src']).name;assert imported.read_bytes()==(R/'public/assets/leaf.svg').read_bytes()
  return {'revision':saved['revision'],'incrementalPatch':True,'savedToAppData':True,'importedAssetSha256':hashlib.sha256(imported.read_bytes()).hexdigest()}
 check('Windows API saves design, applies patch and imports existing artwork',save_patch_asset)
 def new_features():
  ui_before=req('/api/project');map_before=req('/api/map')
  assert map_before['kind']=='studio-map' and map_before['grid']['width']==16
  changed=json.loads(json.dumps(map_before));changed['name']='Installed map persistence 地图保留'
  saved=req('/api/map','PUT',{'project':changed,'baseRevision':map_before['revision']})
  assert req('/api/project')==ui_before
  assert json.loads((DATA/'map.json').read_text())==saved
  task=req('/api/generation','POST',{'baseRevision':ui_before['revision'],'name':'Installed HUD','brief':'Create an editable woodland HUD','template':'hud','width':960,'height':600,'rules':[],'locale':'en'})
  with zipfile.ZipFile(io.BytesIO(req(task['downloadUrl']))) as archive:
   assert 'model.mjs' in archive.namelist() and 'validate.mjs' in archive.namelist()
   assert len(json.loads(archive.read('template.project.json'))['nodes'])>3
  export=req('/api/map/godot','POST',{'baseRevision':saved['revision']})
  with zipfile.ZipFile(io.BytesIO(req(export['downloadUrl']))) as archive:
   assert 'map.tscn' in archive.namelist() and b'TileMapLayer' in archive.read('map.tscn')
  with sync_playwright() as browser_api:
   installed_browser=browser_api.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   page=installed_browser.new_page(viewport={'width':1366,'height':768});errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
   page.goto(base,wait_until='networkidle');page.get_by_test_id('workspace-map').click()
   expect(page.get_by_test_id('map-canvas')).to_be_visible()
   page.get_by_test_id('workspace-ui').click();page.get_by_test_id('generation-task').click()
   expect(page.get_by_test_id('generation-dialog')).to_be_visible()
   assert not errors,errors
   installed_browser.close()
  return {'separateMapPersistence':True,'uiUnaffected':True,'taskZipValidatorAndTemplate':True,'nativeTileMapLayerArchive':True,'installedMapCanvasAndTaskDialog':True}
 check('installed map workspace, Codex tasks and map Godot exports use bundled modules',new_features)
 def workbench_features():
  current=req('/api/project');bench=req('/api/workbench')
  def action(name,data):
   state=req('/api/workbench');return req('/api/workbench/action','POST',{'action':name,'data':data,'libraryRevision':state['library']['revision'],'uiRevision':state['uiRevision'],'mapRevision':state['mapRevision']})
  created=action('document-create',{'kind':'ui','name':'Native installed extra page'})
  project=next(p for p in created['library']['projects'] if p['id']==created['library']['activeProjectId'])
  assert len(project['uiPages'])==2
  action('document-open',{'kind':'ui','id':current['id']});assert req('/api/project')['name']==current['name']
  exported=req('/api/workbench/export','POST',{})
  with zipfile.ZipFile(io.BytesIO(req(exported['downloadUrl']))) as archive:
   assert 'workspace.json' in archive.namelist() and 'resources.json' in archive.namelist()
  update=req('/api/workbench/godot','POST',{})
  with zipfile.ZipFile(io.BytesIO(req(update['downloadUrl']))) as archive:
   assert 'sync.mjs' in archive.namelist() and 'incoming-manifest.json' in archive.namelist()
   assert ('studio_generated/ui/'+current['id']+'/main.tscn').encode() in archive.read('starter-project.godot')
  assert (DATA/'workbench.json').is_file()
  return {'multiplePages':True,'restoredWorkingPage':True,'completePackage':True,'incrementalUpdater':True,'libraryPersisted':True}
 check('installed v0.4 project library, complete resources and Godot updater are functional',workbench_features)
 def animation_features():
  original=req('/api/animation');assert original['canvas']=={'width':64,'height':96}
  assert len(original['clips'])==12
  edited=json.loads(json.dumps(original));clip=edited['clips'][0];frame=clip['frames'][0];frame['durationMs']=177
  pixels=[0]*(100*96*4);index=(40*100+90)*4;pixels[index:index+4]=[0,0,255,255];frame['image']={'width':100,'height':96,'pixels':pixels}
  edited['reviews'].append({'id':'installed-review','clipId':clip['id'],'frameIds':[frame['id']],'partId':'all','target':'Adjust duration','expected':'Slower anticipation','protectedProperties':['root'],'priority':'high','status':'pending'})
  saved=req('/api/animation','PUT',{'project':edited,'baseRevision':original['revision']})
  assert req('/api/animation')['clips'][0]['frames'][0]['durationMs']==177
  feedback=req('/api/animation/feedback','POST',{'baseRevision':saved['revision']})
  with zipfile.ZipFile(io.BytesIO(req(feedback['downloadUrl']))) as archive:
   data=json.loads(archive.read('feedback.json'));assert data['reviews'][0]['id']=='installed-review';assert data['bodyReference']=={'width':64,'height':96};bounds=data['renderBounds'];assert bounds['width']>64 or bounds['height']>96
   import struct
   png=archive.read(data['screenshots'][frame['id']]);assert struct.unpack('>II',png[16:24])==(bounds['width'],bounds['height'])
   from PIL import Image
   assert Image.open(io.BytesIO(png)).convert('RGBA').getpixel((90-bounds['x'],40-bounds['y']))==(0,0,255,255)
   assert any(n.endswith('.png') for n in archive.namelist())
   assert 'motionPresets.js' in archive.namelist() and 'MOTION-LICENSE.txt' in archive.namelist()
   validator=B/'feedback-validator';validator.mkdir(exist_ok=True)
   for name in ['animationModel.mjs','motionPresets.js','validate.mjs']:(validator/name).write_bytes(archive.read(name))
   (validator/'project.json').write_text(json.dumps(saved));(validator/'patch.json').write_text(json.dumps({'projectId':saved['id'],'baseRevision':saved['revision'],'reviewIds':['installed-review'],'operations':[{'clipId':clip['id'],'frameId':frame['id'],'path':'durationMs','value':190}]}))
  winvalidator='Z:'+str(validator).replace('/','\\')
  checked=run([WININSTALL+'\\node.exe',winvalidator+'\\validate.mjs',winvalidator+'\\project.json',winvalidator+'\\patch.json'],'installed-feedback-validator')
  assert 'durationMs' in checked.read_text()
  exported=req('/api/animation/godot','POST',{'baseRevision':saved['revision']})
  with zipfile.ZipFile(io.BytesIO(req(exported['downloadUrl']))) as archive:
   assert 'project.godot' in archive.namelist()
   mapping=json.loads(archive.read('animation-map.json'));assert mapping['renderBounds']==bounds;assert mapping['origin']=={'x':-bounds['x'],'y':-bounds['y']}
   assert any(n.endswith('.png') for n in archive.namelist())
  assert (DATA/'animation-state.json').exists()
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':1366,'height':768});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(base,wait_until='networkidle');page.get_by_test_id('workspace-animation').click();expect(page.get_by_test_id('animation-workspace')).to_be_visible();expect(page.get_by_test_id('anim-stage')).to_be_visible()
   before=page.get_by_test_id('anim-stage').get_attribute('data-frame-id');page.get_by_test_id('anim-next').click();assert page.get_by_test_id('anim-stage').get_attribute('data-frame-id')!=before
   assert not errors,errors;browser.close()
  return {'default64x96':True,'twelveDirectionalClips':True,'frameAndReviewPersisted':True,'feedbackPngs':True,'bundledMotionLicense':True,'feedbackValidatorRunsOnWindowsNode':True,'outsideBodyBluePixelPreserved':True,'expandedFrameDimensions':bounds,'fixedOrigin':mapping['origin'],'godotArchive':True}
 check('installed animation workspace persists frames and reviews and exports feedback and Godot',animation_features)



 def duplicate():
  log=run([WININSTALL+'\\node.exe',WININSTALL+'\\app\\scripts\\desktop-launcher.mjs','--no-open'],'duplicate-final')
  result=json.loads(log.read_text().strip());assert result['reused'] and result['pid']==s['pid'] and result['url']==base
  return {'reused':True,'samePid':True,'sameUrl':True}
 check('repeated launch reuses the existing Windows instance',duplicate)
 def stop_first():
  run(['wscript.exe','//B','//NoLogo',WININSTALL+'\\launch.vbs','--stop'],'stop-vbs')
  p.wait(timeout=15);assert p.returncode==0
  wait(lambda:not STATE.exists(),'state removed')
  return {'wrapperExitCode':p.returncode,'stateRemoved':True}
 check('wscript stop wrapper shuts down owner and clears runtime state',stop_first)
 def occupied_control_port():
  server=socket.socket();server.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);server.bind(('127.0.0.1',s['controlPort']));server.listen(1)
  def fake():
   connection,_=server.accept()
   with connection:
    connection.recv(8192);connection.sendall(b'{"ok":true,"app":"Unrelated listener"}\n')
  thread=threading.Thread(target=fake,daemon=True);thread.start()
  try:
   log=run([WININSTALL+'\\node.exe',WININSTALL+'\\app\\scripts\\desktop-launcher.mjs','--no-open'],'occupied-control-port',expected=1)
   assert not STATE.exists()
   return {'exitCode':1,'unrelatedListenerPreserved':True,'secondServerStarted':False}
  finally:server.close()
 check('unrelated process occupying control port blocks unsafe second instance',occupied_control_port)
 def concurrent():
  args=[WININSTALL+'\\node.exe',WININSTALL+'\\app\\scripts\\desktop-launcher.mjs','--no-open']
  a=start(args,'concurrent-a');b=start(args,'concurrent-b');info=wait(ready,'concurrent owner ready')
  wait(lambda:a.poll() is not None or b.poll() is not None,'concurrent duplicate exits')
  records=[]
  for name in ['concurrent-a.log','concurrent-b.log']:
   records.extend(json.loads(line) for line in (B/name).read_text().splitlines() if line.startswith('{'))
  assert len(records)==2 and sorted(x['reused'] for x in records)==[False,True],records
  assert len({x['pid'] for x in records})==1
  run([WININSTALL+'\\node.exe',WININSTALL+'\\app\\scripts\\desktop-launcher.mjs','--stop'],'concurrent-stop')
  a.wait(timeout=15);b.wait(timeout=15);assert a.returncode==b.returncode==0
  return {'processes':2,'oneOwner':True,'oneReuse':True,'bothExitZeroAfterStop':True}
 check('simultaneous Windows launches converge on one owner',concurrent)
 p,s=launch('restart-vbs',True);base=s['url']
 assert req('/api/preferences')['locale']=='en'
 assert req('/api/map')['name']=='Installed map persistence 地图保留'
 check('restart retains saved design and patch',lambda:{'savedName':req('/api/project')['name'],'patchedText':next(n for n in req('/api/project')['nodes'] if n['id']=='recruit-button')['style']['text']})
 assert req('/api/project')['name']=='Windows installed persistence 验收'
 before={str(f.relative_to(DATA)):hashlib.sha256(f.read_bytes()).hexdigest() for f in DATA.rglob('*') if f.is_file()}
 def upgrade():
  details=install();p.wait(timeout=15);assert p.returncode==0 and not STATE.exists()
  after={str(f.relative_to(DATA)):hashlib.sha256(f.read_bytes()).hexdigest() for f in DATA.rglob('*') if f.is_file()};assert after==before
  return {'activeProcessStopped':True,'dataHashesPreserved':len(before),'payloadFilesVerified':details['payloadFilesVerified']}
 check('running application upgrades safely and preserves all user data',upgrade)
 p,s=launch('post-upgrade',True);base=s['url'];assert req('/api/project')['name']=='Windows installed persistence 验收';assert req('/api/preferences')['locale']=='en'
 def uninstall():
  # NSIS self-copies the uninstaller; wait for application/files, not only the initial exit code.
  run([WININSTALL+'\\Uninstall.exe','/S'],'uninstall-final');p.wait(timeout=30);assert p.returncode==0
  wait(lambda:not (INSTALL/'app').exists() and not (INSTALL/'node.exe').exists(),'app and runtime removed')
  assert not (INSTALL/'node.exe').exists()
  after={str(f.relative_to(DATA)):hashlib.sha256(f.read_bytes()).hexdigest() for f in DATA.rglob('*') if f.is_file()};assert after==before
  assert not (PREFIX/'drive_c/users/agent/Desktop/Game UI Studio.lnk').exists()
  assert not (PREFIX/'drive_c/users/agent/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Game UI Studio').exists()
  reglog=run(['reg.exe','query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\GameUIStudio'],'uninstall-registry',expected=1)
  return {'activeProcessStopped':True,'programFilesRemoved':True,'registryRemoved':True,'shortcutsRemoved':True,'dataHashesPreserved':len(before)}
 check('active uninstall removes program and shortcuts but keeps design/imports',uninstall)
 RESULT['status']='passed'
except Exception as e:
 RESULT['status']='failed';RESULT['error']=str(e);RESULT['traceback']=traceback.format_exc();print(RESULT['traceback'],flush=True)
finally:
 for proc in procs:
  if proc.poll() is None:
   try:proc.terminate();proc.wait(timeout=5)
   except Exception:proc.kill()
 for f in logs:f.close()
 RESULT['passed']=sum(c['status']=='passed' for c in RESULT['checks']);RESULT['failed']=sum(c['status']=='failed' for c in RESULT['checks'])
 RESULT['verifiedAtUtc']=__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()
 RESULT['testHarnessSha256']=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
 (R/'releases/v0.4.2/windows-verification.json').write_text(json.dumps(RESULT,ensure_ascii=False,indent=2)+'\n')
 print('RESULT',RESULT['status'],RESULT['passed'],RESULT['failed'],flush=True)
