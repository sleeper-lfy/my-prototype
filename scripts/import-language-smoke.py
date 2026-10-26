#!/usr/bin/env python3
"""Real browser acceptance for visible UI import and persistent editor languages.
Uses isolated temporary data. Does not modify the user's working project or old previews.
"""
import argparse, copy, json, os, pathlib, platform, re, shutil, socket, subprocess, tempfile, time, traceback, urllib.request
from playwright.sync_api import sync_playwright, expect
ROOT=pathlib.Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--chromium',default=shutil.which('chromium'))
parser.add_argument('--screenshots',action='store_true')
parser.add_argument('--out', default='artifacts/import-language-results.json')
parser.add_argument('--preview-dir', default='previews/v0.1.2')
args=parser.parse_args()
report={'schemaVersion':1,'platform':platform.system()+' / real Chromium against production Node server','checks':[],'status':'running','isolatedData':True,'screenshotsGenerated':args.screenshots}
server=None;browser=None;logs=[]
workspace=pathlib.Path(tempfile.mkdtemp(prefix='studio-import-language-'))
report_path=ROOT/args.out
report_path.parent.mkdir(parents=True,exist_ok=True)

def wait(fn,why,timeout=15):
 end=time.monotonic()+timeout;last=None
 while time.monotonic()<end:
  try:
   v=fn()
   if v:return v
  except Exception as e:last=e
  time.sleep(.05)
 raise AssertionError(f'{why}: {last}')

def check(name,fn):
 started=time.monotonic()
 try:
  detail=fn();report['checks'].append({'name':name,'status':'passed','seconds':round(time.monotonic()-started,3),'details':detail});print('PASS',name,flush=True);return detail
 except Exception as e:
  report['checks'].append({'name':name,'status':'failed','error':str(e)});raise

def start():
 global server,base
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 env={**os.environ,'STUDIO_DATA_DIR':str(workspace/'data'),'PORT':str(port)}
 log=(workspace/f'server-{port}.log').open('w');logs.append(log)
 server=subprocess.Popen(['node','server/index.js','--production'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
 base=f'http://127.0.0.1:{port}'
 wait(lambda:read('/api/health')['ok'],'server readiness')

def stop():
 global server
 if server is not None:
  server.terminate()
  try:server.wait(timeout=10)
  except subprocess.TimeoutExpired:server.kill();server.wait()
  server=None

def read(route):
 with urllib.request.urlopen(base+route,timeout=5) as r:return json.load(r)

def file(name,value):
 p=workspace/name;p.write_text(value if isinstance(value,str) else json.dumps(value,ensure_ascii=False));return p

def screen(name):
 if args.screenshots:
  folder=ROOT/args.preview_dir;folder.mkdir(parents=True,exist_ok=True)
  page.screenshot(path=str(folder/name),full_page=True)

def open_import():
 page.get_by_test_id('import-ui').click()
 return page.get_by_role('dialog')

def set_language(locale):
 page.get_by_test_id('language-select').select_option(locale)
 expect(page.locator('html')).to_have_attribute('lang',locale)
 wait(lambda:read('/api/preferences')['locale']==locale,'language persisted')

try:
 start()
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
  report['chromiumVersion']=browser.version
  context=browser.new_context(viewport={'width':1600,'height':1050},accept_downloads=True)
  page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(base);expect(page.get_by_test_id('import-ui')).to_be_visible()
  original=read('/api/project')
  def chinese():
   expect(page.get_by_test_id('import-ui')).to_have_text('导入 UI')
   expect(page.get_by_test_id('export-project')).to_have_text('导出项目')
   expect(page.get_by_role('button',name='图层',exact=True)).to_be_visible()
   expect(page.get_by_role('button',name='属性',exact=True)).to_be_visible()
   screen('editor-zh.png')
   dialog=open_import();expect(dialog.get_by_role('heading',name='导入 UI',exact=True)).to_be_visible()
   expect(dialog.get_by_role('button',name='导入并打开')).to_be_disabled()
   screen('import-zh.png')
   dialog.get_by_role('button',name='取消',exact=True).click()
  check('Chinese default exposes distinct import UI and export project actions',chinese)
  def english():
   set_language('en')
   expect(page.get_by_test_id('import-ui')).to_have_text('Import UI')
   expect(page.get_by_test_id('export-project')).to_have_text('Export project')
   page.get_by_role('button',name='Assets',exact=True).click()
   expect(page.get_by_label('Asset kind')).to_have_value('portrait')
   expect(page.get_by_label('Asset kind').locator('option[value="nineSlice"]')).to_have_text('Nine-slice panel')
   page.get_by_role('button',name='Guidelines',exact=True).click()
   expect(page.get_by_role('heading',name='Project foundations')).to_be_visible()
   page.get_by_role('button',name='Layers',exact=True).click()
   page.get_by_test_id('layer-recruit-button').click()
   page.get_by_role('button',name='Properties',exact=True).click()
   expect(page.get_by_label('Name',exact=True)).to_have_value('Recruit / primary action')
   expect(page.get_by_label('Text align',exact=True).locator('option[value="center"]')).to_have_text('Center')
   expect(page.get_by_role('button',name='Normal',exact=True)).to_be_visible()
   page.get_by_role('button',name='Changes',exact=True).click()
   expect(page.get_by_role('button',name='Import Codex patch',exact=True).first).to_be_visible()
   assert read('/api/project')==original,'Language switch changed design content'
   page.locator('.right-panel .panel-tabs').get_by_role('button',name=re.compile(r'^Review\b')).click()
   expect(page.get_by_role('heading',name='Make it intentional.')).to_be_visible()
   expect(page.locator('.review-status').first).to_have_text('Pending')
   screen('editor-en.png')
   dialog=open_import();screen('import-en.png');dialog.get_by_role('button',name='Cancel',exact=True).click()
  check('English covers assets, rules, properties, button states, review and changes without altering design',english)
  def invalid():
   dialog=open_import()
   page.get_by_test_id('project-file').set_input_files(file('page.html','<html>Not a native project</html>'))
   expect(dialog.get_by_role('alert')).to_contain_text('Choose a .json project file')
   page.get_by_test_id('project-file').set_input_files(file('broken.json','{broken'))
   expect(dialog.get_by_role('alert')).to_contain_text('Invalid JSON syntax')
   page.get_by_test_id('project-file').set_input_files(file('component.json',{'kind':'studio-component'}))
   expect(dialog.get_by_role('alert')).to_contain_text('component template')
   page.get_by_test_id('project-file').set_input_files(file('patch.json',{'projectId':'ashfall','changes':[]}))
   expect(dialog.get_by_role('alert')).to_contain_text('incremental patch')
   expect(dialog.get_by_test_id('confirm-import')).to_be_disabled()
   assert read('/api/project')==original
   dialog.get_by_role('button',name='Cancel',exact=True).click()
  check('wrong files, invalid JSON, component templates and patches are clearly rejected without changing project',invalid)
  def missing_asset():
   set_language('zh-CN');dialog=open_import()
   bad=copy.deepcopy(original);bad['assets'][0]['src']='/local-assets/not-present.svg'
   page.get_by_test_id('project-file').set_input_files(file('missing.project.json',bad))
   expect(dialog.get_by_role('status')).to_contain_text('项目格式检查通过')
   dialog.get_by_role('checkbox').uncheck()
   dialog.get_by_test_id('confirm-import').click()
   expect(dialog.get_by_role('alert')).to_contain_text('找不到项目引用的素材')
   expect(dialog).to_be_visible();assert read('/api/project')==original
   dialog.get_by_role('button',name='取消',exact=True).click()
   page.get_by_role('button',name='关闭错误提示',exact=True).click()
   set_language('en')
  check('server-side missing asset failures remain visible in import dialog and preserve the active project',missing_asset)
  def import_file():
   imported=copy.deepcopy(original);imported['id']='qa-import-ui';imported['name']='Imported UI 导入验证'
   imported['nodes'].append({'id':'qa-imported-label','name':'Imported label 可编辑','type':'Label','parentId':None,'frame':{'x':24,'y':542,'width':300,'height':32},'style':{'text':'Codex UI 导入','fontSize':18,'color':'#e2dfc9','fontFamily':'Studio Sans'},'visible':True,'locked':False})
   dialog=open_import();page.get_by_test_id('project-file').set_input_files(file('codex.project.json',imported))
   expect(dialog.get_by_role('status')).to_contain_text('37')
   before=read('/api/project')
   with page.expect_download() as event:dialog.get_by_test_id('confirm-import').click()
   backup=workspace/'downloaded-backup.json';event.value.save_as(backup)
   assert json.loads(backup.read_text())==before
   expect(dialog).not_to_be_visible()
   wait(lambda:read('/api/project')['id']=='qa-import-ui','project imported')
   expect(page.get_by_test_id('layer-qa-imported-label')).to_be_visible()
   assert len(read('/api/project')['nodes'])==37
   return {'components':37,'backupMatchesPriorProject':True,'stableId':'qa-imported-label'}
  check('native project file imports 37 independent nodes with an automatic matching backup',import_file)
  def edit_and_drag():
   page.get_by_test_id('layer-qa-imported-label').click()
   page.get_by_role('button',name='Properties',exact=True).click()
   page.get_by_label('Component text',exact=True).fill('Edited after import 导入后修改')
   page.get_by_label('Component text',exact=True).press('Tab')
   wait(lambda:next(n for n in read('/api/project')['nodes'] if n['id']=='qa-imported-label')['style']['text']=='Edited after import 导入后修改','editable text persisted')
   page.reload();expect(page.get_by_test_id('layer-qa-imported-label')).to_be_visible()
   current=read('/api/project');node=next(n for n in current['nodes'] if n['id']=='qa-imported-label')
   box=page.locator('.konvajs-content').bounding_box();z=box['width']/current['canvas']['width']
   x=box['x']+(node['frame']['x']+80)*z;y=box['y']+(node['frame']['y']+16)*z
   page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+24*z,y-16*z,steps=8);page.mouse.up()
   wait(lambda:next(n for n in read('/api/project')['nodes'] if n['id']=='qa-imported-label')['frame']['x']!=node['frame']['x'],'imported node free drag')
   return {'editedAfterImport':True,'reloadPreservesEdit':True,'dragPersists':True}
  check('imported nodes remain individually editable, draggable and persistent',edit_and_drag)
  def cancel_and_paste():
   before=read('/api/project');dialog=open_import()
   dialog.get_by_label('Or paste project JSON').fill('{bad')
   dialog.get_by_role('button',name='Check project',exact=True).click()
   expect(dialog.get_by_role('alert')).to_contain_text('Invalid JSON syntax')
   dialog.get_by_role('button',name='Cancel',exact=True).click();assert read('/api/project')==before
   dialog=open_import();value=copy.deepcopy(before);value['id']='qa-pasted-ui'
   dialog.get_by_label('Or paste project JSON').fill(json.dumps(value))
   dialog.get_by_role('button',name='Check project',exact=True).click();dialog.get_by_role('checkbox').uncheck()
   dialog.get_by_test_id('confirm-import').click();expect(dialog).not_to_be_visible()
   assert read('/api/project')['id']=='qa-pasted-ui'
  check('cancel is non-destructive and pasted project JSON can be checked and imported',cancel_and_paste)
  def dropped():
   value=read('/api/project');value['id']='qa-dropped-ui';dialog=open_import()
   transfer=page.evaluate_handle('(text)=>{const dt=new DataTransfer();dt.items.add(new File([text],"dropped.project.json",{type:"application/json"}));return dt}',json.dumps(value))
   dialog.locator('.import-dropzone').dispatch_event('drop',{'dataTransfer':transfer})
   expect(dialog.get_by_role('status')).to_contain_text('Project format is valid')
   dialog.get_by_role('checkbox').uncheck();dialog.get_by_test_id('confirm-import').click();expect(dialog).not_to_be_visible()
   assert read('/api/project')['id']=='qa-dropped-ui'
  check('drag-and-drop imports the same editable project format',dropped)
  def restart_language():
   before=read('/api/project');page.evaluate('localStorage.clear()');page.reload()
   expect(page.get_by_test_id('import-ui')).to_have_text('Import UI')
   prior=base;stop();start();assert base!=prior
   fresh=context.new_page();fresh.on('pageerror',lambda e:errors.append(str(e)));fresh.goto(base)
   expect(fresh.get_by_test_id('import-ui')).to_have_text('Import UI')
   assert read('/api/project')==before
   fresh.get_by_test_id('language-select').select_option('zh-CN')
   wait(lambda:read('/api/preferences')['locale']=='zh-CN','Chinese saved')
   fresh.reload();expect(fresh.get_by_test_id('import-ui')).to_have_text('导入 UI')
   fresh.close()
   return {'persistedAcrossReload':True,'persistedAcrossNewServerPort':True,'designUnchanged':True}
  check('language survives cleared browser storage and a server restart on a different port',restart_language)
  assert not errors,errors
  report['pageErrors']=errors;report['status']='passed';browser.close();browser=None
except Exception as error:
 report['status']='failed';report['error']=str(error);report['traceback']=traceback.format_exc();print(traceback.format_exc(),flush=True)
finally:
 if browser:
  try:browser.close()
  except:pass
 stop()
 for log in logs:log.close()
 report['passed']=sum(x['status']=='passed' for x in report['checks']);report['failed']=sum(x['status']=='failed' for x in report['checks'])
 report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 shutil.rmtree(workspace,ignore_errors=True)
 print(json.dumps({'status':report['status'],'passed':report['passed'],'failed':report['failed'],'report':str(report_path)},ensure_ascii=False),flush=True)
 if report['status']!='passed':raise SystemExit(1)
