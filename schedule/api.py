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
from schedule.wbs_io import (
    apply_wbs_action,
    import_json_into_version,
    serialize_wbs_tree,
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


def serialize_version_schedule(obj, include_tree=False):
    setting_names = ['未設定', 'CPM要徑', '甘特圖', '簡易區間']
    s_idx = int(obj.schedule_setting_type or 0)
    setting_name = setting_names[s_idx] if 0 <= s_idx < len(setting_names) else '未設定'
    stage = obj.get_stage_info()
    versions_list = obj.get_versions()
    ver_num = 1
    for num, v in versions_list:
        if v.id == obj.id:
            ver_num = num
            break
    parent_item = obj.parent_item if obj.parent_item_id else None
    wbs_parent_ver = parent_item.version if (parent_item and parent_item.version_id) else None
    data = {
        'id': obj.id,
        'resource_uri': f'/schedule/api/active/version_schedule/{obj.id}/',
        'parent_id': obj.parent_id,
        'version_number': ver_num,
        'version_count': len(versions_list),
        'parent_item_id': obj.parent_item_id,
        'parent_item_name': parent_item.name if parent_item else '',
        'parent_item_duration': int(parent_item.duration or 0) if parent_item else 0,
        'wbs_parent_version_id': wbs_parent_ver.id if wbs_parent_ver else None,
        'wbs_parent_version_name': wbs_parent_ver.display_name if wbs_parent_ver else '',
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
        'cpm_locked': bool(obj.cpm_locked),
        'gantt_locked': bool(obj.gantt_locked),
        'stage_code': stage['code'],
        'stage_label': stage['label'],
        'schedule_setting_type': obj.schedule_setting_type,
        'schedule_setting_type__name': setting_name,
    }
    if include_tree:
        # Attach sibling versions (newest first: vN .. v1) of this same schedule family
        data['version_family'] = [
            {
                'id': v.id,
                'version_number': num,
                'is_latest': (num == len(versions_list)),
                'project_name': v.display_name,
                'duration': v.duration,
                'stage_code': v.get_stage_info()['code'],
                'stage_label': v.get_stage_info()['label'],
                'update_time': v.update_time.isoformat() if v.update_time else '',
            }
            for num, v in reversed(versions_list)
        ]
        # Attach WBS child sub-schedules linked to the displayed version's PDM nodes;
        # only fall back to earlier sibling versions if the displayed version has none yet (legacy v2s).
        family_ids = [v.id for _, v in versions_list]
        sub_qs = (
            Version_Schedule.objects.select_related('parent_item', 'parent_item__version', 'project', 'create_user', 'update_user')
            .filter(parent_item__version_id=obj.id)
            .order_by('parent_item__priority', 'create_time', 'id')
        )
        if not sub_qs.exists() and len(family_ids) > 1:
            sub_qs = (
                Version_Schedule.objects.select_related('parent_item', 'parent_item__version', 'project', 'create_user', 'update_user')
                .filter(parent_item__version_id__in=family_ids)
                .order_by('parent_item__priority', 'create_time', 'id')
            )
        # Group sub-schedules by root family (so each sub-schedule family appears once with its latest version & version count)
        sub_families = {}
        for s_ver in sub_qs:
            root_sub_id = s_ver.parent_id or s_ver.id
            sub_families.setdefault(root_sub_id, []).append(s_ver)
        sub_summaries = []
        for root_sub_id, members in sub_families.items():
            latest = members[-1]
            s_stage = latest.get_stage_info()
            sub_summaries.append({
                'id': latest.id,
                'project_name': latest.display_name,
                'parent_item_id': latest.parent_item_id,
                'parent_item_name': latest.parent_item.name if latest.parent_item else '',
                'parent_item_duration': int(latest.parent_item.duration or 0) if latest.parent_item else 0,
                'parent_version_number': latest.parent_item.version.get_version_number() if (latest.parent_item and latest.parent_item.version) else 1,
                'duration': latest.duration,
                'version_number': len(members),
                'version_count': len(members),
                'stage_code': s_stage['code'],
                'stage_label': s_stage['label'],
                'overrun_days': latest.get_parent_overrun_days(),
                'update_time': latest.update_time.isoformat() if latest.update_time else '',
            })
        data['sub_schedules'] = sub_summaries
        data['sub_schedule_count'] = len(sub_summaries)
    return data


def serialize_schedule_item(obj, extra=None, sub_map=None):
    items = obj.read_deep_sub_item_in_list()
    delete_ids = '.'.join([str(i.id) for i in items])
    if sub_map is not None:
        linked_subs = sub_map.get(obj.id, [])
    else:
        linked_subs = list(obj.sub_schedules.all().order_by('create_time', 'id'))
    latest_sub = None
    if linked_subs:
        last = linked_subs[-1]
        st = last.get_stage_info()
        latest_sub = {
            'id': last.id,
            'project_name': last.display_name,
            'duration': int(last.duration or 0),
            'version_number': last.get_version_number(),
            'cpm_locked': bool(last.cpm_locked),
            'gantt_locked': bool(last.gantt_locked),
            'stage_code': st['code'],
            'stage_label': st['label'],
        }
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
        'sub_schedule_count': len(linked_subs),
        'latest_sub_schedule': latest_sub,
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
        qs = Version_Schedule.objects.select_related(
            'project', 'create_user', 'update_user', 'parent', 'parent_item', 'parent_item__version'
        ).all()
        tree_mode = request.GET.get('tree') == '1'
        name_q = request.GET.get('p__name__icontains', '').strip()
        if name_q:
            qs = qs.filter(
                Q(project__name__icontains=name_q)
                | Q(project_name__icontains=name_q)
                | Q(parent_item__name__icontains=name_q)
            ).distinct()

        project_q = request.GET.get('project', '').strip()
        if project_q:
            pid = _extract_id(project_q)
            if pid:
                qs = qs.filter(project_id=pid)

        if tree_mode and not name_q:
            # In WBS tree mode (without active search filter), list top-level root schedules only;
            # their sibling versions & WBS sub-schedules are returned nested inside each card.
            qs = qs.filter(parent_item__isnull=True, parent__isnull=True)

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

        serialized_objects = []
        for o in page_qs:
            # In tree mode, display the LATEST version of each schedule family as the primary card
            display_obj = o.get_last_version() if (tree_mode and not name_q) else o
            serialized_objects.append(serialize_version_schedule(display_obj, include_tree=tree_mode))

        return JsonResponse({
            'meta': {
                'limit': limit,
                'offset': offset,
                'total_count': total_count,
                'next': None,
                'previous': None,
            },
            'objects': serialized_objects,
        })

    if request.method == 'POST':
        data = _parse_json_body(request)
        pid = _extract_id(data.get('project'))
        project = Project.objects.filter(id=pid).first() if pid else None

        parent_item_id = _extract_id(data.get('parent_item'))
        parent_item = ScheduleItem.objects.select_related('version', 'version__project').filter(id=parent_item_id).first() if parent_item_id else None

        clone_id = _extract_id(data.get('clone_version'))
        pre_version = Version_Schedule.objects.select_related('project', 'parent', 'parent_item').filter(id=clone_id).first() if clone_id else None

        parent_version = None
        if data.get('as_new_version') and pre_version:
            parent_version = pre_version.parent if pre_version.parent_id else pre_version
            if not parent_item and pre_version.parent_item_id:
                parent_item = pre_version.parent_item
            if not project and pre_version.project_id:
                project = pre_version.project

        if parent_item and not project and parent_item.version.project_id:
            project = parent_item.version.project

        project_name = data.get('project_name')
        if not project_name:
            if parent_item:
                project_name = f'{parent_item.version.display_name} - {parent_item.name}'
            elif pre_version:
                project_name = pre_version.display_name
            elif project:
                project_name = project.name
            else:
                project_name = ''

        setting_type = int(data.get('schedule_setting_type') or (pre_version.schedule_setting_type if pre_version else 1))

        if 'duration' in data and data['duration'] not in (None, ''):
            duration = int(data['duration'])
        elif parent_item and parent_item.duration:
            duration = int(parent_item.duration)
        elif pre_version and pre_version.duration:
            duration = int(pre_version.duration)
        elif project and project.duration:
            duration = int(project.duration)
        else:
            duration = 0

        user = request.user if request.user.is_authenticated else None
        obj = Version_Schedule.objects.create(
            parent=parent_version,
            parent_item=parent_item,
            project=project,
            project_name=project_name,
            schedule_setting_type=setting_type,
            duration=duration,
            create_user=user,
            update_user=user,
        )
        obj.create_root_item()

        if pre_version:
            obj.new_version_copy_pre_item(pre_version=pre_version)

        return JsonResponse(serialize_version_schedule(obj), status=201)

    return HttpResponse(status=405)


def _delete_version_schedule_cleanly(obj, _visited=None):
    """安全刪除預定進度版本（含子 PDM）：
    1. 若刪除的是版本鏈中的 v1 或中間版本，自動銜接其餘版本鏈（不打散版本家族）。
    2. 遞迴刪除掛載於此版本工項下的巢狀子 PDM，避免產生變成頂層專案的孤兒資料。
    """
    if _visited is None:
        _visited = set()
    if obj.id in _visited:
        return
    _visited.add(obj.id)

    # 1. Re-stitch own jsrcm version chain (parent -> schedule_parent)
    direct_children = list(obj.schedule_parent.all().order_by('create_time', 'id'))
    if direct_children:
        if obj.parent_id:
            obj.schedule_parent.update(parent_id=obj.parent_id)
        else:
            new_root = direct_children[0]
            new_root.parent = None
            new_root.save(update_fields=['parent'])
            for sibling in direct_children[1:]:
                sibling.parent = new_root
                sibling.save(update_fields=['parent'])

    # 2. Recursively delete nested WBS sub-schedules belonging to this version's items
    nested_subs = list(
        Version_Schedule.objects.filter(parent_item__version_id=obj.id).exclude(id=obj.id)
    )
    for sub in nested_subs:
        _delete_version_schedule_cleanly(sub, _visited=_visited)

    obj.delete()


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
        _delete_version_schedule_cleanly(obj)
        return JsonResponse({'status': True}, status=200)

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


@csrf_exempt
def version_schedule_toggle_cpm_lock(request, pk):
    """鎖定或解除鎖定 CPM 網圖（/schedule/api/active/version_schedule/<pk>/toggle_cpm_lock/）"""
    if request.method != 'POST':
        return HttpResponse(status=405)

    version = Version_Schedule.objects.filter(id=pk).first()
    if not version:
        return JsonResponse({'status': False, 'msg': '找不到此預定進度版本'}, status=404)

    data = _parse_json_body(request)
    action = str(data.get('action') or '').strip().lower()
    if action not in ('lock', 'unlock'):
        return JsonResponse({'status': False, 'msg': '無效的操作類型'}, status=400)

    if action == 'lock':
        checklist = version.get_cpm_lock_checklist()
        if not checklist['can_lock']:
            return JsonResponse(
                {
                    'status': False,
                    'msg': '尚未符合 CPM 鎖定條件，請先完成所有前置項目。',
                    'checklist': checklist,
                },
                status=400,
            )
        version.cpm_locked = True
        version.update_time = NOW()
        if request.user.is_authenticated:
            version.update_user = request.user
        version.save(update_fields=['cpm_locked', 'update_time', 'update_user'])
        _sync_cpm_links_to_items(version)
        return JsonResponse({
            'status': True,
            'cpm_locked': True,
            'gantt_locked': bool(version.gantt_locked),
            'checklist': version.get_cpm_lock_checklist(),
        })

    # unlock Step 1 -> also unlocks Step 2 (progressive order), WITHOUT invalidating cpm_release!
    # Also heal legacy rows where Step 2 link sync previously cleared cpm_release while locked.
    update_fields = ['cpm_locked', 'gantt_locked', 'update_time', 'update_user']
    if version.cpm_locked and not version.cpm_release:
        try:
            parsed_links = json.loads(version.cpm_link or '[]')
        except Exception:
            parsed_links = []
        has_cpm_values = version.scheduleitem_set.exclude(uplevel=None).exclude(kind_id=10).filter(ef__gt=0).exists()
        if parsed_links and has_cpm_values:
            version.cpm_release = True
            update_fields.append('cpm_release')

    version.cpm_locked = False
    version.gantt_locked = False
    version.update_time = NOW()
    if request.user.is_authenticated:
        version.update_user = request.user
    version.save(update_fields=update_fields)
    return JsonResponse({
        'status': True,
        'cpm_locked': False,
        'gantt_locked': False,
        'checklist': version.get_cpm_lock_checklist(),
    })


@csrf_exempt
def version_schedule_toggle_gantt_lock(request, pk):
    """鎖定或解除鎖定步驟 2「進度調整」（/schedule/api/active/version_schedule/<pk>/toggle_gantt_lock/）"""
    if request.method != 'POST':
        return HttpResponse(status=405)

    version = Version_Schedule.objects.filter(id=pk).first()
    if not version:
        return JsonResponse({'status': False, 'msg': '找不到此預定進度版本'}, status=404)

    data = _parse_json_body(request)
    action = str(data.get('action') or '').strip().lower()
    if action not in ('lock', 'unlock'):
        return JsonResponse({'status': False, 'msg': '無效的操作類型'}, status=400)

    if action == 'lock':
        if not version.cpm_locked:
            return JsonResponse(
                {
                    'status': False,
                    'msg': '請先完成並鎖定步驟 1「邏輯網圖」，才可鎖定步驟 2「進度調整」。',
                    'checklist': version.get_cpm_lock_checklist(),
                },
                status=400,
            )
        version.gantt_locked = True
        version.update_time = NOW()
        if request.user.is_authenticated:
            version.update_user = request.user
        version.save(update_fields=['gantt_locked', 'update_time', 'update_user'])
        return JsonResponse({
            'status': True,
            'cpm_locked': True,
            'gantt_locked': True,
            'checklist': version.get_cpm_lock_checklist(),
        })

    # unlock Step 2 (keeps Step 1 cpm_locked intact)
    version.gantt_locked = False
    version.update_time = NOW()
    if request.user.is_authenticated:
        version.update_user = request.user
    version.save(update_fields=['gantt_locked', 'update_time', 'update_user'])
    return JsonResponse({
        'status': True,
        'cpm_locked': bool(version.cpm_locked),
        'gantt_locked': False,
        'checklist': version.get_cpm_lock_checklist(),
    })


def _update_single_schedule_item(item, data, user=None):
    """套用單筆 ScheduleItem 更新邏輯（與 jsrcm ScheduleItemResource.obj_update 一致）"""
    is_patch = bool(data.get('is_patch'))
    old_cpm_sig = (
        int(item.es or 0),
        int(item.ef or 0),
        int(item.ls or 0),
        int(item.lf or 0),
        int(item.duration or 0),
        decimal.Decimal(str(item.unit_price or 0)),
        bool(item.cp),
        item.link or '[]',
    )

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

    new_cpm_sig = (
        int(item.es or 0),
        int(item.ef or 0),
        int(item.ls or 0),
        int(item.lf or 0),
        int(item.duration or 0),
        decimal.Decimal(str(item.unit_price or 0)),
        bool(item.cp),
        item.link or '[]',
    )
    cpm_logic_changed = (new_cpm_sig != old_cpm_sig)

    version = item.version
    version.update_time = NOW()
    if user and user.is_authenticated:
        version.update_user = user
    if data.get('cpm_float_shift') or not cpm_logic_changed:
        version.save(update_fields=['update_time', 'update_user'])
    else:
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

        page_list = list(page_qs)
        item_ids = [o.id for o in page_list]
        sub_map = {}
        if item_ids:
            for sv in Version_Schedule.objects.filter(parent_item_id__in=item_ids).order_by('create_time', 'id'):
                sub_map.setdefault(sv.parent_item_id, []).append(sv)

        return JsonResponse({
            'meta': {
                'limit': limit,
                'offset': offset,
                'total_count': total_count,
                'next': None,
                'previous': None,
            },
            'objects': [serialize_schedule_item(o, sub_map=sub_map) for o in page_list],
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
def scheduleitem_sub_schedules(request, pk):
    """查詢或建立連結至指定母 PDM 節點之 WBS 分項預定進度（支援多版本）。"""
    item = ScheduleItem.objects.select_related('version', 'version__project').filter(id=pk).first()
    if not item:
        return JsonResponse({'status': False, 'msg': '找不到此工項節點'}, status=404)

    if request.method == 'GET':
        subs = list(
            Version_Schedule.objects.select_related('parent', 'project', 'create_user', 'update_user')
            .filter(parent_item=item)
            .order_by('create_time', 'id')
        )
        parent_dur = int(item.duration or 0)
        sub_list = []
        total_subs = len(subs)
        for idx_s, sv in enumerate(subs):
            st = sv.get_stage_info()
            sub_list.append({
                'id': sv.id,
                'project_name': sv.display_name,
                'version_number': sv.get_version_number(),
                'is_latest': (idx_s == total_subs - 1),
                'duration': int(sv.duration or 0),
                'overrun_days': sv.get_parent_overrun_days(),
                'cpm_locked': bool(sv.cpm_locked),
                'gantt_locked': bool(sv.gantt_locked),
                'stage_code': st['code'],
                'stage_label': st['label'],
                'create_time': sv.create_time.isoformat() if sv.create_time else '',
                'update_time': sv.update_time.isoformat() if sv.update_time else '',
                'url': f'/schedule/item_profile/{sv.id}/',
            })
        sub_list.reverse()  # Show latest version first!
        return JsonResponse({
            'status': True,
            'item': {
                'id': item.id,
                'name': item.name,
                'duration': parent_dur,
                'es': int(item.es or 0) + 1,
                'ef': int(item.ef or 0),
                'unit_price': float(item.unit_price or 0),
                'version_id': item.version_id,
                'version_name': item.version.display_name,
            },
            'sub_schedules': sub_list,
        })

    if request.method == 'POST':
        data = _parse_json_body(request)
        user = request.user if request.user.is_authenticated else None
        clone_id = _extract_id(data.get('clone_version_id'))
        pre_version = Version_Schedule.objects.filter(id=clone_id, parent_item=item).first() if clone_id else None

        existing_root = (
            Version_Schedule.objects.filter(parent_item=item, parent__isnull=True).order_by('create_time', 'id').first()
        )
        parent_ver = None
        if pre_version:
            parent_ver = pre_version.parent if pre_version.parent_id else pre_version
        elif existing_root:
            parent_ver = existing_root

        default_name = f'{item.version.display_name} - {item.name}'
        project_name = str(data.get('project_name') or '').strip() or (pre_version.display_name if pre_version else default_name)
        duration = int(data.get('duration') or (pre_version.duration if pre_version else item.duration) or 30)

        new_sub = Version_Schedule.objects.create(
            parent=parent_ver,
            parent_item=item,
            project=item.version.project,
            project_name=project_name,
            schedule_setting_type=1,
            duration=duration,
            create_user=user,
            update_user=user,
        )
        new_sub.create_root_item()
        if pre_version:
            new_sub.new_version_copy_pre_item(pre_version=pre_version)

        return JsonResponse({
            'status': True,
            'version': serialize_version_schedule(new_sub),
            'url': f'/schedule/item_profile/{new_sub.id}/',
        }, status=201)

    return HttpResponse(status=405)


@csrf_exempt
def version_schedule_wbs_tree(request, pk):
    """取得指定預定進度及其所有 WBS 分項子網圖之完整樹狀結構。"""
    if request.method != 'GET':
        return HttpResponse(status=405)
    version = Version_Schedule.objects.filter(id=pk).first()
    if not version:
        return JsonResponse({'status': False, 'msg': '找不到此預定進度版本'}, status=404)
    return JsonResponse({'status': True, 'tree': serialize_wbs_tree(version)})


@csrf_exempt
def version_schedule_wbs_action(request, pk):
    """執行 WBS 工項架構規劃頁的結構與數值調整操作。"""
    if request.method != 'POST':
        return HttpResponse(status=405)
    version = Version_Schedule.objects.filter(id=pk).first()
    if not version:
        return JsonResponse({'status': False, 'msg': '找不到此預定進度版本'}, status=404)
    payload = _parse_json_body(request)
    result = apply_wbs_action(version, payload, user=request.user)
    status_code = 200 if result.get('status') else 400
    return JsonResponse(result, status=status_code)


@csrf_exempt
def version_schedule_import_wbs_json(request, pk):
    """直接以 JSON 文字／Payload 匯入（自動識別 wbs-import-1.0、2.0-wbs 與舊版 jsrcm）。"""
    if request.method != 'POST':
        return HttpResponse(status=405)
    version = Version_Schedule.objects.filter(id=pk).first()
    if not version:
        return JsonResponse({'status': False, 'msg': '找不到此預定進度版本'}, status=404)
    if version.cpm_locked:
        return JsonResponse({'status': False, 'msg': '此版本邏輯網圖已鎖定，請先解除鎖定後再匯入'}, status=400)
    payload = _parse_json_body(request)
    raw_data = payload.get('data') if isinstance(payload, dict) and 'data' in payload else payload
    if isinstance(raw_data, str):
        try:
            raw_data = json.loads(raw_data)
        except Exception as exc:
            return JsonResponse({'status': False, 'msg': f'JSON 格式解析失敗：{exc}'}, status=400)
    result = import_json_into_version(version, raw_data, user=request.user)
    if result.get('status'):
        result['tree'] = serialize_wbs_tree(version)
        return JsonResponse(result)
    return JsonResponse(result, status=400)


@csrf_exempt
def dailyreport_version_stub(request):
    """相容 manage_schedule.js 查詢契約版本的端點（簡化專案無 dailyreport 模組，回傳空清單）。"""
    return JsonResponse({'meta': {'total_count': 0}, 'objects': []})
