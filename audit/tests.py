import base64
import json

from django.test import TestCase
from django.urls import reverse

from core.models import Project
from .models import (
    AuditCase,
    AuditCaseDetail,
    AuditFault,
    AuditSignature,
    AuditTemplate,
    AuditTemplateCriterion,
)


class AuditModuleTests(TestCase):
    def setUp(self):
        self.project = Project.objects.create(name='測試抽查工程', contractor='測試營造')
        self.tpl = AuditTemplate.objects.create(
            project=self.project,
            check_type=AuditTemplate.TYPE_SPOT_CHECK,
            name='鋼筋施工抽查驗表',
            work_item_name='結構工程',
        )
        self.tpl.init_defaults()
        stage = self.tpl.stages.first()
        AuditTemplateCriterion.objects.create(stage=stage, name='鋼筋號數確認', standard='符合圖說')
        AuditTemplateCriterion.objects.create(stage=stage, name='保護層厚度', standard='>= 40mm')

    def test_template_clone_and_docx_export(self):
        cloned = self.tpl.clone_template()
        self.assertEqual(cloned.stages.count(), self.tpl.stages.count())
        resp = self.client.get(reverse('audit:template_export_docx', args=[self.tpl.id]))
        self.assertEqual(resp.status_code, 200)
        self.assertGreater(len(resp.content), 1000)

    def test_case_creation_auto_fault_signature_and_exports(self):
        resp = self.client.post(reverse('audit:case_list'), {
            'action': 'create',
            'project_id': self.project.id,
            'template_id': self.tpl.id,
            'location': 'B1 柱位',
            'inspector': '測試工程師',
        })
        self.assertEqual(resp.status_code, 302)
        case = AuditCase.objects.first()
        self.assertEqual(case.details.count(), 2)

        d1, d2 = list(case.details.all())
        self.client.post(reverse('audit:case_edit', args=[case.id]), {
            'action': 'save_case',
            'name': case.name,
            'work_item_name': case.work_item_name,
            'inspector': case.inspector,
            'location': case.location,
            'contractor': case.contractor,
            'check_timing': 1,
            f'result_{d1.id}': '1',
            f'note_{d1.id}': '符合',
            f'result_{d2.id}': '2',
            f'note_{d2.id}': '保護層僅 25mm',
        })
        case.refresh_from_db()
        self.assertFalse(case.is_passed)
        self.assertEqual(AuditFault.objects.filter(detail__case=case).count(), 1)

        # Test Excel & Improve DOCX exports
        self.assertEqual(self.client.get(reverse('audit:case_export_excel', args=[case.id])).status_code, 200)
        self.assertEqual(self.client.get(reverse('audit:case_export_improve_docx', args=[case.id])).status_code, 200)

        # Test signature save (1x1 transparent PNG)
        tiny_png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
        sig_resp = self.client.post(
            reverse('audit:case_save_signature', args=[case.id]),
            data=json.dumps({'role_name': '監造現場人員簽名', 'data_url': tiny_png}),
            content_type='application/json',
        )
        self.assertEqual(sig_resp.status_code, 200)
        self.assertEqual(AuditSignature.objects.filter(case=case).count(), 1)
