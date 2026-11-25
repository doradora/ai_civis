# -*- coding: utf-8 -*-
"""
純 Django 實作與 jsrcm django-tastypie 完全相容的 /schedule/api/active/ REST API，
不需安裝 django-tastypie 或 django-guardian，且已簡化權限檢查。
"""
import base64
import datetime
import decimal
import json
import re
import sys
from io import BytesIO

from django.core.files.uploadedfile import InMemoryUploadedFile
from django.db import transaction
from django.db.models import F, Q
from django.http import HttpResponse, HttpResponseBadRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from core.models import Project
from schedule.models import (
    NOW,
    Option,
    ScheduleItem,
    Version_Schedule,
    get_dir_kind,
    get_item_kind,
)


def _extract_id(value):
    """從 Tastypie URI（如 /schedule/api/active/scheduleitem/12/）或數字取出整數 ID。"""
    if value is None or value == '':
        return None
    if isinstance(value, int):
        return value
    s = str(value).strip()
    if s.isdigit():
        return int(s)
    m = re.search(r'/(\d+)/?$', s)
    if m:
        return int(m.group(1))
    return None


def _parse_json_body(request):
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode('utf-8'))
    except Exception:
        return {}


def _user_display_name(user):
    if not user:
        return '系統'
    full = f'{user.last_name}{user.first_name}'.strip()
    return full or user.username


def serialize_version_schedule(obj):
    setting_names = ['未設定', 'CPM要徑', '甘特圖', '簡易區間']
    s_idx = int(obj.schedule_setting_type or 0)
    setting_name = setting_names[s_idx] if 0 <= s_idx < len(setting_names) else '未設定'
    return {
        'id': obj.id,
        'resource_uri': f'/schedule/api/active/version_schedule/{obj.id}/',
        'project': f'/project/api/v1/project/{obj.project_id}/' if obj.project_id else None,
        'project__id': obj.project_id,
        'project_name': obj.project_name or (obj.project.name if obj.project else ''),
        'version': None,
        'version__start_date': '無',
        'start_date': obj.start_date.isoformat() if obj.start_date else None,
        'create_time': obj.create_time.isoformat() if obj.create_time else '',
        'update_time': obj.update_time.isoformat() if obj.update_time else '',
        'create_user': f'/project/api/v1/user/{obj.create_user_id}/' if obj.create_user_id else None,
        'update_user': f'/project/api/v1/user/{obj.update_user_id}/' if obj.update_user_id else None,
        'create_user__name': _user_display_name(obj.create_user),
        'update_user__name': _user_display_name(obj.update_user),
        'need_recount_esef': obj.need_recount_esef,
        'cpm_link': obj.cpm_link or '[]',
        'duration': obj.duration,
        'start_end_node': obj.start_end_node or '{}',
        'release_json': obj.release_json or '{}',
        'cpm_release': obj.cpm_release,
        'schedule_setting_type': obj.schedule_setting_type,
        'schedule_setting_type__name': setting_name,
    }


def serialize_schedule_item(obj, extra=None):
    items = obj.read_deep_sub_item_in_list()
    delete_ids = '.'.join([str(i.id) for i in items])
    data = {
        'id': obj.id,
        'key': obj.id,
        'resource_uri': f'/schedule/api/active/scheduleitem/{obj.id}/',
        'version': f'/schedule/api/active/version_schedule/{obj.version_id}/',
        'is_main_item': obj.is_main_item,
        'name': obj.name or '',
        'unit_name': obj.unit_name,
        'unit_num': float(obj.unit_num),
        'unit_price': float(obj.unit_price),
        'es': obj.es,
        'ef': obj.ef,
        'ls': obj.ls,
        'lf': obj.lf,
        'kind': f'/dailyreport/api/v1/option/{obj.kind_id}/',
        'uplevel': f'/schedule/api/active/scheduleitem/{obj.uplevel_id}/' if obj.uplevel_id else None,
        'pre_item': f'/schedule/api/active/scheduleitem/{obj.pre_item_id}/' if obj.pre_item_id else None,
        'priority': obj.priority,
        'include_item': obj.include_item,
        'link': obj.link or '[]',
        'cp': obj.cp,
        'duration': obj.duration,
        'location': obj.location or '',
        'delete_ids': delete_ids,
        'read_level_symbol': obj.read_level_symbol(),
    }
    if extra:
        data.update(extra)
    return data


def _sync_cpm_links_to_items(version_obj):
    """與 jsrcm Version_ScheduleResource.obj_update 同步 CPM 連結至 ScheduleItem.link"""
    sch_items = list(version_obj.scheduleitem_set.all().select_related('uplevel').exclude(uplevel=None))
    cpm_to_sch_mapping = {i.id: i for i in sch_items}
    link_mapping = {}
    cpm_link = json.loads(version_obj.cpm_link or '[]')
    modes = ['FS', 'SS', 'FF', 'SF']
    for link in cpm_link:
        frm = link.get('from')
        to = link.get('to')
        if frm == 'start' or to == 'end':
            continue
        if frm not in cpm_to_sch_mapping or to not in cpm_to_sch_mapping:
            continue
        from_sch = cpm_to_sch_mapping[frm]
        to_sch = cpm_to_sch_mapping[to]
        mode = link.get('mode', 'FS')
        mode_idx = modes.index(mode) if mode in modes else 0
        link_mapping.setdefault(from_sch.id, []).append({
            'source': from_sch.id,
            'target': to_sch.id,
            'type': str(mode_idx),
        })

    @transaction.atomic
    def _update():
        for item in sch_items:
            item.link = json.dumps(link_mapping.get(item.id, []))
            item.save(update_fields=['link'])

    _update()


def _apply_version_update(obj, data, user=None):
    if 'update_to_100_progress' in data:
        obj.update_to_100_progress()

    if 'project' in data:
        pid = _extract_id(data['project'])
        obj.project = Project.objects.filter(id=pid).first() if pid else None
    if 'project_name' in data:
        obj.project_name = str(data['project_name'])
    if 'duration' in data and data['duration'] not in (None, ''):
        obj.duration = int(data['duration'])
    if 'cpm_link' in data:
        obj.cpm_link = data['cpm_link'] if isinstance(data['cpm_link'], str) else json.dumps(data['cpm_link'])
    if 'start_end_node' in data:
        obj.start_end_node = (
            data['start_end_node'] if isinstance(data['start_end_node'], str) else json.dumps(data['start_end_node'])
        )
    if 'schedule_setting_type' in data and data['schedule_setting_type'] not in (None, ''):
        obj.schedule_setting_type = int(data['schedule_setting_type'])
    if 'need_recount_esef' in data:
        obj.need_recount_esef = bool(data['need_recount_esef'])
    if 'cpm_release' in data:
        obj.cpm_release = bool(data['cpm_release'])

    if user and user.is_authenticated:
        obj.update_user = user
    obj.update_time = NOW()
    obj.save()

    if obj.schedule_setting_type == 1 and 'cpm_link' in data:
        _sync_cpm_links_to_items(obj)

    return obj


@csrf_exempt
def version_schedule_list(request):
    get_dir_kind()
    get_item_kind()

    if request.method == 'GET':
        qs = Version_Schedule.objects.select_related('project', 'create_user', 'update_user').all()
        name_q = request.GET.get('p__name__icontains', '').strip()
        if name_q:
            qs = qs.filter(Q(project__name__icontains=name_q) | Q(project_name__icontains=name_q)).distinct()

        project_q = request.GET.get('project', '').strip()
        if project_q:
            pid = _extract_id(project_q)
            if pid:
                qs = qs.filter(project_id=pid)

        order_by = request.GET.get('order_by', '-create_time').strip()
        allowed_orders = {'create_time', '-create_time', 'update_time', '-update_time', 'project', '-project', 'id', '-id'}
        if order_by in allowed_orders:
            qs = qs.order_by(order_by)
        else:
            qs = qs.order_by('-create_time')

        total_count = qs.count()
        offset = max(0, int(request.GET.get('offset', 0) or 0))
        limit_raw = request.GET.get('limit', '20')
        limit = int(limit_raw) if str(limit_raw).isdigit() else 20
        page_qs = qs[offset:] if limit == 0 else qs[offset : offset + limit]

        return JsonResponse({
            'meta': {
                'limit': limit,
                'offset': offset,
                'total_count': total_count,
                'next': None,
                'previous': None,
            },
            'objects': [serialize_version_schedule(o) for o in page_qs],
        })

    if request.method == 'POST':
        data = _parse_json_body(request)
        pid = _extract_id(data.get('project'))
        project = Project.objects.filter(id=pid).first() if pid else None
        project_name = data.get('project_name') or (project.name if project else '')
        setting_type = int(data.get('schedule_setting_type') or 1)

        if 'duration' in data and data['duration'] not in (None, ''):
            duration = int(data['duration'])
        elif project and project.duration:
            duration = int(project.duration)
        else:
            duration = 0

        user = request.user if request.user.is_authenticated else None
        obj = Version_Schedule.objects.create(
            project=project,
            project_name=project_name,
            schedule_setting_type=setting_type,
            duration=duration,
            create_user=user,
            update_user=user,
        )
        obj.create_root_item()

        clone_id = _extract_id(data.get('clone_version'))
        if clone_id:
            pre_version = Version_Schedule.objects.filter(id=clone_id).first()
            if pre_version:
                obj.new_version_copy_pre_item(pre_version=pre_version)

        return JsonResponse(serialize_version_schedule(obj), status=201)

    return HttpResponse(status=405)


@csrf_exempt
def version_schedule_detail(request, pk):
    obj = Version_Schedule.objects.filter(id=pk).first()
    if not obj:
        return JsonResponse({'error': 'Not found'}, status=404)

    if request.method == 'GET':
        return JsonResponse(serialize_version_schedule(obj))

    if request.method in ('PUT', 'PATCH'):
        data = _parse_json_body(request)
        _apply_version_update(obj, data, user=request.user)
        return JsonResponse(serialize_version_schedule(obj))

    if request.method == 'DELETE':
        obj.delete()
        return JsonResponse({}, status=200)

    return HttpResponse(status=405)


@csrf_exempt
def version_schedule_release(request):
    """儲存 CPM 發佈圖（/schedule/api/active/version_schedule/release/）"""
    if request.method != 'POST':
        return HttpResponse(status=405)

    data = _parse_json_body(request)
    version = Version_Schedule.objects.get(id=data['version_id'])
    ext = 'jpg'
    f = data.get('file', '')
    base64_content = base64.b64decode(f)
    output = BytesIO()
    output.write(base64_content)
    output.seek(0)
    timestamp = datetime.datetime.now().strftime('%H_%M_%S_%f')
    frame = InMemoryUploadedFile(output, None, f'{timestamp}.jpg', 'image/jpeg', len(base64_content), None)
    version.file.save(f'{version.id}.{ext}', frame, save=False)
    version.cpm_release = True
    version.update_time = NOW()
    version.save()

    return JsonResponse({'status': True})


def _update_single_schedule_item(item, data, user=None):
    """套用單筆 ScheduleItem 更新邏輯（與 jsrcm ScheduleItemResource.obj_update 一致）"""
    is_patch = bool(data.get('is_patch'))

    if 'is_main_item' in data and not is_patch:
        new_main = bool(data['is_main_item'])
        if new_main:
            if item.uplevel and not item.uplevel.is_main_item:
                return HttpResponseBadRequest('您的上層未勾選顯示。')
            if item.uplevel:
                ids = [i.id for i in item.uplevel.schedule_scheduleitem_uplevel.all()]
                if ids:
                    ScheduleItem.objects.filter(id__in=ids).update(is_main_item=True)
        else:
            if item.uplevel:
                ids = []
                for i in item.uplevel.schedule_scheduleitem_uplevel.all():
                    if i.kind_id == 10:
                        ids += [j.id for j in i.read_deep_sub_item_in_list()]
                    else:
                        ids.append(i.id)
                if ids:
                    ScheduleItem.objects.filter(id__in=ids).update(is_main_item=False)
        item.is_main_item = new_main
    elif 'is_main_item' in data:
        item.is_main_item = bool(data['is_main_item'])

    if item.version.schedule_setting_type != 1:
        if 'es' in data and data['es'] not in (None, ''):
            delta = item.ef - item.es + 1
            new_es = int(data['es'])
            if new_es <= 0:
                return HttpResponseBadRequest('設定最小值為1')
            if new_es > 3650:
                return HttpResponseBadRequest('設定最大值為3650')
            item.es = new_es
            if not is_patch:
                item.ef = new_es + delta - 1
    else:
        if 'es' in data and data['es'] not in (None, ''):
            item.es = int(data['es'])

    if 'ef' in data and data['ef'] not in (None, '') and (is_patch or 'es' not in data or item.version.schedule_setting_type == 1):
        item.ef = int(data['ef'])
    if 'ls' in data and data['ls'] not in (None, ''):
        item.ls = int(data['ls'])
    if 'lf' in data and data['lf'] not in (None, ''):
        item.lf = int(data['lf'])
    if 'name' in data and data['name'] is not None:
        item.name = str(data['name']).replace('\n', '')
    if 'unit_name' in data and data['unit_name'] is not None:
        item.unit_name = str(data['unit_name'])
    if 'unit_num' in data and data['unit_num'] not in (None, ''):
        item.unit_num = decimal.Decimal(str(data['unit_num']))
    if 'unit_price' in data and data['unit_price'] not in (None, ''):
        item.unit_price = decimal.Decimal(str(data['unit_price']))
    if 'cp' in data:
        item.cp = bool(data['cp'])
    if 'duration' in data and data['duration'] not in (None, ''):
        item.duration = int(data['duration'])
    if 'location' in data and data['location'] is not None:
        item.location = str(data['location'])
    if 'link' in data and data['link'] is not None:
        item.link = data['link'] if isinstance(data['link'], str) else json.dumps(data['link'])
    if 'priority' in data and data['priority'] not in (None, ''):
        item.priority = int(data['priority'])
    if 'include_item' in data and data['include_item'] is not None:
        item.include_item = str(data['include_item'])

    item.save()

    version = item.version
    version.update_time = NOW()
    if user and user.is_authenticated:
        version.update_user = user
    version.need_recount_esef = True
    version.cpm_release = False
    version.save(update_fields=['update_time', 'update_user', 'need_recount_esef', 'cpm_release'])
    return None


def _create_single_schedule_item(data, user=None):
    dir_kind = get_dir_kind()
    item_kind = get_item_kind()

    version_id = _extract_id(data.get('version'))
    uplevel_id = _extract_id(data.get('uplevel'))
    kind_id = _extract_id(data.get('kind')) or 11
    kind = dir_kind if kind_id == 10 else item_kind

    same_items = ScheduleItem.objects.filter(uplevel_id=uplevel_id).order_by('-priority')
    is_main_item = data.get('is_main_item', True)
    if same_items.exists():
        priority = same_items.first().priority + 1
        if same_items.filter(is_main_item=False).exists():
            is_main_item = False
    else:
        priority = 0

    name = str(data.get('name') or data.get('text') or '').replace('\n', '')
    unit_price = decimal.Decimal(str(data.get('unit_price') if data.get('unit_price') not in (None, '') else '0'))
    es = int(data.get('es') if data.get('es') not in (None, '') else 1)
    ef = int(data.get('ef') if data.get('ef') not in (None, '') else 1)
    ls = int(data.get('ls') if data.get('ls') not in (None, '') else 1)
    lf = int(data.get('lf') if data.get('lf') not in (None, '') else 1)
    duration = int(data.get('duration') if data.get('duration') not in (None, '') else (data.get('length') or 1))
    link = data.get('link', '[]')
    if not isinstance(link, str):
        link = json.dumps(link)

    item = ScheduleItem.objects.create(
        version_id=version_id,
        uplevel_id=uplevel_id,
        kind=kind,
        priority=priority,
        is_main_item=bool(is_main_item),
        name=name,
        unit_name=str(data.get('unit_name') or '---'),
        unit_num=decimal.Decimal(str(data.get('unit_num') or '1')),
        unit_price=unit_price,
        es=es,
        ef=ef,
        ls=ls,
        lf=lf,
        cp=bool(data.get('cp', False)),
        duration=duration,
        location=str(data.get('location') or ''),
        link=link,
    )

    version = item.version
    version.update_time = NOW()
    if user and user.is_authenticated:
        version.update_user = user
    version.need_recount_esef = True
    version.cpm_release = False
    version.save(update_fields=['update_time', 'update_user', 'need_recount_esef', 'cpm_release'])
    return item


@csrf_exempt
def scheduleitem_list(request):
    get_dir_kind()
    get_item_kind()

    if request.method == 'GET':
        qs = ScheduleItem.objects.select_related('version', 'kind', 'uplevel', 'pre_item').all()
        if request.GET.get('version'):
            vid = _extract_id(request.GET.get('version'))
            if vid:
                qs = qs.filter(version_id=vid)
        if request.GET.get('kind'):
            kid = _extract_id(request.GET.get('kind'))
            if kid:
                qs = qs.filter(kind_id=kid)
        if request.GET.get('uplevel'):
            uid = _extract_id(request.GET.get('uplevel'))
            if uid:
                qs = qs.filter(uplevel_id=uid)
        if request.GET.get('id'):
            iid = _extract_id(request.GET.get('id'))
            if iid:
                qs = qs.filter(id=iid)

        order_by = request.GET.get('order_by', 'priority').strip()
        allowed_orders = {'priority', '-priority', 'id', '-id', 'es', '-es', 'ls', '-ls'}
        qs = qs.order_by(order_by if order_by in allowed_orders else 'priority')

        total_count = qs.count()
        offset = max(0, int(request.GET.get('offset', 0) or 0))
        limit_raw = request.GET.get('limit', '20')
        limit = int(limit_raw) if str(limit_raw).isdigit() else 20
        page_qs = qs[offset:] if limit == 0 else qs[offset : offset + limit]

        return JsonResponse({
            'meta': {
                'limit': limit,
                'offset': offset,
                'total_count': total_count,
                'next': None,
                'previous': None,
            },
            'objects': [serialize_schedule_item(o) for o in page_qs],
        })

    if request.method == 'POST':
        data = _parse_json_body(request)
        item = _create_single_schedule_item(data, user=request.user)
        extra = {}
        if 'temp_key' in data:
            extra['temp_key'] = data['temp_key']
        if 'old_id' in data:
            extra['old_id'] = data['old_id']
        return JsonResponse(serialize_schedule_item(item, extra=extra), status=201)

    if request.method == 'PATCH':
        payload = _parse_json_body(request)
        deleted_uris = payload.get('deleted_objects', [])
        objects_data = payload.get('objects', [])
        returned_objects = []

        with transaction.atomic():
            for uri in deleted_uris:
                del_id = _extract_id(uri)
                if not del_id:
                    continue
                item = ScheduleItem.objects.filter(id=del_id).first()
                if item:
                    version = item.version
                    if item.uplevel:
                        item.uplevel.schedule_scheduleitem_uplevel.filter(priority__gt=item.priority).update(
                            priority=F('priority') - 1
                        )
                    item.delete()
                    version.update_time = NOW()
                    version.need_recount_esef = True
                    version.cpm_release = False
                    version.save(update_fields=['update_time', 'need_recount_esef', 'cpm_release'])

            for obj_data in objects_data:
                obj_data = dict(obj_data)
                obj_data['is_patch'] = True
                existing_id = _extract_id(obj_data.get('resource_uri')) or _extract_id(obj_data.get('id'))
                item = ScheduleItem.objects.filter(id=existing_id).first() if existing_id else None

                extra = {}
                if 'temp_key' in obj_data:
                    extra['temp_key'] = obj_data['temp_key']
                if 'old_id' in obj_data:
                    extra['old_id'] = obj_data['old_id']

                if item:
                    err = _update_single_schedule_item(item, obj_data, user=request.user)
                    if err is not None:
                        return err
                else:
                    item = _create_single_schedule_item(obj_data, user=request.user)
                returned_objects.append(serialize_schedule_item(item, extra=extra))

        return JsonResponse({'objects': returned_objects})

    return HttpResponse(status=405)


@csrf_exempt
def scheduleitem_detail(request, pk):
    item = ScheduleItem.objects.filter(id=pk).first()
    if not item:
        return JsonResponse({'error': 'Not found'}, status=404)

    if request.method == 'GET':
        return JsonResponse(serialize_schedule_item(item))

    if request.method in ('PUT', 'PATCH'):
        data = _parse_json_body(request)
        err = _update_single_schedule_item(item, data, user=request.user)
        if err is not None:
            return err
        item.refresh_from_db()
        return JsonResponse(serialize_schedule_item(item))

    if request.method == 'DELETE':
        version = item.version
        if item.uplevel:
            item.uplevel.schedule_scheduleitem_uplevel.filter(priority__gt=item.priority).update(
                priority=F('priority') - 1
            )
        item.delete()
        version.update_time = NOW()
        if request.user.is_authenticated:
            version.update_user = request.user
        version.need_recount_esef = True
        version.cpm_release = False
        version.save(update_fields=['update_time', 'update_user', 'need_recount_esef', 'cpm_release'])
        return JsonResponse({}, status=200)

    return HttpResponse(status=405)


@csrf_exempt
def scheduleitem_change_item_priority(request):
    if request.method != 'POST':
        return HttpResponse(status=405)
    data = _parse_json_body(request)
    priority_mapping = {int(i['row_id']): int(i['priority']) for i in data.get('objects', [])}
    items = list(ScheduleItem.objects.filter(id__in=priority_mapping.keys()))

    with transaction.atomic():
        for i in items:
            i.priority = priority_mapping[i.id]
            i.save(update_fields=['priority'])

    return JsonResponse({})


@csrf_exempt
def scheduleitem_get_delete_sub_ids(request):
    row_id = request.GET.get('row_id')
    item = ScheduleItem.objects.get(id=row_id)
    items = item.read_deep_sub_item_in_list()
    delete_ids = '.'.join([str(i.id) for i in items])
    return JsonResponse({'delete_ids': delete_ids})


@csrf_exempt
def dailyreport_version_stub(request):
    """相容 manage_schedule.js 查詢契約版本的端點（簡化專案無 dailyreport 模組，回傳空清單）。"""
    return JsonResponse({'meta': {'total_count': 0}, 'objects': []})
