import base64
import io
import json
from decimal import Decimal

import openpyxl
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from core.models import Project
from schedule.models import ScheduleItem, Version_Schedule, get_dir_kind, get_item_kind


class FullJsrcmScheduleTests(TestCase):
    def setUp(self):
        self.dir_kind = get_dir_kind()
        self.item_kind = get_item_kind()
        self.project = Project.objects.create(
            name='測試道路工程',
            year=115,
            contract_amount=Decimal('10000000'),
            duration=60,
        )
        self.v_cpm = Version_Schedule.objects.create(
            project=self.project,
            project_name=self.project.name,
            schedule_setting_type=1,
            duration=60,
        )
        self.v_cpm.create_root_item()
        self.cpm_root = self.v_cpm.scheduleitem_set.get(uplevel=None)
        self.t1 = ScheduleItem.objects.create(
            version=self.v_cpm, uplevel=self.cpm_root, kind=self.item_kind,
            priority=0, name='工項A', unit_price=Decimal('30'), duration=10,
        )
        self.t2 = ScheduleItem.objects.create(
            version=self.v_cpm, uplevel=self.cpm_root, kind=self.item_kind,
            priority=1, name='工項B', unit_price=Decimal('50'), duration=20,
        )
        self.t3 = ScheduleItem.objects.create(
            version=self.v_cpm, uplevel=self.cpm_root, kind=self.item_kind,
            priority=2, name='工項C', unit_price=Decimal('20'), duration=5,
        )

    def test_pages_render_without_login(self):
        self.assertEqual(self.client.get('/').status_code, 200)
        self.assertEqual(self.client.get('/schedule/manage_schedule/').status_code, 200)
        self.assertEqual(self.client.get(f'/schedule/item_profile/{self.v_cpm.id}/').status_code, 200)
        self.assertEqual(self.client.get(f'/schedule/cpm_diagram/?version_id={self.v_cpm.id}').status_code, 200)

        v_gantt = Version_Schedule.objects.create(
            project=self.project, project_name='甘特測試', schedule_setting_type=2, duration=60,
        )
        v_gantt.create_root_item()
        self.assertEqual(self.client.get(f'/schedule/item_profile/{v_gantt.id}/').status_code, 200)
        self.assertEqual(self.client.get(f'/schedule/gantt_diagram/?version_id={v_gantt.id}').status_code, 200)

    def test_tastypie_compatible_version_and_item_api(self):
        # List
        resp = self.client.get('/schedule/api/active/version_schedule/?order_by=-create_time&offset=0&limit=10')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['meta']['total_count'], 1)

        # Create draft via API
        resp = self.client.post(
            '/schedule/api/active/version_schedule/',
            data=json.dumps({
                'project': f'/project/api/v1/project/{self.project.id}/',
                'project_name': self.project.name,
                'version': None,
                'schedule_setting_type': '2',
            }),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 201)
        new_id = resp.json()['id']

        # GET without trailing slash (used by cpm/js/main.js)
        resp = self.client.get(f'/schedule/api/active/version_schedule/{new_id}')
        self.assertEqual(resp.status_code, 200)

        # PATCH bulk create + update + delete (used by GoJS & dhtmlxGantt)
        v_new = Version_Schedule.objects.get(id=new_id)
        root = v_new.scheduleitem_set.get(uplevel=None)
        patch_resp = self.client.patch(
            '/schedule/api/active/scheduleitem/',
            data=json.dumps({
                'objects': [{
                    'temp_key': 99999,
                    'name': '新增節點',
                    'unit_price': 40,
                    'duration': 15,
                    'es': 1,
                    'ef': 15,
                    'uplevel': f'/schedule/api/active/scheduleitem/{root.id}/',
                    'version': f'/schedule/api/active/version_schedule/{new_id}/',
                }],
                'deleted_objects': [],
            }),
            content_type='application/json',
        )
        self.assertEqual(patch_resp.status_code, 200)
        objs = patch_resp.json()['objects']
        self.assertEqual(len(objs), 1)
        self.assertEqual(objs[0]['temp_key'], 99999)
        self.assertIsInstance(objs[0]['id'], int)

    def test_cpm_api_and_exports(self):
        payload = {
            'nodes': [
                {'key': self.t1.id, 'text': self.t1.name, 'length': 10, 'duration': 10},
                {'key': self.t2.id, 'text': self.t2.name, 'length': 20, 'duration': 20},
                {'key': self.t3.id, 'text': self.t3.name, 'length': 5, 'duration': 5},
            ],
            'links': [
                {'from': 'start', 'to': self.t1.id, 'mode': 'FS', 'lag': 0},
                {'from': self.t1.id, 'to': self.t2.id, 'mode': 'FS', 'lag': 0},
                {'from': self.t1.id, 'to': self.t3.id, 'mode': 'FS', 'lag': 0},
                {'from': self.t2.id, 'to': 'end', 'mode': 'FS', 'lag': 0},
                {'from': self.t3.id, 'to': 'end', 'mode': 'FS', 'lag': 0},
            ],
        }
        resp = self.client.post('/schedule/api_cpm/', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        res = resp.json()
        self.assertTrue(res['status'])
        self.t2.refresh_from_db()
        self.t3.refresh_from_db()
        self.assertTrue(self.t2.cp)
        self.assertFalse(self.t3.cp)
        self.assertEqual(self.t2.ef, 30)

        # Save cpm_link
        self.v_cpm.cpm_link = json.dumps(payload['links'])
        self.v_cpm.save()

        # S-curve
        sc_resp = self.client.post(f'/schedule/draw_sch_s_curve/{self.v_cpm.id}/')
        self.assertEqual(sc_resp.status_code, 200)
        self.assertAlmostEqual(sc_resp.json()['data']['progress'][-1], 100.0, places=1)

        # Exports: Excel, Gantt Excel, ADM PNG, Gantt PNG, JSON/SCPM
        self.assertEqual(self.client.get(f'/schedule/make_excel_scheduleitem/{self.v_cpm.id}/?price_type=rate&value_type=lslf').status_code, 200)
        self.assertEqual(self.client.get(f'/schedule/make_gantt_schedule_excel/{self.v_cpm.id}/?data_range=auto&value_type=lslf').status_code, 200)
        self.assertEqual(self.client.get(f'/schedule/make_adm_png/{self.v_cpm.id}/?value_type=lslf').status_code, 200)
        self.assertEqual(self.client.get(f'/schedule/make_gantt_schedule_png/{self.v_cpm.id}/?range=auto&gantta=true').status_code, 200)
        json_resp = self.client.get(f'/schedule/make_json_scheduleitem/{self.v_cpm.id}/?price_type=rate&ext=scpm')
        self.assertEqual(json_resp.status_code, 200)

        # JSON / SCPM import roundtrip
        v2 = Version_Schedule.objects.create(project=self.project, project_name='匯入測試', schedule_setting_type=1, duration=60)
        v2.create_root_item()
        uploaded = SimpleUploadedFile('backup.scpm', json_resp.content, content_type='application/json')
        imp_resp = self.client.post('/schedule/create_sch_item_by_json/', {'version_id': v2.id, 'file': uploaded})
        self.assertEqual(imp_resp.status_code, 200)
        self.assertTrue(imp_resp.json()['status'])
        self.assertEqual(v2.scheduleitem_set.exclude(uplevel=None).count(), 3)

    def test_excel_import_and_range_split_and_clone(self):
        v_g = Version_Schedule.objects.create(project=self.project, project_name='Excel匯入測試', schedule_setting_type=2, duration=60)
        v_g.create_root_item()

        # Build valid jsrcm-format Excel
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(['說明列'])
        ws.append(['標註', '項次', '工項名稱', '預定開始天數', '預定結束天數', '花費金額或比率', '要徑'])
        ws.append(['*', '1', '第一階段', '', '', '', ''])
        ws.append(['', '1.1', '開挖整地', 1, 20, 40, '*'])
        ws.append(['', '1.2', '基礎施工', 21, 60, 60, '*'])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)

        xlsx_file = SimpleUploadedFile('test.xlsx', buf.getvalue(), content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        resp = self.client.post('/schedule/create_sch_item_by_excel/', {'version_id': v_g.id, 'file': xlsx_file})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['status'])
        self.assertEqual(v_g.scheduleitem_set.exclude(uplevel=None).count(), 3)

        # Clone via API
        clone_resp = self.client.post(
            '/schedule/api/active/version_schedule/',
            data=json.dumps({
                'project': f'/project/api/v1/project/{self.project.id}/',
                'project_name': self.project.name,
                'clone_version': v_g.id,
                'schedule_setting_type': '2',
                'duration': 60,
            }),
            content_type='application/json',
        )
        self.assertEqual(clone_resp.status_code, 201)
        cloned = Version_Schedule.objects.get(id=clone_resp.json()['id'])
        self.assertEqual(cloned.scheduleitem_set.exclude(uplevel=None).count(), 3)

        # Range split
        v_r = Version_Schedule.objects.create(project=self.project, project_name='區間測試', schedule_setting_type=3, duration=60)
        v_r.create_root_item()
        r_resp = self.client.post(
            '/schedule/create_item_by_range/',
            data=json.dumps({'version_id': v_r.id, 'duration': 60, 'scale': 20}),
            content_type='application/json',
        )
        self.assertEqual(r_resp.status_code, 200)
        self.assertEqual(v_r.scheduleitem_set.exclude(uplevel=None).count(), 3)

    def test_item_cpm_unified_workspace_and_embed_modes(self):
        # 1. Weight == 100% renders valid green pill & unified workspace hooks
        resp = self.client.get(f'/schedule/item_profile/{self.v_cpm.id}/')
        self.assertEqual(resp.status_code, 200)
        html = resp.content.decode('utf-8')
        for marker in [
            'id="version_project_name"',
            'id="edit_version_project_name"',
            'id="version_duration"',
            'id="set_duration"',
            'id="tab-cpm"',
            'id="tab-gantt"',
            'id="draw_s_curve"',
            'id="btn-toggle-editor"',
            'id="toggle-critical-only"',
            'id="btn-auto-layout"',
            'id="iframe-cpm"',
            'readonly=1',
            'sc-weight-pill is-valid',
            '權重總計：100%',
        ]:
            self.assertIn(marker, html)

        # 2. Weight != 100% renders invalid warning pill with diff
        self.t3.delete()
        resp_invalid = self.client.get(f'/schedule/item_profile/{self.v_cpm.id}/')
        self.assertEqual(resp_invalid.status_code, 200)
        html_invalid = resp_invalid.content.decode('utf-8')
        self.assertIn('sc-weight-pill is-invalid', html_invalid)
        self.assertIn('差額', html_invalid)

        # 3. Embed modes for Gantt and CPM editor (including readonly=1)
        g_embed = self.client.get(f'/schedule/gantt_diagram/?version_id={self.v_cpm.id}&embed=1')
        self.assertEqual(g_embed.status_code, 200)
        self.assertEqual(g_embed['X-Frame-Options'], 'SAMEORIGIN')
        self.assertNotIn('class="sc-gantt-topbar"', g_embed.content.decode('utf-8'))

        c_embed = self.client.get(f'/schedule/cpm_diagram/?version_id={self.v_cpm.id}&embed=1&readonly=1')
        self.assertEqual(c_embed.status_code, 200)
        self.assertEqual(c_embed['X-Frame-Options'], 'SAMEORIGIN')
        c_html = c_embed.content.decode('utf-8')
        self.assertIn('sc-cpm-topbar-embed', c_html)
        self.assertIn('const INITIAL_READONLY = true;', c_html)

        # 4. Gantt mode item_profile stays unaffected with original dark topbar
        v_gantt = Version_Schedule.objects.create(
            project=self.project, project_name='甘特回歸測試', schedule_setting_type=2, duration=60,
        )
        v_gantt.create_root_item()
        vg_resp = self.client.get(f'/schedule/item_profile/{v_gantt.id}/')
        self.assertEqual(vg_resp.status_code, 200)
        self.assertIn('class="sc-topbar ', vg_resp.content.decode('utf-8'))

    def test_cpm_lock_workflow_and_gantt_guard(self):
        # 1. Before CPM calculation & lock, locking must fail (400) and Gantt must show locked gate
        fail_lock = self.client.post(
            f'/schedule/api/active/version_schedule/{self.v_cpm.id}/toggle_cpm_lock/',
            data=json.dumps({'action': 'lock'}),
            content_type='application/json',
        )
        self.assertEqual(fail_lock.status_code, 400)
        self.assertFalse(fail_lock.json()['status'])

        g_locked = self.client.get(f'/schedule/gantt_diagram/?version_id={self.v_cpm.id}&embed=1')
        self.assertEqual(g_locked.status_code, 200)
        self.assertIn('尚未完成並鎖定 CPM 網圖，無法使用甘特圖', g_locked.content.decode('utf-8'))

        # 2. Complete CPM links & release (weight is already 30+50+20 = 100%)
        links = [
            {'from': 'start', 'to': self.t1.id, 'mode': 'FS', 'lag': 0},
            {'from': self.t1.id, 'to': self.t2.id, 'mode': 'FS', 'lag': 0},
            {'from': self.t1.id, 'to': self.t3.id, 'mode': 'FS', 'lag': 0},
            {'from': self.t2.id, 'to': 'end', 'mode': 'FS', 'lag': 0},
            {'from': self.t3.id, 'to': 'end', 'mode': 'FS', 'lag': 0},
        ]
        self.v_cpm.cpm_link = json.dumps(links)
        self.v_cpm.cpm_release = True
        self.v_cpm.save()

        ok_lock = self.client.post(
            f'/schedule/api/active/version_schedule/{self.v_cpm.id}/toggle_cpm_lock/',
            data=json.dumps({'action': 'lock'}),
            content_type='application/json',
        )
        self.assertEqual(ok_lock.status_code, 200)
        self.assertTrue(ok_lock.json()['cpm_locked'])

        # 3. After locking Step 1: Step 2 Gantt opens editable (without ADM subview),
        #    Step 3 Result Studio stays locked until Step 2 is locked!
        g_open = self.client.get(f'/schedule/gantt_diagram/?version_id={self.v_cpm.id}&embed=1')
        self.assertEqual(g_open.status_code, 200)
        g_open_html = g_open.content.decode('utf-8')
        self.assertIn('id="gantt_here"', g_open_html)
        self.assertIn('var edit = true;', g_open_html)
        self.assertNotIn('id="gantt-adm-switcher"', g_open_html)
        self.assertNotIn('id="gantt-adm-panel"', g_open_html)

        cpm_ro = self.client.get(f'/schedule/cpm_diagram/?version_id={self.v_cpm.id}&embed=1')
        self.assertIn('const INITIAL_READONLY = true;', cpm_ro.content.decode('utf-8'))

        prof_step2 = self.client.get(f'/schedule/item_profile/{self.v_cpm.id}/')
        prof_step2_html = prof_step2.content.decode('utf-8')
        self.assertIn('id="btn-unlock-cpm"', prof_step2_html)
        self.assertIn('id="btn-lock-gantt"', prof_step2_html)
        self.assertIn('尚未鎖定步驟 2「進度調整」，無法產出進度成果', prof_step2_html)
        self.assertNotIn('id="result-studio-panel"', prof_step2_html)

        # 4. Saving a float shift in Step 2 or patching without CPM-logic changes MUST NOT clear cpm_release;
        #    unlocking Step 1 and re-locking without changes MUST succeed without recalculating!
        shift_resp = self.client.patch(
            '/schedule/api/active/scheduleitem/',
            data=json.dumps({
                'objects': [{
                    'resource_uri': f'/schedule/api/active/scheduleitem/{self.t3.id}/',
                    'es': 15,
                    'ef': 25,
                    'cpm_float_shift': True,
                }]
            }),
            content_type='application/json',
        )
        self.assertEqual(shift_resp.status_code, 200)
        # Also test a no-op PATCH (e.g. only location updated in CPM) keeps cpm_release=True
        noop_resp = self.client.patch(
            '/schedule/api/active/scheduleitem/',
            data=json.dumps({
                'objects': [{
                    'resource_uri': f'/schedule/api/active/scheduleitem/{self.t1.id}/',
                    'location': '120 80',
                }]
            }),
            content_type='application/json',
        )
        self.assertEqual(noop_resp.status_code, 200)
        self.v_cpm.refresh_from_db()
        self.assertTrue(self.v_cpm.cpm_release)

        ok_unlock_noop = self.client.post(
            f'/schedule/api/active/version_schedule/{self.v_cpm.id}/toggle_cpm_lock/',
            data=json.dumps({'action': 'unlock'}),
            content_type='application/json',
        )
        self.assertEqual(ok_unlock_noop.status_code, 200)
        self.assertTrue(ok_unlock_noop.json()['checklist']['can_lock'])

        # Re-locking immediately without recalculation MUST succeed (200)
        ok_relock = self.client.post(
            f'/schedule/api/active/version_schedule/{self.v_cpm.id}/toggle_cpm_lock/',
            data=json.dumps({'action': 'lock'}),
            content_type='application/json',
        )
        self.assertEqual(ok_relock.status_code, 200)
        self.assertTrue(ok_relock.json()['cpm_locked'])

        # 5. Lock Step 2 (進度調整) -> Step 2 becomes read-only & Step 3 Result Studio opens!
        ok_gantt_lock = self.client.post(
            f'/schedule/api/active/version_schedule/{self.v_cpm.id}/toggle_gantt_lock/',
            data=json.dumps({'action': 'lock'}),
            content_type='application/json',
        )
        self.assertEqual(ok_gantt_lock.status_code, 200)
        self.assertTrue(ok_gantt_lock.json()['gantt_locked'])

        g_ro = self.client.get(f'/schedule/gantt_diagram/?version_id={self.v_cpm.id}&embed=1')
        self.assertIn('var edit = false;', g_ro.content.decode('utf-8'))
        self.assertIn('進度調整已鎖定定案', g_ro.content.decode('utf-8'))

        prof_locked = self.client.get(f'/schedule/item_profile/{self.v_cpm.id}/')
        prof_locked_html = prof_locked.content.decode('utf-8')
        self.assertIn('id="btn-unlock-gantt"', prof_locked_html)
        self.assertIn('id="btn-unlock-cpm"', prof_locked_html)
        for studio_marker in [
            'result_studio.js',
            'id="result-studio-panel"',
            'id="result-base-adm"',
            'id="result-base-gantt"',
            'id="result-base-pdm"',
            'id="result-show-scurve"',
            'id="result-show-envelope"',
            'id="result-show-pct-labels"',
            'id="result-show-progress-table"',
            'id="result-adm-node-style"',
            'id="result-pdm-opacity"',
            'id="result-grid-step"',
            'id="result-detail-btn"',
            'id="result-detail-popover"',
            'id="result-start-date"',
            'id="result-duration-mode"',
            'id="result-calendar-format"',
            'id="result-label-every-n"',
            'id="result-label-every-n-custom"',
            'id="result-day-label-format"',
            'id="result-table-merge"',
            'id="result-table-decimals"',
            'id="result-export-png"',
            'id="result-export-svg"',
            'id="result-print-btn"',
        ]:
            self.assertIn(studio_marker, prof_locked_html)

        # 6. Unlocking Step 2 keeps Step 1 locked and re-locks Step 3
        ok_gantt_unlock = self.client.post(
            f'/schedule/api/active/version_schedule/{self.v_cpm.id}/toggle_gantt_lock/',
            data=json.dumps({'action': 'unlock'}),
            content_type='application/json',
        )
        self.assertEqual(ok_gantt_unlock.status_code, 200)
        self.assertTrue(ok_gantt_unlock.json()['cpm_locked'])
        self.assertFalse(ok_gantt_unlock.json()['gantt_locked'])

        # 7. Unlocking Step 1 re-locks Gantt (and clears gantt_locked)
        ok_unlock = self.client.post(
            f'/schedule/api/active/version_schedule/{self.v_cpm.id}/toggle_cpm_lock/',
            data=json.dumps({'action': 'unlock'}),
            content_type='application/json',
        )
        self.assertEqual(ok_unlock.status_code, 200)
        self.assertFalse(ok_unlock.json()['cpm_locked'])
        self.assertFalse(ok_unlock.json()['gantt_locked'])
        g_relocked = self.client.get(f'/schedule/gantt_diagram/?version_id={self.v_cpm.id}&embed=1')
        self.assertIn('尚未完成並鎖定 CPM 網圖，無法使用甘特圖', g_relocked.content.decode('utf-8'))

        # Locking Step 2 while Step 1 is unlocked must fail (400)
        fail_gantt_lock = self.client.post(
            f'/schedule/api/active/version_schedule/{self.v_cpm.id}/toggle_gantt_lock/',
            data=json.dumps({'action': 'lock'}),
            content_type='application/json',
        )
        self.assertEqual(fail_gantt_lock.status_code, 400)

    def test_api_cpm_large_100_node_dag_fast_and_cycle_detection(self):
        # Build a 100-node 10-stage branching DAG (~5^10 paths) that would hang O(2^N) cycle check
        nodes = [{'key': f'n{i}', 'text': f'工項{i}', 'length': 5 + (i % 7), 'duration': 5 + (i % 7)} for i in range(100)]
        links = [{'from': 'start', 'to': 'n0', 'mode': 'FS', 'lag': 0}]
        for s in range(10):
            base = s * 10
            if s > 0:
                links.append({'from': f'n{(s - 1) * 10 + 9}', 'to': f'n{base}', 'mode': 'FS', 'lag': 0})
            for j in range(1, 9):
                links.append({'from': f'n{base}', 'to': f'n{base + j}', 'mode': 'FS', 'lag': 0})
                links.append({'from': f'n{base + j}', 'to': f'n{base + 9}', 'mode': 'FS', 'lag': 0})
        links.append({'from': 'n99', 'to': 'end', 'mode': 'FS', 'lag': 0})

        resp = self.client.post(
            '/schedule/api_cpm/',
            data=json.dumps({'nodes': nodes, 'links': links}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['status'])
        self.assertEqual(len(body['result']), 102)

        # Cycle detection must still catch cycles immediately
        links_with_cycle = links + [{'from': 'n50', 'to': 'n10', 'mode': 'FS', 'lag': 0}]
        cyc_resp = self.client.post(
            '/schedule/api_cpm/',
            data=json.dumps({'nodes': nodes, 'links': links_with_cycle}),
            content_type='application/json',
        )
        self.assertEqual(cyc_resp.status_code, 200)
        self.assertFalse(cyc_resp.json()['status'])
        self.assertIn('循環工項', cyc_resp.json()['msg'])

    def test_wbs_sub_schedules_and_jsrcm_multi_version_chain(self):
        # 1. Create Master v2 using jsrcm-compatible `parent` version chain
        v2_resp = self.client.post(
            '/schedule/api/active/version_schedule/',
            data=json.dumps({
                'clone_version': self.v_cpm.id,
                'as_new_version': True,
                'schedule_setting_type': 1,
            }),
            content_type='application/json',
        )
        self.assertEqual(v2_resp.status_code, 201)
        v2_data = v2_resp.json()
        self.assertEqual(v2_data['parent_id'], self.v_cpm.id)
        self.assertEqual(v2_data['version_number'], 2)
        self.assertEqual(v2_data['version_count'], 2)
        self.assertEqual(len(self.v_cpm.get_versions()), 2)
        self.assertEqual(self.v_cpm.get_last_version().id, v2_data['id'])

        # 2. Create Sub-Schedule v1 linked to PDM node t2 (duration 20)
        sub1_resp = self.client.post(
            f'/schedule/api/active/scheduleitem/{self.t2.id}/sub_schedules/',
            data=json.dumps({'project_name': '主體結構細部分項', 'duration': 25}),
            content_type='application/json',
        )
        self.assertEqual(sub1_resp.status_code, 201)
        sub1_id = sub1_resp.json()['version']['id']
        self.assertEqual(sub1_resp.json()['version']['parent_item_id'], self.t2.id)
        self.assertEqual(sub1_resp.json()['version']['version_number'], 1)

        # 3. Clone Sub-Schedule v1 -> v2 (same parent_item, jsrcm parent chain v1 -> v2)
        sub2_resp = self.client.post(
            f'/schedule/api/active/scheduleitem/{self.t2.id}/sub_schedules/',
            data=json.dumps({'clone_version_id': sub1_id}),
            content_type='application/json',
        )
        self.assertEqual(sub2_resp.status_code, 201)
        sub2_data = sub2_resp.json()['version']
        self.assertEqual(sub2_data['parent_id'], sub1_id)
        self.assertEqual(sub2_data['parent_item_id'], self.t2.id)
        self.assertEqual(sub2_data['version_number'], 2)

        # 4. Parent item API reports sub_schedule_count == 2 and latest_sub_schedule
        items_resp = self.client.get(
            f'/schedule/api/active/scheduleitem/?limit=0&version={self.v_cpm.id}&kind=11&order_by=priority'
        )
        self.assertEqual(items_resp.status_code, 200)
        t2_obj = next(o for o in items_resp.json()['objects'] if o['id'] == self.t2.id)
        self.assertEqual(t2_obj['sub_schedule_count'], 2)
        self.assertEqual(t2_obj['latest_sub_schedule']['id'], sub2_data['id'])
        self.assertEqual(t2_obj['latest_sub_schedule']['version_number'], 2)

        # 5. Sub-schedule page renders WBS breadcrumb, version dropdown, and overrun badge (+5 days vs parent 20)
        sub_page = self.client.get(f'/schedule/item_profile/{sub2_data["id"]}/')
        self.assertEqual(sub_page.status_code, 200)
        sub_html = sub_page.content.decode('utf-8')
        self.assertIn('id="wbs-breadcrumb-bar"', sub_html)
        self.assertIn(f'/schedule/item_profile/{self.v_cpm.id}/', sub_html)
        self.assertIn('id="version-family-dropdown"', sub_html)
        self.assertIn('id="wbs-parent-overrun-badge"', sub_html)
        self.assertIn('超出母節點工期 +5 天', sub_html)

        # 6. Tree-mode schedule list API surfaces LATEST version (v2) first & orders version_family newest-first
        tree_resp = self.client.get('/schedule/api/active/version_schedule/?tree=1&limit=20')
        self.assertEqual(tree_resp.status_code, 200)
        master_entry = next(o for o in tree_resp.json()['objects'] if o['id'] == v2_data['id'])
        self.assertEqual(master_entry['version_number'], 2)
        self.assertEqual(len(master_entry['version_family']), 2)
        self.assertEqual(master_entry['version_family'][0]['version_number'], 2)
        self.assertEqual(master_entry['sub_schedule_count'], 1)
        self.assertEqual(master_entry['sub_schedules'][0]['parent_item_id'], self.t2.id)
        self.assertEqual(master_entry['sub_schedules'][0]['version_count'], 2)
        self.assertEqual(master_entry['sub_schedules'][0]['id'], sub2_data['id'])

        # 7. Sub-schedules endpoint also returns newest version first
        sub_list_resp = self.client.get(f'/schedule/api/active/scheduleitem/{self.t2.id}/sub_schedules/')
        self.assertEqual(sub_list_resp.status_code, 200)
        sub_rows = sub_list_resp.json()['sub_schedules']
        self.assertEqual(sub_rows[0]['version_number'], 2)
        self.assertTrue(sub_rows[0]['is_latest'])

    def test_wbs_tree_planner_and_dual_json_import_export(self):
        # 1. Step 0 WBS UI markers render on item_profile page
        page = self.client.get(f'/schedule/item_profile/{self.v_cpm.id}/')
        self.assertEqual(page.status_code, 200)
        html = page.content.decode('utf-8')
        self.assertIn('id="tab-wbs"', html)
        self.assertIn('id="view-wbs"', html)
        self.assertIn('id="wbs_import_json_modal"', html)
        self.assertIn('wbs_planner.js', html)
        self.assertIn('include_sub=1', html)
        self.assertIn('format=wbs_template', html)

        # 2. Fetch WBS tree API (verify contract price rollup & uncalculated state)
        tree_resp = self.client.get(f'/schedule/api/active/version_schedule/{self.v_cpm.id}/wbs_tree/')
        self.assertEqual(tree_resp.status_code, 200)
        tree_data = tree_resp.json()['tree']
        self.assertEqual(tree_data['node_count'], 3)
        self.assertTrue(tree_data['weight_valid'])
        self.assertEqual([n['wbs_code'] for n in tree_data['nodes']], ['1', '2', '3'])
        self.assertEqual(tree_data['budget'], 10000000)
        self.assertEqual(tree_data['nodes'][0]['allocated_price'], 3000000)
        self.assertEqual(tree_data['nodes'][1]['allocated_price'], 5000000)
        self.assertFalse(tree_data['has_schedule_result'])

        # Simulate CPM calculation results and verify WBS tree reflects plan_start, plan_end, cp & float_days
        self.t1.es, self.t1.ef, self.t1.ls, self.t1.lf, self.t1.cp = 0, 10, 0, 10, True
        self.t1.save()
        self.t2.es, self.t2.ef, self.t2.ls, self.t2.lf, self.t2.cp = 10, 30, 15, 35, False
        self.t2.save()
        self.v_cpm.cpm_release = True
        self.v_cpm.save(update_fields=['cpm_release'])
        tree_calc = self.client.get(f'/schedule/api/active/version_schedule/{self.v_cpm.id}/wbs_tree/').json()['tree']
        self.assertTrue(tree_calc['has_schedule_result'])
        self.assertEqual(tree_calc['plan_start'], 1)
        self.assertEqual(tree_calc['plan_end'], 30)
        self.assertTrue(tree_calc['nodes'][0]['cp'])
        self.assertEqual(tree_calc['nodes'][0]['plan_start'], 1)
        self.assertEqual(tree_calc['nodes'][0]['plan_end'], 10)
        self.assertFalse(tree_calc['nodes'][1]['cp'])
        self.assertEqual(tree_calc['nodes'][1]['plan_start'], 11)
        self.assertEqual(tree_calc['nodes'][1]['plan_end'], 30)
        self.assertEqual(tree_calc['nodes'][1]['float_days'], 5)

        # 3. WBS Actions: add_item -> save_items -> balance_100 -> add_child_item -> indent -> outdent -> delete
        action_url = f'/schedule/api/active/version_schedule/{self.v_cpm.id}/wbs_action/'

        add_resp = self.client.post(
            action_url,
            data=json.dumps({'action': 'add_item', 'target_version_id': self.v_cpm.id, 'name': '臨時工項D', 'duration': 8, 'unit_price': 10}),
            content_type='application/json',
        )
        self.assertEqual(add_resp.status_code, 200)
        self.assertEqual(add_resp.json()['tree']['node_count'], 4)
        new_item_id = add_resp.json()['tree']['nodes'][-1]['id']

        save_resp = self.client.post(
            action_url,
            data=json.dumps({
                'action': 'save_items',
                'items': [{'id': new_item_id, 'name': '工項D改', 'duration': 12, 'unit_price': 20}],
            }),
            content_type='application/json',
        )
        self.assertEqual(save_resp.status_code, 200)
        self.assertFalse(save_resp.json()['tree']['weight_valid'])

        bal_resp = self.client.post(
            action_url,
            data=json.dumps({'action': 'balance_100', 'target_version_id': self.v_cpm.id}),
            content_type='application/json',
        )
        self.assertEqual(bal_resp.status_code, 200)
        self.assertTrue(bal_resp.json()['tree']['weight_valid'])

        # Add child under t3 (so t3 has a linked sub-schedule), then indent new_item_id under t3
        child_resp = self.client.post(
            action_url,
            data=json.dumps({'action': 'add_child_item', 'item_id': self.t3.id, 'name': 'C分項細項1', 'duration': 5, 'unit_price': 100}),
            content_type='application/json',
        )
        self.assertEqual(child_resp.status_code, 200)
        t3_node = next(n for n in child_resp.json()['tree']['nodes'] if n['id'] == self.t3.id)
        self.assertIsNotNone(t3_node['sub_schedule'])
        self.assertEqual(t3_node['sub_schedule']['node_count'], 1)

        indent_resp = self.client.post(
            action_url,
            data=json.dumps({'action': 'indent_item', 'item_id': new_item_id}),
            content_type='application/json',
        )
        self.assertEqual(indent_resp.status_code, 200)
        self.assertEqual(indent_resp.json()['tree']['node_count'], 3)
        t3_node2 = next(n for n in indent_resp.json()['tree']['nodes'] if n['id'] == self.t3.id)
        self.assertEqual(t3_node2['sub_schedule']['node_count'], 2)

        outdent_resp = self.client.post(
            action_url,
            data=json.dumps({'action': 'outdent_item', 'item_id': new_item_id}),
            content_type='application/json',
        )
        self.assertEqual(outdent_resp.status_code, 200)
        self.assertEqual(outdent_resp.json()['tree']['node_count'], 4)

        del_resp = self.client.post(
            action_url,
            data=json.dumps({'action': 'delete_item', 'item_id': new_item_id}),
            content_type='application/json',
        )
        self.assertEqual(del_resp.status_code, 200)
        self.assertEqual(del_resp.json()['tree']['node_count'], 3)

        # 4. Export clean WBS template (wbs-import-1.0)
        tpl_resp = self.client.get(f'/schedule/make_json_scheduleitem/{self.v_cpm.id}/?format=wbs_template')
        self.assertEqual(tpl_resp.status_code, 200)
        tpl_json = json.loads(tpl_resp.content.decode('utf-8'))
        self.assertEqual(tpl_json['schema_version'], 'wbs-import-1.0')
        self.assertEqual(len(tpl_json['wbs_nodes']), 3)
        self.assertEqual(len(tpl_json['wbs_nodes'][2]['children']), 1)

        # 5. Import clean wbs-import-1.0 JSON into a fresh Version_Schedule (creates master + sub-schedule + links)
        v_import = Version_Schedule.objects.create(
            project=self.project, project_name='WBS匯入測試', schedule_setting_type=1, duration=100,
        )
        v_import.create_root_item()
        clean_payload = {
            'schema_version': 'wbs-import-1.0',
            'project_name': 'WBS匯入測試工程',
            'duration': 120,
            'wbs_nodes': [
                {'wbs_code': '1', 'name': '假設工程', 'duration': 20, 'weight': 20, 'predecessors': []},
                {
                    'wbs_code': '2', 'name': '主體結構', 'duration': 70, 'weight': 60, 'predecessors': ['1'],
                    'children': [
                        {'wbs_code': '2.1', 'name': '基礎開挖', 'duration': 30, 'weight': 40, 'predecessors': []},
                        {'wbs_code': '2.2', 'name': '主體澆置', 'duration': 40, 'weight': 60, 'predecessors': ['2.1']},
                    ],
                },
                {'wbs_code': '3', 'name': '裝修驗收', 'duration': 30, 'weight': 20, 'predecessors': ['2']},
            ],
        }
        imp_resp = self.client.post(
            f'/schedule/api/active/version_schedule/{v_import.id}/import_wbs_json/',
            data=json.dumps({'data': clean_payload}),
            content_type='application/json',
        )
        self.assertEqual(imp_resp.status_code, 200)
        imp_json = imp_resp.json()
        self.assertTrue(imp_json['status'])
        self.assertEqual(imp_json['format'], 'wbs-import-1.0')
        self.assertEqual(imp_json['created_items'], 5)
        self.assertEqual(imp_json['created_sub_schedules'], 1)
        v_import.refresh_from_db()
        master_items = list(v_import.scheduleitem_set.filter(kind=self.item_kind).order_by('priority'))
        self.assertEqual(len(master_items), 3)
        master_links = json.loads(v_import.cpm_link or '[]')
        self.assertTrue(any(l['from'] == master_items[0].id and l['to'] == master_items[1].id for l in master_links))
        self.assertTrue(any(l['from'] == master_items[1].id and l['to'] == master_items[2].id for l in master_links))
        sub_ver = master_items[1].sub_schedules.first()
        self.assertIsNotNone(sub_ver)
        sub_items = list(sub_ver.scheduleitem_set.filter(kind=self.item_kind).order_by('priority'))
        self.assertEqual(len(sub_items), 2)
        sub_links = json.loads(sub_ver.cpm_link or '[]')
        self.assertTrue(any(l['from'] == sub_items[0].id and l['to'] == sub_items[1].id for l in sub_links))

        # 6. Export full 2.0-wbs JSON (?include_sub=1) and round-trip import via legacy upload endpoint
        full_resp = self.client.get(f'/schedule/make_json_scheduleitem/{v_import.id}/?price_type=rate&include_sub=1')
        self.assertEqual(full_resp.status_code, 200)
        full_payload = json.loads(full_resp.content.decode('utf-8'))
        self.assertEqual(full_payload['schema_version'], '2.0-wbs')
        self.assertIn('sub_schedule', full_payload['items'][0][1])
        self.assertEqual(len(full_payload['items'][0][1]['sub_schedule']['items'][0]), 2)

        v_roundtrip = Version_Schedule.objects.create(
            project=self.project, project_name='WBS還原測試', schedule_setting_type=1, duration=60,
        )
        v_roundtrip.create_root_item()
        uploaded = SimpleUploadedFile(
            'wbs_full.json',
            json.dumps(full_payload, ensure_ascii=False).encode('utf-8'),
            content_type='application/json',
        )
        rt_resp = self.client.post(
            '/schedule/create_sch_item_by_json/',
            {'version_id': str(v_roundtrip.id), 'file': uploaded},
        )
        self.assertEqual(rt_resp.status_code, 200)
        rt_json = rt_resp.json()
        self.assertTrue(rt_json['status'])
        self.assertEqual(rt_json['format'], '2.0-wbs')
        self.assertEqual(rt_json['created_sub_schedules'], 1)
        rt_master_items = list(v_roundtrip.scheduleitem_set.filter(kind=self.item_kind).order_by('priority'))
        self.assertEqual(len(rt_master_items), 3)
        self.assertEqual(rt_master_items[1].sub_schedules.count(), 1)
        rt_sub = rt_master_items[1].sub_schedules.first()
        self.assertEqual(rt_sub.scheduleitem_set.filter(kind=self.item_kind).count(), 2)

    def test_master_v2_carries_sub_pdm_and_clean_sub_pdm_deletion(self):
        # 1. Attach a sub-PDM (with 2 items + 1 link + an L3 nested sub-PDM) to Master v1's t2
        sub_v1_resp = self.client.post(
            f'/schedule/api/active/scheduleitem/{self.t2.id}/sub_schedules/',
            data=json.dumps({'project_name': '工項B分項子網圖', 'duration': 20}),
            content_type='application/json',
        )
        self.assertEqual(sub_v1_resp.status_code, 201)
        sub_v1 = Version_Schedule.objects.get(id=sub_v1_resp.json()['version']['id'])
        sub_root = sub_v1.scheduleitem_set.get(uplevel=None)
        s_i1 = ScheduleItem.objects.create(
            version=sub_v1, uplevel=sub_root, kind=self.item_kind,
            priority=0, name='子工項1', unit_price=Decimal('40'), duration=8,
        )
        s_i2 = ScheduleItem.objects.create(
            version=sub_v1, uplevel=sub_root, kind=self.item_kind,
            priority=1, name='子工項2', unit_price=Decimal('60'), duration=12,
        )
        sub_v1.cpm_link = json.dumps([{'from': s_i1.id, 'to': s_i2.id, 'mode': 'FS', 'lag': 0}])
        sub_v1.cpm_release = True
        sub_v1.cpm_locked = True
        sub_v1.save()

        # Also create an L3 nested sub-PDM under s_i1
        l3_resp = self.client.post(
            f'/schedule/api/active/scheduleitem/{s_i1.id}/sub_schedules/',
            data=json.dumps({'project_name': 'L3細部網圖', 'duration': 8}),
            content_type='application/json',
        )
        self.assertEqual(l3_resp.status_code, 201)

        # 2. Clone Master v1 -> Master v2 (unchanged items MUST carry over their sub-PDMs!)
        v2_resp = self.client.post(
            '/schedule/api/active/version_schedule/',
            data=json.dumps({
                'clone_version': self.v_cpm.id,
                'as_new_version': True,
                'schedule_setting_type': 1,
            }),
            content_type='application/json',
        )
        self.assertEqual(v2_resp.status_code, 201)
        v2 = Version_Schedule.objects.get(id=v2_resp.json()['id'])
        v2_t2 = v2.scheduleitem_set.get(pre_item=self.t2)
        v2_subs = list(v2_t2.sub_schedules.all())
        self.assertEqual(len(v2_subs), 1)
        v2_sub = v2_subs[0]
        self.assertNotEqual(v2_sub.id, sub_v1.id)
        self.assertTrue(v2_sub.cpm_locked)
        v2_sub_items = list(v2_sub.scheduleitem_set.filter(kind=self.item_kind).order_by('priority'))
        self.assertEqual([i.name for i in v2_sub_items], ['子工項1', '子工項2'])
        v2_sub_links = json.loads(v2_sub.cpm_link or '[]')
        self.assertTrue(any(l['from'] == v2_sub_items[0].id and l['to'] == v2_sub_items[1].id for l in v2_sub_links))
        # L3 nested sub-PDM was also carried over!
        self.assertEqual(v2_sub_items[0].sub_schedules.count(), 1)
        v2_l3_id = v2_sub_items[0].sub_schedules.first().id

        # 3. Tree API shows Master v2 with exactly 1 sub-schedule (no duplication from v1!)
        tree_resp = self.client.get('/schedule/api/active/version_schedule/?tree=1&limit=20')
        master_entry = next(o for o in tree_resp.json()['objects'] if o['id'] == v2.id)
        self.assertEqual(master_entry['sub_schedule_count'], 1)
        self.assertEqual(master_entry['sub_schedules'][0]['id'], v2_sub.id)

        # 4. Sub-schedule page & manage_schedule render delete controls
        sub_page_html = self.client.get(f'/schedule/item_profile/{v2_sub.id}/').content.decode('utf-8')
        self.assertIn('id="btn-delete-current-sub"', sub_page_html)
        manage_html = self.client.get('/schedule/manage_schedule/').content.decode('utf-8')
        self.assertIn('js-delete-sub-version', manage_html)

        # 5. Deleting v2_sub removes v2_sub AND its nested L3 (no ghost orphan), while keeping Master v1's sub_v1 intact!
        del_resp = self.client.delete(f'/schedule/api/active/version_schedule/{v2_sub.id}/')
        self.assertEqual(del_resp.status_code, 200)
        self.assertFalse(Version_Schedule.objects.filter(id=v2_sub.id).exists())
        self.assertFalse(Version_Schedule.objects.filter(id=v2_l3_id).exists())
        self.assertTrue(Version_Schedule.objects.filter(id=sub_v1.id).exists())

        # 6. Deleting v1 of a multi-version sub-schedule chain cleanly promotes v2 to root
        sub_v2_resp = self.client.post(
            f'/schedule/api/active/scheduleitem/{self.t2.id}/sub_schedules/',
            data=json.dumps({'clone_version_id': sub_v1.id}),
            content_type='application/json',
        )
        self.assertEqual(sub_v2_resp.status_code, 201)
        sub_v2_id = sub_v2_resp.json()['version']['id']
        self.assertEqual(self.client.delete(f'/schedule/api/active/version_schedule/{sub_v1.id}/').status_code, 200)
        sub_v2 = Version_Schedule.objects.get(id=sub_v2_id)
        self.assertIsNone(sub_v2.parent_id)
        self.assertEqual(sub_v2.parent_item_id, self.t2.id)
