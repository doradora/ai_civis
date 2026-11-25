from django.test import TestCase
from django.urls import reverse
from .models import Project


class CoreViewTests(TestCase):
    def test_dashboard_and_project_crud(self):
        resp = self.client.get(reverse('core:dashboard'))
        self.assertEqual(resp.status_code, 200)

        resp_create = self.client.post(reverse('core:project_list'), {
            'action': 'create',
            'name': '測試橋梁工程',
            'code': 'TEST-01',
            'year': 115,
            'duration': 100,
            'contract_amount': 5000000,
        })
        self.assertEqual(resp_create.status_code, 302)
        self.assertEqual(Project.objects.count(), 1)
