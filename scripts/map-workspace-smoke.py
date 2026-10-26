#!/usr/bin/env python3
"""Real Chromium acceptance for Codex generation and the isometric map workspace.

Starts an isolated production server and uses mouse/file/form interactions for
editing. API reads assert the persisted result; no user's working data changes.
Run `npm run build` first, then `python scripts/map-workspace-smoke.py`.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
from pathlib import Path
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import traceback
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zipfile

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent


def wait_for(operation, description, timeout=20):
    end = time.monotonic() + timeout
    last = None
    while time.monotonic() < end:
        try:
            value = operation()
            if value:
                return value
        except Exception as error:
            last = error
        time.sleep(.08)
    raise AssertionError(f"Timed out: {description}; last error: {last}")


def ensure(value, message):
    if not value:
        raise AssertionError(message)


def archive_entries(filename):
    with zipfile.ZipFile(filename) as archive:
        ensure(archive.testzip() is None, "Corrupt downloaded archive")
        return {name: archive.read(name) for name in archive.namelist()}


class Acceptance:
    def __init__(self, page, base, temporary, out, previews):
        self.page = page
        self.base = base
        self.temporary = temporary
        self.out = out
        self.previews = previews

    def api(self, route, body=None, method=None, expected=200):
        data = None if body is None else json.dumps(body).encode()
        request = Request(self.base + route, data=data, headers={"Content-Type": "application/json"}, method=method or ("GET" if body is None else "POST"))
        try:
            with urlopen(request, timeout=15) as response:
                status = response.status
                result = json.load(response)
        except HTTPError as error:
            status = error.code
            result = json.load(error)
        ensure(status == expected, f"{route}: expected HTTP {expected}, got {status}: {result}")
        return result

    def map(self):
        return self.api('/api/map')

    def saved(self, predicate, why):
        def condition():
            current = self.map()
            return current if predicate(current) else None
        return wait_for(condition, why)

    def object(self, object_id, project=None):
        return next(item for item in (project or self.map())['objects'] if item['id'] == object_id)

    def layer(self, layer_id, project=None):
        return next(item for item in (project or self.map())['layers'] if item['id'] == layer_id)

    def fixture(self, name, data):
        filename = self.temporary / name
        filename.write_text(data if isinstance(data, str) else json.dumps(data, ensure_ascii=False), encoding='utf-8')
        return filename

    def download(self, control, filename):
        with self.page.expect_download() as event:
            control.click()
        destination = self.out / filename
        event.value.save_as(destination)
        return destination

    def screen(self, filename):
        if self.previews:
            self.previews.mkdir(parents=True, exist_ok=True)
            self.page.screenshot(path=str(self.previews / filename), full_page=True)

    def cell(self, x, y):
        canvas = self.page.get_by_test_id('map-canvas')
        bounds = canvas.bounding_box()
        origin_x = float(canvas.get_attribute('data-origin-x'))
        origin_y = float(canvas.get_attribute('data-origin-y'))
        scale = float(canvas.get_attribute('data-scale'))
        grid = self.map()['grid']
        return (bounds['x'] + origin_x + (x-y)*grid['tileWidth']/2*scale,
                bounds['y'] + origin_y + (x+y)*grid['tileHeight']/2*scale)

    def click_cell(self, x, y):
        self.page.mouse.click(*self.cell(x, y))

    def drag_cells(self, start, end):
        self.page.mouse.move(*self.cell(*start))
        self.page.mouse.down()
        self.page.mouse.move(*self.cell(*end), steps=12)
        self.page.mouse.up()

    def native_palette_drop(self, asset_id, x, y, width=1, height=1, valid=True, screenshot=None):
        """Use Chromium's native HTML drag lifecycle, without synthetic DataTransfer."""
        source=self.page.get_by_test_id('map-asset-'+asset_id)
        source.scroll_into_view_if_needed()
        bounds=source.bounding_box()
        start=(bounds['x']+bounds['width']/2,bounds['y']+bounds['height']/2)
        destination=self.cell(x,y)
        canvas=self.page.get_by_test_id('map-canvas')
        self.page.mouse.move(*start)
        self.page.mouse.down()
        try:
            self.page.mouse.move(start[0]+8,start[1]+8,steps=3)
            self.page.mouse.move(*destination,steps=18)
            self.page.mouse.move(destination[0]+.5,destination[1]+.5)
            expect(canvas).to_have_attribute('data-drop-x',str(x))
            expect(canvas).to_have_attribute('data-drop-y',str(y))
            expect(canvas).to_have_attribute('data-drop-width',str(width))
            expect(canvas).to_have_attribute('data-drop-height',str(height))
            expect(canvas).to_have_attribute('data-drop-valid','true' if valid else 'false')
            if screenshot:self.screen(screenshot)
        finally:
            self.page.mouse.up()

    def language(self, locale):
        self.page.get_by_test_id('language-select').select_option(locale)
        expect(self.page.locator('html')).to_have_attribute('lang', locale)
        wait_for(lambda: self.api('/api/preferences')['locale'] == locale, 'language preference')

    def run(self, check):
        page = self.page
        page.goto(self.base, wait_until='networkidle')
        expect(page.get_by_test_id('workspace-map')).to_be_visible()
        self.language('en')
        self.run_generation(check)
        page.get_by_test_id('workspace-map').click()
        expect(page.get_by_test_id('map-canvas')).to_be_visible()
        self.run_map(check)
        check('UI document is preserved while the map is edited', lambda: ensure(self.api('/api/project') == self.generated_ui_snapshot, 'Map edits changed the independent UI document'))

    def run_generation(self, check):
        page = self.page
        def selective_ui_patch():
            before = self.api('/api/project')
            patch = {'schemaVersion':1,'projectId':before['id'],'baseRevision':before['revision'],
                'summary':'Browser acceptance: two independent reviewed UI changes',
                'reviewIds':['review-cta','review-card'],
                'changes':[{'nodeId':'recruit-button','set':{'style.text':'RECRUIT · 240'}},
                           {'nodeId':'character-card','set':{'style.stroke':'#b59a62'}}]}
            page.get_by_test_id('patch-file').set_input_files(self.fixture('ui-selective.patch.json',patch))
            dialog = page.get_by_role('dialog')
            page.get_by_test_id('preview-ui-patch').click()
            expect(page.get_by_test_id('ui-patch-change-1')).to_be_checked()
            ensure(self.api('/api/project') == before, 'UI patch preview mutated the current project')
            page.get_by_test_id('ui-patch-change-1').uncheck()
            page.get_by_test_id('apply-ui-patch').click()
            expect(dialog).not_to_be_visible()
            current = self.api('/api/project')
            lookup = lambda p,n: next(item for item in p['nodes'] if item['id']==n)
            ensure(lookup(current,'recruit-button')['style']['text']=='RECRUIT · 240','Selected UI field not applied')
            ensure(lookup(current,'character-card')==lookup(before,'character-card'),'Unselected UI component changed')
            ensure(all(review['status']=='pending' for review in current['reviews']),'Partial UI patch prematurely marked reviews complete')
            ensure(len(current['history'][-1]['changes'])==1,'History contains unselected changes')
            page.reload()
            page.get_by_role('button',name='Changes',exact=True).click()
            page.locator('.history-card').first.get_by_role('button',name='Safely roll back this change',exact=True).click()
            wait_for(lambda: lookup(self.api('/api/project'),'recruit-button')==lookup(before,'recruit-button'),'UI patch rollback')
            return {'previewReadOnly':True,'acceptedFields':1,'omittedFields':1,'reviewStatus':'pending','rollback':True}
        check('UI patch preview supports selective acceptance, persistence and rollback',selective_ui_patch)

        def generate():
            before = self.api('/api/project')
            page.get_by_test_id('generation-task').click()
            dialog = page.get_by_test_id('generation-dialog')
            expect(dialog).to_be_visible()
            page.get_by_test_id('generation-name').fill('QA Woodland Inventory')
            page.get_by_test_id('generation-template').select_option('inventory')
            page.get_by_test_id('generation-width').fill('960')
            page.get_by_test_id('generation-height').fill('600')
            page.get_by_test_id('generation-brief').fill('Create an editable game inventory with separate item slots, a detail panel and a Use button.')
            page.get_by_test_id('generation-rules').fill('Keep the antique gold and forest palette.\nReuse local art assets and stable asset IDs.')
            page.get_by_test_id('generation-context').check()
            self.screen('codex-task-en.png')
            page.get_by_test_id('generation-export').click()
            expect(page.get_by_test_id('generation-result')).to_be_visible()
            filename = self.download(page.get_by_test_id('generation-download'),'generation-task.zip')
            entries = archive_entries(filename)
            required = ['TASK.md','task.json','template.project.json','FORMAT.json','model.mjs','validate.mjs','asset-manifest.json','reference.project.json']
            ensure(all(name in entries for name in required),f'Task archive misses files: {required}')
            ensure(json.loads(entries['reference.project.json'])==before,'Task context not exact source revision')
            task = json.loads(entries['task.json'])
            ensure(task['template']=='inventory' and task['baseRevision']==before['revision'],'Task template/revision mismatch')
            template = json.loads(entries['template.project.json'])
            ensure(len(template['nodes'])>10,'Inventory template lacks independent components')
            ensure(len({node['id'] for node in template['nodes']})==len(template['nodes']),'Template lacks unique stable IDs')
            manifest = json.loads(entries['asset-manifest.json'])
            for asset in manifest:
                ensure(asset['archivePath'] in entries,'Asset manifest points to missing archive member')
                if asset['src'].startswith('/assets/'):
                    ensure(entries[asset['archivePath']]==(ROOT/'public'/asset['src'].lstrip('/')).read_bytes(),'Task changed original asset bytes')
            extracted = self.temporary/'task-validation'
            extracted.mkdir()
            for name in ('model.mjs','validate.mjs','template.project.json'):
                (extracted/name).write_bytes(entries[name])
            validated = subprocess.run(['node','validate.mjs','template.project.json'],cwd=extracted,capture_output=True,text=True,timeout=15)
            ensure(validated.returncode==0,f'Bundled validator failed: {validated.stderr}')
            ensure(self.api('/api/project')==before,'Exporting a task modified the active design')
            self.generated_template = template
            self.generated_ui_id = template['id']
            dialog.get_by_role('button',name='Close',exact=True).last.click()
            return {'files':len(entries),'components':len(template['nodes']),'assetCopies':len(manifest),'standaloneValidatorPassed':True,'currentProjectUnchanged':True}
        check('Codex task ZIP contains editable inventory, exact context, original assets and a working validator',generate)

        def import_generated():
            before = self.api('/api/project')
            template = copy.deepcopy(self.generated_template)
            label = next(node for node in template['nodes'] if node['type']=='Label')
            label.setdefault('style',{})['text']='CODEX INVENTORY · editable'
            page.get_by_test_id('import-ui').click()
            dialog=page.get_by_role('dialog')
            page.get_by_test_id('project-file').set_input_files(self.fixture('result.project.json',template))
            with page.expect_download() as download:
                page.get_by_test_id('confirm-import').click()
            backup=self.temporary/'ui-backup.json';download.value.save_as(backup)
            ensure(json.loads(backup.read_text())==before,'Import backup is not prior active design')
            expect(dialog).not_to_be_visible()
            expect(page.get_by_test_id('layer-'+label['id'])).to_be_visible()
            page.get_by_test_id('layer-'+label['id']).click()
            page.get_by_role('button',name='Properties',exact=True).click()
            page.get_by_label('Component text',exact=True).fill('Editable after Codex task import')
            page.get_by_label('Component text',exact=True).press('Tab')
            wait_for(lambda: next(node for node in self.api('/api/project')['nodes'] if node['id']==label['id'])['style']['text']=='Editable after Codex task import','generated native node edited and saved')
            self.generated_ui_snapshot=self.api('/api/project')
            return {'projectId':template['id'],'editedNodeId':label['id'],'componentCount':len(template['nodes']),'backupVerified':True}
        check('Task result imports as native editable UI with backup and component editing',import_generated)

    def run_map(self, check):
        page=self.page
        def open_sample():
            current=self.map()
            ensure(current['grid']['width']==16 and current['grid']['height']==16,'Expected editable 16×16 sample')
            ensure(len(current['layers'])>=4 and len(current['objects'])>=8,'Expected layered village with editable objects')
            ensure(len(current['layers'][0]['cells'])==256,'Expected actual tile grid')
            expect(page.get_by_test_id('map-tool-brush')).to_be_visible()
            expect(page.get_by_test_id('map-tool-walk')).to_be_visible()
            self.screen('map-editor-en.png')
            self.language('zh-CN')
            expect(page.get_by_test_id('map-tool-brush')).to_have_attribute('title','画笔')
            self.screen('map-editor-zh.png')
            self.language('en')
            return {'grid':current['grid'],'layers':len(current['layers']),'objects':len(current['objects']),'render':'real Konva canvas with original SVG assets'}
        check('isometric village opens with layers, native tiles, objects and bilingual controls',open_sample)

        def terrain():
            page.get_by_test_id('map-layer-ground').click()
            page.get_by_test_id('map-asset-path').click()
            page.get_by_test_id('map-tool-brush').click()
            self.click_cell(1,12)
            self.saved(lambda p:self.layer('ground',p)['cells'].get('1,12')=='path','real brush tile save')
            page.get_by_test_id('map-tool-erase').click()
            self.click_cell(1,12)
            self.saved(lambda p:'1,12' not in self.layer('ground',p)['cells'],'real eraser tile save')
            page.get_by_test_id('map-undo').click()
            self.saved(lambda p:self.layer('ground',p)['cells'].get('1,12')=='path','erase undo')
            page.get_by_test_id('map-tool-rectangle').click()
            self.drag_cells((1,11),(2,12))
            targets=['1,11','2,11','1,12','2,12']
            self.saved(lambda p:all(self.layer('ground',p)['cells'].get(key)=='path' for key in targets),'rectangle painted four grid cells')
            after_rectangle=copy.deepcopy(self.layer('ground')['cells'])
            page.get_by_test_id('map-undo').click()
            self.saved(lambda p:self.layer('ground',p)['cells'].get('2,11')=='grass','rectangle undo')
            page.get_by_test_id('map-redo').click()
            self.saved(lambda p:self.layer('ground',p)['cells']==after_rectangle,'rectangle redo')
            page.get_by_test_id('map-tool-fill').click()
            self.click_cell(0,0)
            self.saved(lambda p:sum(value=='path' for value in self.layer('ground',p)['cells'].values())>200,'connected tile flood fill')
            page.get_by_test_id('map-undo').click()
            self.saved(lambda p:self.layer('ground',p)['cells']==after_rectangle,'flood-fill undo')
            return {'brush':True,'erase':True,'rectangleCells':4,'fillCells':'>200','undoRedo':True}
        check('mouse brush, eraser, rectangle and flood fill persist with undo/redo',terrain)

        def locked_layer():
            page.get_by_test_id('map-layer-lock-ground').click()
            self.saved(lambda p:self.layer('ground',p)['locked'],'layer locked')
            before=copy.deepcopy(self.map())
            page.get_by_test_id('map-tool-brush').click()
            self.click_cell(0,12)
            page.wait_for_timeout(250)
            ensure(self.map()==before,'Painting changed a locked layer')
            page.get_by_test_id('map-layer-lock-ground').click()
            self.saved(lambda p:not self.layer('ground',p)['locked'],'layer unlocked')
            return {'lockedPaintRejected':True,'documentUnchanged':True}
        check('locked layers reject real canvas painting',locked_layer)

        def object_drag():
            page.get_by_test_id('map-tool-select').click()
            page.get_by_test_id('map-object-list-tree-01').click()
            before=copy.deepcopy(self.object('tree-01'))
            start=self.cell(before['x'],before['y'])
            end=self.cell(before['x']-1,before['y'])
            scale=float(page.get_by_test_id('map-canvas').get_attribute('data-scale'))
            page.mouse.move(start[0],start[1]-40*scale)
            page.mouse.down()
            page.mouse.move(end[0],end[1]-40*scale,steps=12)
            page.mouse.up()
            self.saved(lambda p:self.object('tree-01',p)['x']==before['x']-1,'real object snapped drag')
            page.reload();page.get_by_test_id('workspace-map').click()
            expect(page.get_by_test_id('map-canvas')).to_be_visible()
            ensure(self.object('tree-01')['x']==before['x']-1,'Object drag lost after reload')
            page.get_by_test_id('map-object-list-tree-01').click()
            expect(page.get_by_test_id('map-object-x')).to_have_value(str(before['x']-1))
            return {'objectId':'tree-01','from':[before['x'],before['y']],'to':[before['x']-1,before['y']],'reloadPreserves':True}
        check('native objects drag with grid snapping and keep stable IDs after reload',object_drag)

        def reviews():
            page.get_by_test_id('map-object-list-tree-01').click()
            page.get_by_test_id('map-tab-reviews').click()
            page.get_by_test_id('map-review-target').fill('Move the gate pine away from the path')
            page.get_by_test_id('map-review-expected').fill('Move one grid cell west; keep display dimensions and artwork')
            page.get_by_test_id('map-protect-width').check()
            page.get_by_test_id('map-protect-height').check()
            page.get_by_test_id('map-review-add').click()
            self.saved(lambda p:len(p['reviews'])==1,'object review saves')
            self.object_review=self.map()['reviews'][0]
            page.get_by_test_id('map-layer-ground').click()
            page.get_by_test_id('map-tool-region').click()
            self.drag_cells((1,11),(2,12))
            page.get_by_test_id('map-tab-reviews').click()
            page.get_by_test_id('map-review-target').fill('Review this four-cell path area')
            page.get_by_test_id('map-review-expected').fill('Change only the reviewed tiles; keep walkability unchanged')
            page.get_by_test_id('map-protect-blocked').check()
            page.get_by_test_id('map-review-add').click()
            self.saved(lambda p:len(p['reviews'])==2,'region review saves')
            self.region_review=next(r for r in self.map()['reviews'] if r['target']['type']=='region')
            ensure(self.region_review['target']=={'type':'region','layerId':'ground','x':1,'y':11,'width':2,'height':2},f'Unexpected review region: {self.region_review}')
            page.get_by_test_id('map-review-target').fill('Already accepted region artwork')
            page.get_by_test_id('map-review-expected').fill('The user has accepted this reference; do not send it as pending work')
            page.get_by_test_id('map-review-add').click()
            self.saved(lambda p:len(p['reviews'])==3,'third review saves')
            self.approved_review=self.map()['reviews'][-1]
            page.get_by_test_id('map-review-'+self.approved_review['id']).locator('select').select_option('approved')
            self.saved(lambda p:p['reviews'][-1]['status']=='approved','explicit user review approval')
            self.review_map=copy.deepcopy(self.map())
            self.screen('map-review-en.png')
            return {'objectReviewId':self.object_review['id'],'objectId':self.object_review['target']['objectId'],'region':self.region_review['target'],'protectedFields':['width','height','blocked']}
        check('object and region reviews retain stable targets and protected properties',reviews)

        def feedback():
            filename=self.download(page.get_by_test_id('map-feedback'),'map-feedback.zip')
            entries=archive_entries(filename)
            feedback=json.loads(entries['feedback.json'])
            ensure(feedback['baseRevision']==self.map()['revision'],'Feedback base revision mismatch')
            ensure(len(feedback['reviews'])==2 and all(r['status']=='pending' for r in feedback['reviews']),'Feedback contains non-pending or missing reviews')
            ensure(self.approved_review['id'] not in [r['id'] for r in feedback['reviews']],'Approved review was exported as pending work')
            screenshot_sizes={}
            for review_id,filename in feedback['screenshots'].items():
                raw=entries[filename]
                ensure(raw.startswith(b'\x89PNG\r\n\x1a\n'),'Feedback crop not a PNG')
                dimensions=struct.unpack('>II',raw[16:24])
                ensure(dimensions[0]>0 and dimensions[1]>0,'Empty feedback screenshot')
                decoded=page.evaluate('''async bytes => {
                    const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
                    const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d');
                    context.drawImage(bitmap,0,0);const pixels=context.getImageData(0,0,bitmap.width,bitmap.height).data,colors=new Set();
                    for(let index=0;index<pixels.length;index+=4){if(pixels[index+3])colors.add(pixels.slice(index,index+4).join(','));if(colors.size>16)break;}
                    return {width:bitmap.width,height:bitmap.height,colors:colors.size};
                }''',list(raw))
                ensure(decoded['colors']>8,'Feedback crop decoded to blank or flat artwork')
                screenshot_sizes[review_id]=list(dimensions)
            ensure(len(screenshot_sizes)==2,'Missing review-local crop')
            ensure('patch-template.json' in entries,'Feedback is missing the incremental patch template')
            self.out.joinpath('map-feedback-project.json').write_text(json.dumps(self.map(),ensure_ascii=False,indent=2)+'\n')
            return {'pendingReviews':2,'approvedReviewsExcluded':1,'localCrops':screenshot_sizes,'archiveFiles':len(entries)}
        check('feedback exports reviewed local regions, original assets and matching patch contract',feedback)

        def patch_roundtrip():
            before=self.map()
            patch={'schemaVersion':1,'kind':'studio-map-patch','projectId':before['id'],'baseRevision':before['revision'],
                'summary':'Move reviewed pine; change one reviewed path tile',
                'reviewIds':[self.object_review['id'],self.region_review['id']],
                'changes':[{'type':'object','objectId':'tree-01','set':{'x':self.object('tree-01',before)['x']-1}},
                    {'type':'cell','layerId':'ground','x':1,'y':11,'assetId':'water'}]}
            # Server guards are independently exercised on the exact browser-created reviews.
            for invalid in ('scope','protected','stale'):
                bad=copy.deepcopy(patch)
                if invalid=='scope':bad['changes'][1]['x']=15
                if invalid=='protected':bad['changes'][0]['set']={'width':120}
                if invalid=='stale':bad['baseRevision']-=1
                response=self.api('/api/map/patch/preview',{'patch':bad},expected=400)
                ensure('error' in response,f'{invalid} patch was not rejected')
                ensure(self.map()==before,f'{invalid} patch preview mutated the document')
            page.get_by_test_id('map-patch').click()
            expect(page.get_by_test_id('map-patch-file')).not_to_be_visible()
            page.get_by_test_id('map-patch-file').set_input_files(self.fixture('reviewed.map.patch.json',patch))
            expect(page.get_by_test_id('map-patch-change-1')).to_be_checked()
            ensure(self.map()==before,'Map patch preview changed persisted map')
            self.screen('map-patch-preview-en.png')
            page.get_by_test_id('map-patch-change-1').uncheck()
            page.get_by_test_id('map-patch-apply').click()
            self.saved(lambda p:self.object('tree-01',p)['x']==self.object('tree-01',before)['x']-1,'selected map patch apply')
            after=self.map()
            ensure(self.layer('ground',after)['cells']==self.layer('ground',before)['cells'],'Unselected terrain edit was applied')
            ensure(all(r['status']=='pending' for r in after['reviews'] if r['id'] in patch['reviewIds']),'Partial map patch prematurely completed reviews')
            ensure(next(r for r in after['reviews'] if r['id']==self.approved_review['id'])['status']=='approved','Partial patch changed unrelated approved review')
            ensure(after['history'][-1]['partial'] and len(after['history'][-1]['changes'])==1,'Partial map history incorrect')
            ensure(after['reviews'][0]['target']==before['reviews'][0]['target'],'Moving object detached review')
            history_id=after['history'][-1]['id']
            page.reload();page.get_by_test_id('workspace-map').click()
            page.get_by_test_id('map-tab-changes').click()
            page.get_by_test_id('map-rollback-'+history_id).click()
            self.saved(lambda p:self.object('tree-01',p)==self.object('tree-01',before),'map patch conflict-aware rollback')
            ensure(self.map()['reviews'][0]['status']=='pending','Rollback changed pending review status')
            self.out.joinpath('map-selective.patch.json').write_text(json.dumps(patch,indent=2)+'\n')
            return {'rejected':['outside review scope','protected width','stale revision'],'previewReadOnly':True,'accepted':1,'omitted':1,'reviewFollowsObject':True,'rollback':True}
        check('map patch preview rejects unsafe edits and supports selective acceptance, reload and rollback',patch_roundtrip)

        def walk():
            page.get_by_test_id('map-tool-walk').click()
            self.click_cell(7,12)
            canvas=page.get_by_test_id('map-canvas')
            expect(canvas).to_have_attribute('data-player-x','7')
            expect(canvas).to_have_attribute('data-player-y','12')
            before=[canvas.get_attribute('data-player-x'),canvas.get_attribute('data-player-y')]
            self.click_cell(13,13)
            page.wait_for_timeout(350)
            ensure([canvas.get_attribute('data-player-x'),canvas.get_attribute('data-player-y')]==before,'Character entered blocked water')
            expect(page.get_by_text('No walkable route. Check collision cells and object footprints.',exact=True)).to_be_visible()
            self.screen('map-walk-en.png')
            return {'reachableDestination':[7,12],'blockedWater':[13,13],'collisionPrevented':True}
        check('real click-to-walk preview moves through free cells and refuses blocked water',walk)

        def import_atlas_asset():
            page.get_by_test_id('map-layer-ground').click()
            page.get_by_test_id('map-palette-terrain').click()
            before=self.map()
            page.get_by_test_id('map-asset-import').click()
            dialog=page.get_by_test_id('map-asset-dialog')
            expect(page.get_by_test_id('map-asset-file')).not_to_be_visible()
            page.get_by_test_id('map-asset-file').set_input_files(ROOT/'public/assets/map/path.svg')
            dialog.get_by_label('Name',exact=True).fill('QA cropped path')
            dialog.get_by_label('Atlas crop',exact=True).check()
            dialog.get_by_label('Crop X',exact=True).fill('16')
            dialog.get_by_label('Crop Y',exact=True).fill('8')
            dialog.get_by_label('Crop width',exact=True).fill('32')
            dialog.get_by_label('Crop height',exact=True).fill('16')
            page.get_by_test_id('map-asset-confirm').click()
            expect(dialog).not_to_be_visible()
            imported=self.saved(lambda p:len(p['assets'])==len(before['assets'])+1,'atlas asset metadata saved')
            asset=next(item for item in imported['assets'] if item['name']=='QA cropped path')
            ensure(asset['atlas']=={'x':16,'y':8,'width':32,'height':16},'Atlas crop not persisted')
            with urlopen(self.base+asset['src'],timeout=5) as response:
                ensure(response.read()==(ROOT/'public/assets/map/path.svg').read_bytes(),'Import changed original image bytes')
            page.get_by_test_id('map-asset-'+asset['id']).click()
            self.click_cell(0,15)
            self.saved(lambda p:self.layer('ground',p)['cells'].get('0,15')==asset['id'],'imported atlas tile painted')
            page.get_by_test_id('map-undo').click()
            self.saved(lambda p:self.layer('ground',p)['cells'].get('0,15')=='grass','imported tile paint undo')
            page.reload();page.get_by_test_id('workspace-map').click()
            expect(page.get_by_test_id('map-asset-'+asset['id'])).to_be_visible()
            ensure(next(item for item in self.map()['assets'] if item['id']==asset['id'])==asset,'Asset metadata lost on reload')
            return {'assetId':asset['id'],'crop':asset['atlas'],'originalBytesPreserved':True,'paintedAndUndone':True,'reloadPreserves':True}
        check('local asset import preserves original bytes, crops atlas tiles, paints and persists',import_atlas_asset)

        def export_import():
            before=self.map()
            filename=self.download(page.get_by_test_id('map-export'),'village-edited.map.json')
            ensure(json.loads(filename.read_text())==before,'Exported map differs from saved document')
            page.get_by_test_id('map-import').click()
            imported=copy.deepcopy(before);imported['id']='qa-imported-village';imported['name']='Imported editable village'
            page.get_by_test_id('map-import-file').set_input_files(self.fixture('import.map.json',imported))
            with page.expect_download() as download:
                page.get_by_test_id('map-import-confirm').click()
            backup=self.temporary/'map-backup.json';download.value.save_as(backup)
            ensure(json.loads(backup.read_text())==before,'Map backup differs from prior map')
            self.saved(lambda p:p['id']=='qa-imported-village','map import replaces map')
            ensure(self.api('/api/project')==self.generated_ui_snapshot,'Map import changed independent UI project')
            return {'backupMatchesPriorMap':True,'importedId':'qa-imported-village','uiDocumentUnchanged':True}
        check('map export/import preserves full editable data and backs up the prior map',export_import)

        def compact_layout():
            page.set_viewport_size({'width':1366,'height':768})
            self.language('zh-CN')
            expect(page.get_by_test_id('map-export')).to_be_visible()
            expect(page.get_by_test_id('map-godot')).to_be_visible()
            canvas=page.get_by_test_id('map-canvas').bounding_box()
            ensure(canvas['width']>350 and canvas['height']>200,f'Map canvas unusable at 1366×768: {canvas}')
            page.get_by_test_id('map-import').click()
            dialog=page.get_by_role('dialog')
            expect(page.get_by_test_id('map-import-file')).not_to_be_visible()
            bounds=dialog.bounding_box()
            ensure(bounds['y']>=0 and bounds['y']+bounds['height']<=769,f'Map dialog extends outside 768px viewport: {bounds}')
            self.screen('map-import-zh-1366.png')
            dialog.get_by_role('button',name='取消',exact=True).click()
            page.set_viewport_size({'width':1600,'height':1000})
            self.language('en')
            return {'viewport':[1366,768],'canvasPixels':[round(canvas['width']),round(canvas['height'])],'dialogFits':True}
        check('Chinese map controls and import dialog remain usable at 1366×768',compact_layout)

        def godot_archive():
            filename=self.download(page.get_by_test_id('map-godot'),'map-godot.zip')
            entries=archive_entries(filename)
            ensure('project.godot' in entries,'Missing real Godot project file')
            ensure(any(name.endswith('.tscn') for name in entries),'Missing Godot scene')
            ensure(any(name.endswith('.gd') for name in entries),'Missing playable Godot script')
            ensure(any('component' in name or 'mapping' in name or 'map' in name for name in entries if name.endswith('.json')),'Missing traceable node mapping')
            return {'archiveFiles':len(entries),'runtimeEvidence':'Separate scripts/test-map-godot.js engine validation; this check verifies download contents only.'}
        check('current map exports a runnable-format Godot archive with assets and ID mapping',godot_archive)

        def new_map():
            before=self.map()
            page.get_by_test_id('map-new').click()
            dialog=page.get_by_test_id('map-new-dialog')
            page.get_by_test_id('map-new-name').fill('QA blank editable map')
            page.get_by_test_id('map-new-width').fill('8')
            page.get_by_test_id('map-new-height').fill('8')
            with page.expect_download() as download:
                page.get_by_test_id('map-new-confirm').click()
            backup=self.temporary/'new-map-backup.json';download.value.save_as(backup)
            ensure(json.loads(backup.read_text())==before,'New map backup differs from prior map')
            expect(dialog).not_to_be_visible()
            blank=self.saved(lambda p:p['name']=='QA blank editable map','blank map created')
            ensure(blank['grid']['width']==8 and blank['grid']['height']==8,'New map dimensions incorrect')
            ensure(not blank['objects'] and not blank['reviews'] and not blank['history'],'New map retained sample objects or history')
            ensure(all(not layer['cells'] for layer in blank['layers']),'New map was not empty')
            ensure(blank['assets']==before['assets'],'New map did not retain asset library')
            page.get_by_test_id('map-palette-terrain').click()
            page.get_by_test_id('map-asset-grass').click()
            page.get_by_test_id('map-tool-fill').click()
            self.click_cell(0,0)
            self.saved(lambda p:len(self.layer('ground',p)['cells'])==64,'blank map flood filled')
            page.get_by_test_id('map-layer-decoration').click()
            page.get_by_test_id('map-palette-objects').click()
            page.get_by_test_id('map-asset-tree').click()
            self.click_cell(3,3)
            one=self.saved(lambda p:len(p['objects'])==1,'new object placed from palette')
            placed=one['objects'][0]
            ensure(placed['x']==3 and placed['y']==3 and placed['layerId']=='decoration','Placed object target coordinates/layer incorrect')
            page.get_by_test_id('map-object-duplicate').click()
            two=self.saved(lambda p:len(p['objects'])==2,'placed object duplicated')
            ensure(two['objects'][0]['id']!=two['objects'][1]['id'],'Duplicate reused original stable ID')
            page.get_by_test_id('map-object-delete').click()
            self.saved(lambda p:len(p['objects'])==1,'duplicate removed')
            page.get_by_test_id('map-tool-spawn').click();self.click_cell(0,0)
            self.saved(lambda p:any(m['type']=='spawn' and m['x']==0 and m['y']==0 for m in p['markers']),'spawn marker placed')
            page.get_by_test_id('map-tool-exit').click();self.click_cell(7,7)
            self.saved(lambda p:any(m['type']=='exit' and m['x']==7 and m['y']==7 for m in p['markers']),'exit marker placed')
            page.get_by_test_id('map-tool-trigger').click();self.click_cell(2,1)
            self.saved(lambda p:any(m['type']=='trigger' and m['x']==2 and m['y']==1 for m in p['markers']),'trigger marker placed')
            page.get_by_test_id('map-tool-collision').click();self.click_cell(6,7)
            self.saved(lambda p:'6,7' in p['blocked'],'collision cell painted')
            page.get_by_test_id('map-tool-walk').click();self.click_cell(7,7)
            canvas=page.get_by_test_id('map-canvas')
            expect(canvas).to_have_attribute('data-player-x','7')
            expect(canvas).to_have_attribute('data-player-y','7')
            page.keyboard.press('ArrowLeft')
            page.wait_for_timeout(150)
            expect(canvas).to_have_attribute('data-player-x','7')
            expect(canvas).to_have_attribute('data-player-y','7')
            return {'grid':[8,8],'paintedTiles':64,'placedObjects':1,'duplicateHasNewId':True,'markers':['spawn','exit','trigger'],'paintedCollisionBlocksKeyboard':True,'priorMapBackedUp':True}
        check('blank maps support asset placement, duplicate/delete, game markers and painted collision',new_map)

        def tile_drop_and_stamp():
            page.get_by_test_id('map-layer-ground').click()
            page.get_by_test_id('map-palette-terrain').click()
            page.get_by_test_id('map-asset-path').click()
            expect(page.get_by_test_id('map-asset-footprint-width')).to_have_value('1')
            expect(page.get_by_test_id('map-asset-footprint-height')).to_have_value('1')
            before=self.map()
            self.native_palette_drop('path',1,5)
            one=self.saved(lambda p:self.layer('ground',p)['cells'].get('1,5')=='path','native HTML tile palette drop')
            old=self.layer('ground',before)['cells'];new=self.layer('ground',one)['cells']
            changed=[key for key in new if new.get(key)!=old.get(key)]
            ensure(changed==['1,5'],f'A 1×1 tile drop changed extra cells: {changed}')
            page.get_by_test_id('map-asset-footprint-width').fill('2')
            page.get_by_test_id('map-asset-footprint-height').fill('3')
            self.saved(lambda p:next(a for a in p['assets'] if a['id']=='path').get('footprint')=={'width':2,'height':3},'terrain stamp footprint saved')
            before=self.map()
            self.native_palette_drop('path',0,2,width=2,height=3,screenshot='map-terrain-stamp-ghost-en.png')
            expected={f'{x},{y}' for x in (0,1) for y in (2,3,4)}
            after=self.saved(lambda p:all(self.layer('ground',p)['cells'].get(key)=='path' for key in expected),'2×3 terrain stamp saved')
            old=self.layer('ground',before)['cells'];new=self.layer('ground',after)['cells']
            changed={key for key in new if new.get(key)!=old.get(key)}
            ensure(changed==expected,f'Stamp did not change exactly six cells: {changed}')
            ensure(next(a for a in after['assets'] if a['id']=='path')['width']==64,'Footprint scaled tile display width')
            before=self.map()
            self.native_palette_drop('path',7,7,width=2,height=3,valid=False)
            page.wait_for_timeout(150)
            ensure(self.map()==before,'Out-of-bounds stamp was partially placed')
            page.get_by_test_id('map-layer-lock-ground').click()
            self.saved(lambda p:self.layer('ground',p)['locked'],'stamp target layer locked')
            before=self.map()
            self.native_palette_drop('path',0,0,width=2,height=3,valid=False)
            page.wait_for_timeout(150)
            ensure(self.map()==before,'Native drop wrote into a locked layer')
            page.get_by_test_id('map-layer-lock-ground').click()
            self.saved(lambda p:not self.layer('ground',p)['locked'],'stamp target layer unlocked')
            return {'nativeHTMLDrag':True,'singleTileCells':1,'stampFootprint':[2,3],'stampCells':6,'displayTileSize':[64,32],'outOfBoundsAtomicRejection':True,'lockedLayerRejection':True}
        check('native tile palette drag drops 1×1 cells or N×M stamps and rejects invalid targets atomically',tile_drop_and_stamp)

        def object_footprint_and_layers():
            page.get_by_test_id('map-layer-decoration').click()
            page.get_by_test_id('map-palette-objects').click()
            page.get_by_test_id('map-asset-house').click()
            expect(page.get_by_test_id('map-asset-footprint-width')).to_have_value('2')
            expect(page.get_by_test_id('map-asset-footprint-height')).to_have_value('2')
            before=self.map()
            self.native_palette_drop('house',5,1,width=2,height=2,screenshot='map-house-footprint-ghost-en.png')
            after=self.saved(lambda p:len(p['objects'])==len(before['objects'])+1,'2×2 house palette drop')
            placed=next(item for item in after['objects'] if item['id'] not in {old['id'] for old in before['objects']})
            ensure(placed['footprint']=={'width':2,'height':2} and placed['layerId']=='decoration','Object footprint or placement layer is incorrect')
            ensure([placed['x'],placed['y'],placed['width'],placed['height']]==[5,1,160,160],'Footprint stretched the house image or placed it at wrong cell')
            page.get_by_test_id('map-object-footprint-width').fill('3')
            updated=self.saved(lambda p:self.object(placed['id'],p)['footprint']['width']==3,'instance footprint edit')
            ensure(self.object(placed['id'],updated)['width']==160 and self.object(placed['id'],updated)['height']==160,'Editing occupancy distorted displayed artwork')
            page.get_by_test_id('map-object-layer').select_option('ground')
            self.saved(lambda p:self.object(placed['id'],p)['layerId']=='ground','object moved to target layer')
            ensure(self.object(placed['id'])['id']==placed['id'],'Layer move changed stable ID')
            page.get_by_test_id('map-object-layer').select_option('decoration')
            self.saved(lambda p:self.object(placed['id'],p)['layerId']=='decoration','object moved back to decoration')
            page.get_by_test_id('map-tool-walk').click();self.click_cell(7,6)
            canvas=page.get_by_test_id('map-canvas')
            expect(canvas).to_have_attribute('data-player-x','7')
            expect(canvas).to_have_attribute('data-player-y','6')
            self.click_cell(7,2)
            page.wait_for_timeout(150)
            expect(canvas).to_have_attribute('data-player-y','6')
            before_image=canvas.locator('canvas').first.screenshot()
            page.get_by_test_id('map-layer-visible-decoration').click()
            self.saved(lambda p:not self.layer('decoration',p)['visible'],'object layer hidden')
            page.wait_for_timeout(80)
            ensure(canvas.locator('canvas').first.screenshot()!=before_image,'Layer visibility did not change actual canvas rendering')
            self.click_cell(7,2)
            page.wait_for_timeout(150)
            expect(canvas).to_have_attribute('data-player-y','6')
            ensure(self.object(placed['id'])['footprint']=={'width':3,'height':2},'Hiding layer changed collision footprint')
            page.get_by_test_id('map-layer-visible-decoration').click()
            self.saved(lambda p:self.layer('decoration',p)['visible'],'object layer shown')
            return {'nativeHTMLDrag':True,'assetFootprint':[2,2],'instanceFootprint':[3,2],'artworkPixels':[160,160],'stableId':placed['id'],'layerMovesPreserveId':True,'hiddenLayerStillBlocksMovement':True}
        check('house footprint ghosts, instance occupancy and explicit layer moves preserve art and collision',object_footprint_and_layers)


def main(acceptance_class=Acceptance, report_name='map-workspace-results.json', default_out=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('google-chrome'))
    parser.add_argument('--out', type=Path, default=default_out or ROOT/'artifacts/v0.2.0/browser')
    parser.add_argument('--previews', type=Path, default=ROOT/'previews/v0.2.0')
    parser.add_argument('--no-previews', action='store_true')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    report = {'schemaVersion':1, 'runner':'Python Playwright / real Chromium', 'isolatedData':True, 'mode':'production', 'checks':[], 'status':'running', 'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    errors = []
    browser = server = page = None

    def check(name, operation):
        start = time.monotonic()
        try:
            details = operation()
            entry = {'name':name, 'status':'passed', 'seconds':round(time.monotonic()-start, 3)}
            if details is not None:
                entry['details'] = details
            report['checks'].append(entry)
            print('PASS', name, flush=True)
            return details
        except Exception as error:
            report['checks'].append({'name':name, 'status':'failed', 'error':str(error)})
            raise

    try:
        with tempfile.TemporaryDirectory(prefix='studio-map-browser-') as directory:
            temporary = Path(directory)
            with socket.socket() as listener:
                listener.bind(('127.0.0.1',0))
                port = listener.getsockname()[1]
            base = f'http://127.0.0.1:{port}'
            with (temporary/'server.log').open('w') as log:
                server = subprocess.Popen(['node','server/index.js','--production'], cwd=ROOT,
                    env={**os.environ,'PORT':str(port),'STUDIO_DATA_DIR':str(temporary/'data')}, stdout=log, stderr=subprocess.STDOUT)
                try:
                    wait_for(lambda: json.load(urlopen(base+'/api/health', timeout=1))['ok'], 'isolated production server starts')
                except Exception:
                    raise RuntimeError((temporary/'server.log').read_text())
                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
                    report['browserVersion'] = browser.version
                    page = browser.new_page(viewport={'width':1600,'height':1000}, accept_downloads=True, device_scale_factor=1)
                    page.on('pageerror',lambda error:errors.append(str(error)))
                    page.set_default_timeout(15000)
                    acceptance_class(page,base,temporary,args.out,None if args.no_previews else args.previews).run(check)
                    check('no uncaught browser errors', lambda: ensure(not errors, f'Uncaught errors: {errors}'))
                    report['status'] = 'passed'
                    browser.close()
                    browser = page = None
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        report['traceback'] = traceback.format_exc()
        if page:
            try:
                page.screenshot(path=str(args.out/'failure.png'), full_page=True)
            except Exception:
                pass
        print(report['traceback'], file=sys.stderr)
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        if server:
            server.terminate()
            try:
                server.wait(timeout=8)
            except subprocess.TimeoutExpired:
                server.kill();server.wait()
        report['pageErrors'] = errors
        report['completedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        report['passed'] = sum(item['status']=='passed' for item in report['checks'])
        report['failed'] = sum(item['status']=='failed' for item in report['checks'])
        (args.out/report_name).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(f"Results: {args.out/report_name}; status={report['status']}",flush=True)
    return 0 if report['status']=='passed' else 1


if __name__ == '__main__':
    sys.exit(main())
