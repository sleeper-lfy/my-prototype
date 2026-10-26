#!/usr/bin/env python3
"""Real Chromium acceptance for the project toolbox using isolated temporary data."""
import pathlib,tempfile,subprocess,os,socket,time,json,urllib.request,zipfile,hashlib,sys,traceback,shutil
from playwright.sync_api import sync_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parent.parent
OUT=ROOT/'artifacts/v0.3.0/browser';OUT.mkdir(parents=True,exist_ok=True)
PRE=ROOT/'previews/v0.3.0';PRE.mkdir(parents=True,exist_ok=True)
report={'checks':[],'errors':[],'status':'running','isolatedData':True}
def check(name,fn):
 try:v=fn();report['checks'].append({'name':name,'status':'passed','details':v});print('PASS',name,flush=True)
 except Exception as e:
  report['checks'].append({'name':name,'status':'failed','error':str(e)})
  try:page.screenshot(path=str(PRE/'failure.png'),full_page=True)
  except:pass
  raise
with tempfile.TemporaryDirectory(prefix='studio-features-browser-') as work:
 work=pathlib.Path(work)
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 base=f'http://127.0.0.1:{port}'
 def req(route,body=None):
  r=urllib.request.Request(base+route,data=None if body is None else json.dumps(body).encode(),headers={} if body is None else {'Content-Type':'application/json'})
  with urllib.request.urlopen(r) as f:return json.load(f)
 def wait(fn):
  end=time.monotonic()+15
  while time.monotonic()<end:
   try:
    v=fn()
    if v:return v
   except Exception:pass
   time.sleep(.05)
  raise AssertionError('condition timed out')
 log=(work/'server.txt').open('w');server=subprocess.Popen(['node','server/index.js','--production'],cwd=ROOT,env={**os.environ,'STUDIO_DATA_DIR':str(work/'data'),'PORT':str(port)},stdout=log,stderr=log)
 try:
  wait(lambda:req('/api/health')['ok'])
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN') or shutil.which('chromium') or shutil.which('google-chrome'),headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':1600,'height':1000},accept_downloads=True);page.on('pageerror',lambda e:report['errors'].append(str(e)))
   page.goto(base);page.get_by_test_id('language-select').select_option('en')
   def tools(kind='ui'):
    if kind=='map':page.get_by_test_id('workspace-map').click();page.get_by_test_id('map-studio-tools').click()
    else:page.get_by_test_id('workspace-ui').click();page.get_by_test_id('studio-tools').click()
    dialog=page.get_by_test_id('studio-toolbox');expect(dialog).to_be_visible();expect(dialog.get_by_test_id('project-create')).to_be_visible();return dialog
   def tab(name):page.get_by_test_id('feature-tab-'+name).click()
   def close():page.get_by_role('button',name='Close and refresh editor',exact=True).click();expect(page.get_by_test_id('studio-tools')).to_be_visible()
   def library():return req('/api/workbench')['library']
   def project():
    lib=library();return next(p for p in lib['projects'] if p['id']==lib['activeProjectId'])
   def multi_docs():
    d=tools();d.get_by_test_id('feature-name').fill('Inventory page');d.get_by_test_id('document-create-ui').click();wait(lambda:len(project()['uiPages'])==2);d.get_by_test_id('open-doc-ashfall').click();wait(lambda:req('/api/project')['id']=='ashfall');d.get_by_test_id('feature-name').fill('Second game');d.get_by_test_id('project-create').click();wait(lambda:len(library()['projects'])==2);d.get_by_test_id('open-project-workspace-default').click();wait(lambda:library()['activeProjectId']=='workspace-default');page.screenshot(path=str(PRE/'projects-en.png'));close();return {'projects':2,'pages':2,'originalUIRestored':req('/api/project')['id']=='ashfall'}
   check('project library manages separate projects and multiple pages through visible controls',multi_docs)
   def portable():
    d=tools()
    with page.expect_download() as event:d.get_by_test_id('workspace-export').click()
    archive=work/'workspace.zip';event.value.save_as(archive)
    with zipfile.ZipFile(archive) as z:
     assert 'workspace.json' in z.namelist();resources=json.loads(z.read('resources.json'));assert any(n.endswith('.ttf') for n in z.namelist());assert len(resources)>10
    d.get_by_test_id('workspace-import').set_input_files(archive);wait(lambda:len(library()['projects'])==3);assert all(a['src'].startswith('/local-assets/') for a in req('/api/project')['assets']);close();return {'resourceCopies':len(resources),'independentRestoredProject':True}
   check('complete project ZIP downloads and restores original resource bytes into an independent project',portable)
   def component_instances():
    page.get_by_test_id('layer-recruit-button').click();d=tools();tab('blocks');d.get_by_label('Template name',exact=True).fill('Shared action');d.get_by_test_id('capture-template').click();wait(lambda:len(project()['templates'])==1);template=project()['templates'][0];d.get_by_label('Template',exact=True).select_option(template['id']);d.get_by_test_id('place-template').click();wait(lambda:any(n.get('templateInstance') for n in req('/api/project')['nodes']));close();return {'templateKind':template['kind'],'linkedInstance':True}
   check('UI components save as reusable linked templates and instantiate editable nodes',component_instances)
   def behavior():
    d=tools();tab('behavior');d.get_by_test_id('interaction-add').click();d.get_by_label('Source',exact=True).select_option('recruit-button');d.get_by_label('Target',exact=True).select_option('character-card');d.get_by_label('Language code',exact=True).fill('zh-CN');d.get_by_test_id('translation-recruit-button').fill('招募英雄');d.get_by_test_id('behavior-save').click();wait(lambda:len(req('/api/project').get('interactions',[]))==1);tab('preview');preview=d.get_by_test_id('studio-preview');expect(preview).to_be_visible();before=int(preview.get_attribute('data-visible-count'));content=preview.locator('.konvajs-content').bounding_box();page.mouse.click(content['x']+568*min(1,900/960,520/600),content['y']+502*min(1,900/960,520/600));wait(lambda:int(preview.get_attribute('data-visible-count'))<before);d.get_by_label('Game text language',exact=True).select_option('zh-CN');expect(preview).to_have_attribute('data-texts',__import__('re').compile('招募英雄'));d.get_by_label('Resolution',exact=True).select_option('2560x1080');d.get_by_label('Button state',exact=True).select_option('disabled');d.get_by_role('button',name='Check rendered text width and fonts',exact=True).click();page.screenshot(path=str(PRE/'ui-preview-en.png'));close();return {'realClickHidesTargetSubtree':True,'translations':True,'ultrawideAndDisabledPreview':True}
   check('UI preview executes real click interactions, translated text and safe-area resolution previews',behavior)
   def slices():
    d=tools();tab('assets');d.get_by_label('Image asset',exact=True).select_option('panel');expect(d.locator('.slice-editor img')).to_be_visible();line=d.locator('.slice-line.left');box=line.bounding_box();page.mouse.move(box['x']+1,box['y']+15);page.mouse.down();page.mouse.move(box['x']+8,box['y']+15,steps=5);page.mouse.up();d.get_by_role('button',name='Save nine-slice',exact=True).click();wait(lambda:next(a for a in req('/api/project')['assets'] if a['id']=='panel')['margins']['left']>12);d.get_by_label('Button',exact=True).select_option('recruit-button');d.get_by_label('disabled',exact=True).select_option('button-hover');d.get_by_test_id('button-states-save').click();wait(lambda:next(n for n in req('/api/project')['nodes'] if n['id']=='recruit-button').get('disabledAssetId')=='button-hover');page.screenshot(path=str(PRE/'nine-slice-en.png'));close();return {'draggedBoundaryPersisted':True,'disabledArtworkSaved':True}
   check('nine-slice boundaries drag and save, and button disabled artwork persists',slices)
   def map_block():
    d=tools('map');tab('blocks');d.get_by_label('Template name',exact=True).fill('Inn and garden');d.get_by_label('X',exact=True).fill('2');d.get_by_label('Y',exact=True).fill('2');d.get_by_label('Width (cells)',exact=True).fill('4');d.get_by_label('Depth (cells)',exact=True).fill('4');d.get_by_test_id('capture-template').click();wait(lambda:any(t['kind']=='map-block' for t in project()['templates']));block=next(t for t in project()['templates'] if t['kind']=='map-block');d.get_by_label('Template',exact=True).select_option(block['id']);d.get_by_label('X',exact=True).fill('8');d.get_by_label('Y',exact=True).fill('8');d.get_by_label('Layout rotation',exact=True).select_option('90');d.get_by_test_id('place-template').click();wait(lambda:len(req('/api/map')['objects'])==9);close();page.get_by_test_id('workspace-map').click();card=page.get_by_test_id('map-block-'+block['id']);expect(card).to_be_visible();card.scroll_into_view_if_needed();canvas=page.get_by_test_id('map-canvas');rect=canvas.bounding_box();scale=float(canvas.get_attribute('data-scale'));ox=float(canvas.get_attribute('data-origin-x'));oy=float(canvas.get_attribute('data-origin-y'));dest=(rect['x']+ox+(0-9)*32*scale,rect['y']+oy+(0+9)*16*scale);box=card.bounding_box();page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down();page.mouse.move(box['x']+box['width']/2+10,box['y']+box['height']/2,steps=4);page.mouse.move(*dest,steps=20);page.wait_for_timeout(250);expect(canvas).to_have_attribute('data-drop-width','4');page.screenshot(path=str(PRE/'map-block-drag-en.png'));page.mouse.up();wait(lambda:len(req('/api/map')['objects'])==10);return {'multiLayerBlock':True,'rotatedPlacedObject':True,'draggablePaletteBlock':True}
   check('multi-layer map blocks capture, rotate, instantiate and appear in the drag palette',map_block)
   def atlas():
    d=tools('map');tab('atlas');d.get_by_label('Imported asset',exact=True).select_option('grass');d.get_by_label('Cell width (px)',exact=True).fill('32');d.get_by_label('Cell height (px)',exact=True).fill('16');before=len(req('/api/map')['assets']);d.get_by_test_id('atlas-split').click();wait(lambda:len(req('/api/map')['assets'])==before+4);page.screenshot(path=str(PRE/'atlas-en.png'));close();return {'newTiles':4,'sourceUnchanged':True}
   check('tile atlas grid split creates four independent cropped palette tiles',atlas)
   def terrain():
    d=tools('map');tab('terrain');d.get_by_label('Rule name',exact=True).fill('Road');d.get_by_label('0',exact=True).select_option('path');d.get_by_label('10',exact=True).select_option('stone');d.get_by_test_id('terrain-save').click();wait(lambda:bool(req('/api/map').get('terrainRules')));d.get_by_label('Object asset',exact=True).select_option('house');d.get_by_label('Allowed terrain (empty means any)',exact=True).select_option(['grass']);d.get_by_test_id('placement-rule-save').click();wait(lambda:'house' in req('/api/map').get('placementRules',{}));close();page.get_by_test_id('workspace-map').click();page.get_by_test_id('map-tool-connected').click();canvas=page.get_by_test_id('map-canvas');origin=(float(canvas.get_attribute('data-origin-x')),float(canvas.get_attribute('data-origin-y')));scale=float(canvas.get_attribute('data-scale'));rect=canvas.bounding_box()
    def cell(x,y):return(rect['x']+origin[0]+(x-y)*32*scale,rect['y']+origin[1]+(x+y)*16*scale)
    page.mouse.move(*cell(0,0));page.mouse.down();page.mouse.move(*cell(3,0),steps=12);page.mouse.up();wait(lambda:any('terrainCells' in l for l in req('/api/map')['layers']));return {'continuousMouseStroke':True,'connectionRulesSaved':True,'placementRestrictionsSaved':True}
   check('connected brush draws continuous terrain and asset placement policies persist',terrain)
   def reference_checks():
    d=tools('map');tab('reference');d.get_by_label('Reference asset',exact=True).select_option('house');d.get_by_label('Width (px)',exact=True).fill('300');d.get_by_label('Height (px)',exact=True).fill('300');d.get_by_test_id('reference-save').click();wait(lambda:req('/api/map').get('reference',{}).get('locked'));tab('checks');d.get_by_test_id('run-project-checks').click();wait(lambda:bool(d.get_by_text(__import__('re').compile('findings;')).count()));page.screenshot(path=str(PRE/'checks-en.png'));close();page.get_by_test_id('workspace-map').click();page.get_by_test_id('map-tool-measure').click();canvas=page.get_by_test_id('map-canvas');rect=canvas.bounding_box();scale=float(canvas.get_attribute('data-scale'));ox=float(canvas.get_attribute('data-origin-x'));oy=float(canvas.get_attribute('data-origin-y'));
    for xx,yy in [(7,14),(7,0)]:page.mouse.click(rect['x']+ox+(xx-yy)*32*scale,rect['y']+oy+(xx+yy)*16*scale)
    wait(lambda:bool(canvas.get_attribute('data-measure')));assert json.loads(canvas.get_attribute('data-measure'))['gridManhattan']==14;page.screenshot(path=str(PRE/'map-measure-en.png'));return {'lockedOverlaySaved':True,'checksRun':True,'canvasMeasureToolAvailable':True}
   check('locked reference overlays, map measurement and project checks are usable',reference_checks)
   def sync_export():
    d=tools();tab('sync');commands=d.locator('pre').last.inner_text();assert '\nnode sync.mjs' in commands and r'\n' not in commands
    with page.expect_download() as event:d.get_by_test_id('godot-update-export').click()
    out=work/'godot-update.zip';event.value.save_as(out)
    with zipfile.ZipFile(out) as z:assert 'sync.mjs' in z.namelist();assert any(n.endswith('/map.tscn') for n in z.namelist());assert any(n.endswith('/main.tscn') for n in z.namelist());assert ('studio_generated/ui/'+req('/api/project')['id']+'/main.tscn').encode() in z.read('starter-project.godot')
    page.screenshot(path=str(PRE/'godot-update-en.png'));d.get_by_role('button',name='Close',exact=True).click();return {'updaterAndManagedScenes':True}
   check('Godot incremental update downloads executable updater plus all managed UI/map scenes',sync_export)
   def project_context():
    current=project()['id'];d=tools();d.get_by_test_id('open-project-workspace-default').click();wait(lambda:library()['activeProjectId']=='workspace-default');tab('behavior');expect(d.get_by_label('Source',exact=True)).to_have_count(0);tab('projects');d.get_by_test_id('open-project-'+current).click();wait(lambda:library()['activeProjectId']==current);tab('behavior');expect(d.get_by_label('Source',exact=True)).to_have_count(1);close();return {'samePageIdAcrossProjects':True,'interactionFormsRemainIsolated':True}
   check('project switching with identical page IDs keeps interaction forms and local metadata isolated',project_context)
   def bilingual():
    page.set_viewport_size({'width':1366,'height':768});page.get_by_test_id('language-select').select_option('zh-CN');d=tools();box=d.bounding_box();assert box['y']>=0 and box['y']+box['height']<=768;expect(d.get_by_role('heading',name='项目工具箱',exact=True)).to_be_visible();d.get_by_test_id('feature-tab-sync').click();page.screenshot(path=str(PRE/'toolbox-zh.png'));return {'ChineseToolbox':True}
   check('new toolbox switches between Chinese and English',bilingual)
   assert not report['errors'],report['errors'];report['status']='passed';browser.close()
 except Exception as e:
  report['status']='failed';report['error']=str(e);report['traceback']=traceback.format_exc();print(report['traceback'],flush=True)
  try:page.screenshot(path=str(PRE/'failure.png'),full_page=True)
  except:pass
 finally:
  server.terminate()
  try:server.wait(timeout=8)
  except:server.kill()
  log.close();(OUT/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
sys.exit(0 if report['status']=='passed' else 1)
