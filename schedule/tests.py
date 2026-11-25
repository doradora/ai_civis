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
