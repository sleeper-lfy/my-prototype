#!/usr/bin/env python3
"""Verify the restored original logo in real Chromium without generating or changing artwork."""
import hashlib
import json
import os
import pathlib
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'artifacts/v0.4.2/branding'
PRE = ROOT / 'previews/v0.4.2'
SOURCE_SHA256 = '40077c80c8fcdcdea37311aa75273f5c92affff4caeb3490dbf49944af5f0ecd'
OUT.mkdir(parents=True, exist_ok=True)
PRE.mkdir(parents=True, exist_ok=True)
report = {'status':'running','checks':[],'errors':[],'isolatedData':True,'originalLogoSha256':SOURCE_SHA256}


def check(name, fn):
    try:
        details = fn()
        report['checks'].append({'name':name,'status':'passed','details':details})
        print('PASS',name,flush=True)
    except Exception as error:
        report['checks'].append({'name':name,'status':'failed','error':str(error)})
        raise


def wait(fn):
    end = time.monotonic() + 20
    while time.monotonic() < end:
        try:
            value = fn()
            if value:
                return value
        except Exception:
            pass
        time.sleep(.05)
    raise AssertionError('Timed out waiting for local application')


with tempfile.TemporaryDirectory(prefix='studio-branding-browser-') as temporary:
    work = pathlib.Path(temporary)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1',0))
        port = listener.getsockname()[1]
    base = f'http://127.0.0.1:{port}'

    def get(route):
        with urllib.request.urlopen(base + route, timeout=15) as response:
            return response.read()

    with (work/'server.txt').open('w') as log:
        server = subprocess.Popen(['node','server/index.js','--production'],cwd=ROOT,
                                  env={**os.environ,'STUDIO_DATA_DIR':str(work/'data'),'PORT':str(port)},
                                  stdout=log,stderr=log)
        page = None
        try:
            wait(lambda: json.loads(get('/api/health'))['ok'])
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN') or shutil.which('chromium') or shutil.which('google-chrome'),headless=True,args=['--no-sandbox'])
                page = browser.new_page(viewport={'width':1366,'height':768})
                page.on('pageerror',lambda error:report['errors'].append(str(error)))

                def unchanged_artwork():
                    original = (ROOT/'previews/branding/game-ui-studio-logo.png').read_bytes()
                    public = (ROOT/'public/assets/game-ui-studio-logo.png').read_bytes()
                    served = get('/assets/game-ui-studio-logo.png')
                    assert hashlib.sha256(original).hexdigest() == SOURCE_SHA256
                    assert original == public == served
                    assert original[:8] == b'\x89PNG\r\n\x1a\n'
                    width,height = struct.unpack('>II',original[16:24])
                    return {'sha256':SOURCE_SHA256,'bytes':len(original),'dimensions':[width,height],
                            'publicCopyAndHTTPResponseByteIdentical':True}
                check('original logo bytes remain unchanged in archive, public assets and HTTP response',unchanged_artwork)

                def loading_logo():
                    held = []
                    page.route('**/api/project',lambda route:held.append(route))
                    page.goto(base,wait_until='domcontentloaded')
                    image = page.locator('.loading img')
                    expect(image).to_be_visible()
                    expect(image).to_have_attribute('src','/assets/game-ui-studio-logo.png')
                    wait(lambda:image.evaluate('(img)=>img.complete && img.naturalWidth>0'))
                    page.screenshot(path=str(PRE/'branding-loading.png'))
                    wait(lambda:bool(held))
                    for route in held:
                        route.continue_()
                    page.unroute('**/api/project')
                    expect(page.get_by_test_id('app-logo')).to_be_visible()
                    return {'originalLogoInLoadingState':True,'decoded':True}
                check('loading state decodes and displays the original logo',loading_logo)

                def favicon():
                    href = page.locator('link[rel="icon"]').get_attribute('href')
                    assert href == '/assets/game-ui-studio.ico'
                    data = get(href)
                    assert data == (ROOT/'public/assets/game-ui-studio.ico').read_bytes()
                    reserved,kind,count = struct.unpack('<HHH',data[:6])
                    assert reserved == 0 and kind == 1 and count == 7
                    sizes = []
                    for i in range(count):
                        width,height,_,_,_,_,size,offset = struct.unpack('<BBBBHHII',data[6+i*16:22+i*16])
                        sizes.append([width or 256,height or 256])
                        assert size > 0 and offset >= 6+count*16 and offset+size <= len(data)
                    assert sorted(sizes) == [[s,s] for s in [16,24,32,48,64,128,256]]
                    decoded = page.evaluate('''url=>new Promise((resolve,reject)=>{
                        const img=new Image();img.onload=()=>resolve([img.naturalWidth,img.naturalHeight]);
                        img.onerror=()=>reject(new Error('ICO decode failed'));img.src=url;
                    })''',href)
                    assert decoded[0] > 0 and decoded[1] > 0
                    return {'url':href,'sizes':sizes,'browserDecoded':decoded,'sha256':hashlib.sha256(data).hexdigest()}
                check('custom seven-size ICO favicon is served intact and decoded by Chromium',favicon)

                def workspaces_and_languages():
                    observations = []
                    for locale in ['en','zh-CN']:
                        page.get_by_test_id('language-select').select_option(locale)
                        for workspace in ['ui','map','animation']:
                            page.get_by_test_id('workspace-'+workspace).click()
                            if workspace == 'map':expect(page.get_by_test_id('map-canvas')).to_be_visible()
                            if workspace == 'animation':expect(page.get_by_test_id('animation-workspace')).to_be_visible()
                            image = page.get_by_test_id('app-logo')
                            expect(image).to_be_visible()
                            expect(image).to_have_attribute('src','/assets/game-ui-studio-logo.png')
                            wait(lambda:image.evaluate('(img)=>img.complete && img.naturalWidth>0'))
                            dimensions = image.evaluate('(img)=>[img.naturalWidth,img.naturalHeight]')
                            style = image.evaluate('(img)=>({fit:getComputedStyle(img).objectFit,background:getComputedStyle(img.parentElement).backgroundColor})')
                            assert style['fit'] == 'contain' and style['background'] == 'rgba(0, 0, 0, 0)'
                            box = image.bounding_box()
                            assert box['width'] == 38 and box['height'] == 38 and box['x'] >= 0 and box['y'] >= 0
                            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                            observations.append({'workspace':workspace,'locale':locale,'decodedDimensions':dimensions,'displayDimensions':[box['width'],box['height']]})
                            if workspace == 'ui':page.locator('.app-header').screenshot(path=str(PRE/f'branding-header-{locale}.png'))
                            if (locale,workspace) in [('en','ui'),('en','map'),('zh-CN','animation')]:page.screenshot(path=str(PRE/f'branding-{workspace}-{locale}.png'))
                    return {'viewport':[1366,768],'observations':observations,'transparentHeaderImage':True}
                check('UI, map and animation use the same original header logo in Chinese and English',workspaces_and_languages)
                assert not report['errors'],report['errors']
                report['status'] = 'passed'
                browser.close()
        except Exception as error:
            report.update(status='failed',error=str(error),traceback=traceback.format_exc())
            print(report['traceback'],flush=True)
            if page:
                try:page.screenshot(path=str(PRE/'branding-failure.png'),full_page=True)
                except Exception:pass
        finally:
            server.terminate()
            try:server.wait(timeout=8)
            except subprocess.TimeoutExpired:server.kill();server.wait(timeout=8)
            (OUT/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
            shutil.copyfile(work/'server.txt',OUT/'server.txt')
sys.exit(0 if report['status']=='passed' else 1)
