import os,json,pathlib,subprocess,time,urllib.request,hashlib,base64,socket,threading,traceback
from playwright.sync_api import sync_playwright,expect
B=pathlib.Path('/tmp/studio-windows-tools');R=pathlib.Path('/workspace/my-prototype');W=B/'wine64';PREFIX=B/'prefix-v012'
INSTALL=B/'安装 测试/Game UI Studio';WININSTALL='Z:\\tmp\\studio-windows-tools\\安装 测试\\Game UI Studio'
HOME=PREFIX/'drive_c/users/agent/AppData/Local/GameUIStudio';STATE=HOME/'runtime/state.json';DATA=HOME/'data'
EXE=R/'releases/v0.1.2/Game-UI-Studio-Setup-0.1.2-x64.exe';M=json.loads((EXE.parent/'windows-manifest.json').read_text())
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
 command='Z:\\workspace\\my-prototype\\releases\\v0.1.2\\'+EXE.name+' /S /D='+WININSTALL
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
Set out=fs.CreateTextFile("Z:\\tmp\\studio-windows-tools\\shortcut-properties.txt",True,True)
out.WriteLine "InstallLocation=" & sh.RegRead("HKCU\\Software\\GameUIStudio\\InstallLocation")
out.WriteLine "DisplayVersion=" & sh.RegRead("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\GameUIStudio\\DisplayVersion")
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
 run(['cscript.exe','//NoLogo','Z:\\tmp\\studio-windows-tools\\shortcut-properties.vbs'],'shortcut-properties')
 text=(B/'shortcut-properties.txt').read_text(encoding='utf-16')
 assert 'InstallLocation='+WININSTALL in text,text
 assert 'DisplayVersion=0.1.2' in text
 def parse_link(path):
  import struct
  raw=path.read_bytes();assert struct.unpack_from('<I',raw)[0]==76
  flags=struct.unpack_from('<I',raw,20)[0];pos=76;values={}
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
 return {'registryVersion':'0.1.2','desktopShortcut':True,'startMenuShortcuts':4,'targetsAndArgumentsVerified':True,'method':'Parsed actual .lnk binary; Wine WScript Shell shortcut enumeration unavailable'}

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

def legacy_upgrade():
 global base
 legacy=R/'releases/v0.1.1/Game-UI-Studio-Setup-0.1.1-x64.exe'
 cmd='Z:'+str(legacy).replace('/','\\')+' /S /D='+WININSTALL
 run(['cmd','/c',cmd],'legacy-v011-install')
 owner,info=launch('legacy-v011-start',True);base=info['url']
 project=req('/api/project');project['name']='v0.1.1 upgrade sentinel 保留';project['revision']+=1;req('/api/project','PUT',project)
 original=(DATA/'project.json').read_bytes()
 install();owner.wait(timeout=20);assert owner.returncode==0
 assert not STATE.exists();assert (DATA/'project.json').read_bytes()==original
 return {'fromVersion':'0.1.1','toVersion':'0.1.2','oldActiveProcessStopped':True,'projectBytesPreserved':True}

try:
 check('upgrade from running v0.1.1 preserves the existing project',legacy_upgrade)
 check('installer runs and preserves all payload hashes in Unicode/space path',install)
 check('HKCU uninstall registration and actual Shell shortcut targets',registration)
 p,s=launch('launch-vbs',True);base=s['url'];check('installed wscript launch.vbs starts bundled Windows Node',lambda:{'pid':s['pid'],'dataOutsideInstallDirectory':not str(DATA).startswith(str(INSTALL))})
 def reject_other_directory():
  other='Z:\\tmp\\studio-windows-tools\\Other installation'
  command='Z:\\workspace\\my-prototype\\releases\\v0.1.2\\'+EXE.name+' /S /D='+other
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
 (R/'releases/v0.1.2/windows-verification.json').write_text(json.dumps(RESULT,ensure_ascii=False,indent=2)+'\n')
 print('RESULT',RESULT['status'],RESULT['passed'],RESULT['failed'],flush=True)
