"""Exercise component templates, all native node types, and font import in Chromium.

Prerequisites: npm ci && npm run build; Python playwright; local Chromium.
Run: python scripts/editor-extra-checks.py --browser /path/to/chromium
Creates its own temporary project and server, and never modifies data/project.json.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--browser', default=os.environ.get('BROWSER_BIN') or shutil.which('chromium') or shutil.which('google-chrome'))
parser.add_argument('--output', type=Path, default=ROOT / 'artifacts' / 'editor-extra-results.json')
args = parser.parse_args()
result = {'testedAt': datetime.now(timezone.utc).isoformat(), 'scope': 'Real Chromium UI checks on an isolated temporary project', 'checks': [], 'browserErrors': []}

def passed(name, detail):
    result['checks'].append({'name': name, 'status': 'passed', 'detail': detail})

with tempfile.TemporaryDirectory(prefix='studio-ui-extra-') as temporary:
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    environment = os.environ.copy()
    environment.update({'PORT': str(port), 'STUDIO_DATA_DIR': str(Path(temporary) / 'data')})
    log = open(Path(temporary) / 'server.log', 'w', encoding='utf-8')
    server = subprocess.Popen(['node', 'server/index.js', '--production'], cwd=ROOT, env=environment, stdout=log, stderr=log)
    try:
        for attempt in range(100):
            if server.poll() is not None:
                raise RuntimeError('Local test server exited before readiness')
            try:
                with urlopen(base + '/api/health', timeout=1) as response:
                    if response.status == 200:
                        break
            except OSError:
                time.sleep(.1)
        else:
            raise RuntimeError('Local test server did not become ready')
        with sync_playwright() as p:
            launch = {'headless': True, 'args': ['--no-sandbox']}
            if args.browser:
                launch['executable_path'] = args.browser
            browser = p.chromium.launch(**launch)
            result['browserVersion'] = browser.version
            page = browser.new_page(viewport={'width': 1600, 'height': 1050})
            page.on('pageerror', lambda error: result['browserErrors'].append(str(error)))
            page.goto(base)
            page.get_by_test_id('layer-character-card').wait_for()
            page.wait_for_function('window.__studioCapture !== undefined')
            def project():
                return page.request.get(base + '/api/project').json()
            def wait_nodes(count):
                for attempt in range(50):
                    if len(project()['nodes']) == count:
                        return
                    page.wait_for_timeout(100)
                raise AssertionError(f'Expected {count} persisted nodes')
            original = project()
            n0 = len(original['nodes'])
            page.get_by_test_id('layer-character-card').click()
            with page.expect_download() as download:
                page.get_by_role('button', name='导出组件', exact=True).click()
            template_path = Path(temporary) / 'character.component.json'
            download.value.save_as(template_path)
            template = json.loads(template_path.read_text(encoding='utf-8'))
            assert len(template['nodes']) > 1
            page.get_by_test_id('component-file').set_input_files(template_path)
            wait_nodes(n0 + len(template['nodes']))
            new_ids = {n['id'] for n in project()['nodes']} - {n['id'] for n in original['nodes']}
            assert not new_ids.intersection(n['id'] for n in template['nodes'])
            assert len(new_ids) == len(template['nodes'])
            passed('component-template-roundtrip', {'nodes': len(template['nodes']), 'newStableIds': True, 'assetMode': 'local references'})
            for node_type in ['Label', 'Button', 'Panel', 'Control', 'TextureRect', 'HBoxContainer', 'VBoxContainer', 'MarginContainer']:
                before = len(project()['nodes'])
                page.get_by_label('New component type').select_option(node_type)
                page.get_by_role('button', name='Add component', exact=True).click()
                wait_nodes(before + 1)
                assert project()['nodes'][-1]['type'] == node_type
                passed('insert-' + node_type, 'Created through UI and persisted through local API')
            page.get_by_role('button', name='资源', exact=True).click()
            page.get_by_label('Asset kind').select_option('font')
            page.get_by_test_id('asset-file').set_input_files(ROOT / 'public/assets/studio-serif.ttf')
            page.wait_for_function("Array.from(document.fonts).some(face => face.family.replaceAll(String.fromCharCode(34), '') === 'studio-serif.ttf' && face.status === 'loaded')")
            asset = project()['assets'][-1]
            assert asset['kind'] == 'font' and asset['src'].startswith('/local-assets/')
            passed('local-font-import', {'persisted': True, 'fontFaceLoaded': True})
            assert not result['browserErrors'], result['browserErrors']
            passed('browser-runtime', 'No uncaught page exceptions')
            browser.close()
        result['status'] = 'passed'
    except Exception as error:
        result['status'] = 'failed'
        result['error'] = str(error)
        raise
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()
        log.close()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False, indent=2))
