#!/usr/bin/env python3
"""Real Chromium animation acceptance using isolated temporary data and synthetic import fixtures."""
import base64
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
OUT = ROOT / 'artifacts/v0.4.0/animation-browser'
PRE = ROOT / 'previews/v0.4.0'
OUT.mkdir(parents=True, exist_ok=True)
PRE.mkdir(parents=True, exist_ok=True)
report = {'status': 'running', 'checks': [], 'errors': [], 'isolatedData': True}


def wait(fn, seconds=20):
    end = time.monotonic() + seconds
    last = None
    while time.monotonic() < end:
        try:
            value = fn()
            if value:
                return value
        except Exception as error:
            last = str(error)
        time.sleep(.05)
    raise AssertionError('Timed out: ' + str(last))


def check(name, fn):
    try:
        details = fn()
        report['checks'].append({'name': name, 'status': 'passed', 'details': details})
        print('PASS', name, flush=True)
    except Exception as error:
        report['checks'].append({'name': name, 'status': 'failed', 'error': str(error)})
        raise


def run(page, work, req):
    page.get_by_test_id('language-select').select_option('en')
    page.get_by_test_id('workspace-animation').click()
    workspace = page.get_by_test_id('animation-workspace')
    stage = page.get_by_test_id('anim-stage')
    expect(workspace).to_be_visible()
    original_ui = req('/api/project')
    def project():
        return req('/api/animation')
    def current_frame():
        p = project()
        return next(f for c in p['clips'] for f in c['frames'] if f['id'] == stage.get_attribute('data-frame-id'))
    def tab(name):
        workspace.locator('.anim-tabs').get_by_role('button', name=name, exact=True).click()
    def download(testid, filename):
        with page.expect_download() as event:
            page.get_by_test_id(testid).click()
        target = work / filename
        event.value.save_as(target)
        return target
    def defaults():
        p = project()
        assert p['canvas'] == {'width': 64, 'height': 96}
        assert len(p['clips']) == 12
        assert {c['direction'] for c in p['clips']} == {'up', 'down', 'left', 'right'}
        assert {c['action'] for c in p['clips']} == {'idle', 'walk', 'attack'}
        expect(stage.locator('canvas')).to_have_attribute('width', '256')
        page.screenshot(path=str(PRE / 'animation-editor-en.png'), full_page=True)
        return {'canvas': p['canvas'], 'clips': len(p['clips']), 'actualCanvas': True}
    check('64x96 editable character workspace opens with twelve directional action presets', defaults)
    def playback():
        first = stage.get_attribute('data-frame-id')
        page.get_by_test_id('anim-play').click()
        wait(lambda: stage.get_attribute('data-frame-id') != first)
        page.get_by_test_id('anim-play').click()
        stopped = stage.get_attribute('data-frame-id')
        page.wait_for_timeout(300)
        assert stage.get_attribute('data-frame-id') == stopped
        page.get_by_test_id('anim-next').click()
        assert stage.get_attribute('data-frame-id') != stopped
        page.get_by_test_id('anim-prev').click()
        assert stage.get_attribute('data-frame-id') == stopped
        workspace.get_by_label('Onion skin', exact=True).check()
        workspace.get_by_label('Pixel grid', exact=True).check()
        page.get_by_test_id('anim-clip-walk-right').click()
        page.get_by_test_id('anim-frame-2').click()
        page.screenshot(path=str(PRE / 'animation-onion-en.png'), full_page=True)
        page.get_by_test_id('anim-clip-idle-down').click()
        return {'timedPlayback': True, 'pauseStable': True, 'nextPrevious': True, 'onionAndGrid': True}
    check('actual playback advances frames and stepping, onion skin and direction switching work', playback)
    def editing():
        page.get_by_test_id('anim-bone').select_option('leftUpperArm')
        page.get_by_test_id('anim-angle').fill('20')
        page.get_by_test_id('anim-duration').fill('180')
        page.get_by_test_id('anim-save-frame').click()
        wait(lambda: current_frame()['durationMs'] == 180)
        assert current_frame()['pose']['leftUpperArm'] == 20
        page.reload()
        page.get_by_test_id('workspace-animation').click()
        expect(page.get_by_test_id('anim-duration')).to_have_value('180')
        page.get_by_test_id('anim-bone').select_option('leftUpperArm')
        expect(page.get_by_test_id('anim-angle')).to_have_value('20')
        assert req('/api/project') == original_ui
        page.get_by_test_id('anim-clip-attack-down').click()
        page.get_by_test_id('anim-frame-3').click()
        events = current_frame()['events']
        assert events[0]['hitbox']
        expect(workspace.get_by_label('Hitboxes & attachment', exact=True)).to_be_checked()
        page.get_by_test_id('anim-duration').fill('80')
        page.get_by_test_id('anim-save-frame').click()
        wait(lambda: current_frame()['durationMs'] == 80)
        assert current_frame()['events'] == events
        page.screenshot(path=str(PRE / 'animation-attack-en.png'), full_page=True)
        page.get_by_test_id('anim-clip-idle-down').click()
        return {'durationPersisted': True, 'posePersisted': True, 'uiDocumentUnchanged': True, 'attackOverlayVisible': True, 'hitboxPayloadPreserved': True}
    check('bone pose and frame timing survive a reload without changing the UI document', editing)
    def review_feedback():
        tab('Review')
        page.get_by_test_id('anim-review-target').fill('Left arm opening timing')
        page.get_by_test_id('anim-review-expected').fill('Hold this anticipation pose for 240 ms.')
        page.get_by_test_id('anim-review-protected').fill('pose.head, root')
        page.get_by_test_id('anim-review-add').click()
        wait(lambda: len(project()['reviews']) == 1)
        review = project()['reviews'][0]
        assert review['frameIds'] == [stage.get_attribute('data-frame-id')]
        archive = download('anim-feedback-export', 'feedback.zip')
        with zipfile.ZipFile(archive) as z:
            feedback = json.loads(z.read('feedback.json'))
            assert len(feedback['reviews']) == 1
            pngs = [n for n in z.namelist() if n.endswith('.png')]
            assert sum(len(c['frames']) for c in feedback['clips']) == 1
            assert len(pngs) >= 1 and feedback['contextFrames']
            assert all(c['id'] not in review['frameIds'] for c in feedback['contextFrames'])
            dimensions = page.evaluate("""async encoded => {
                const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
                const image = await createImageBitmap(new Blob([bytes], {type:'image/png'}));
                const size = [image.width,image.height]; image.close(); return size;
            }""", base64.b64encode(z.read(pngs[0])).decode())
            assert dimensions == [64, 96]
            assert 'animationModel.mjs' in z.namelist() and 'validate.mjs' in z.namelist()
        page.screenshot(path=str(PRE / 'animation-review-en.png'), full_page=True)
        return {'stableFrameReview': True, 'pendingOnly': True, 'pngDecoded': dimensions, 'modelValidatorIncluded': True}
    check('frame review exports a scoped feedback ZIP with a decodable original-size frame', review_feedback)
    def patch_rollback():
        p = project(); c = p['clips'][0]; f = c['frames'][0]
        patch = {'schemaVersion':1, 'kind':'studio-animation-patch', 'projectId':p['id'],
                 'baseRevision':p['revision'], 'summary':'Hold anticipation',
                 'reviewIds':[p['reviews'][0]['id']],
                 'operations':[{'clipId':c['id'],'frameId':f['id'],'path':'durationMs','value':240}]}
        path = work / 'review.patch.json'; path.write_text(json.dumps(patch))
        tab('Patches')
        page.get_by_test_id('anim-patch-import').set_input_files(path)
        expect(page.get_by_test_id('anim-patch-diff')).to_contain_text('240')
        assert current_frame()['durationMs'] == 180
        page.screenshot(path=str(PRE / 'animation-patch-en.png'), full_page=True)
        page.get_by_test_id('anim-patch-apply').click()
        wait(lambda: current_frame()['durationMs'] == 240)
        assert project()['reviews'][0]['status'] == 'modified'
        workspace.locator('[data-testid="anim-rollback"]:enabled').first.click()
        wait(lambda: current_frame()['durationMs'] == 180)
        assert project()['reviews'][0]['status'] == 'pending'
        page.get_by_test_id('anim-patch-import').set_input_files(path)
        expect(workspace.get_by_role('alert')).to_contain_text('revision')
        assert page.get_by_test_id('anim-patch-apply').count() == 0
        return {'previewDoesNotMutate': True, 'scopedPatch': True, 'reviewModified': True, 'rollback': True, 'stalePatchRefused': True}
    check('patch preview, application, review transition and guarded rollback work through visible controls', patch_rollback)
    def godot_export():
        archive = download('anim-godot-export', 'animation-godot.zip')
        with zipfile.ZipFile(archive) as z:
            mapping = json.loads(z.read('animation-map.json'))
            assert len(mapping['clips']) == 12
            assert b'AnimatedSprite2D' in z.read('main.tscn')
            assert b'SpriteFrames' in z.read('character.tres')
            assert b'animation_event' in z.read('animation_player.gd')
            assert all(f['texture'] in z.namelist() for c in mapping['clips'] for f in c['frames'])
            assert mapping['canvas'] == {'width':64, 'height':96}
        return {'allClipTexturesPresent': True, 'nativeSpriteFrames': True, 'eventAdapter': True, 'engineVerificationSeparate': True}
    check('Godot archive contains all native sprite frames, timing metadata and event adapter', godot_export)
    def imports():
        tab('Pose')
        count = len(project()['clips'][0]['frames'])
        png = page.evaluate("""count => {
            const c=document.createElement('canvas');c.width=64*count;c.height=96;
            const ctx=c.getContext('2d');
            for(let i=0;i<count;i++){ctx.fillStyle=i%2?'#d7bb78':'#3c665d';ctx.fillRect(i*64+20,30,24,48);}
            return c.toDataURL('image/png').split(',')[1];
        }""", count)
        sheet = work/'synthetic-import-fixture.png';sheet.write_bytes(base64.b64decode(png))
        ids = [f['id'] for f in project()['clips'][0]['frames']]
        page.get_by_test_id('anim-sheet-import').set_input_files(sheet)
        wait(lambda: bool(project()['clips'][0]['frames'][0].get('image')))
        assert [f['id'] for f in project()['clips'][0]['frames']] == ids
        first = project()['clips'][0]['frames'][0]['image']
        assert first['pixels'][(30*64+20)*4:(30*64+20)*4+4] == [60,102,93,255]
        page.get_by_test_id('anim-regenerate').click()
        wait(lambda: current_frame()['durationMs'] != 180)
        assert project()['clips'][0]['frames'][0]['image'] == first
        assert project()['reviews'][0]['frameIds'] == [ids[0]]
        exported = download('anim-json-export', 'complete-animation.json')
        saved = json.loads(exported.read_text())
        assert saved['clips'][0]['frames'][0]['image'] == first
        revision = project()['revision']
        page.get_by_test_id('anim-json-import').set_input_files(exported)
        wait(lambda: project()['revision'] > revision)
        return {'syntheticFixtureOnly': True, 'sourcePixelsPreserved': True, 'frameIdsPreserved': True, 'regenerationPreservesOverridesAndReviews': True, 'completeJsonRoundTrip': True}
    check('sprite sheet import and project round-trip preserve pixels, frame IDs and review associations', imports)
    def checks_languages():
        tab('Checks');page.get_by_test_id('anim-run-checks').click()
        expect(page.get_by_test_id('anim-check-count')).to_be_visible()
        page.set_viewport_size({'width':1366,'height':768})
        page.get_by_test_id('language-select').select_option('zh-CN')
        expect(workspace.get_by_role('heading',name='像素角色动画 64 × 96')).to_be_visible()
        page.get_by_test_id('anim-clip-walk-right').click()
        page.screenshot(path=str(PRE / 'animation-editor-zh.png'), full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        return {'checksVisible': True, 'ChineseWorkspace': True, 'smallViewportNoHorizontalOverflow': True}
    check('animation checks and Chinese workspace are usable at 1366x768', checks_languages)


with tempfile.TemporaryDirectory(prefix='studio-animation-browser-') as temporary:
    work = pathlib.Path(temporary)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    base = f'http://127.0.0.1:{port}'

    def req(route, body=None):
        request = urllib.request.Request(
            base + route,
            data=None if body is None else json.dumps(body).encode(),
            headers={} if body is None else {'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)

    with (work / 'server.txt').open('w') as log:
        server = subprocess.Popen(
            ['node', 'server/index.js', '--production'], cwd=ROOT,
            env={**os.environ, 'STUDIO_DATA_DIR': str(work / 'data'), 'PORT': str(port)},
            stdout=log, stderr=log)
        page = None
        try:
            wait(lambda: req('/api/health')['ok'])
            with sync_playwright() as pw:
                browser = pw.chromium.launch(
                    executable_path=os.environ.get('CHROMIUM_BIN') or shutil.which('chromium') or shutil.which('google-chrome'),
                    headless=True, args=['--no-sandbox'])
                page = browser.new_page(viewport={'width': 1600, 'height': 1000}, accept_downloads=True)
                page.on('pageerror', lambda error: report['errors'].append(str(error)))
                page.goto(base)
                run(page, work, req)
                assert not report['errors'], report['errors']
                report['status'] = 'passed'
                browser.close()
        except Exception as error:
            report['status'] = 'failed'
            report['error'] = str(error)
            report['traceback'] = traceback.format_exc()
            print(report['traceback'], flush=True)
            if page:
                try:
                    page.screenshot(path=str(PRE / 'animation-failure.png'), full_page=True)
                except Exception:
                    pass
        finally:
            server.terminate()
            try:
                server.wait(timeout=8)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=8)
            (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
            shutil.copyfile(work / 'server.txt', OUT / 'server.txt')
sys.exit(0 if report['status'] == 'passed' else 1)
