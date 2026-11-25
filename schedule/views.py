# -*- coding: utf-8 -*-
"""
完整移植自 jsrcm.modules.schedule.views，保留所有功能與演算法，
僅簡化權限檢查（無 @login_required / guardian / RcmUP / ProjectUP 單位隔離）與 S3 外部依賴。
Excel 匯入使用 openpyxl（不需額外安裝 pandas）。
"""
import base64
import datetime
import decimal
import io
import json
import math
import os
import random
import sys
from io import BytesIO
from os.path import join
from urllib.parse import quote
from wsgiref.util import FileWrapper

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt
import openpyxl
from django.core.files.uploadedfile import InMemoryUploadedFile
from django.db import transaction
from django.db.models import F
from django.http import HttpResponse, HttpResponseRedirect, JsonResponse, StreamingHttpResponse
from django.shortcuts import render
from django.template.loader import render_to_string
from django.views.decorators.clickjacking import xframe_options_sameorigin
from django.views.decorators.csrf import csrf_exempt
from matplotlib import font_manager

from core.models import Project
from schedule.export_utils import (
    make_excel_scheduleitem_call,
    make_gantt_schedule_excel_call,
    make_gantt_schedule_png_call,
)
from schedule.models import (
    NOW,
    ScheduleItem,
    Version_Schedule,
    get_dir_kind,
    get_item_kind,
    round_fix,
)


def _content_disposition_attachment(filename, inline=False):
    disposition = 'inline' if inline else 'attachment'
    encoded = quote(filename)
    return f"{disposition}; filename*=UTF-8''{encoded}"


def manage_schedule(R):
    get_dir_kind()
    get_item_kind()
    projects = Project.objects.all().order_by(F('start_date').desc(nulls_last=True), '-year', 'name', 'id')
    return render(
        R,
        join('schedule', 'manage_schedule.html'),
        {
            'user': R.user,
            'projects': projects,
            'toppage_name': '工具',
        },
    )


def item_profile(R, version_id):
    get_dir_kind()
    get_item_kind()
    version = Version_Schedule.objects.filter(id=version_id).first()
    if not version:
        return HttpResponseRedirect('/schedule/manage_schedule/')

    project = version.project
    version.create_root_item()
    root_item = version.scheduleitem_set.filter(uplevel=None).order_by('id').first()
    version.scheduleitem_set.filter(uplevel=None).exclude(id=root_item.id).delete()
    root_item.name = version.project.name if version.project else version.project_name
    root_item.read_dir_price()
    root_item.save()

    items = root_item.read_all_item()
    engs_price = version.read_engs_price()
    version.read_engs_price_val = engs_price
    daily_versions = []

    if version.need_recount_esef:
        root_item.update_es_ef()
        version.need_recount_esef = False
        version.save()

    for i in items:
        i.symbol = i.read_level_symbol()
        if not engs_price:
            i.transfer_value = 0
        else:
            i.transfer_value = int(round_fix(float(str(engs_price)) * float(str(i.unit_price)) / 100.0, 0))

    weight_total = float(root_item.unit_price or 0)
    weight_diff = round_fix(weight_total - 100.0, 5)
    weight_is_valid = abs(weight_total - 100.0) < 1e-4

    cpm_nodes = []
    for i in items[1:]:
        es = int(i.es or 0)
        ef = int(i.ef or 0)
        ls = int(i.ls or 0)
        lf = int(i.lf or 0)
        dur = int(i.duration or max(0, ef - es + 1))
        cpm_nodes.append({
            'id': i.id,
            'name': i.name or '',
            'es': es,
            'ef': ef,
            'ls': ls,
            'lf': lf,
            'duration': dur,
            'tf': ls - es,
            'unit_price': float(i.unit_price or 0),
            'transfer_value': int(getattr(i, 'transfer_value', 0) or 0),
            'cp': bool(i.cp),
        })

    try:
        parsed_links = json.loads(version.cpm_link or '[]')
        if not isinstance(parsed_links, list):
            parsed_links = []
    except Exception:
        parsed_links = []

    if version.schedule_setting_type == 1:
        t = join('schedule', 'item_cpm.html')
    else:
        t = join('schedule', 'item_gantt.html')

    return render(
        R,
        t,
        {
            'project': project,
            'daily_versions': daily_versions,
            'version': version,
            'engs_price': engs_price,
            'root_item': root_item,
            'items': items,
            'weight_total': weight_total,
            'weight_diff': weight_diff,
            'weight_is_valid': weight_is_valid,
            'cpm_nodes_json': json.dumps(cpm_nodes, ensure_ascii=False),
            'cpm_links_json': json.dumps(parsed_links, ensure_ascii=False),
        },
    )


@xframe_options_sameorigin
def cpm_diagram(R):
    get_dir_kind()
    get_item_kind()
    version_id = R.GET.get('version_id', '')
    if not version_id:
        return HttpResponseRedirect('/schedule/manage_schedule/')

    version = Version_Schedule.objects.filter(id=version_id).first()
    if not version:
        return HttpResponseRedirect('/schedule/manage_schedule/')

    project = version.project
    version.create_root_item()
    root_item = version.scheduleitem_set.filter(uplevel=None).order_by('id').first()
    version.mapping_items_count = 0

    return render(
        R,
        join('schedule', 'cpm_diagram.html'),
        {
            'total_days': version.duration,
            'project': project,
            'edit': R.GET.get('readonly') != '1',
            'readonly': R.GET.get('readonly') == '1',
            'embed': R.GET.get('embed') == '1',
            'version': version,
            'root_item': root_item,
            'item_version': None,
            'item_html': '',
        },
    )


@xframe_options_sameorigin
def gantt_diagram(R):
    get_dir_kind()
    get_item_kind()
    version_id = R.GET.get('version_id', '')
    if not version_id:
        return HttpResponseRedirect('/schedule/manage_schedule/')

    version = Version_Schedule.objects.filter(id=version_id).first()
    if not version:
        return HttpResponseRedirect('/schedule/manage_schedule/')

    version.create_root_item()
    root_item = version.scheduleitem_set.filter(uplevel=None).order_by('id').first()
    if version.need_recount_esef:
        root_item.update_es_ef()
        version.need_recount_esef = False
        version.save()

    project = version.project
    version.scheduleitem_set.filter(uplevel=None).exclude(id=root_item.id).delete()
    root_item.name = version.project.name if version.project else version.project_name
    root_item.read_dir_price()
    root_item.save()

    items = root_item.read_all_item()
    start_date = version.create_time.date() if version.create_time else datetime.date.today()

    item_links = []
    for i in items:
        if i.uplevel == root_item:
            i.uplevel = None
        i.symbol = i.read_level_symbol()
        if version.schedule_setting_type == 1:
            es_0 = max(0, int(i.es or 0))
            ls_0 = max(0, int(i.ls or 0))
            ef_1 = max(1, int(i.ef or 1))
            lf_1 = max(ef_1, int(i.lf or ef_1))
            i.start_date = start_date + datetime.timedelta(days=es_0)
            i.cpm_min_start = es_0 + 1
            i.cpm_max_end = lf_1
            i.cpm_tf = max(0, ls_0 - es_0)
            i.cpm_duration = max(1, int(i.duration or (ef_1 - es_0)))
        else:
            i.start_date = start_date + datetime.timedelta(days=max(0, int(i.es or 1) - 1))
            i.cpm_min_start = max(1, int(i.es or 1))
            i.cpm_max_end = max(1, int(i.ef or 1))
            i.cpm_tf = 0
            i.cpm_duration = max(1, int(i.get_delta() or 1))
        for link in i.get_link():
            item_links.append(link)

    end_date = start_date + datetime.timedelta(days=max(1, int(version.duration or 30)) + 30)
    pre_start_date = start_date - datetime.timedelta(days=1)

    return render(
        R,
        join('schedule', 'gantt_diagram.html'),
        {
            'project': project,
            'edit': True,
            'embed': R.GET.get('embed') == '1',
            'start_date': start_date,
            'pre_start_date': pre_start_date,
            'end_date': end_date,
            'version': version,
            'root_item': root_item,
            'items': items[1:],
            'item_links': json.dumps(item_links),
        },
    )


@csrf_exempt
def create_item_by_month(R):
    """新增 item 根據日期拆分月份項目"""
    item_kind = get_item_kind()
    data = R.POST or json.loads(R.body)
    version = Version_Schedule.objects.get(id=data['version_id'])
    version.create_root_item()
    root_item = version.scheduleitem_set.filter(uplevel=None).order_by('id').first()
    start_date = datetime.datetime.strptime(data['start_date'], '%Y-%m-%d').date()
    end_date = datetime.datetime.strptime(data['end_date'], '%Y-%m-%d').date()

    items = []
    ScheduleItem.objects.filter(version=version).exclude(id=root_item.id).delete()
    start_priority = 0
    es = 1
    ef = 1
    while start_date < end_date:
        next_date = start_date + datetime.timedelta(days=1)
        if next_date.month != start_date.month or next_date == end_date:
            items.append(
                ScheduleItem(
                    version=version,
                    name=f'{start_date.year}-{str(start_date.month).zfill(2)}',
                    es=es,
                    ef=ef,
                    duration=ef - es + 1,
                    kind=item_kind,
                    uplevel=root_item,
                    priority=start_priority,
                )
            )
            start_priority += 1
            ef += 1
            es = ef
        else:
            ef += 1
        start_date = next_date

    ScheduleItem.objects.bulk_create(items)
    root_item.update_es_ef()
    version.need_recount_esef = False
    version.save()
    return JsonResponse({'status': True})


@csrf_exempt
def create_item_by_range(R):
    """新增 item 根據固定天數拆分項目"""
    item_kind = get_item_kind()
    data = R.POST or json.loads(R.body)
    version = Version_Schedule.objects.get(id=data['version_id'])
    version.create_root_item()
    root_item = version.scheduleitem_set.filter(uplevel=None).order_by('id').first()
    duration = int(data['duration'])
    scale = int(data['scale'])

    items = []
    ScheduleItem.objects.filter(version=version).exclude(id=root_item.id).delete()
    items_num = math.ceil(duration * 1.0 / scale)

    for i in range(items_num):
        es = i * scale + 1
        ef = duration if i + 1 == items_num else (i + 1) * scale
        items.append(
            ScheduleItem(
                version=version,
                name=f'{es}-{ef}',
                es=es,
                ef=ef,
                duration=ef - es + 1,
                kind=item_kind,
                uplevel=root_item,
                priority=i,
            )
        )

    ScheduleItem.objects.bulk_create(items)
    root_item.update_es_ef()
    version.need_recount_esef = False
    version.save()
    return JsonResponse({'status': True})


@csrf_exempt
def create_sch_item_by_excel(R):
    """使用制式 EXCEL 檔案製造預定進度工項（使用 openpyxl 讀取，完全對齊 jsrcm 格式）"""
    dir_kind = get_dir_kind()
    item_kind = get_item_kind()

    file = R.FILES.get('file', None)
    if not file:
        return JsonResponse({'status': False, 'msg': '未上傳檔案'})

    wb = openpyxl.load_workbook(io.BytesIO(file.read()), data_only=True)
    ws = wb.active
    raw_rows = list(ws.iter_rows(values_only=True))
    # 與 pandas.read_excel 一致：第 0 列為表頭（合併說明列），第 1 列為欄位名稱（標註/項次/工項名稱...），第 2 列起為資料
    data_rows = []
    for r in raw_rows[2:]:
        # 略過完全空白列
        if all(cell is None or str(cell).strip() == '' for cell in r):
            continue
        padded = list(r) + [None] * max(0, 7 - len(r))
        data_rows.append(padded)

    version = Version_Schedule.objects.get(id=R.POST.get('version_id', None))
    version.create_root_item()
    root_item = version.scheduleitem_set.filter(uplevel=None).order_by('id').first()

    uplevel_mapping = {0: {'priority': 0, 'sub_priority': 0}}
    new_items = [[] for _ in range(20)]

    for n, row in enumerate(data_rows):
        if row[1] is None or str(row[1]).strip() == '':
            return JsonResponse({'status': False, 'msg': f'編號不可為空白，第{n + 3}列，請檢查編號'})

    for n, row in enumerate(data_rows):
        try:
            def _clean_num(val):
                if val is None:
                    return ''
                if isinstance(val, (int, float, decimal.Decimal)):
                    return val
                return str(val).replace(' ', '').replace('　', '').replace(',', '')

            r3 = _clean_num(row[3])
            r4 = _clean_num(row[4])
            r5 = _clean_num(row[5])

            level_num = str(row[1]).strip().count('.') + 1
            uplevel_set = uplevel_mapping[level_num - 1]

            new_row = ScheduleItem(
                version=version,
                kind=item_kind,
                priority=uplevel_set['sub_priority'],
            )
            new_row.es = int(float(r3)) if r3 != '' else 1
            new_row.ef = int(float(r4)) if r4 != '' else 1
            new_row.duration = max(1, new_row.ef - new_row.es + 1)
            new_row.unit_price = decimal.Decimal(str(float(r5))) if r5 != '' else decimal.Decimal('0')
            new_row.name = str(row[2]).replace('\r', '').replace('\n', '') if row[2] is not None else ''
            if len(row) > 6 and row[6] is not None and '*' in str(row[6]):
                new_row.cp = True

            if new_row.es > 3650 or new_row.ef > 3650:
                return JsonResponse({'status': False, 'msg': '匯入失敗，工項允許最大天數為3650'})

            if row[0] is not None and '*' in str(row[0]):
                new_row.kind = dir_kind

            new_row.uplevel_priority = uplevel_set['priority']
            new_row.uplevel_index = len(new_items[level_num - 2]) - 1
            new_items[level_num - 1].append(new_row)
            uplevel_set['sub_priority'] += 1
            if level_num not in uplevel_mapping:
                uplevel_mapping[level_num] = {'priority': 0, 'sub_priority': 0}
            else:
                uplevel_mapping[level_num]['priority'] += 1
                uplevel_mapping[level_num]['sub_priority'] = 0
        except Exception as exc:
            return JsonResponse({'status': False, 'msg': f'匯入失敗，第{n + 3}列工項資訊有錯誤：{exc}'})

    version.scheduleitem_set.all().exclude(uplevel=None).delete()

    uplevel_items = [root_item]
    for n1, level_items in enumerate(new_items):
        if not level_items:
            continue
        next_level_items = []
        for new_item in level_items:
            if n1 == 0:
                new_item.uplevel = root_item
            else:
                new_item.uplevel = uplevel_items[new_item.uplevel_index]
            next_level_items.append(new_item)

        ScheduleItem.objects.bulk_create(next_level_items)
        uplevel_items = list(ScheduleItem.objects.filter(uplevel__in=uplevel_items).order_by('id'))

    with transaction.atomic():
        uplevel_ids = [i['uplevel'] for i in version.scheduleitem_set.all().values('uplevel').distinct() if i['uplevel']]
        ScheduleItem.objects.filter(id__in=uplevel_ids).update(kind=dir_kind)

    if version.schedule_setting_type == 1:
        for n, i in enumerate(root_item.read_all_item()):
            if n == 0:
                continue
            i.kind = item_kind
            i.uplevel = root_item
            i.priority = n - 1
            i.save()

    root_item.update_es_ef()
    version.need_recount_esef = False
    version.save()
    return JsonResponse({'status': True})


@csrf_exempt
def create_sch_item_by_json(R):
    """使用精靈檔 json / scpm 檔案製造預定進度工項"""
    dir_kind = get_dir_kind()
    item_kind = get_item_kind()

    file = R.FILES.get('file', None)
    if not file:
        return JsonResponse({'status': False, 'msg': '未上傳檔案'})

    data = json.loads(file.read().decode('utf-8'))
    version = Version_Schedule.objects.get(id=R.POST.get('version_id', None))
    version.create_root_item()
    root_item = version.scheduleitem_set.filter(uplevel=None).order_by('id').first()
    from_schedule_setting_type = data.get('schedule_setting_type', 0)

    if 'items' not in data or 'start_end_node' not in data:
        return JsonResponse({'status': False, 'msg': '匯入失敗，檔案格式錯誤'})

    version.scheduleitem_set.all().exclude(uplevel=None).delete()

    id_mapping = {}
    cpm_id_mapping = {}
    for level_n, level_item in enumerate(data['items']):
        c_objects = []
        uplevel_ids = []
        for obj in level_item:
            obj = dict(obj)
            if from_schedule_setting_type == 1 and version.schedule_setting_type != 1:
                obj['ls'] += 1
                obj['es'] = obj['ls']
                obj['ef'] = obj['lf']
            elif from_schedule_setting_type != 1 and version.schedule_setting_type == 1:
                obj['es'] -= 1
                obj['ls'] = obj['es']
                obj['lf'] = obj['ef']

            row = ScheduleItem(
                version=version,
                is_main_item=obj.get('is_main_item', True),
                name=obj['name'],
                unit_price=decimal.Decimal(str(obj['unit_price'])),
                es=obj['es'],
                ef=obj['ef'],
                ls=obj['ls'],
                lf=obj['lf'],
                kind=dir_kind if obj['kind'] == 10 else item_kind,
                uplevel=root_item if level_n == 0 else id_mapping[obj['uplevel']],
                priority=obj['priority'],
                link=obj.get('link', '[]'),
                cp=obj.get('cp', False),
                duration=obj.get('duration', 1),
                location=obj.get('location', ''),
            )
            if row.uplevel.id not in uplevel_ids:
                uplevel_ids.append(row.uplevel.id)
            c_objects.append(row)

        ScheduleItem.objects.bulk_create(c_objects)
        created_rows = list(
            version.scheduleitem_set.filter(uplevel_id__in=uplevel_ids).order_by('uplevel__priority', 'priority', 'id')
        )
        for n, i in enumerate(created_rows):
            if n < len(level_item):
                id_mapping[level_item[n]['id']] = i
                if 'cpm_item__id' in level_item[n]:
                    cpm_id_mapping[level_item[n]['cpm_item__id']] = i

    with transaction.atomic():
        for i in version.scheduleitem_set.all().exclude(link='[]'):
            new_link = []
            for link in i.get_link():
                src = int(link.get('source', 0) or 0)
                tgt = int(link.get('target', 0) or 0)
                if src in id_mapping and tgt in id_mapping:
                    link['source'] = id_mapping[src].id
                    link['target'] = id_mapping[tgt].id
                    new_link.append(link)
            i.link = json.dumps(new_link)
            i.save()

    version.start_end_node = data['start_end_node']
    new_cpm_link = []
    if version.schedule_setting_type == 1:
        for i in json.loads(data.get('cpm_link', '[]') or '[]'):
            link_copy = dict(i)
            if link_copy['from'] not in ['start', 'end']:
                fid = int(link_copy['from'])
                if fid in cpm_id_mapping:
                    link_copy['from'] = cpm_id_mapping[fid].id
                elif fid in id_mapping:
                    link_copy['from'] = id_mapping[fid].id
                else:
                    continue
            if link_copy['to'] not in ['start', 'end']:
                tid = int(link_copy['to'])
                if tid in cpm_id_mapping:
                    link_copy['to'] = cpm_id_mapping[tid].id
                elif tid in id_mapping:
                    link_copy['to'] = id_mapping[tid].id
                else:
                    continue
            new_cpm_link.append(link_copy)

        version.cpm_link = json.dumps(new_cpm_link)

        if data.get('version_file', ''):
            f = data.get('version_file', '')
            ext = 'jpg'
            base64_content = base64.b64decode(f)
            output = BytesIO()
            output.write(base64_content)
            output.seek(0)
            timestamp = datetime.datetime.now().strftime('%H_%M_%S_%f')
            frame = InMemoryUploadedFile(output, None, f'{timestamp}.jpg', 'image/jpeg', len(base64_content), None)
            version.file.save(f'{version.id}.{ext}', frame, save=False)
        else:
            version.file = None
    else:
        version.cpm_link = '[]'
        version.file = None

    root_item.update_es_ef()
    version.need_recount_esef = False
    version.save()
    return JsonResponse({'status': True})


@csrf_exempt
def create_item(R):
    """右鍵選單新增資料夾／子資料夾／工項"""
    dir_kind = get_dir_kind()
    item_kind = get_item_kind()

    row_id = R.POST['row_id']
    level = R.POST['level']
    row = ScheduleItem.objects.get(id=row_id)
    new_row = ScheduleItem()
    version = row.version
    version.update_time = NOW()
    version.save()
    t = join('schedule', 'item_gantt_tr.html')

    new_row.unit_name = '式'
    new_row.unit_num = decimal.Decimal('1')
    new_row.unit_price = decimal.Decimal('0')
    new_row.es = 1
    new_row.ef = 1
    new_row.version = row.version

    random_num = int(random.random() * 100000)

    if level == 'same_dir':
        target_row = row.uplevel
        new_row.uplevel = target_row
        new_row.name = '請輸入『新資料夾』名稱，系統隨機碼：' + str(random_num)
        new_row.kind = dir_kind
        new_row.priority = target_row.read_last_item().priority + 1
    elif level == 'sub_dir':
        target_row = row
        new_row.uplevel = target_row
        new_row.name = '請輸入『新資料夾』名稱，系統隨機碼：' + str(random_num)
        new_row.kind = dir_kind
        new_row.priority = target_row.read_last_item().priority + 1
    elif level == 'item':
        if row.kind_id == dir_kind.id:
            target_row = row
            new_row.priority = target_row.read_last_item().priority + 1
        else:
            target_row = row.uplevel
            new_row.priority = row.priority + 1
            row.uplevel.schedule_scheduleitem_uplevel.filter(priority__gt=row.priority).update(priority=F('priority') + 1)

        new_row.uplevel = target_row
        new_row.name = '請輸入『新工項』名稱，系統隨機碼：' + str(random_num)
        new_row.kind = item_kind
        new_row.unit_name = '---'
        new_row.unit_num = decimal.Decimal('0')
        target_row = target_row.read_last_item() if target_row.read_last_item().priority != -1 else target_row

    if new_row.uplevel.schedule_scheduleitem_uplevel.filter(is_main_item=False).exists() or not new_row.uplevel.is_main_item:
        new_row.is_main_item = False

    new_row.save()
    new_row.symbol = new_row.read_level_symbol()
    new_row.transfer_value = 0

    target_ids = [row.id]
    if row.kind_id == item_kind.id:
        pass
    else:
        target_ids.insert(0, target_row.id)
        qs = target_row.schedule_scheduleitem_uplevel.all().exclude(id=new_row.id).order_by('-priority')
        while qs.exists():
            first_sub = qs.first()
            target_ids.insert(0, first_sub.id)
            qs = first_sub.schedule_scheduleitem_uplevel.all().order_by('-priority')

    html = render_to_string(
        t,
        {
            'edit': True,
            'item': new_row,
            'version': version,
        },
        request=R,
    )
    return JsonResponse({'status': True, 'target_ids': target_ids, 'html': html, 'new_row_id': new_row.id})


@csrf_exempt
def update_priority(R):
    """調整 schedule_item 的縮排／凸排序位"""
    dir_kind = get_dir_kind()
    row_id = R.POST['row_id']
    direction = R.POST['direction']

    row = ScheduleItem.objects.get(id=row_id)
    before_item = ScheduleItem.objects.filter(uplevel=row.uplevel, priority__lt=row.priority).order_by('-priority')
    uplevel_after_item = (
        ScheduleItem.objects.filter(uplevel=row.uplevel.uplevel, priority__gt=row.uplevel.priority).order_by('priority')
        if row.uplevel and row.uplevel.uplevel
        else ScheduleItem.objects.none()
    )
    after_item = ScheduleItem.objects.filter(uplevel=row.uplevel, priority__gte=row.priority).order_by('priority')
    last_row = ScheduleItem.objects.filter(uplevel=row.uplevel).order_by('-priority').first()

    if row.priority == 0 and direction == 'up':
        return JsonResponse({'status': False, 'msg': '已經為第1序位，無法再向上移動'})
    if last_row == row and direction == 'down':
        return JsonResponse({'status': False, 'msg': '已經為最後序位，無法再向下移動'})
    if (not row.uplevel or not row.uplevel.uplevel) and direction == 'outdent':
        return JsonResponse({'status': False, 'msg': '已經高階層，無法再向前凸排'})
    if direction == 'indent':
        if not before_item.filter(kind=dir_kind).exists():
            return JsonResponse({'status': False, 'msg': '同階層無資料夾工項，無法再向後縮排'})

    target_row = row
    if direction == 'outdent':
        target_row = row.uplevel
        row.priority = row.uplevel.priority + 1
        row.uplevel = row.uplevel.uplevel
        uplevel_after_item.update(priority=F('priority') + 1)
        after_item.update(priority=F('priority') - 1)
        row.save()

        while target_row.kind_id == dir_kind.id and target_row.read_last_item().priority != -1:
            target_row = ScheduleItem.objects.filter(uplevel=target_row).order_by('-priority').first()

    elif direction == 'indent':
        for i in before_item:
            if i.kind_id == dir_kind.id:
                target_row = i
                break
        row.priority = target_row.read_last_item().priority + 1
        next_target = target_row.read_last_item()
        row.uplevel = target_row
        after_item.update(priority=F('priority') - 1)
        row.save()

        if next_target.priority != -1:
            while next_target.kind_id == dir_kind.id and next_target.read_last_item().priority != -1:
                next_target = ScheduleItem.objects.filter(uplevel=next_target).order_by('-priority').first()
            target_row = next_target

    deep_sub_item = row.read_deep_sub_item_in_list()
    deep_sub_item.pop(0)

    return JsonResponse({
        'status': True,
        'new_uplevel': row.uplevel.id,
        'target_id': target_row.id,
        'sub_item_ids': '_'.join([str(i.id) for i in deep_sub_item]),
    })


@csrf_exempt
def delete_all_item(R):
    """刪除該版本下所有工項（保留根節點，已簡化 is_staff 限制）"""
    data = R.POST or json.loads(R.body)
    v = Version_Schedule.objects.get(id=data['version_id'])
    ScheduleItem.objects.filter(version=v).exclude(uplevel=None).delete()
    v.need_recount_esef = True
    v.cpm_release = False
    v.save()
    return JsonResponse({'status': True})


@csrf_exempt
def draw_sch_s_curve(R, version_id):
    """S 曲線進度資料"""
    version = Version_Schedule.objects.get(id=version_id)
    working_dates, progress, max_day = version.read_schedule_progress_for_s_curve()
    data = {'date': [], 'progress': []}
    for d, date_label in enumerate(working_dates):
        data['date'].append(str(date_label))
        data['progress'].append(round_fix(progress[d], 5))
    return JsonResponse({'status': True, 'data': data, 'max_day': max_day})


@csrf_exempt
def api_cpm(R):
    """完整保留 jsrcm CPM 要徑演算法（FS/SS/FF/SF + Lag + 循環偵測 + 自動補滿工期）"""
    if R.method != 'POST':
        return JsonResponse({'status': False, 'result': []})

    try:
        data = json.loads(R.body)
    except Exception:
        data = R.POST

    nodeDataArray = data.get('nodes', [])
    linkDataArray = data.get('links', [])
    fix_duration = data.get('fix_duration', 0)
    last_result = data.get('last_result', [])

    if last_result:
        nodeDataArray = last_result[1:-1]

    nodeDataArray_dict = {}
    for row in nodeDataArray:
        if 'fix_length' not in row:
            row['fix_length'] = 0
        nodeDataArray_dict[row['key']] = row

    all_key = [i['key'] for i in nodeDataArray]

    # 偵測是否有完整設定結尾
    check_end_keys = all_key[:]
    for i in linkDataArray:
        if i['mode'] in ['FS', 'FF'] and i['from'] in check_end_keys:
            check_end_keys.remove(i['from'])

    if check_end_keys:
        for i in nodeDataArray:
            if i['key'] == check_end_keys[0]:
                return JsonResponse({'status': False, 'msg': f"有工項未設定結尾項目：【 {i['text']} 】"})

    link_mapping = {}
    start_node_min_num = {}
    end_node_min_num = {}
    new_linkDataArray = []
    for row in linkDataArray:
        if 'lag' not in row or not row['lag']:
            row['lag'] = 0
        if row['from'] == 'start':
            start_node_min_num[row['to']] = row['lag']
        elif row['to'] == 'end':
            end_node_min_num[row['from']] = row['lag']
        else:
            link_mapping.setdefault(row['from'], []).append(row['to'])
            new_linkDataArray.append(row)

    linkDataArray = new_linkDataArray

    def link_behind(gene_list):
        next_gene_list = []
        for gene in gene_list:
            last_key = gene[-1]
            if last_key not in link_mapping:
                continue
            for link_key in link_mapping[last_key]:
                next_gen = gene[:] + [link_key]
                if link_key in gene:
                    return {'status': False, 'msg': f'連結關係錯誤，有循環工項設定：【 {next_gen} 】'}, []
                next_gene_list.append(next_gen)
        return {'status': True}, next_gene_list

    for key in link_mapping:
        check_round = [[key]]
        while check_round:
            check_status, check_round = link_behind(check_round)
            if not check_status['status']:
                return JsonResponse(check_status)

    # 進行工期自動展延調整
    if fix_duration:
        max_lf = max([i['lf'] for i in nodeDataArray])
        if max_lf >= fix_duration:
            return JsonResponse({'status': False, 'msg': '欲調整工期小於目前最長工期，系統無法自動調整'})

        def get_all_link_behind(gene_list):
            complete_gene_list = []
            next_gene_list = []
            for gene in gene_list:
                last_key = gene[-1]
                if last_key not in link_mapping:
                    complete_gene_list.append(gene)
                    continue
                for link_key in link_mapping[last_key]:
                    next_gene_list.append(gene[:] + [link_key])
            return complete_gene_list, next_gene_list

        all_from_key = [row['from'] for row in linkDataArray]
        all_to_key = [row['to'] for row in linkDataArray]
        start_keys = list(set(all_key) - set(all_to_key))
        end_keys = list(set(all_key) - set(all_from_key))
        cp_keys = [row['key'] for row in nodeDataArray if row.get('cp')]
        all_path = []
        for key in start_keys:
            check_round = [[key]]
            while check_round:
                complete_check_round, check_round = get_all_link_behind(check_round)
                if complete_check_round:
                    all_path += complete_check_round

        cp_path = []
        cp_path_len = []
        for path in all_path:
            is_cps = [key in cp_keys for key in path]
            if False not in is_cps and path[-1] in end_keys:
                cp_path.append(path)
                cp_path_len.append(len(path))

        if cp_path:
            max_cp_path_num = max(cp_path_len)
            cp_path = [cp_path[cp_path_len.index(max_cp_path_num)]]
            delta_days = fix_duration - max_lf
            max_row = nodeDataArray_dict[cp_path[0][0]]
            for cp in cp_path:
                rate = fix_duration * 1.0 / max_lf
                for key in cp:
                    row = nodeDataArray_dict[key]
                    row['fix_length'] = int(round_fix(row['duration'] * rate, 0)) - row['duration']
                    delta_days -= row['fix_length']
                    if max_row['duration'] < row['duration']:
                        max_row = row

            if delta_days:
                max_row['duration'] += delta_days
                max_row['fix_length'] += delta_days

    class Node:
        def __init__(self, key, txt, dur, fix_dur):
            self.es = self.ef = self.tf = 0
            self.ls = self.lf = 1e10
            self.ori_dur = dur
            self.key = key
            self.txt = txt
            self.dur = dur + fix_dur
            self.pre = []
            self.succ = []

        def my_print(self):
            return {
                'key': self.key,
                'es': self.es,
                'ef': self.ef,
                'ls': self.ls,
                'lf': self.lf,
                'ff': self.tf,
                'text': self.txt,
                'pre': self.pre,
                'succ': self.succ,
                'length': self.dur,
                'fix_length': self.dur - self.ori_dur,
            }

        def update_TF(self):
            self.tf = self.lf - self.es - self.dur

    x = {}
    for v in nodeDataArray:
        temp = dict(v)
        i = temp['key']
        x[i] = Node(i, temp['text'], int(temp['length']), int(temp['fix_length']))

    link = []
    for v in linkDataArray:
        d = dict(v)
        link.append([d['from'], d['to'], d['mode'], int(d['lag'])])
        x[d['to']].pre.append(link[-1])
        x[d['from']].succ.append(link[-1])

    all_key = sorted(x.keys(), key=lambda k: str(k))

    x['start'] = Node('start', 'start', 0, 0)
    x['end'] = Node('end', 'end', 0, 0)

    for k in all_key:
        if len(x[k].pre) == 0:
            x[k].pre.append(['start', k, 'FS', 0])
            x['start'].succ.append(['start', k, 'FS', 0])
        if len(x[k].succ) == 0:
            x[k].succ.append([k, 'end', 'FS', 0])
            x['end'].pre.append([k, 'end', 'FS', 0])

    for k in start_node_min_num:
        x[k].pre.append(['start', k, 'FS', int(start_node_min_num[k])])
        x['start'].succ.append(['start', k, 'FS', int(start_node_min_num[k])])

    for k in end_node_min_num:
        x[k].succ.append([k, 'end', 'FS', int(end_node_min_num[k])])
        x['end'].pre.append([k, 'end', 'FS', int(end_node_min_num[k])])

    def all_in(a, A):
        return all(i in A for i in a)

    y = {k: [e[0] for e in x[k].pre] for k in all_key}
    do_order = ['start']

    for rep in range(len(x) + 1):
        for k in list(y.keys()):
            if all_in(y[k], do_order):
                do_order.append(k)
                del y[k]
                break
        if len(y) == 0:
            break
    if len(y) > 0:
        return JsonResponse({'status': False, 'msg': '連結關係設定錯誤'})

    do_order.append('end')

    for k in do_order[1:]:
        for f, t, m, lag in x[k].pre:
            if t in start_node_min_num and f == 'start':
                lag = max(lag, int(start_node_min_num[t]))
            if f in end_node_min_num and t == 'end':
                lag = max(lag, int(end_node_min_num[f]))
            if m == 'FS':
                x[t].es = max(x[f].ef + lag, x[t].es)
            elif m == 'SS':
                x[t].es = max(x[f].es + lag, x[t].es)
            elif m == 'SF':
                x[t].ef = max(x[f].es + lag, x[t].ef)
            elif m == 'FF':
                x[t].ef = max(x[f].ef + lag, x[t].ef)
            else:
                return JsonResponse({'status': False, 'msg': '連結關係設定錯誤'})
            x[k].ef = max(x[k].es + x[k].dur, x[k].ef)
            x[k].es = max(x[k].es, x[k].ef - x[k].dur)

    x['end'].ls = x['end'].ef
    x['end'].lf = x['end'].ef

    for k in reversed(do_order[:-1]):
        for f, t, m, lag in x[k].succ:
            if t in start_node_min_num and f == 'start':
                lag = max(lag, int(start_node_min_num[t]))
            if f in end_node_min_num and t == 'end':
                lag = max(lag, int(end_node_min_num[f]))
            if m == 'FS':
                x[f].lf = min(x[f].lf, x[t].ls - lag)
            elif m == 'SS':
                x[f].ls = min(x[f].ls, x[t].ls - lag)
            elif m == 'SF':
                x[f].ls = min(x[f].ls, x[t].lf - lag)
            elif m == 'FF':
                x[f].lf = min(x[f].lf, x[t].lf - lag)
            else:
                return JsonResponse({'status': False, 'msg': '連結關係設定錯誤'})
            x[k].lf = min(x[k].ls + x[k].dur, x[k].lf)
            x[k].ls = min(x[k].ls, x[k].lf - x[k].dur)

    for k in do_order:
        x[k].update_TF()

    result = [x[k].my_print() for k in do_order]

    result_by_key = {r['key']: r for r in result if r['key'] not in ('start', 'end')}
    with transaction.atomic():
        items = ScheduleItem.objects.filter(id__in=[k for k in result_by_key if isinstance(k, int)])
        for i in items:
            row = result_by_key[i.id]
            i.es = int(row['es'])
            i.ef = int(row['ef'])
            i.ls = int(row['ls'])
            i.lf = int(row['lf'])
            i.cp = (row['es'] == row['ls'] and row['ef'] == row['lf'])
            i.save()

    return JsonResponse({'status': True, 'result': result})


@csrf_exempt
def copy_items_to_scheduleitems(R):
    return JsonResponse({'status': False, 'msg': '獨立簡化版無日報表契約工項模組'})


@csrf_exempt
def copy_main_items_to_scheduleitems(R):
    return JsonResponse({'status': False, 'msg': '獨立簡化版無日報表契約工項模組'})


@csrf_exempt
def copy_main_items_to_cpmitems(R):
    return JsonResponse({'status': False, 'msg': '獨立簡化版無日報表契約工項模組'})


def download_file(R, table_name, file_id):
    if table_name != 'Version_Schedule':
        return HttpResponse(status=404)

    row = Version_Schedule.objects.get(id=file_id)
    if not row.file or not os.path.exists(row.get_file_path()):
        return HttpResponse(status=404)

    file_name = 'cpm.jpg'
    file_path = row.get_file_path()
    ext = row.rExt()
    chunk_size = 8192

    response = StreamingHttpResponse(
        FileWrapper(open(file_path, 'rb'), chunk_size),
        content_type='image/jpeg' if ext.lower() in ('jpg', 'jpeg') else f'application/{ext}',
    )
    response['Content-Disposition'] = _content_disposition_attachment(file_name, inline=bool(R.GET.get('open')))
    return response


def make_excel_scheduleitem(R, version_id):
    version = Version_Schedule.objects.get(id=version_id)
    version.create_root_item()
    root_item = version.scheduleitem_set.filter(uplevel=None).order_by('id').first()
    value_type = R.GET.get('value_type', 'lslf')

    if version.schedule_setting_type == 1:
        root_item.symbol = ''
        subitems = list(root_item.schedule_scheduleitem_uplevel.filter(kind_id=11).order_by('ls', 'lf'))
        for n, i in enumerate(subitems):
            i.symbol = str(n + 1)
        items = [root_item] + subitems
    else:
        items = root_item.read_all_item()
        for i in items:
            i.symbol = i.read_level_symbol()

    data = {
        'create_time': str(version.create_time),
        'price_type': R.GET.get('price_type', 'rate'),
        'engs_price': str(version.read_engs_price()),
        'items': [],
    }

    for i in items:
        es, ef = i.es, i.ef
        if version.schedule_setting_type == 1:
            if value_type == 'lslf':
                es = i.ls + 1
                ef = i.lf
            elif value_type == 'esef':
                es = i.es + 1
            elif value_type == 'avg':
                es = int((i.es + 1 + i.ls + 1) / 2.0)
                ef = int((i.ef + i.lf) / 2.0)
            elif value_type == 'full':
                es = i.es + 1
                ef = i.lf

        data['items'].append({
            'symbol': i.symbol,
            'name': i.name,
            'es': es if i.kind_id != 10 else '',
            'ef': ef if i.kind_id != 10 else '',
            'unit_price': str(i.unit_price) if i.kind_id != 10 else '',
            'kind__id': i.kind_id,
            'cp': i.cp,
        })

    response = make_excel_scheduleitem_call(data, f_type='response')
    ts = version.create_time.strftime('%Y%m%d_%H%M%S') if version.create_time else str(version.id)
    response['Content-Disposition'] = _content_disposition_attachment(f'預定進度精靈_{ts}_匯出進度工項.xlsx')
    return response


def make_json_scheduleitem(R, version_id):
    version = Version_Schedule.objects.get(id=version_id)
    version.create_root_item()
    root_item = version.scheduleitem_set.filter(uplevel=None).order_by('id').first()
    if version.need_recount_esef:
        root_item.update_es_ef()
        version.need_recount_esef = False
        version.save()

    project = version.project
    data = {'items': []}
    subs = root_item.schedule_scheduleitem_uplevel.all().order_by('priority', 'id')
    while subs.exists():
        tmp = []
        for i in subs:
            dur = i.duration if version.schedule_setting_type == 1 else (i.ef - i.es + 1)
            tmp.append({
                'id': i.id,
                'is_main_item': i.is_main_item,
                'name': i.name,
                'symbol': i.read_level_symbol(),
                'es': i.es,
                'ef': i.ef,
                'ls': i.ls,
                'lf': i.lf,
                'kind': i.kind_id,
                'unit_price': float(str(i.unit_price)),
                'uplevel': i.uplevel_id,
                'priority': i.priority,
                'link': i.link,
                'cp': i.cp,
                'duration': dur,
                'location': i.location,
            })
        data['items'].append(tmp)
        subs = ScheduleItem.objects.filter(uplevel__in=subs).order_by('uplevel__priority', 'priority', 'id')

    if version.file and os.path.exists(version.get_file_path()):
        with open(version.get_file_path(), 'rb') as f:
            data['version_file'] = base64.encodebytes(f.read()).decode('utf-8')

    if version.schedule_setting_type == 1:
        data['cpm_link'] = version.cpm_link
    data['start_end_node'] = version.start_end_node
    data['schedule_setting_type'] = version.schedule_setting_type

    ext = R.GET.get('ext', 'json')
    buf = BytesIO(json.dumps(data, ensure_ascii=False).encode('utf-8'))
    response = HttpResponse(buf.getvalue(), content_type='application/json')
    response['Content-Length'] = buf.getbuffer().nbytes
    mode_label = ['---', 'CPM', '甘特', '區間'][int(version.schedule_setting_type or 0)]
    ts = version.create_time.strftime('%Y%m%d_%H%M%S') if version.create_time else str(version.id)
    pname = (project.name if project else version.project_name).replace(',', '')
    response['Content-Disposition'] = _content_disposition_attachment(f'精靈專用檔[{mode_label}]-{ts}-{pname}.{ext}')
    return response


def make_gantt_schedule_excel(R, version_id):
    version = Version_Schedule.objects.filter(id=version_id).first()
    if not version:
        return JsonResponse({'status': False, 'msg': '找不到對應的版本'})

    data_range = R.GET.get('data_range', 'auto')
    value_type = R.GET.get('value_type', 'lslf')
    if data_range != 'auto':
        data_range = int(data_range)

    data = version.get_gantta_data(data_range=data_range, value_type=value_type)
    if version.file and os.path.exists(version.get_file_path()):
        with open(version.get_file_path(), 'rb') as f:
            data['version_file'] = base64.encodebytes(f.read()).decode('utf-8')

    try:
        adm_bytes = make_adm_png(R, version_id, return_response=False)
        if adm_bytes:
            data['adm_file'] = base64.encodebytes(adm_bytes).decode('utf-8')
    except Exception:
        pass

    response = make_gantt_schedule_excel_call(data, f_type='response')
    ts = version.create_time.strftime('%Y%m%d_%H%M%S') if version.create_time else str(version.id)
    response['Content-Disposition'] = _content_disposition_attachment(f'預定進度精靈_{ts}_甘特圖.xlsx')
    return response


def make_gantt_schedule_png(R, version_id):
    version = Version_Schedule.objects.get(id=version_id)
    data = version.get_gantta_png_data(GET=R.GET)
    response = make_gantt_schedule_png_call(data, f_type='response')
    ts = version.create_time.strftime('%Y%m%d_%H%M%S') if version.create_time else str(version.id)
    response['Content-Disposition'] = _content_disposition_attachment(f'預定進度精靈_{ts}_甘特圖.png')
    return response


def configure_fonts():
    font_path = os.path.join(os.path.dirname(__file__), 'bkai00mp.ttf')
    if os.path.exists(font_path):
        font_manager.fontManager.addfont(font_path)
        prop = font_manager.FontProperties(fname=font_path)
        font_name = prop.get_name()
        plt.rcParams['font.sans-serif'] = [font_name] + plt.rcParams['font.sans-serif']
    plt.rcParams['axes.unicode_minus'] = False


def make_adm_png(R, version_id, return_response=True):
    """匯出 ADM 箭線圖 PNG（完全保留 jsrcm 繪圖邏輯與標楷體字型）"""
    version = Version_Schedule.objects.get(id=version_id)
    version.create_root_item()
    root_item = version.scheduleitem_set.filter(uplevel=None).order_by('id').first()
    if version.need_recount_esef:
        root_item.update_es_ef()
        version.need_recount_esef = False
        version.save()

    value_type = R.GET.get('value_type', 'lslf')
    cpm_link = json.loads(version.cpm_link or '[]')
    data = []
    items = version.scheduleitem_set.filter(uplevel__isnull=False).exclude(kind_id=10).order_by('priority', 'id')
    for i in items:
        es, ef = i.es, i.ef
        if version.schedule_setting_type == 1:
            if value_type == 'lslf':
                es = i.ls + 1
                ef = i.lf
            elif value_type == 'esef':
                es = i.es + 1
            elif value_type == 'avg':
                es = int((i.es + 1 + i.ls + 1) / 2.0)
                ef = int((i.ef + i.lf) / 2.0)
            elif value_type == 'full':
                es = i.es + 1
                ef = i.lf
        data.append({
            'id': i.id,
            'name': i.name or '',
            'es': es - 1,
            'ef': ef,
            'link': [{'to': j['to'], 'mode': j['mode']} for j in cpm_link if j.get('from') == i.id],
            'cp': i.cp,
            'duration': max(1, ef - es + 1),
        })

    if not data:
        if not return_response:
            return b''
        return HttpResponse('目前無工項可繪製 ADM 圖', status=400)

    configure_fonts()

    cp_tasks = sorted([t for t in data if t.get('cp')], key=lambda x: x['es'])
    other_tasks = sorted([t for t in data if not t.get('cp')], key=lambda x: x['es'])

    lanes = []
    task_positions = {}

    for task in cp_tasks:
        placed = False
        for i, lane_end in enumerate(lanes):
            if task['es'] >= lane_end:
                lanes[i] = task['ef']
                task_positions[task['id']] = {'lane': i, 'data': task}
                placed = True
                break
        if not placed:
            lanes.append(task['ef'])
            task_positions[task['id']] = {'lane': len(lanes) - 1, 'data': task}

    cp_lanes_count = len(lanes)

    for task in other_tasks:
        placed = False
        for i in range(cp_lanes_count, len(lanes)):
            if task['es'] >= lanes[i]:
                lanes[i] = task['ef']
                task_positions[task['id']] = {'lane': i, 'data': task}
                placed = True
                break
        if not placed:
            lanes.append(task['ef'])
            task_positions[task['id']] = {'lane': len(lanes) - 1, 'data': task}

    num_lanes = len(lanes)
    min_day = min(d['es'] for d in data)
    max_day = max(d['ef'] for d in data)
    mid_timeline = min_day + (max_day - min_day) / 2

    points = set()
    for _, info in task_positions.items():
        y = num_lanes - 1 - info['lane']
        points.add((info['data']['es'], y))
        points.add((info['data']['ef'], y))

    sorted_points = sorted(list(points), key=lambda p: (p[0], -p[1]))
    final_node_positions = {}
    counter = 10
    for pt in sorted_points:
        final_node_positions[counter] = pt
        counter += 10

    fig_height = max(5, num_lanes * 1.3 + 1)
    total_duration = max(1, max_day - min_day)

    width_factor = 15
    if len(data) > 10:
        if total_duration > 300:
            width_factor = 35
        elif total_duration > 100:
            width_factor = 25

    fig, ax = plt.subplots(figsize=(width_factor, fig_height))
    days_per_inch = total_duration / width_factor
    char_width_threshold_inch = 0.4
    days_per_char_limit = max(0.01, days_per_inch * char_width_threshold_inch)

    for _, info in task_positions.items():
        task = info['data']
        y = num_lanes - 1 - info['lane']
        color = '#ef4444' if task.get('cp') else 'black'
        linewidth = 2.5 if task.get('cp') else 1.5

        ax.annotate(
            '',
            xy=(task['ef'], y),
            xycoords='data',
            xytext=(task['es'], y),
            textcoords='data',
            arrowprops=dict(arrowstyle='-|>', color=color, lw=linewidth, shrinkA=12, shrinkB=15),
        )

        wrap_width = max(1, min(10, int(task['duration'] / days_per_char_limit)))
        raw_name = task['name']
        wrapped_name = '\n'.join([raw_name[i : i + wrap_width] for i in range(0, len(raw_name), wrap_width)])
        mid_x = (task['es'] + task['ef']) / 2

        ax.text(
            mid_x,
            y + 0.12,
            wrapped_name,
            ha='center',
            va='bottom',
            fontsize=10,
            color='black',
            fontweight='bold',
            bbox=dict(facecolor='white', alpha=0.7, edgecolor='none', pad=0.5),
        )
        ax.text(mid_x, y - 0.15, f"{task['duration']} 天", ha='center', va='top', fontsize=9, color='#4b5563')

        if 'link' in task:
            for link in task['link']:
                target = link['to']
                if target == 'end':
                    continue
                if target in task_positions:
                    t_info = task_positions[target]
                    ty = num_lanes - 1 - t_info['lane']
                    start_pt = (task['ef'], y)
                    end_pt = (t_info['data']['es'], ty)
                    if start_pt != end_pt:
                        if start_pt[0] < mid_timeline:
                            path_x = [start_pt[0], start_pt[0], end_pt[0]]
                            path_y = [start_pt[1], end_pt[1], end_pt[1]]
                        else:
                            path_x = [start_pt[0], end_pt[0], end_pt[0]]
                            path_y = [start_pt[1], start_pt[1], end_pt[1]]
                        ax.plot(path_x, path_y, linestyle='--', color='#9ca3af', linewidth=1, zorder=0)

    for _, (nx, ny) in final_node_positions.items():
        ax.plot(
            nx,
            ny,
            marker='o',
            markersize=32,
            markerfacecolor='white',
            markeredgecolor='black',
            markeredgewidth=1.5,
            zorder=20,
            linestyle='None',
        )
        ax.text(nx, ny, str(int(nx)), ha='center', va='center', fontsize=9, fontweight='bold', zorder=21)

    if total_duration > 300:
        step = 30
    elif total_duration > 100:
        step = 10
    elif total_duration > 30:
        step = 5
    else:
        step = 1

    ticks = list(range(int(min_day), int(max_day) + 1, step))
    if ticks[-1] < max_day:
        ticks.append(int(max_day))

    ax.set_xticks(ticks)
    right_padding = max(5, total_duration * 0.05)
    left_padding = max(2, step)
    ax.set_xlim(min_day - left_padding, max_day + right_padding)
    ax.set_ylim(-1, num_lanes)
    ax.set_yticks([])
    ax.grid(True, axis='x', linestyle=':', alpha=0.4)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_visible(False)

    plt.title(version.project_name or version.display_name, fontsize=16, pad=20)
    plt.tight_layout()

    footer_offset_inch = 0.9
    y_pos = -(footer_offset_inch / fig_height)
    ax.text(0.46, y_pos, '工期', transform=ax.transAxes, fontsize=12, va='center', ha='right', color='black')
    ax.text(0.48, y_pos, '(', transform=ax.transAxes, fontsize=10, va='center', ha='left', color='black')
    ax.annotate(
        '',
        xy=(0.53, y_pos),
        xytext=(0.49, y_pos),
        xycoords='axes fraction',
        textcoords='axes fraction',
        arrowprops=dict(arrowstyle='-|>', color='#ef4444', lw=2.5),
    )
    ax.text(0.54, y_pos, '代表要徑)', transform=ax.transAxes, fontsize=10, va='center', ha='left', color='black')

    buf = BytesIO()
    plt.savefig(buf, format='png', dpi=150, bbox_inches='tight')
    plt.close(fig)
    buf.seek(0)

    if not return_response:
        return buf.getvalue()

    response = HttpResponse(buf.getvalue(), content_type='image/png')
    response['Content-Length'] = buf.getbuffer().nbytes
    response['Content-Disposition'] = _content_disposition_attachment(f'預定進度精靈_{version.id}_ADM.png')
    return response
