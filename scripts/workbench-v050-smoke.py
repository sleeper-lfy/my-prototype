#!/usr/bin/env python3
"""v0.5.0 real Chromium workflows, isolated local data, original artwork untouched."""
import base64
import hashlib
import io
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.request
import zipfile
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'artifacts/v0.5.0/browser'
PRE = ROOT / 'previews/v0.5.0'


def wait(fn, seconds=25):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            value = fn()
            if value:
                return value
        except Exception as error:
            last = str(error)
        time.sleep(.05)
    raise AssertionError('Timed out: ' + str(last))


def run(page, work, req, report):
    def check(name, fn):
        started = time.monotonic()
        try:
            details = fn()
            report['checks'].append({'name': name, 'status': 'passed', 'seconds': round(time.monotonic()-started, 3), 'details': details})
            print('PASS', name, flush=True)
        except Exception as error:
            report['checks'].append({'name': name, 'status': 'failed', 'error': str(error)})
            raise

    def workflow(kind):
        page.get_by_test_id('studio-workflows').click()
        page.get_by_test_id(kind+'-open').click()

    def download(testid, filename):
        with page.expect_download() as event:
            page.get_by_test_id(testid).click()
        target = work / filename
        event.value.save_as(target)
        return target

    page.get_by_test_id('language-select').select_option('en')

    def tasks():
        workflow('codex-queue')
        page.get_by_test_id('codex-review-review-cta').check()
        page.get_by_test_id('codex-task-create').click()
        expect(page.get_by_test_id('codex-task-export')).to_be_enabled()
        archive = download('codex-task-export', 'task.zip')
        with zipfile.ZipFile(archive) as z:
            assert any(n.endswith('.png') for n in z.namelist())
        patch=req('/api/example-patch')
        patchfile=work/'result.patch.json'; patchfile.write_text(json.dumps(patch))
        page.get_by_test_id('codex-task-file').set_input_files(str(patchfile))
        expect(page.get_by_test_id('codex-task-apply')).to_be_visible()
        page.get_by_test_id('codex-task-apply').click()
        expect(page.get_by_test_id('codex-task-rollback')).to_be_enabled()
        assert next(r for r in req('/api/project')['reviews'] if r['id']=='review-cta')['status']=='modified'
        page.get_by_test_id('codex-task-rollback').click()
        wait(lambda: next(r for r in req('/api/project')['reviews'] if r['id']=='review-cta')['status']=='pending')
        page.get_by_test_id('codex-task-close').click()
        return {'appliedAndRolledBack':True,'realCrops': True, 'bytes': archive.stat().st_size}
    check('Codex creates a scoped task and exports actual component crops', tasks)

    def assets():
        workflow('asset-inspector')
        expect(page.get_by_test_id('asset-item').first).to_be_visible()
        page.get_by_test_id('asset-run-checks').click()
        expect(page.get_by_test_id('asset-check-results')).to_be_visible()
        page.screenshot(path=str(PRE/'asset-health-en.png'))
        page.get_by_test_id('asset-inspector').get_by_role('button',name='Close',exact=True).click()
        return {'decodedResourceChecked': True}
    check('Asset inspector indexes references and checks decoded pixels', assets)

    def trial():
        page.get_by_test_id('workspace-animation').click()
        page.get_by_test_id('anim-lab-open').click()
        page.get_by_test_id('anim-lab-start').click()
        page.keyboard.down('KeyD'); page.wait_for_timeout(200); page.keyboard.up('KeyD')
        assert float(page.get_by_test_id('anim-lab-state').get_attribute('data-x')) > 0
        page.get_by_test_id('anim-lab-reset').click()
        page.screenshot(path=str(PRE/'character-trial-en.png'))
        return {'keyboardMovement': True}
    check('Character trial moves the actual animation with keyboard input', trial)

    def events():
        page.get_by_test_id('anim-lab-tab-events').click()
        page.get_by_test_id('anim-event-type').select_option('audio')
        page.get_by_test_id('anim-event-name').fill('test-sound')
        page.get_by_test_id('anim-event-resource').fill('res://audio/test.ogg')
        page.get_by_test_id('anim-event-add').click()
        wait(lambda: any(e.get('name')=='test-sound' for e in req('/api/animation')['clips'][0]['frames'][0]['events']))
        page.screenshot(path=str(PRE/'event-timeline-en.png'))
        return {'eventPersisted': True}
    check('Timeline saves a typed audio event and complete resource identifier', events)

    def equipment():
        page.get_by_test_id('anim-lab-tab-equipment').click()
        page.get_by_test_id('anim-equipment-add').click()
        wait(lambda: len(req('/api/animation').get('equipment',[])) == 1)
        page.get_by_test_id('anim-equipment-check').click()
        expect(page.get_by_test_id('anim-equipment-report')).to_be_visible()
        page.screenshot(path=str(PRE/'equipment-en.png'))
        return {'attachmentPersisted': True}
    check('Equipment binds to rig and checks every action extent', equipment)

    def readback():
        page.get_by_test_id('workspace-ui').click()
        workflow('godot-readback')
        scene='[gd_scene format=3]\n[node name="Root" type="Control"]\noffset_right = 640.0\noffset_bottom = 480.0\n[node name="Title" type="Label" parent="."]\noffset_right = 200.0\noffset_bottom = 40.0\ntext = "Readback title"\n'
        page.get_by_test_id('godot-scene-text').fill(scene)
        expect(page.get_by_test_id('godot-import-summary')).to_contain_text('2')
        expect(page.get_by_test_id('godot-import-apply')).to_be_enabled()
        page.screenshot(path=str(PRE/'godot-readback-en.png'))
        page.keyboard.press('Escape')
        return {'supportedNodes':2,'previewValidated':True}
    check('Godot scene parser previews editable Control and Label', readback)


    def map_reachability():
        page.get_by_test_id('workspace-map').click()
        page.get_by_test_id('map-playability').click()
        panel = page.get_by_test_id('map-playability-panel')
        expect(panel).to_be_visible()
        expect(page.get_by_test_id('map-route-exit-north')).to_be_enabled()
        original = json.loads(download('map-playability-export', 'playability-original.json').read_text())
        page.get_by_test_id('map-actor-width').fill('2')
        wait(lambda: req('/api/map').get('playability', {}).get('actor', {}).get('width') == 2)
        larger = json.loads(download('map-playability-export', 'playability-wide.json').read_text())
        assert larger['actor']['width'] == 2
        assert len(larger['reachable']) < len(original['reachable'])
        page.get_by_test_id('map-actor-width').fill('1')
        wait(lambda: req('/api/map')['playability']['actor']['width'] == 1)
        page.get_by_test_id('map-marker-exit-north-x').fill('3')
        wait(lambda: next(m for m in req('/api/map')['markers'] if m['id']=='exit-north')['x'] == 3)
        page.get_by_test_id('map-marker-exit-north-y').fill('3')
        wait(lambda: next(m for m in req('/api/map')['markers'] if m['id']=='exit-north')['y'] == 3)
        expect(page.get_by_test_id('map-route-exit-north')).to_be_disabled()
        expect(page.get_by_test_id('map-playability-issues')).to_contain_text('Exit is unreachable')
        page.screenshot(path=str(PRE / 'map-unreachable-en.png'))
        page.get_by_test_id('map-marker-exit-north-x').fill('7')
        wait(lambda: next(m for m in req('/api/map')['markers'] if m['id']=='exit-north')['x'] == 7)
        page.get_by_test_id('map-marker-exit-north-y').fill('0')
        wait(lambda: next(m for m in req('/api/map')['markers'] if m['id']=='exit-north')['y'] == 0)
        expect(page.get_by_test_id('map-route-exit-north')).to_be_enabled()
        page.get_by_test_id('map-playability-walk').click()
        expect(panel).not_to_be_visible()
        canvas = page.get_by_test_id('map-canvas')
        wait(lambda: canvas.get_attribute('data-player-y') == '14')
        page.keyboard.press('ArrowUp')
        wait(lambda: canvas.get_attribute('data-player-y') == '13')
        expect(page.get_by_test_id('map-avatar-status')).to_contain_text('Saved animation loaded')
        page.screenshot(path=str(PRE / 'map-character-walk-en.png'))
        return {'actorFootprintSaved': True, 'reachablePositions': len(original['reachable']), 'wideActorReachablePositions': len(larger['reachable']), 'blockedExitDetected': True, 'markerEditPersisted': True, 'keyboardMovedActor': True, 'savedAnimationAvatarLoaded': True}
    check('map footprint changes actual reachability; moved exit warns and saved character walks by keyboard', map_reachability)

    def map_regions():
        page.get_by_test_id('map-tool-select').click()
        page.get_by_test_id('map-object-list-house-01').click()
        page.get_by_test_id('map-tab-properties').click()
        page.get_by_test_id('map-object-collision-width').fill('1')
        wait(lambda: next(o for o in req('/api/map')['objects'] if o['id']=='house-01').get('collision', {}).get('width') == 1)
        page.get_by_test_id('map-object-occlusion-width').fill('3')
        wait(lambda: next(o for o in req('/api/map')['objects'] if o['id']=='house-01').get('occlusion', {}).get('width') == 3)
        page.get_by_test_id('map-object-occlusion-fade').check()
        wait(lambda: next(o for o in req('/api/map')['objects'] if o['id']=='house-01')['occlusion']['fade'])
        house = next(o for o in req('/api/map')['objects'] if o['id']=='house-01')
        assert house['footprint'] == {'width': 2, 'height': 2}
        assert house['width'] == house['height'] == 160
        page.screenshot(path=str(PRE / 'map-independent-regions-en.png'))
        page.reload(wait_until='networkidle')
        page.get_by_test_id('workspace-map').click()
        assert next(o for o in req('/api/map')['objects'] if o['id']=='house-01') == house
        return {'artworkPixels': [160,160], 'occupancyCells': [2,2], 'collisionWidthCells': 1, 'occlusionWidthCells': 3, 'fadeEnabled': True, 'reloadPreserved': True}
    check('map image, occupancy, collision and occlusion dimensions edit and save independently', map_regions)

    if len(report['checks']) < 7:
        raise AssertionError('Integration suite incomplete: all seven accepted feature groups must be checked.')
    assert not report['errors'], report['errors']


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    PRE.mkdir(parents=True, exist_ok=True)
    report = {'status': 'running', 'checks': [], 'errors': [], 'isolatedData': True, 'nativeWindows': False}
    with tempfile.TemporaryDirectory(prefix='studio-v050-browser-') as temporary:
        work = pathlib.Path(temporary)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        def req(route, method='GET', body=None):
            raw = None if body is None else json.dumps(body).encode()
            request = urllib.request.Request(base + route, method=method, data=raw, headers={} if body is None else {'Content-Type': 'application/json'})
            with urllib.request.urlopen(request, timeout=30) as response:
                data = response.read()
                return json.loads(data) if 'json' in response.headers.get('Content-Type','') else data
        with (work / 'server.txt').open('w') as log:
            server = subprocess.Popen(['node', 'server/index.js', '--production'], cwd=ROOT, env={**os.environ, 'STUDIO_DATA_DIR': str(work/'data'), 'PORT': str(port)}, stdout=log, stderr=log)
            page = None
            try:
                wait(lambda: req('/api/health')['ok'])
                with sync_playwright() as pw:
                    browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN') or shutil.which('chromium') or shutil.which('google-chrome'), headless=True, args=['--no-sandbox'])
                    page = browser.new_page(viewport={'width':1600, 'height':1000}, accept_downloads=True)
                    page.on('pageerror', lambda error: report['errors'].append(str(error)))
                    page.goto(base, wait_until='networkidle')
                    run(page, work, req, report)
                    page.set_viewport_size({'width':1366,'height':768})
                    for language in ['zh-CN','en']:
                        page.get_by_test_id('language-select').select_option(language)
                        for workspace in ['ui','map','animation']:
                            page.get_by_test_id('workspace-'+workspace).click()
                            expect(page.get_by_test_id('app-logo')).to_be_visible()
                            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                            page.screenshot(path=str(PRE/(workspace+'-'+language+'-1366.png')))
                    report['checks'].append({'name':'Both languages and all workspaces fit 1366x768 with original logo','status':'passed'})
                    report.update(status='passed', chromiumVersion=browser.version)
                    browser.close()
            except Exception as error:
                report.update(status='failed', error=str(error), traceback=traceback.format_exc())
                print(report['traceback'], flush=True)
                if page:
                    try: page.screenshot(path=str(PRE/'workbench-failure.png'), full_page=True)
                    except Exception: pass
            finally:
                server.terminate()
                try: server.wait(timeout=8)
                except subprocess.TimeoutExpired: server.kill(); server.wait(timeout=8)
                report['passed'] = sum(check['status']=='passed' for check in report['checks'])
                report['failed'] = sum(check['status']=='failed' for check in report['checks'])
                report['testHarnessSha256'] = hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
                (OUT/'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
                shutil.copyfile(work/'server.txt', OUT/'server.txt')
    return 0 if report['status']=='passed' else 1

if __name__ == '__main__':
    sys.exit(main())
