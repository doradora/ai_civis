# -*- coding:utf8 -*-
import datetime
import decimal
import json
import math
import os

from django.conf import settings
from django.contrib.auth.models import User
from django.db import models as M
from django.db import transaction
from django.db.models import F, Sum

from core.models import Project


def TODAY():
    return datetime.date.today()


def NOW():
    return datetime.datetime.now()


def round_fix(num, d=0):
    """修正 PY3 round（四捨五入）"""
    d_str = str(10 ** (-1 * int(d)))
    return float(str(decimal.Decimal(str(num)).quantize(decimal.Decimal(d_str), decimal.ROUND_HALF_UP)))


def calsize(num):
    if not num:
        num = 0
    if num < 1024:
        return str(num) + ' B'
    k = int(num) / 1024
    if k <= 1024:
        return str(k) + ' KB'
    m = k / 1024
    if m <= 1024:
        return str(m) + ' MB'
    g = m / 1024
    return str(g) + ' GB'


class Option(M.Model):
    """對齊 jsrcm dailyreport.Option（id=10 目錄、id=11 工項），免去跨模組耦合。"""
    swarm = M.CharField(verbose_name='群組', max_length=64, db_index=True)
    value = M.CharField(verbose_name='名稱', max_length=64)

    class Meta:
        verbose_name = '進度選項'
        verbose_name_plural = '進度選項'
        unique_together = (('swarm', 'value'),)

    def __str__(self):
        return f'{self.swarm}:{self.value}'


def get_dir_kind():
    obj, _ = Option.objects.get_or_create(id=10, defaults={'swarm': 'item_kind', 'value': '目錄'})
    return obj


def get_item_kind():
    obj, _ = Option.objects.get_or_create(id=11, defaults={'swarm': 'item_kind', 'value': '工項'})
    return obj


def _VERSION_SCHEDULE_FILE(instance, filename):
    if instance.project_id:
        return os.path.join('schedule', 'version_schedule', str(instance.project_id), f'{instance.id}.jpg')
    return os.path.join('schedule', 'version_schedule', f'year_{TODAY().year}', f'{instance.id}.jpg')


class Version_Schedule(M.Model):
    """版本_預定進度（完整移植自 jsrcm.modules.schedule.models.Version_Schedule）"""
    SETTING_TYPE_CHOICES = (
        (0, '未設定'),
        (1, 'CPM要徑'),
        (2, '甘特圖'),
        (3, '簡易區間'),
    )

    parent = M.ForeignKey(
        'self',
        verbose_name='母版本',
        related_name='schedule_parent',
        null=True,
        blank=True,
        on_delete=M.SET_NULL,
    )
    parent_item = M.ForeignKey(
        'ScheduleItem',
        verbose_name='所屬母工項節點',
        related_name='sub_schedules',
        null=True,
        blank=True,
        on_delete=M.SET_NULL,
    )
    project = M.ForeignKey(
        Project,
        verbose_name='對應工程',
        related_name='schedule_project',
        on_delete=M.CASCADE,
        null=True,
        blank=True,
    )
    project_name = M.TextField(verbose_name='自行輸入工程名稱', default='', blank=True)
    start_date = M.DateField(verbose_name='版本建立日期', null=True, blank=True)
    create_user = M.ForeignKey(
        User,
        related_name='schedule_version_schedule_create_user',
        null=True,
        blank=True,
        on_delete=M.SET_NULL,
    )
    create_time = M.DateTimeField(verbose_name='建立時間', default=datetime.datetime.now)
    update_user = M.ForeignKey(
        User,
        related_name='schedule_version_schedule_update_user',
        null=True,
        blank=True,
        on_delete=M.SET_NULL,
    )
    update_time = M.DateTimeField(verbose_name='最後更新時間', default=datetime.datetime.now)
    need_recount_esef = M.BooleanField(verbose_name='是否資料夾需要重算esef', default=False)
    cpm_link = M.TextField(verbose_name='連結關係', default='[]')
    duration = M.IntegerField(verbose_name='工期', default=0)
    start_end_node = M.TextField(verbose_name='起始結束項目', default='{}')
    file = M.FileField(upload_to=_VERSION_SCHEDULE_FILE, null=True, blank=True)
    release_json = M.TextField(verbose_name='release json狀態', default='{}')
    cpm_release = M.BooleanField(verbose_name='CPM是否已發布(若更動為否)', default=False)
    cpm_locked = M.BooleanField(verbose_name='CPM是否已鎖定(鎖定後才可使用進度調整)', default=False)
    gantt_locked = M.BooleanField(verbose_name='進度調整是否已鎖定(鎖定後才可檢視進度成果)', default=False)
    schedule_setting_type = M.IntegerField(
        verbose_name='預定進度設定方法',
        default=0,
        choices=SETTING_TYPE_CHOICES,
    )  # 0未決定 1CPM 2甘特 3區間

    class Meta:
        get_latest_by = 'start_date'
        verbose_name = '預定進度版本'
        verbose_name_plural = '預定進度版本'

    def __str__(self):
        return '%s(%s)' % (self.project.name if self.project else self.project_name, self.start_date or self.create_time.date())

    @property
    def display_name(self):
        return self.project_name or (self.project.name if self.project else f'草稿 #{self.id}')

    @property
    def setting_type_name(self):
        names = ['未設定', 'CPM要徑', '甘特圖', '簡易區間']
        idx = int(self.schedule_setting_type or 0)
        return names[idx] if 0 <= idx < len(names) else '未設定'

    @property
    def total_weight(self):
        total = self.scheduleitem_set.exclude(kind_id=10).aggregate(Sum('unit_price'))['unit_price__sum']
        return total or decimal.Decimal('0')

    def get_versions(self):
        """回傳同一預定進度之所有版本（完全相容 jsrcm Version_Schedule.get_versions）"""
        main_version = self.parent if self.parent_id else self
        children = list(main_version.schedule_parent.all().order_by('create_time', 'id'))
        return [[1, main_version]] + [[n + 2, ver] for n, ver in enumerate(children)]

    def get_last_version(self):
        """回傳最新版本（相容 jsrcm）"""
        return self.get_versions()[-1][1]

    def get_version_number(self):
        for num, ver in self.get_versions():
            if ver.id == self.id:
                return num
        return 1

    @property
    def wbs_parent_version(self):
        if self.parent_item_id and self.parent_item:
            return self.parent_item.version
        return None

    def get_wbs_ancestors(self):
        """由最頂層總預定進度向下回傳所有祖先 WBS 資訊，供麵包屑導覽使用。"""
        ancestors = []
        seen = {self.id}
        cur = self
        while cur.parent_item_id and cur.parent_item and cur.parent_item.version_id:
            p_item = cur.parent_item
            p_ver = p_item.version
            if p_ver.id in seen:
                break
            seen.add(p_ver.id)
            ancestors.append({
                'version': p_ver,
                'item': p_item,
                'version_id': p_ver.id,
                'version_name': p_ver.display_name,
                'version_number': p_ver.get_version_number(),
                'item_id': p_item.id,
                'item_name': p_item.name,
                'item_duration': int(p_item.duration or 0),
                'item_weight': float(p_item.unit_price or 0),
                'item_es': int(p_item.es or 0) + 1,
                'item_ef': int(p_item.ef or 0),
            })
            cur = p_ver
        ancestors.reverse()
        return ancestors

    def get_stage_info(self):
        if self.schedule_setting_type != 1:
            return {'code': 'normal', 'label': self.setting_type_name}
        if self.cpm_locked and self.gantt_locked:
            return {'code': 'done', 'label': '進度已定案'}
        if self.cpm_locked:
            return {'code': 'step2', 'label': '網圖已鎖定'}
        return {'code': 'draft', 'label': '草稿'}

    def get_parent_overrun_days(self):
        if not self.parent_item_id or not self.parent_item:
            return 0
        parent_dur = int(self.parent_item.duration or 0)
        if parent_dur <= 0:
            return 0
        leaf_items = list(self.scheduleitem_set.exclude(uplevel=None).exclude(kind_id=10))
        cpm_max_day = max((int(i.lf or i.ef or 0) for i in leaf_items), default=0)
        effective_dur = max(int(self.duration or 0), cpm_max_day)
        return max(0, effective_dur - parent_dur)

    def get_cpm_lock_checklist(self):
        """檢查 CPM 網圖是否符合鎖定前置條件（鎖定後才開放甘特圖與 S 曲線）。"""
        leaf_items = list(self.scheduleitem_set.exclude(uplevel=None).exclude(kind_id=10))
        try:
            parsed_links = json.loads(self.cpm_link or '[]')
            if not isinstance(parsed_links, list):
                parsed_links = []
        except Exception:
            parsed_links = []

        duration_val = int(self.duration or 0)
        weight_total = float(sum((float(i.unit_price or 0) for i in leaf_items), 0.0))
        weight_diff = round_fix(weight_total - 100.0, 5)
        cpm_max_day = max((int(i.lf or i.ef or 0) for i in leaf_items), default=0)

        duration_ok = duration_val > 0
        items_ok = len(leaf_items) > 0
        cpm_calc_ok = bool(self.cpm_release) and len(parsed_links) > 0
        weight_ok = abs(weight_total - 100.0) < 1e-4

        checks = [
            {
                'key': 'duration',
                'label': '已設定目標總工期',
                'ok': duration_ok,
                'detail': f'{duration_val} 天' if duration_ok else '尚未設定（須大於 0 天）',
            },
            {
                'key': 'items',
                'label': '已建立施工工項',
                'ok': items_ok,
                'detail': f'共 {len(leaf_items)} 項' if items_ok else '尚未建立任何工項',
            },
            {
                'key': 'cpm_calc',
                'label': '已完成 CPM 要徑計算與儲存',
                'ok': cpm_calc_ok,
                'detail': f'已完成（{len(parsed_links)} 條連線，最長 {cpm_max_day} 天）' if cpm_calc_ok else '請先進入「編輯網圖」並點擊「計算並儲存」',
            },
            {
                'key': 'weight',
                'label': '所有工項權重總計等於 100%',
                'ok': weight_ok,
                'detail': '100%' if weight_ok else f'目前 {round_fix(weight_total, 2)}%（差額 {"+" if weight_diff > 0 else ""}{weight_diff}%）',
            },
        ]
        can_lock = duration_ok and items_ok and cpm_calc_ok and weight_ok
        duration_mismatch = (cpm_max_day > 0 and duration_val > 0 and cpm_max_day != duration_val)
        return {
            'can_lock': can_lock,
            'cpm_locked': bool(self.cpm_locked),
            'gantt_locked': bool(self.gantt_locked),
            'checks': checks,
            'cpm_max_day': cpm_max_day,
            'duration': duration_val,
            'duration_mismatch': duration_mismatch,
            'missing': [c['label'] + '：' + c['detail'] for c in checks if not c['ok']],
        }

    def create_root_item(self):
        if self.scheduleitem_set.filter(uplevel=None).exists():
            return True

        schedule_item = ScheduleItem(
            version=self,
            name=self.project.name if self.project else self.project_name,
            kind=get_dir_kind(),
            priority=0,
            uplevel=None,
        )
        schedule_item.save()
        return True

    def get_file_path(self):
        """讀取本地檔案路徑"""
        return self.file.path

    def rExt(self):
        if self.file:
            return self.file.name.split('.')[-1]
        return 'zip'

    def calSize(self):
        try:
            if self.file and os.path.exists(self.get_file_path()):
                return calsize(os.path.getsize(self.get_file_path()))
            return calsize(0)
        except Exception:
            return calsize(0)

    def read_pre_version(self):
        """回傳上一個版本"""
        try:
            return self.project.schedule_project.filter(start_date__lt=self.start_date).order_by('-start_date')[0]
        except Exception:
            return False

    def read_next_version(self):
        """回傳下一個版本"""
        try:
            return self.project.schedule_project.filter(start_date__gt=self.start_date).order_by('start_date')[0]
        except Exception:
            return False

    def read_engs_price(self):
        """回傳該版本契約總價（以對應工程案的契約金額作為換算基準）"""
        if self.project and self.project.contract_amount:
            return self.project.contract_amount
        return 0

    def new_version_copy_pre_item(self, pre_version, carry_sub_schedules=True, _visited=None):
        """新增新預定進度複製前一個版本的資訊，並自動遞迴攜帶各工項對應之最新分項子網圖（WBS 子 PDM）"""
        if not pre_version:
            return False
        if _visited is None:
            _visited = set()
        if pre_version.id in _visited:
            return False
        _visited = _visited | {pre_version.id, self.id}

        dir_kind = get_dir_kind()
        pre_root_item = pre_version.scheduleitem_set.filter(uplevel=None).order_by('id').first()
        if not pre_root_item:
            return False

        old_items = [[] for _ in range(20)]
        uplevel_items = [pre_root_item]
        level_num = 0
        while uplevel_items and level_num < 20:
            old_items[level_num] = list(
                ScheduleItem.objects.filter(uplevel__in=uplevel_items).order_by('uplevel__priority', 'priority')
            )
            uplevel_items = old_items[level_num]
            level_num += 1

        new_items = [[] for _ in range(20)]

        root_item, _ = ScheduleItem.objects.get_or_create(
            uplevel=None, version=self, defaults={'kind': dir_kind, 'priority': 0}
        )
        for field in pre_root_item._meta.fields:
            if field.name not in ['id', 'version', 'pre_item', 'uplevel']:
                setattr(root_item, field.name, getattr(pre_root_item, field.name))
        root_item.pre_item = pre_root_item
        root_item.save()

        uplevel_items = [root_item]
        uplevel_mapping = {pre_root_item.id: root_item}

        for n, level_items in enumerate(old_items):
            if not level_items:
                continue
            for i in level_items:
                row = ScheduleItem(
                    version=self,
                    uplevel=uplevel_mapping[i.uplevel.id],
                    pre_item=i,
                    priority=i.priority,
                )
                for field in i._meta.fields:
                    if field.name not in ['id', 'version', 'pre_item', 'uplevel']:
                        setattr(row, field.name, getattr(i, field.name))
                if pre_version.schedule_setting_type == 1 and int(self.schedule_setting_type) != 1:
                    row.es = row.ls + 1
                    row.ef = row.lf
                new_items[n].append(row)

            ScheduleItem.objects.bulk_create(new_items[n])
            uplevel_items = list(
                ScheduleItem.objects.filter(uplevel__in=uplevel_items, version=self, kind_id=10).order_by(
                    'uplevel__priority', 'priority'
                )
            )
            for j in uplevel_items:
                if j.pre_item_id:
                    uplevel_mapping[j.pre_item_id] = j

        pre_item_mapping = {}
        sch_items = list(self.scheduleitem_set.all())
        for i in sch_items:
            if i.pre_item_id:
                pre_item_mapping[str(i.pre_item_id)] = i

        @transaction.atomic
        def update_link():
            for item in sch_items:
                link = []
                for i in item.get_link():
                    if str(i.get('target', '')) in pre_item_mapping and str(i.get('source', '')) in pre_item_mapping:
                        i['source'] = pre_item_mapping[str(i['source'])].id
                        i['target'] = pre_item_mapping[str(i['target'])].id
                        link.append(i)
                item.link = json.dumps(link)
                item.save()

        update_link()

        new_cpm_link = []
        if pre_version.schedule_setting_type == 1:
            for i in json.loads(pre_version.cpm_link or '[]'):
                link_copy = dict(i)
                if link_copy['from'] not in ['start', 'end']:
                    if str(link_copy['from']) not in pre_item_mapping:
                        continue
                    link_copy['from'] = pre_item_mapping[str(link_copy['from'])].id
                if link_copy['to'] not in ['start', 'end']:
                    if str(link_copy['to']) not in pre_item_mapping:
                        continue
                    link_copy['to'] = pre_item_mapping[str(link_copy['to'])].id
                new_cpm_link.append(link_copy)

        self.cpm_link = json.dumps(new_cpm_link)
        self.file = pre_version.file
        self.start_end_node = pre_version.start_end_node
        self.save()

        # 遞迴攜帶未變動工項所連結之分項子網圖（每個子網圖家族取最新版本複製到新工項下，確保 v1 與 v2 各自獨立不互相污染）
        if carry_sub_schedules and pre_item_mapping:
            old_item_ids = [int(k) for k in pre_item_mapping.keys() if k.isdigit()]
            linked_subs = list(
                Version_Schedule.objects.filter(parent_item_id__in=old_item_ids)
                .order_by('create_time', 'id')
            )
            # 依 (parent_item_id, sub_family_root_id) 分組，取每組最新版本
            sub_groups = {}
            for s_ver in linked_subs:
                fam_key = (s_ver.parent_item_id, s_ver.parent_id or s_ver.id)
                sub_groups[fam_key] = s_ver  # 因已依 create_time, id 排序，最後一筆即最新版

            for (old_pid, _fam_root), old_sub in sub_groups.items():
                if old_sub.id in _visited:
                    continue
                new_parent_item = pre_item_mapping.get(str(old_pid))
                if not new_parent_item:
                    continue
                new_sub = Version_Schedule.objects.create(
                    parent=None,
                    parent_item=new_parent_item,
                    project=self.project or old_sub.project,
                    project_name=old_sub.project_name or f'{self.display_name} - {new_parent_item.name}',
                    schedule_setting_type=old_sub.schedule_setting_type,
                    duration=old_sub.duration,
                    cpm_release=old_sub.cpm_release,
                    cpm_locked=old_sub.cpm_locked,
                    gantt_locked=old_sub.gantt_locked,
                    create_user=self.create_user or old_sub.create_user,
                    update_user=self.update_user or old_sub.update_user,
                )
                new_sub.create_root_item()
                new_sub.new_version_copy_pre_item(
                    old_sub,
                    carry_sub_schedules=True,
                    _visited=_visited,
                )

        return True

    def readWorkingDate(self):
        v = self
        schedule_items = list(v.scheduleitem_set.all().exclude(kind_id=10))
        if schedule_items:
            if v.schedule_setting_type == 1:
                max_day = max([max(i.ef, i.lf) for i in schedule_items])
            else:
                max_day = max([i.ef for i in schedule_items])
        else:
            max_day = 1

        max_day = max([max_day, int(v.duration or 0), 1])
        return range(1, max_day + 1)

    def read_schedule_progress_for_s_curve(self):
        """計算預定累積進度列表 for 畫 S 曲線用（此版本）"""
        v = self
        working_dates = self.readWorkingDate()
        max_day = len(working_dates)
        progress_list = [0.0 for _ in working_dates]

        schedule_items = v.scheduleitem_set.all().exclude(kind_id=10)
        for si in schedule_items:
            es = si.es
            ef = si.ef
            if self.schedule_setting_type == 1:  # CPM：依目前甘特圖排程位置 (es+1 ~ ef) 計算
                es = int(si.es or 0) + 1
                ef = int(si.ef or 0)
            span = ef - es + 1
            if span <= 0:
                continue
            daily = float(str(si.unit_price)) / span
            for d in range(es - 1, ef):
                if 0 <= d < max_day:
                    progress_list[d] += daily

        for n in range(1, len(progress_list)):
            progress_list[n] += progress_list[n - 1]

        new_progress_list = []
        for nd, _ in enumerate(working_dates):
            nd = int(math.ceil(nd))
            if nd < 0:
                new_progress_list.append(0)
            elif nd > len(progress_list) - 1:
                new_progress_list.append(progress_list[-1])
            else:
                new_progress_list.append(progress_list[nd])

        return [f'第{i}天' for i in working_dates], new_progress_list, max_day

    def get_gantta_data(self, data_range='auto', value_type='lslf'):
        """取得製作甘特圖 xlsx 所需 data"""
        project = self.project
        self.create_root_item()
        sch_root_item = self.scheduleitem_set.filter(uplevel=None).order_by('id').first()
        workingdates = self.readWorkingDate()
        max_n = len(workingdates)
        sch_root_item.update_es_ef()
        self.need_recount_esef = False
        self.save()

        if self.schedule_setting_type == 1:
            if value_type == 'lslf':
                order_list = ['lf', 'ls']
            elif value_type == 'esef':
                order_list = ['ef', 'es']
            elif value_type == 'avg':
                order_list = ['lf', 'es']
            elif value_type == 'full':
                order_list = ['lf', 'es']
            else:
                order_list = ['lf', 'ls']
            sch_items = sch_root_item.read_all_item(order_list=order_list)
        else:
            sch_items = sch_root_item.read_all_item()

        tmp_dates, tmp_schedule_progress, max_day = self.read_schedule_progress_for_s_curve()
        progress = {0: {'sch': 0}}
        for n, _ in enumerate(tmp_dates):
            progress[n + 1] = {'sch': tmp_schedule_progress[n]}

        no_subs_id = [
            i['uplevel']
            for i in self.scheduleitem_set.filter(is_main_item=False).exclude(uplevel=None).values('uplevel').distinct()
        ]
        items = []
        if data_range == 'auto':
            max_td = 17
            if max_n < 35:
                stag = 1
            elif max_n < max_td * 7:
                stag = 7
            elif max_n < max_td * 15:
                stag = 15
            else:
                stag = 30
        else:
            stag = int(data_range)

        all_duration_range = list(range(0, max_n, stag))
        if all_duration_range[-1] != max_n:
            all_duration_range.append(max_n)

        if len(sch_items) == 1:
            sch_items.append(sch_items[0])

        for si_sort, si in enumerate(sch_items[1:]):
            if self.schedule_setting_type == 1:  # CPM
                if value_type == 'lslf':
                    si.es = si.ls + 1
                    si.ef = si.lf
                elif value_type == 'esef':
                    si.es += 1
                elif value_type == 'avg':
                    si.es = int((si.es + 1 + si.ls + 1) / 2.0)
                    si.ef = int((si.ef + si.lf) / 2.0)
                elif value_type == 'full':
                    si.es += 1
                    si.ef = si.lf

            if not si.is_main_item:
                continue
            span_len = max(1, si.ef - si.es + 1)
            si_progress = [decimal.Decimal('0')] * span_len
            if si.id in no_subs_id:
                subs = list(si.schedule_scheduleitem_uplevel.all())
            else:
                subs = [si]

            for sub_si in subs:
                if not sub_si.unit_price:
                    continue
                unit_rate = sub_si.unit_price
                sub_span = max(1, sub_si.ef - sub_si.es + 1)
                for sib_si_n in range(sub_span):
                    idx = sib_si_n + (sub_si.es - si.es)
                    if 0 <= idx < len(si_progress):
                        si_progress[idx] += unit_rate * decimal.Decimal(str((sib_si_n + 1) / sub_span))

                if sub_si.ef < si.ef:
                    for d in range(sub_si.ef + 1 - si.es, si.ef - si.es + 1):
                        if 0 <= d < len(si_progress):
                            si_progress[d] += unit_rate

            si_min_n = int(si.es / stag) * stag
            si_max_n = int(math.ceil(si.ef / stag)) * stag
            si_data = [decimal.Decimal('0')] * len(all_duration_range)
            for si_n in range(si_min_n, si_max_n + stag, stag):
                key = int(si_n / stag)
                if key < 0 or key >= len(si_data):
                    continue
                if si_n < si.es:
                    si_data[key] = decimal.Decimal('0')
                elif si_n <= si.ef:
                    idx = si_n - si.es
                    si_data[key] = si_progress[idx] if 0 <= idx < len(si_progress) else si_progress[-1]
                elif si_progress:
                    si_data[key] = si_progress[-1]
                else:
                    si_data[key] = decimal.Decimal('0')

            si_data.reverse()
            for i in range(len(si_data) - 1):
                if si_data[i]:
                    si_data[i] -= si_data[i + 1]
            si_data.reverse()

            si_data = [float(str(i)) for i in si_data]
            unit_rate = si.unit_price

            items.append({
                'symbol': si.read_level_symbol() if self.schedule_setting_type != 1 else str(si_sort + 1),
                'name': si.name,
                'unit_rate': float(str(unit_rate)),
                'data': si_data,
                'is_dir': si.kind_id == 10 and si.id not in no_subs_id,
                'es': int(si_min_n / stag),
                'ef': int(si_max_n / stag),
                'cp': si.cp,
            })

        sch_progress = []
        for n in all_duration_range:
            if n == 0:
                sch_progress.append(0)
            else:
                sch_progress.append(progress[n]['sch'])
        sch_progres_delta = []
        for i in range(1, len(sch_progress)):
            sch_progres_delta.append(sch_progress[i] - sch_progress[i - 1])

        return {
            'decimal_point': 2,
            'project_id': project.id if project else '',
            'project_name': project.name if project else self.project_name,
            'items': items,
            'duration': self.duration,
            'all_duration_range': all_duration_range,
            'sch_progress': sch_progress,
            'sch_progres_delta': sch_progres_delta,
            'progress': progress,
        }

    def get_gantta_png_data(self, GET):
        """取得製作甘特圖 png 所需 data"""
        project = self.project
        data = {
            'project__id': project.id if project else '',
            'project__name': project.name if project else self.project_name,
            'range': GET.get('range', 'auto'),
            'only_s_curve': GET.get('only_s_curve', 'false') == 'true',
            'format': GET.get('format', ''),
            'scale': GET.get('scale', 'month'),
            'no_act_line': GET.get('no_act_line', 'false') == 'true',
            'show_all_day': GET.get('show_all_day', 'false') == 'true',
            'gantta': GET.get('gantta', 'false') == 'true',
            'version_id': self.id,
        }

        data['working_dates'] = working_dates = list(self.readWorkingDate())
        self.create_root_item()
        sch_root_item = self.scheduleitem_set.filter(uplevel=None).order_by('id').first()
        sch_root_item.update_es_ef()
        self.need_recount_esef = False
        self.save()

        tmp_dates, tmp_schedule_progress, _ = self.read_schedule_progress_for_s_curve()
        schedule_progress = {d: tmp_schedule_progress[n] for n, d in enumerate(tmp_dates)}

        sch_items = sch_root_item.read_all_item()

        data_range = data['range']
        data_days = []
        if data_range == 'auto':
            max_n = len(working_dates)
            max_td = 17
            if max_n < 35:
                data_range = 'day'
            elif max_n < max_td * 7:
                data_range = 'week'
            elif max_n < max_td * 15:
                data_range = 'two_week'
            else:
                data_range = 'month'

        for d in working_dates[:-1]:
            if data_range == 'day':
                data_days.append(d)
            elif data_range == 'week' and (d % 7) == 0:
                data_days.append(d)
            elif data_range == 'two_week' and (d % 15) == 0:
                data_days.append(d)
            elif data_range == 'month' and (d % 30) == 0:
                data_days.append(d)

        if not data_days or working_dates[-1] != data_days[-1]:
            data_days.append(working_dates[-1])

        data_days_design = []
        multi_version_design_percents = []

        for day_num in working_dates:
            entry = {'日期': day_num, '預定累計進度': schedule_progress[f'第{day_num}天']}
            multi_version_design_percents.append(entry)
            if day_num in data_days:
                data_days_design.append(entry)

        if data_range in ['week', 'two_week', 'month']:
            data['full_data_days_design'] = multi_version_design_percents
            data['multi_version_design_percents'] = data_days_design
        else:
            data['full_data_days_design'] = multi_version_design_percents
            data['multi_version_design_percents'] = multi_version_design_percents

        data['items'] = []
        if not data['only_s_curve']:
            no_subs_id = [
                i['uplevel']
                for i in self.scheduleitem_set.filter(is_main_item=False).exclude(uplevel=None).values('uplevel').distinct()
            ]
            for si in sch_items:
                if self.schedule_setting_type == 1:
                    si.es = si.ls + 1
                    si.ef = si.lf
                si.show_split_bar = False
                subs = []
                if si.id in no_subs_id:
                    si.show_split_bar = True
                    for sub_i in si.schedule_scheduleitem_uplevel.all().order_by('-priority'):
                        subs.append({
                            'id': sub_i.id,
                            'es': sub_i.es,
                            'ef': sub_i.ef,
                            'kind__value': sub_i.kind.value,
                            'cp': sub_i.cp,
                            'unit_price': float(str(sub_i.unit_price)),
                            'get_link': sub_i.get_link(),
                        })

                if si.uplevel and si.uplevel.id in no_subs_id:
                    continue
                if si.uplevel and si.uplevel.uplevel and si.uplevel.uplevel.id in no_subs_id:
                    continue

                data['items'].append({
                    'id': si.id,
                    'symbol': si.read_level_symbol(),
                    'name': si.name,
                    'show_split_bar': si.show_split_bar,
                    'unit_price': float(str(si.unit_price)),
                    'kind__value': si.kind.value,
                    'es': si.es,
                    'ef': si.ef,
                    'cp': si.cp,
                    'get_link': si.get_link(),
                    'subs': subs,
                })

        return data

    def update_to_100_progress(self):
        """將進度依比例四捨五入至小數 2 位，並將尾差補齊至最大工項，確保總和精準為 100.00%"""
        price = decimal.Decimal('100.00')
        items = list(self.scheduleitem_set.all().exclude(kind_id=10).order_by('id'))
        if not items:
            return False
        item_sum = sum((i.unit_price or decimal.Decimal('0') for i in items), decimal.Decimal('0'))
        if not item_sum:
            return False

        q = decimal.Decimal('0.01')
        rounded_total = decimal.Decimal('0.00')
        for i in items:
            scaled = ((i.unit_price or decimal.Decimal('0')) * price / item_sum).quantize(q, rounding=decimal.ROUND_HALF_UP)
            i.unit_price = scaled
            rounded_total += scaled

        delta = price - rounded_total
        if delta != decimal.Decimal('0.00'):
            target = max(items, key=lambda x: x.unit_price)
            target.unit_price = (target.unit_price + delta).quantize(q, rounding=decimal.ROUND_HALF_UP)

        for i in items:
            i.save(update_fields=['unit_price'])
        return True


class ScheduleItem(M.Model):
    """預計進度工項（完整移植自 jsrcm.modules.schedule.models.ScheduleItem）"""
    version = M.ForeignKey(Version_Schedule, on_delete=M.CASCADE)
    is_main_item = M.BooleanField(verbose_name='是否甘特圖畫出bar', default=True)
    name = M.CharField(verbose_name='項目名稱', null=True, blank=True, max_length=256)
    unit_name = M.CharField(verbose_name='單位', default='---', max_length=16)
    unit_num = M.DecimalField(verbose_name='設計數量', default=decimal.Decimal('1'), max_digits=32, decimal_places=10)
    unit_price = M.DecimalField(verbose_name='價格', default=decimal.Decimal('0'), max_digits=32, decimal_places=10)
    es = M.IntegerField(verbose_name='開始日期', default=1)
    ef = M.IntegerField(verbose_name='結束日期', default=1)
    ls = M.IntegerField(verbose_name='最晚開始日期', default=1)
    lf = M.IntegerField(verbose_name='最晚結束日期', default=1)
    kind = M.ForeignKey(
        Option,
        related_name='schedule_kind_scheduleitem',
        verbose_name='工項種類',
        default=11,
        on_delete=M.SET_DEFAULT,
    )
    uplevel = M.ForeignKey(
        'self',
        null=True,
        blank=True,
        related_name='schedule_scheduleitem_uplevel',
        on_delete=M.CASCADE,
    )
    pre_item = M.ForeignKey(
        'self',
        null=True,
        blank=True,
        related_name='schedule_scheduleitem_pre_item',
        verbose_name='前一個版本是誰',
        on_delete=M.SET_NULL,
    )
    priority = M.IntegerField(verbose_name='優先權值', default=0)
    include_item = M.TextField(verbose_name='連結的工項ID', default='-')
    link = M.TextField(verbose_name='甘特圖連結關係', default='[]')
    cp = M.BooleanField(verbose_name='是否為要徑', default=False)
    duration = M.IntegerField(verbose_name='工期', default=1)
    location = M.CharField(verbose_name='項目於圖表中的位置', default='', blank=True, max_length=256)

    class Meta:
        verbose_name = '工程項目'
        verbose_name_plural = '工程項目'

    def __str__(self):
        return self.name or ''

    def get_delta(self):
        return self.ef - self.es + 1

    def get_link(self):
        try:
            return json.loads(self.link or '[]')
        except Exception:
            return []

    def read_all_item(self, order_list=None):
        """針對 root_item 使用（一次撈出整棵樹排序）"""
        if order_list is None:
            order_list = ['priority']
        all_items = (
            self.version.scheduleitem_set.all()
            .order_by(*order_list)
            .prefetch_related('version', 'kind', 'uplevel', 'pre_item')
        )

        item_relation = {}
        for i in all_items:
            uplevel_key = i.uplevel.id if i.uplevel else -1
            item_relation.setdefault(uplevel_key, []).append(i)

        def include_subs(item, items):
            if item.id not in item_relation:
                return items
            for i in item_relation[item.id]:
                items.append(i)
                include_subs(i, items)
            return items

        items = [self]
        include_subs(self, items)
        return items

    def read_sub_item_in_list(self):
        return (
            self.schedule_scheduleitem_uplevel.all()
            .order_by('priority')
            .prefetch_related('version', 'kind', 'uplevel', 'pre_item')
        )

    def read_deep_sub_item_in_list(self):
        items = [self]

        def readScheduleItemInlist(acc, check_item):
            for i in check_item.read_sub_item_in_list():
                acc.append(i)
                acc = readScheduleItemInlist(acc, i)
            return acc

        return readScheduleItemInlist(items, self)

    def read_level_num(self):
        num = 0
        row = self
        while row.uplevel:
            num += 1
            row = row.uplevel
        return num

    def read_level_symbol(self):
        symbol = str(self.priority + 1)
        row = self
        while row.uplevel:
            symbol = str(row.uplevel.priority + 1) + '.' + symbol
            row = row.uplevel
        return symbol[2:]

    def read_last_item(self):
        last_sub = self.schedule_scheduleitem_uplevel.all().order_by('-priority').first()
        if last_sub:
            return last_sub
        return ScheduleItem(priority=-1, kind=Option())

    def read_top_dir_in_list(self):
        ids = ''
        row = self
        while row.uplevel:
            ids += '.' + str(row.uplevel.id)
            row = row.uplevel
        return ids

    def update_es_ef(self):
        if self.kind_id != 10:
            return self.es
        dir_items = [self]

        def readDirItemInlist(acc, check_item):
            for i in check_item.read_sub_item_in_list():
                if i.kind_id == 10:
                    acc.append(i)
                    acc = readDirItemInlist(acc, i)
            return acc

        items = readDirItemInlist(dir_items, self)
        items.reverse()
        for i in items:
            subs = list(i.schedule_scheduleitem_uplevel.all())
            if subs:
                i.es = min([j.es for j in subs])
                i.ef = max([j.ef for j in subs])
                i.ls = min([j.ls for j in subs])
                i.lf = max([j.lf for j in subs])
            else:
                i.es = 1
                i.ef = 1
                i.ls = 1
                i.lf = 1
            i.save()
        return self.es

    def read_dir_price(self):
        if self.kind_id != 10:
            return self.unit_price

        dir_items = [self]

        def readDirItemInlist(acc, check_item):
            for i in check_item.read_sub_item_in_list():
                if i.kind_id == 10:
                    acc.append(i)
                    acc = readDirItemInlist(acc, i)
            return acc

        items = readDirItemInlist(dir_items, self)
        items.reverse()

        for i in items:
            i.unit_price = (
                i.schedule_scheduleitem_uplevel.all().aggregate(Sum('unit_price'))['unit_price__sum']
                or decimal.Decimal('0')
            )
            i.save()
        return items[-1].unit_price
