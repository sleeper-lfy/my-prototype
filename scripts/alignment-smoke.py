#!/usr/bin/env python3
"""Exercise actual Konva alignment guides and multi-selection through Chromium.

Uses the isolated server harness shared with map-workspace-smoke.py. The only API
mutation imports a small native test fixture before each independent scenario;
all layout changes under test use real mouse drags and editor controls.
Run npm run build first, then python scripts/alignment-smoke.py.
"""
from __future__ import annotations

import copy
import importlib.util
from pathlib import Path
import re
import sys

from playwright.sync_api import expect

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('studio_browser_harness',ROOT/'scripts/map-workspace-smoke.py')
harness=importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)
ensure=harness.ensure
wait_for=harness.wait_for


class AlignmentAcceptance(harness.Acceptance):
    def project(self):
        return self.api('/api/project')

    def state(self):
        return self.page.evaluate('window.__studioState()')

    def node(self,node_id,project=None):
        return next(item for item in (project or self.project())['nodes'] if item['id']==node_id)

    def setup(self):
        def panel(node_id,x,y,width,height,color):
            return {'id':node_id,'name':node_id,'type':'Panel','parentId':None,
                'frame':{'x':x,'y':y,'width':width,'height':height},'visible':True,'locked':False,
                'style':{'fill':color,'stroke':'#c8b378','strokeWidth':1,'text':node_id,'fontSize':16,'color':'#eee5c7','align':'center'}}
        fixture={'schemaVersion':1,'id':'alignment-qa','name':'Alignment acceptance fixture','revision':1,
            'canvas':{'width':800,'height':600,'background':'#16251c'},'tokens':{},'assets':[],
            'nodes':[panel('moving-a',70,80,80,60,'#516742'),panel('reference-b',280,200,120,100,'#697453'),panel('reference-c',550,380,100,80,'#465d48')],
            'reviews':[],'history':[]}
        self.api('/api/import',fixture)
        self.page.goto(self.base,wait_until='networkidle')
        self.language('en')
        expect(self.page.get_by_test_id('layer-moving-a')).to_be_visible()
        self.page.get_by_test_id('ui-zoom-reset').click()
        wait_for(lambda:abs(self.state()['zoom']-1)<.001,'100 percent zoom')
        return self.project()

    def drag(self,node_id,x,y):
        page=self.page
        node=self.node(node_id);frame=node['frame'];zoom=self.state()['zoom']
        board=page.locator('.artboard-wrap .konvajs-content').bounding_box()
        start=(board['x']+(frame['x']+frame['width']/2)*zoom,
               board['y']+(frame['y']+frame['height']/2)*zoom)
        destination=(start[0]+(x-frame['x'])*zoom,start[1]+(y-frame['y'])*zoom)
        page.mouse.move(*start);page.mouse.down();page.mouse.move(*destination,steps=12)
        wait_for(lambda:self.state()['dragActive'],'real Konva drag starts')
        page.wait_for_timeout(60)
        return self.state()

    def finish(self,node_id,expected_x=None,expected_y=None):
        self.page.mouse.up()
        wait_for(lambda:not self.state()['dragActive'] and not self.state()['guides'],'transient guide state clears on drop')
        def persisted():
            frame=self.node(node_id)['frame']
            return frame if (expected_x is None or abs(frame['x']-expected_x)<.01) and (expected_y is None or abs(frame['y']-expected_y)<.01) else None
        return wait_for(persisted,'snapped coordinates persist')

    def select(self,*ids):
        self.page.get_by_test_id('layer-'+ids[0]).click()
        for node_id in ids[1:]:
            self.page.get_by_test_id('layer-'+node_id).click(modifiers=['Shift'])
        ensure(set(self.state()['selected'])==set(ids),'Layer tree multi-selection did not select intended components')

    def apply_alignment(self,mode):
        previous=self.project()['revision']
        self.page.get_by_test_id('ui-alignment-action').select_option(mode)
        self.page.get_by_test_id('ui-alignment-apply').click()
        wait_for(lambda:self.project()['revision']>previous,'alignment persisted')
        return self.project()

    def run(self,check):
        page=self.page
        def live_guides():
            before=self.setup()
            state=self.drag('moving-a',282,108)
            ensure(any(g['axis']=='x' and abs(g['value']-280)<.01 and g['kind']=='edge' for g in state['guides']),f'Missing left-edge guide: {state}')
            ensure(self.project()==before,'In-progress guide drag prematurely saved document')
            self.screen('ui-snap-guides-en.png')
            self.finish('moving-a',280)
            after=self.project()
            ensure(self.node('reference-b',after)==self.node('reference-b',before),'Snapping moved reference sibling')
            expected=copy.deepcopy(before)
            expected['revision']=after['revision']
            self.node('moving-a',expected)['frame']=self.node('moving-a',after)['frame']
            ensure(after==expected,'Transient guide data or unrelated changes were persisted')
            self.setup()
            state=self.drag('moving-a',302,108)
            ensure(any(g['axis']=='x' and abs(g['value']-340)<.01 and g['kind']=='center' for g in state['guides']),f'Missing center guide: {state}')
            self.finish('moving-a',300)
            return {'edge':280,'center':340,'previewReadOnly':True,'guidesClearOnDrop':True,'documentContainsOnlyLayoutChanges':True}
        check('real drags draw edge/center guides, snap precisely and clear ephemeral state',live_guides)

        def zoom_and_toggles():
            self.setup()
            for _ in range(5):page.get_by_role('button',name='Zoom out',exact=True).click()
            wait_for(lambda:abs(self.state()['zoom']-.5)<.001,'50 percent zoom')
            state=self.drag('moving-a',289,108)
            ensure(any(g['axis']=='x' and abs(g['value']-280)<.01 for g in state['guides']),'6-screen-pixel snapping tolerance was not scaled at 50%')
            self.finish('moving-a',280)
            self.setup()
            page.get_by_test_id('ui-snap-toggle').click()
            expect(page.get_by_test_id('ui-snap-toggle')).to_have_attribute('aria-pressed','false')
            self.drag('moving-a',282,108)
            self.finish('moving-a',282,108)
            self.setup()
            page.get_by_test_id('ui-guides-toggle').click()
            expect(page.get_by_test_id('ui-guides-toggle')).to_have_attribute('aria-pressed','false')
            state=self.drag('moving-a',282,108)
            ensure(state['guides']==[],'Guide display toggle still exposes guide lines')
            self.finish('moving-a',280)
            return {'zooms':[1,.5],'screenPixelTolerance':6,'snapToggleWorks':True,'guideVisibilityIndependentOfSnap':True}
        check('guide tolerance follows zoom and snap/display toggles work independently',zoom_and_toggles)

        def selection_drag():
            before=self.setup();self.select('moving-a','reference-b')
            state=self.drag('moving-a',234,95)
            ensure(any(g['axis']=='x' and abs(g['value']-400)<.01 for g in state['guides']),f'Multi-selection did not snap its shared bounds to canvas center: {state}')
            self.finish('moving-a',235)
            after=self.project()
            a=self.node('moving-a',after)['frame'];b=self.node('reference-b',after)['frame']
            ensure(abs((b['x']-a['x'])-210)<.01 and abs((b['y']-a['y'])-120)<.01,'Group drag distorted relative component layout')
            ensure(self.node('reference-c',after)==self.node('reference-c',before),'Group drag moved an unselected component')
            return {'selected':['moving-a','reference-b'],'groupCenter':400,'relativeOffset':[b['x']-a['x'],b['y']-a['y']],'unselectedPreserved':True}
        check('multi-component drag snaps shared bounds while preserving relative positions',selection_drag)

        def multi_align():
            self.setup();self.select('moving-a','reference-b','reference-c')
            before=self.project()
            aligned=self.apply_alignment('right')
            right=max(node['frame']['x']+node['frame']['width'] for node in before['nodes'])
            ensure(all(node['frame']['x']+node['frame']['width']==right for node in aligned['nodes']),'Right alignment failed for different component widths')
            aligned=self.apply_alignment('bottom')
            bottom=max(node['frame']['y']+node['frame']['height'] for node in before['nodes'])
            ensure(all(node['frame']['y']+node['frame']['height']==bottom for node in aligned['nodes']),'Bottom alignment failed for different heights')
            self.setup();self.select('moving-a','reference-b','reference-c')
            before=self.project();after=self.apply_alignment('distributeX')
            nodes=sorted(after['nodes'],key=lambda item:item['frame']['x'])
            gaps=[nodes[i+1]['frame']['x']-nodes[i]['frame']['x']-nodes[i]['frame']['width'] for i in range(2)]
            ensure(abs(gaps[0]-gaps[1])<.01,f'Unequal horizontal gaps: {gaps}')
            ensure(self.node('moving-a',after)==self.node('moving-a',before) and self.node('reference-c',after)==self.node('reference-c',before),'Distribution moved endpoints')
            self.setup();self.select('moving-a','reference-b','reference-c')
            after=self.apply_alignment('distributeY')
            nodes=sorted(after['nodes'],key=lambda item:item['frame']['y'])
            gaps_y=[nodes[i+1]['frame']['y']-nodes[i]['frame']['y']-nodes[i]['frame']['height'] for i in range(2)]
            ensure(abs(gaps_y[0]-gaps_y[1])<.01,f'Unequal vertical gaps: {gaps_y}')
            page.reload()
            ensure(self.project()==after,'Alignment lost on reload')
            return {'rightEdge':right,'bottomEdge':bottom,'horizontalGaps':gaps,'verticalGaps':gaps_y,'endpointPreservation':True,'reloadPersists':True}
        check('multi-selection aligns edges and distributes equal gaps for mixed component sizes',multi_align)

        def chinese_controls():
            self.language('zh-CN')
            expect(page.get_by_test_id('ui-alignment-action').locator('option[value="distributeX"]')).to_have_text(re.compile(r'[\u4e00-\u9fff]'))
            ensure(re.search(r'[\u4e00-\u9fff]',page.get_by_test_id('ui-guides-toggle').get_attribute('aria-label') or ''),'Guide label did not localize')
            self.select('moving-a','reference-b','reference-c')
            self.screen('ui-alignment-zh.png')
            return {'locale':'zh-CN','alignmentAndGuideLabelsLocalized':True}
        check('alignment and guide controls switch to Chinese',chinese_controls)


if __name__=='__main__':
    sys.exit(harness.main(acceptance_class=AlignmentAcceptance,report_name='alignment-results.json',default_out=ROOT/'artifacts/v0.2.0/alignment'))
