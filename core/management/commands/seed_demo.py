import datetime
import json
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand

from audit.models import (
    AuditCase,
    AuditCaseDetail,
    AuditFault,
    AuditTemplate,
    AuditTemplateCriterion,
)
from core.models import Project
from schedule.models import (
    ScheduleItem,
    Version_Schedule,
    get_dir_kind,
    get_item_kind,
)


class Command(BaseCommand):
    help = '建立 AI Civis 功能測試用範例資料（工程案、完整 jsrcm Schedule CPM/甘特/區間範例、抽查樣板、抽查紀錄與缺失追蹤）'

    def handle(self, *args, **options):
        dir_kind = get_dir_kind()
        item_kind = get_item_kind()

        if not User.objects.filter(username='admin').exists():
            User.objects.create_superuser('admin', 'admin@example.com', 'admin123')
            self.stdout.write(self.style.SUCCESS('已建立管理員帳號 admin / admin123'))

        admin_user = User.objects.filter(username='admin').first()

        # 1. 建立範例工程案（若尚未存在）
        if not Project.objects.exists():
            p1 = Project.objects.create(
                code='CIVIS-115-001',
                year=115,
                name='智慧市區道路暨人行道改善工程',
                contract_amount=Decimal('28500000'),
                duration=120,
                start_date=datetime.date(2026, 3, 1),
                contractor='大安營造股份有限公司',
                supervisor='智誠工程顧問有限公司',
                note='功能測試範例工程（含 CPM 進度與抽查驗紀錄）',
            )
            p2 = Project.objects.create(
                code='CIVIS-115-002',
                year=115,
                name='河濱公園景觀步道及排水新建工程',
                contract_amount=Decimal('15200000'),
                duration=90,
                start_date=datetime.date(2026, 4, 15),
                contractor='永泰營造有限公司',
                supervisor='智誠工程顧問有限公司',
                note='階層式甘特圖與自主檢查測試範例',
            )
        else:
            projects = list(Project.objects.all().order_by('id'))
            p1 = projects[0]
            p2 = projects[1] if len(projects) > 1 else projects[0]

        # 2. 建立完整 jsrcm Schedule 範例（若尚未存在）
        if not Version_Schedule.objects.exists():
            # 範例 1：CPM 要徑模式（含 GoJS 座標、前後置連結與要徑計算結果）
            v_cpm = Version_Schedule.objects.create(
                project=p1,
                project_name=p1.name,
                schedule_setting_type=1,
                duration=120,
                create_user=admin_user,
                update_user=admin_user,
                start_end_node=json.dumps({'start_item': '50 150', 'end_item': '1450 150'}),
            )
            v_cpm.create_root_item()
            cpm_root = v_cpm.scheduleitem_set.get(uplevel=None)

            t1 = ScheduleItem.objects.create(
                version=v_cpm, uplevel=cpm_root, kind=item_kind, priority=0,
                name='假設工程與交維佈設', unit_price=Decimal('8.00'),
                duration=10, es=0, ef=10, ls=0, lf=10, cp=True, location='300 150',
            )
            t2 = ScheduleItem.objects.create(
                version=v_cpm, uplevel=cpm_root, kind=item_kind, priority=1,
                name='既有路面刨除與路基整地', unit_price=Decimal('17.00'),
                duration=20, es=10, ef=30, ls=10, lf=30, cp=True, location='580 150',
            )
            t3 = ScheduleItem.objects.create(
                version=v_cpm, uplevel=cpm_root, kind=item_kind, priority=2,
                name='雨水管涵與側溝施工', unit_price=Decimal('25.00'),
                duration=35, es=30, ef=65, ls=30, lf=65, cp=True, location='860 60',
            )
            t4 = ScheduleItem.objects.create(
                version=v_cpm, uplevel=cpm_root, kind=item_kind, priority=3,
                name='人行道透水磚鋪設', unit_price=Decimal('20.00'),
                duration=25, es=35, ef=60, ls=40, lf=65, cp=False, location='860 260',
            )
            t5 = ScheduleItem.objects.create(
                version=v_cpm, uplevel=cpm_root, kind=item_kind, priority=4,
                name='瀝青混凝土路面鋪築', unit_price=Decimal('20.00'),
                duration=35, es=65, ef=100, ls=65, lf=100, cp=True, location='1140 150',
            )
            t6 = ScheduleItem.objects.create(
                version=v_cpm, uplevel=cpm_root, kind=item_kind, priority=5,
                name='標線號誌復舊與竣工勘驗', unit_price=Decimal('10.00'),
                duration=20, es=100, ef=120, ls=100, lf=120, cp=True, location='1140 330',
            )

            cpm_links = [
                {'from': 'start', 'to': t1.id, 'mode': 'FS', 'lag': 0, 'fromSpot': 'RightSide', 'toSpot': 'LeftSide'},
                {'from': t1.id, 'to': t2.id, 'mode': 'FS', 'lag': 0, 'fromSpot': 'RightSide', 'toSpot': 'LeftSide'},
                {'from': t2.id, 'to': t3.id, 'mode': 'FS', 'lag': 0, 'fromSpot': 'RightSide', 'toSpot': 'LeftSide'},
                {'from': t2.id, 'to': t4.id, 'mode': 'FS', 'lag': 5, 'fromSpot': 'RightSide', 'toSpot': 'LeftSide'},
                {'from': t3.id, 'to': t5.id, 'mode': 'FS', 'lag': 0, 'fromSpot': 'RightSide', 'toSpot': 'LeftSide'},
                {'from': t4.id, 'to': t5.id, 'mode': 'FS', 'lag': 0, 'fromSpot': 'RightSide', 'toSpot': 'LeftSide'},
                {'from': t5.id, 'to': t6.id, 'mode': 'FS', 'lag': 0, 'fromSpot': 'RightSide', 'toSpot': 'LeftSide'},
                {'from': t6.id, 'to': 'end', 'mode': 'FS', 'lag': 0, 'fromSpot': 'RightSide', 'toSpot': 'LeftSide'},
            ]
            v_cpm.cpm_link = json.dumps(cpm_links)
            v_cpm.save()
            cpm_root.read_dir_price()
            cpm_root.update_es_ef()

            # 範例 2：甘特圖模式（階層目錄 + 子工項）
            v_gantt = Version_Schedule.objects.create(
                project=p2,
                project_name=p2.name,
                schedule_setting_type=2,
                duration=90,
                create_user=admin_user,
                update_user=admin_user,
            )
            v_gantt.create_root_item()
            g_root = v_gantt.scheduleitem_set.get(uplevel=None)

            f1 = ScheduleItem.objects.create(
                version=v_gantt, uplevel=g_root, kind=dir_kind, priority=0,
                name='第一階段：整地與排水', es=1, ef=40, ls=1, lf=40,
            )
            g1 = ScheduleItem.objects.create(
                version=v_gantt, uplevel=f1, kind=item_kind, priority=0,
                name='測量放樣與清除掘除', unit_price=Decimal('15.00'),
                es=1, ef=15, ls=1, lf=15, duration=15, cp=True,
            )
            g2 = ScheduleItem.objects.create(
                version=v_gantt, uplevel=f1, kind=item_kind, priority=1,
                name='U型排水溝施作', unit_price=Decimal('25.00'),
                es=12, ef=40, ls=12, lf=40, duration=29, cp=True,
            )

            f2 = ScheduleItem.objects.create(
                version=v_gantt, uplevel=g_root, kind=dir_kind, priority=1,
                name='第二階段：步道與植栽', es=35, ef=90, ls=35, lf=90,
            )
            g3 = ScheduleItem.objects.create(
                version=v_gantt, uplevel=f2, kind=item_kind, priority=0,
                name='混凝土步道基層澆置', unit_price=Decimal('35.00'),
                es=35, ef=70, ls=35, lf=70, duration=36, cp=True,
            )
            g4 = ScheduleItem.objects.create(
                version=v_gantt, uplevel=f2, kind=item_kind, priority=1,
                name='植栽綠化與照明設備', unit_price=Decimal('25.00'),
                es=65, ef=90, ls=65, lf=90, duration=26, cp=False,
            )
            g1.link = json.dumps([{'id': 1, 'source': g1.id, 'target': g2.id, 'type': '0'}])
            g1.save()
            g2.link = json.dumps([{'id': 2, 'source': g2.id, 'target': g3.id, 'type': '0'}])
            g2.save()
            g3.link = json.dumps([{'id': 3, 'source': g3.id, 'target': g4.id, 'type': '0'}])
            g3.save()
            g_root.read_dir_price()
            g_root.update_es_ef()

            # 範例 3：簡易區間模式
            v_range = Version_Schedule.objects.create(
                project=p2,
                project_name=f'{p2.name}（區間模式範例）',
                schedule_setting_type=3,
                duration=90,
                create_user=admin_user,
                update_user=admin_user,
            )
            v_range.create_root_item()
            r_root = v_range.scheduleitem_set.get(uplevel=None)
            for idx, (es, ef, weight) in enumerate([(1, 30, '25'), (31, 60, '45'), (61, 90, '30')]):
                ScheduleItem.objects.create(
                    version=v_range, uplevel=r_root, kind=item_kind, priority=idx,
                    name=f'{es}-{ef}', unit_price=Decimal(weight),
                    es=es, ef=ef, ls=es, lf=ef, duration=ef - es + 1,
                )
            r_root.read_dir_price()
            r_root.update_es_ef()
            self.stdout.write(self.style.SUCCESS('已建立 3 筆完整 jsrcm Schedule 範例（CPM / 甘特圖 / 簡易區間）'))

        # 3. 建立 Audit 範例（若尚未存在）
        if not AuditTemplate.objects.exists():
            tpl_spot = AuditTemplate.objects.create(
                project=None,
                check_type=AuditTemplate.TYPE_SPOT_CHECK,
                name='瀝青混凝土鋪築施工抽(查)驗表',
                work_item_name='道路瀝青鋪面工程',
                note='適用於市區道路 AC 鋪築抽查作業',
            )
            tpl_spot.init_defaults()
            s_pre, s_mid, s_post = list(tpl_spot.stages.order_by('priority'))
            AuditTemplateCriterion.objects.create(stage=s_pre, name='底層清掃與透層/黏層噴灑', standard='表面乾燥清潔無積水，噴灑均勻', priority=1)
            AuditTemplateCriterion.objects.create(stage=s_pre, name='拌合料出廠溫度與配比核對', standard='出廠溫度 135°C~165°C，附出料單', priority=2)
            AuditTemplateCriterion.objects.create(stage=s_mid, name='鋪築溫度量測', standard='進場鋪築溫度不低於 120°C', priority=1)
            AuditTemplateCriterion.objects.create(stage=s_mid, name='滾壓遍數與接縫處理', standard='初壓、複壓、終壓確實，縱橫接縫平順', priority=2)
            AuditTemplateCriterion.objects.create(stage=s_post, name='壓實度與鑽心厚度抽驗', standard='壓實度 >= 96%，厚度誤差 ±6mm 以內', priority=1)
            AuditTemplateCriterion.objects.create(stage=s_post, name='路面平坦度檢查', standard='3m 直規量測高低差 <= 6mm', priority=2)

            tpl_self = AuditTemplate.objects.create(
                project=p2,
                check_type=AuditTemplate.TYPE_SELF_CHECK,
                name='排水溝鋼筋模板自主檢查表',
                work_item_name='排水結構工程',
                note='施工廠商澆置前自主檢查專用',
            )
            tpl_self.init_defaults()
            ss_pre, ss_mid, ss_post = list(tpl_self.stages.order_by('priority'))
            AuditTemplateCriterion.objects.create(stage=ss_pre, name='開挖高程與基底夯實', standard='符合設計高程 ±10mm', priority=1)
            AuditTemplateCriterion.objects.create(stage=ss_mid, name='鋼筋號數、間距與保護層', standard='保護層墊塊齊全，間距誤差 <= 10mm', priority=1)
            AuditTemplateCriterion.objects.create(stage=ss_mid, name='模板支撐穩固與清潔', standard='支撐牢靠無漏漿縫隙', priority=2)
            AuditTemplateCriterion.objects.create(stage=ss_post, name='拆模後外觀與養護', standard='無蜂窩冷縫，濕治養護 7 天', priority=1)

            c1 = AuditCase.objects.create(
                project=p1,
                template=tpl_spot,
                check_type=tpl_spot.check_type,
                name='第 1 次瀝青混凝土鋪築抽查驗',
                work_item_name=tpl_spot.work_item_name,
                check_date=datetime.date(2026, 5, 10),
                inspector='林監造工程師',
                location='0K+100 ~ 0K+300 北向車道',
                contractor=p1.contractor,
                check_timing=AuditCase.TIMING_HOLD_POINT,
                selected_stages='施工前, 施工中, 施工後',
                memo='現場溫度與厚度抽測大抵良好，惟末端接縫處需修整。',
            )
            c1.populate_from_template(tpl_spot)
            details = list(c1.details.all())
            for idx, d in enumerate(details):
                if idx == len(details) - 1:
                    d.result = AuditCaseDetail.RESULT_FAIL
                    d.actual_note = '0K+285 處 3m 直規量測高低差達 9mm，超過標準 6mm'
                else:
                    d.result = AuditCaseDetail.RESULT_PASS
                    d.actual_note = '現場量測符合契約規範'
                d.save(update_fields=['result', 'actual_note'])

            failed_detail = details[-1]
            AuditFault.objects.create(
                detail=failed_detail,
                fault_note='0K+285 橫向施工接縫處不平整，高低差 9mm（規範 <= 6mm）。',
                improve_plan='安排刨除局部 10m 路段重新鋪築並以震動壓路機確實壓平。',
                improve_note='',
                is_improved=False,
                is_verified=False,
            )

        self.stdout.write(self.style.SUCCESS('成功建立 AI Civis 範例資料！'))
