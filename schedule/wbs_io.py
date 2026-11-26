# -*- coding: utf-8 -*-
"""
WBS 階層式母子預定進度引擎與雙格式 JSON 匯出／匯入模組（100% 向下相容 jsrcm）。

支援三種 JSON 格式：
1. 舊版 jsrcm 精靈檔（items + start_end_node + cpm_link）：單層完整還原。
2. 新版完整 WBS 母子備份檔（schema_version = "2.0-wbs"）：相容舊版欄位，並在節點上遞迴攜帶 sub_schedule。
3. 精簡 WBS 樹狀匯入檔（schema_version = "wbs-import-1.0"，含 wbs_nodes）：
   專為外部系統、Excel 轉換或 AI 產生之階層工項規劃設計，匯入時自動建立母子 PDM 與前後置連線。
"""
import base64
import datetime
import decimal
import json
from io import BytesIO

from django.core.files.uploadedfile import InMemoryUploadedFile
from django.db import transaction

from schedule.models import (
    NOW,
    ScheduleItem,
    Version_Schedule,
    get_dir_kind,
    get_item_kind,
    round_fix,
)


def _sync_links_for_version(version_obj):
    """與 ScheduleItem.link 同步 CPM 連線（避免循環 import）。"""
    sch_items = list(version_obj.scheduleitem_set.all().exclude(uplevel=None))
    item_map = {i.id: i for i in sch_items}
    link_mapping = {}
    try:
        cpm_links = json.loads(version_obj.cpm_link or '[]')
    except Exception:
        cpm_links = []
    modes = ['FS', 'SS', 'FF', 'SF']
    for lnk in cpm_links:
        frm = lnk.get('from')
        to = lnk.get('to')
        if frm == 'start' or to == 'end':
            continue
        if frm not in item_map or to not in item_map:
            continue
        mode = lnk.get('mode', 'FS')
        mode_idx = modes.index(mode) if mode in modes else 0
        link_mapping.setdefault(frm, []).append({
            'source': frm,
            'target': to,
            'type': str(mode_idx),
        })
    for it in sch_items:
        it.link = json.dumps(link_mapping.get(it.id, []))
    if sch_items:
        ScheduleItem.objects.bulk_update(sch_items, ['link'])


def _recalc_root_weight(version_obj):
    root = version_obj.scheduleitem_set.filter(uplevel=None).order_by('id').first()
    if not root:
        return decimal.Decimal('0')
    total = sum(
        (decimal.Decimal(str(i.unit_price or 0)) for i in version_obj.scheduleitem_set.exclude(uplevel=None).exclude(kind_id=10)),
        decimal.Decimal('0'),
    )
    root.unit_price = total
    root.save(update_fields=['unit_price'])
    return total


def _resequence_priorities(version_obj):
    leaves = list(
        version_obj.scheduleitem_set.exclude(uplevel=None).exclude(kind_id=10).order_by('priority', 'id')
    )
    for idx, it in enumerate(leaves):
        it.priority = idx
    if leaves:
        ScheduleItem.objects.bulk_update(leaves, ['priority'])


def _get_latest_sub_map(item_ids):
    """批次查出各母節點對應的最新分項版本（避免 N+1 查詢）。"""
    if not item_ids:
        return {}
    by_item = {}
    qs = Version_Schedule.objects.filter(parent_item_id__in=item_ids).order_by('create_time', 'id')
    for sv in qs:
        by_item.setdefault(sv.parent_item_id, []).append(sv)
    return by_item


def _resolve_version_budget(version, parent_budget=None):
    """計算此層級對應之核定預算金額（元）：
    - 若由上層傳入 parent_budget，直接沿用（避免重複計算）。
    - 若為直接開啟的分項子網圖，從最頂層工程契約金額依各祖先節點權重比例推算。
    """
    if parent_budget is not None:
        return float(parent_budget)
    base_price = float(version.read_engs_price() or 0)
    if base_price <= 0:
        return 0.0
    budget = base_price
    for anc in version.get_wbs_ancestors():
        budget *= float(anc.get('item_weight') or 0) / 100.0
    return budget


def serialize_wbs_tree(version, prefix='', depth=0, visited=None, parent_budget=None):
    """遞迴序列化母子 WBS 樹狀結構，供「0. WBS 工項架構」互動表格使用。
    直接利用已載入之 ScheduleItem 欄位計算要徑、預定開始/結束與換算價格，零額外 SQL 查詢。
    """
    if visited is None:
        visited = set()
    if version.id in visited or depth > 6:
        return None
    visited = visited | {version.id}

    version.create_root_item()
    leaves = list(
        version.scheduleitem_set.exclude(uplevel=None).exclude(kind_id=10).order_by('priority', 'id')
    )
    sub_map = _get_latest_sub_map([i.id for i in leaves])

    level_budget = _resolve_version_budget(version, parent_budget=parent_budget)
    weight_total = float(sum((float(i.unit_price or 0) for i in leaves), 0.0))
    weight_diff = round_fix(weight_total - 100.0, 4)
    weight_valid = abs(weight_total - 100.0) < 1e-4
    stage = version.get_stage_info()
    cpm_max_day = max((int(i.lf or i.ef or 0) for i in leaves), default=0)

    is_cpm_mode = (int(version.schedule_setting_type or 1) == 1)
    has_schedule_result = (
        bool(version.cpm_release or version.cpm_locked)
        if is_cpm_mode
        else bool(leaves)
    )

    nodes = []
    valid_starts = []
    valid_ends = []
    for idx, it in enumerate(leaves):
        code = f'{prefix}.{idx + 1}' if prefix else str(idx + 1)
        subs = sub_map.get(it.id, [])
        latest_sub = subs[-1] if subs else None
        weight_val = float(it.unit_price or 0)
        node_budget = (level_budget * (weight_val / 100.0)) if level_budget > 0 else 0.0
        sub_tree = (
            serialize_wbs_tree(
                latest_sub,
                prefix=code,
                depth=depth + 1,
                visited=visited,
                parent_budget=node_budget if level_budget > 0 else 0.0,
            )
            if latest_sub
            else None
        )

        plan_start = None
        plan_end = None
        float_days = None
        if has_schedule_result and (int(it.ef or 0) > 0 or int(it.lf or 0) > 0):
            plan_start = (int(it.es or 0) + 1) if is_cpm_mode else max(1, int(it.es or 1))
            plan_end = int(it.ef or 0)
            if plan_end < plan_start:
                plan_end = plan_start + max(1, int(it.duration or 1)) - 1
            float_days = max(0, int(it.lf or plan_end) - plan_end) if is_cpm_mode else 0
            valid_starts.append(plan_start)
            valid_ends.append(plan_end)

        nodes.append({
            'id': it.id,
            'version_id': version.id,
            'wbs_code': code,
            'depth': depth,
            'priority': it.priority,
            'name': it.name or '',
            'duration': int(it.duration or 1),
            'unit_price': weight_val,
            'allocated_price': round(node_budget) if level_budget > 0 else None,
            'es': int(it.es or 0),
            'ef': int(it.ef or 0),
            'ls': int(it.ls or 0),
            'lf': int(it.lf or 0),
            'plan_start': plan_start,
            'plan_end': plan_end,
            'float_days': float_days,
            'cp': bool(it.cp) if has_schedule_result else False,
            'has_result': plan_start is not None,
            'sub_version_count': len(subs),
            'sub_schedule': sub_tree,
        })

    return {
        'version_id': version.id,
        'version_number': version.get_version_number(),
        'project_name': version.display_name,
        'duration': int(version.duration or 0),
        'cpm_max_day': cpm_max_day,
        'cpm_release': bool(version.cpm_release),
        'has_schedule_result': has_schedule_result,
        'plan_start': min(valid_starts) if valid_starts else None,
        'plan_end': max(valid_ends) if valid_ends else None,
        'budget': round(level_budget) if level_budget > 0 else None,
        'cpm_locked': bool(version.cpm_locked),
        'gantt_locked': bool(version.gantt_locked),
        'editable': not bool(version.cpm_locked),
        'stage_code': stage['code'],
        'stage_label': stage['label'],
        'parent_item_id': version.parent_item_id,
        'parent_item_duration': int(version.parent_item.duration or 0) if version.parent_item_id and version.parent_item else 0,
        'overrun_days': version.get_parent_overrun_days(),
        'weight_total': round_fix(weight_total, 4),
        'weight_diff': weight_diff,
        'weight_valid': weight_valid,
        'node_count': len(nodes),
        'url': f'/schedule/item_profile/{version.id}/',
        'nodes': nodes,
    }


def export_version_json_payload(version, include_sub_schedules=False, include_file=False, visited=None):
    """匯出完整 jsrcm 相容 JSON；當 include_sub_schedules=True 時遞迴附加 sub_schedule（schema 2.0-wbs）。"""
    if visited is None:
        visited = set()
    visited = visited | {version.id}

    version.create_root_item()
    root_item = version.scheduleitem_set.filter(uplevel=None).order_by('id').first()
    if version.need_recount_esef:
        root_item.update_es_ef()
        version.need_recount_esef = False
        version.save(update_fields=['need_recount_esef'])

    data = {
        'items': [],
        'project_name': version.display_name,
        'duration': int(version.duration or 0),
        'start_end_node': version.start_end_node or '{}',
        'cpm_link': version.cpm_link or '[]',
        'schedule_setting_type': version.schedule_setting_type,
    }
    if include_sub_schedules:
        data['schema_version'] = '2.0-wbs'

    subs = root_item.schedule_scheduleitem_uplevel.all().order_by('priority', 'id')
    while subs.exists():
        level_rows = list(subs)
        sub_map = _get_latest_sub_map([i.id for i in level_rows]) if include_sub_schedules else {}
        tmp = []
        for idx, i in enumerate(level_rows):
            dur = i.duration if version.schedule_setting_type == 1 else (i.ef - i.es + 1)
            row_dict = {
                'id': i.id,
                'wbs_code': str(idx + 1),
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
            }
            if include_sub_schedules:
                linked_subs = sub_map.get(i.id, [])
                if linked_subs and linked_subs[-1].id not in visited:
                    row_dict['sub_schedule'] = export_version_json_payload(
                        linked_subs[-1],
                        include_sub_schedules=True,
                        include_file=False,
                        visited=visited,
                    )
            tmp.append(row_dict)
        data['items'].append(tmp)
        subs = ScheduleItem.objects.filter(uplevel__in=level_rows).order_by('uplevel__priority', 'priority', 'id')

    if include_file and version.schedule_setting_type == 1 and version.file:
        try:
            with open(version.get_file_path(), 'rb') as f:
                data['version_file'] = base64.b64encode(f.read()).decode('utf-8')
        except Exception:
            pass

    return data


def build_wbs_import_template(version=None):
    """產生精簡 WBS 樹狀匯入 JSON（schema_version = wbs-import-1.0），供外部系統或 AI 產出對接。"""
    def _version_to_wbs_nodes(ver, prefix='', visited=None):
        if visited is None:
            visited = set()
        if ver.id in visited:
            return []
        visited = visited | {ver.id}
        leaves = list(ver.scheduleitem_set.exclude(uplevel=None).exclude(kind_id=10).order_by('priority', 'id'))
        if not leaves:
            return []
        sub_map = _get_latest_sub_map([i.id for i in leaves])
        id_to_code = {}
        for idx, it in enumerate(leaves):
            id_to_code[it.id] = f'{prefix}.{idx + 1}' if prefix else str(idx + 1)

        preds_by_id = {}
        try:
            for lnk in json.loads(ver.cpm_link or '[]'):
                frm, to = lnk.get('from'), lnk.get('to')
                if frm in id_to_code and to in id_to_code:
                    mode = lnk.get('mode', 'FS')
                    lag = int(lnk.get('lag') or 0)
                    if mode == 'FS' and lag == 0:
                        preds_by_id.setdefault(to, []).append(id_to_code[frm])
                    else:
                        preds_by_id.setdefault(to, []).append({'code': id_to_code[frm], 'mode': mode, 'lag': lag})
        except Exception:
            pass

        result = []
        for it in leaves:
            code = id_to_code[it.id]
            linked = sub_map.get(it.id, [])
            children = _version_to_wbs_nodes(linked[-1], prefix=code, visited=visited) if linked else []
            node = {
                'wbs_code': code,
                'name': it.name or '未命名工項',
                'duration': int(it.duration or 1),
                'weight': float(it.unit_price or 0),
                'predecessors': preds_by_id.get(it.id, []),
            }
            if children:
                node['children'] = children
            result.append(node)
        return result

    if version is not None:
        existing_nodes = _version_to_wbs_nodes(version)
        if existing_nodes:
            return {
                'schema_version': 'wbs-import-1.0',
                'project_name': version.display_name,
                'duration': int(version.duration or 180),
                'wbs_nodes': existing_nodes,
            }

    return {
        'schema_version': 'wbs-import-1.0',
        'project_name': (version.display_name if version else '範例工程預定進度'),
        'duration': int(version.duration or 180) if version else 180,
        'wbs_nodes': [
            {
                'wbs_code': '1',
                'name': '假設與開工準備工程',
                'duration': 30,
                'weight': 15.0,
                'predecessors': [],
                'children': [
                    {'wbs_code': '1.1', 'name': '施工測量與放樣', 'duration': 10, 'weight': 35.0, 'predecessors': []},
                    {'wbs_code': '1.2', 'name': '圍籬與工務所設置', 'duration': 20, 'weight': 65.0, 'predecessors': ['1.1']},
                ],
            },
            {
                'wbs_code': '2',
                'name': '主體結構與排水工程',
                'duration': 110,
                'weight': 65.0,
                'predecessors': ['1'],
                'children': [
                    {'wbs_code': '2.1', 'name': '基礎開挖與墊層', 'duration': 30, 'weight': 25.0, 'predecessors': []},
                    {'wbs_code': '2.2', 'name': '主體結構鋼筋混凝土', 'duration': 55, 'weight': 50.0, 'predecessors': ['2.1']},
                    {'wbs_code': '2.3', 'name': '附屬排水設施施工', 'duration': 25, 'weight': 25.0, 'predecessors': [{'code': '2.2', 'mode': 'FS', 'lag': 0}]},
                ],
            },
            {
                'wbs_code': '3',
                'name': '路面復舊與完工驗收',
                'duration': 40,
                'weight': 20.0,
                'predecessors': ['2'],
                'children': [],
            },
        ],
    }


def _import_wbs_nodes_recursive(version, wbs_nodes, user=None, depth=0):
    """將精簡樹狀 wbs_nodes 遞迴寫入 version 與其各分項子 Version_Schedule。"""
    if depth > 6:
        return 0, 0
    item_kind = get_item_kind()
    version.create_root_item()
    root_item = version.scheduleitem_set.filter(uplevel=None).order_by('id').first()

    # 清除舊工項（保留母節點關聯但解除舊子網圖的 parent_item 以免孤兒碰撞）
    old_item_ids = list(version.scheduleitem_set.exclude(uplevel=None).values_list('id', flat=True))
    if old_item_ids:
        Version_Schedule.objects.filter(parent_item_id__in=old_item_ids).update(parent_item=None)
    version.scheduleitem_set.exclude(uplevel=None).delete()

    created_count = 0
    created_subs = 0
    code_to_item = {}
    ordered_nodes = []

    for idx, raw in enumerate(wbs_nodes):
        if not isinstance(raw, dict):
            continue
        code = str(raw.get('wbs_code') or raw.get('code') or (idx + 1)).strip()
        name = str(raw.get('name') or f'工項 {code}').replace('\r', '').replace('\n', '').strip()
        dur = max(1, int(round(float(raw.get('duration') or 1))))
        weight_raw = raw.get('weight') if raw.get('weight') is not None else raw.get('unit_price', 0)
        weight = decimal.Decimal(str(float(weight_raw or 0))).quantize(decimal.Decimal('0.01'))

        # Clean default grid coordinates for GoJS PDM
        col = idx % 6
        row = idx // 6
        loc = f'{260 + col * 260} {160 + row * 155}'

        it = ScheduleItem.objects.create(
            version=version,
            uplevel=root_item,
            kind=item_kind,
            priority=idx,
            is_main_item=True,
            name=name,
            unit_name='式',
            unit_num=decimal.Decimal('1'),
            unit_price=weight,
            es=0,
            ef=dur,
            ls=0,
            lf=dur,
            duration=dur,
            cp=False,
            location=loc,
            link='[]',
        )
        code_to_item[code] = it
        ordered_nodes.append((code, it, raw))
        created_count += 1

    # Build CPM links from `predecessors`
    cpm_links = []
    has_pred = set()
    has_succ = set()
    for code, it, raw in ordered_nodes:
        preds = raw.get('predecessors') or []
        if isinstance(preds, str):
            preds = [p.strip() for p in preds.split(',') if p.strip()]
        for p in preds:
            if isinstance(p, dict):
                p_code = str(p.get('code') or p.get('from') or '').strip()
                mode = str(p.get('mode') or 'FS').upper()
                lag = int(p.get('lag') or 0)
            else:
                p_code = str(p).strip()
                mode = 'FS'
                lag = 0
            if mode not in ('FS', 'SS', 'FF', 'SF'):
                mode = 'FS'
            if p_code in code_to_item and code_to_item[p_code].id != it.id:
                frm_id = code_to_item[p_code].id
                cpm_links.append({'from': frm_id, 'to': it.id, 'mode': mode, 'lag': lag})
                has_pred.add(it.id)
                has_succ.add(frm_id)

    if ordered_nodes:
        for _, it, _ in ordered_nodes:
            if it.id not in has_pred:
                cpm_links.append({'from': 'start', 'to': it.id, 'mode': 'FS', 'lag': 0})
            if it.id not in has_succ:
                cpm_links.append({'from': it.id, 'to': 'end', 'mode': 'FS', 'lag': 0})

    max_col = min(6, max(1, len(ordered_nodes)))
    version.start_end_node = json.dumps({
        'start_item': '40 160',
        'end_item': f'{260 + max_col * 260 + 80} 160',
    })
    version.cpm_link = json.dumps(cpm_links)
    version.cpm_release = False
    version.cpm_locked = False
    version.gantt_locked = False
    version.need_recount_esef = False
    version.update_time = NOW()
    if user and getattr(user, 'is_authenticated', False):
        version.update_user = user
    version.save()

    _sync_links_for_version(version)
    _recalc_root_weight(version)

    # Recursively create child sub-schedules for nodes with `children`
    for code, it, raw in ordered_nodes:
        children = raw.get('children') or []
        if isinstance(children, list) and len(children) > 0:
            sub_name = str(raw.get('sub_project_name') or f'{version.display_name} - {it.name}').strip()
            sub_ver = Version_Schedule.objects.create(
                parent=None,
                parent_item=it,
                project=version.project,
                project_name=sub_name,
                schedule_setting_type=1,
                duration=it.duration,
                create_user=user if (user and getattr(user, 'is_authenticated', False)) else None,
                update_user=user if (user and getattr(user, 'is_authenticated', False)) else None,
            )
            sub_ver.create_root_item()
            created_subs += 1
            c_items, c_subs = _import_wbs_nodes_recursive(sub_ver, children, user=user, depth=depth + 1)
            created_count += c_items
            created_subs += c_subs

    return created_count, created_subs


def _import_legacy_or_v2_json(version, data, user=None, depth=0):
    """還原舊版 jsrcm JSON/SCPM 或 2.0-wbs（含遞迴 sub_schedule）。"""
    if depth > 6:
        return 0, 0
    dir_kind = get_dir_kind()
    item_kind = get_item_kind()

    version.create_root_item()
    root_item = version.scheduleitem_set.filter(uplevel=None).order_by('id').first()
    from_schedule_setting_type = data.get('schedule_setting_type', 0)

    old_item_ids = list(version.scheduleitem_set.exclude(uplevel=None).values_list('id', flat=True))
    if old_item_ids:
        Version_Schedule.objects.filter(parent_item_id__in=old_item_ids).update(parent_item=None)
    version.scheduleitem_set.exclude(uplevel=None).delete()

    id_mapping = {}
    cpm_id_mapping = {}
    sub_schedule_queue = []  # (created_item, sub_schedule_dict)
    created_count = 0
    created_subs = 0

    for level_n, level_item in enumerate(data['items']):
        c_objects = []
        uplevel_ids = []
        for obj in level_item:
            obj = dict(obj)
            if from_schedule_setting_type == 1 and version.schedule_setting_type != 1:
                obj['ls'] = int(obj.get('ls', 0)) + 1
                obj['es'] = obj['ls']
                obj['ef'] = int(obj.get('lf', 1))
            elif from_schedule_setting_type != 1 and version.schedule_setting_type == 1:
                obj['es'] = max(0, int(obj.get('es', 1)) - 1)
                obj['ls'] = obj['es']
                obj['lf'] = int(obj.get('ef', 1))

            row = ScheduleItem(
                version=version,
                is_main_item=obj.get('is_main_item', True),
                name=obj.get('name', ''),
                unit_price=decimal.Decimal(str(obj.get('unit_price', 0))),
                es=int(obj.get('es', 0)),
                ef=int(obj.get('ef', 1)),
                ls=int(obj.get('ls', 0)),
                lf=int(obj.get('lf', 1)),
                kind=dir_kind if obj.get('kind') == 10 else item_kind,
                uplevel=root_item if level_n == 0 else id_mapping[obj['uplevel']],
                priority=int(obj.get('priority', 0)),
                link=obj.get('link', '[]'),
                cp=bool(obj.get('cp', False)),
                duration=int(obj.get('duration', 1)),
                location=obj.get('location', ''),
            )
            if row.uplevel.id not in uplevel_ids:
                uplevel_ids.append(row.uplevel.id)
            c_objects.append(row)

        ScheduleItem.objects.bulk_create(c_objects)
        created_rows = list(
            version.scheduleitem_set.filter(uplevel_id__in=uplevel_ids).order_by('uplevel__priority', 'priority', 'id')
        )
        created_count += len(created_rows)
        for n, i in enumerate(created_rows):
            if n < len(level_item):
                id_mapping[level_item[n]['id']] = i
                if 'cpm_item__id' in level_item[n]:
                    cpm_id_mapping[level_item[n]['cpm_item__id']] = i
                if isinstance(level_item[n].get('sub_schedule'), dict):
                    sub_schedule_queue.append((i, level_item[n]['sub_schedule']))

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
        i.save(update_fields=['link'])

    version.start_end_node = data.get('start_end_node', '{}')
    if data.get('duration') and int(data.get('duration') or 0) > 0:
        version.duration = int(data['duration'])

    if version.schedule_setting_type == 1:
        new_cpm_link = []
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
            version.cpm_release = True

    root_item.update_es_ef()
    _recalc_root_weight(version)
    version.need_recount_esef = False
    version.cpm_locked = False
    version.gantt_locked = False
    version.update_time = NOW()
    if user and getattr(user, 'is_authenticated', False):
        version.update_user = user
    version.save()

    if version.schedule_setting_type == 1:
        _sync_links_for_version(version)

    # Recursively import attached WBS sub-schedules (schema 2.0-wbs)
    for parent_node, sub_data in sub_schedule_queue:
        sub_ver = Version_Schedule.objects.create(
            parent=None,
            parent_item=parent_node,
            project=version.project,
            project_name=str(sub_data.get('project_name') or f'{version.display_name} - {parent_node.name}'),
            schedule_setting_type=int(sub_data.get('schedule_setting_type') or 1),
            duration=int(sub_data.get('duration') or parent_node.duration or 30),
            create_user=user if (user and getattr(user, 'is_authenticated', False)) else None,
            update_user=user if (user and getattr(user, 'is_authenticated', False)) else None,
        )
        sub_ver.create_root_item()
        created_subs += 1
        c_items, c_subs = _import_legacy_or_v2_json(sub_ver, sub_data, user=user, depth=depth + 1)
        created_count += c_items
        created_subs += c_subs

    return created_count, created_subs


@transaction.atomic
def import_json_into_version(version, data, user=None):
    """統一自動判別 JSON 格式並匯入（支援 wbs-import-1.0、2.0-wbs 與舊版 jsrcm JSON/SCPM）。"""
    if not isinstance(data, dict):
        return {'status': False, 'msg': '匯入失敗，JSON 根結構須為物件'}

    if 'wbs_nodes' in data:
        wbs_nodes = data.get('wbs_nodes')
        if not isinstance(wbs_nodes, list) or len(wbs_nodes) == 0:
            return {'status': False, 'msg': '匯入失敗，wbs_nodes 不可為空'}
        if data.get('duration') and int(data.get('duration') or 0) > 0:
            version.duration = int(data['duration'])
            version.save(update_fields=['duration'])
        c_items, c_subs = _import_wbs_nodes_recursive(version, wbs_nodes, user=user, depth=0)
        return {
            'status': True,
            'format': 'wbs-import-1.0',
            'created_items': c_items,
            'created_sub_schedules': c_subs,
        }

    if 'items' in data and 'start_end_node' in data:
        c_items, c_subs = _import_legacy_or_v2_json(version, data, user=user, depth=0)
        fmt = '2.0-wbs' if (c_subs > 0 or data.get('schema_version') == '2.0-wbs') else 'jsrcm-legacy'
        return {
            'status': True,
            'format': fmt,
            'created_items': c_items,
            'created_sub_schedules': c_subs,
        }

    return {'status': False, 'msg': '匯入失敗，檔案格式錯誤（須含 wbs_nodes 或 items / start_end_node）'}


@transaction.atomic
def apply_wbs_action(root_version, payload, user=None):
    """執行 WBS 工項架構規劃頁的結構與欄位編輯操作。"""
    action = str(payload.get('action') or '').strip()
    target_ver_id = int(payload.get('target_version_id') or root_version.id)
    target_ver = Version_Schedule.objects.filter(id=target_ver_id).first()
    if not target_ver:
        return {'status': False, 'msg': '找不到指定的預定進度層級'}

    item_kind = get_item_kind()
    target_ver.create_root_item()
    root_item = target_ver.scheduleitem_set.filter(uplevel=None).order_by('id').first()

    if action == 'save_items':
        rows = payload.get('items') or []
        touched_versions = set()
        for r in rows:
            item_id = r.get('id')
            it = ScheduleItem.objects.select_related('version').filter(id=item_id).first()
            if not it or it.version.cpm_locked:
                continue
            old_sig = (it.name, int(it.duration or 0), decimal.Decimal(str(it.unit_price or 0)))
            if 'name' in r and r['name'] is not None:
                it.name = str(r['name']).replace('\r', '').replace('\n', '').strip() or it.name
            if 'duration' in r and r['duration'] not in (None, ''):
                it.duration = max(1, int(round(float(r['duration']))))
                if int(it.ef or 0) <= int(it.es or 0):
                    it.ef = int(it.es or 0) + it.duration
            if 'unit_price' in r and r['unit_price'] not in (None, ''):
                it.unit_price = max(decimal.Decimal('0'), decimal.Decimal(str(float(r['unit_price']))).quantize(decimal.Decimal('0.01')))
            new_sig = (it.name, int(it.duration or 0), decimal.Decimal(str(it.unit_price or 0)))
            if new_sig != old_sig:
                it.save(update_fields=['name', 'duration', 'ef', 'unit_price'])
                touched_versions.add(it.version)

        for ver in touched_versions:
            _recalc_root_weight(ver)
            ver.cpm_release = False
            ver.update_time = NOW()
            ver.save(update_fields=['cpm_release', 'update_time'])
        return {'status': True, 'tree': serialize_wbs_tree(root_version)}

    if action == 'add_item':
        if target_ver.cpm_locked:
            return {'status': False, 'msg': '此層邏輯網圖已鎖定，請先解除鎖定再新增工項'}
        existing = list(target_ver.scheduleitem_set.exclude(uplevel=None).exclude(kind_id=10).order_by('priority', 'id'))
        next_prio = (existing[-1].priority + 1) if existing else 0
        col = len(existing) % 6
        row = len(existing) // 6
        name = str(payload.get('name') or f'新工項 {len(existing) + 1}').strip()
        dur = max(1, int(payload.get('duration') or 10))
        weight = decimal.Decimal(str(float(payload.get('unit_price') or 0))).quantize(decimal.Decimal('0.01'))
        new_it = ScheduleItem.objects.create(
            version=target_ver,
            uplevel=root_item,
            kind=item_kind,
            priority=next_prio,
            is_main_item=True,
            name=name,
            unit_name='式',
            unit_num=decimal.Decimal('1'),
            unit_price=weight,
            es=0,
            ef=dur,
            ls=0,
            lf=dur,
            duration=dur,
            cp=False,
            location=f'{260 + col * 260} {160 + row * 155}',
            link='[]',
        )
        _recalc_root_weight(target_ver)
        target_ver.cpm_release = False
        target_ver.update_time = NOW()
        target_ver.save(update_fields=['cpm_release', 'update_time'])
        return {'status': True, 'created_item_id': new_it.id, 'tree': serialize_wbs_tree(root_version)}

    if action == 'delete_item':
        item_id = payload.get('item_id')
        it = ScheduleItem.objects.select_related('version').filter(id=item_id).first()
        if not it:
            return {'status': False, 'msg': '找不到此工項'}
        ver = it.version
        if ver.cpm_locked:
            return {'status': False, 'msg': '此層邏輯網圖已鎖定，請先解除鎖定再刪除工項'}
        Version_Schedule.objects.filter(parent_item=it).update(parent_item=None)
        # Clean cpm_link references to deleted item
        try:
            links = [l for l in json.loads(ver.cpm_link or '[]') if l.get('from') != it.id and l.get('to') != it.id]
            ver.cpm_link = json.dumps(links)
        except Exception:
            pass
        it.delete()
        _resequence_priorities(ver)
        _recalc_root_weight(ver)
        ver.cpm_release = False
        ver.update_time = NOW()
        ver.save(update_fields=['cpm_link', 'cpm_release', 'update_time'])
        return {'status': True, 'tree': serialize_wbs_tree(root_version)}

    if action == 'balance_100':
        if target_ver.cpm_locked:
            return {'status': False, 'msg': '此層邏輯網圖已鎖定，無法配平權重'}
        leaves = list(target_ver.scheduleitem_set.exclude(uplevel=None).exclude(kind_id=10).order_by('priority', 'id'))
        if not leaves:
            return {'status': False, 'msg': '此層尚無工項可配平'}
        total = sum(float(i.unit_price or 0) for i in leaves)
        running = decimal.Decimal('0.00')
        for idx, it in enumerate(leaves):
            if idx == len(leaves) - 1:
                w = decimal.Decimal('100.00') - running
            elif total > 0:
                w = (decimal.Decimal(str(float(it.unit_price or 0) / total * 100.0))).quantize(decimal.Decimal('0.01'))
            else:
                w = (decimal.Decimal('100.00') / decimal.Decimal(str(len(leaves)))).quantize(decimal.Decimal('0.01'))
            it.unit_price = max(decimal.Decimal('0.00'), w)
            running += it.unit_price
        ScheduleItem.objects.bulk_update(leaves, ['unit_price'])
        _recalc_root_weight(target_ver)
        target_ver.cpm_release = False
        target_ver.update_time = NOW()
        target_ver.save(update_fields=['cpm_release', 'update_time'])
        return {'status': True, 'tree': serialize_wbs_tree(root_version)}

    if action == 'add_child_item':
        parent_it = ScheduleItem.objects.select_related('version', 'version__project').filter(id=payload.get('item_id')).first()
        if not parent_it:
            return {'status': False, 'msg': '找不到指定的母工項節點'}
        latest_sub = Version_Schedule.objects.filter(parent_item=parent_it).order_by('create_time', 'id').last()
        if not latest_sub:
            latest_sub = Version_Schedule.objects.create(
                parent=None,
                parent_item=parent_it,
                project=parent_it.version.project,
                project_name=f'{parent_it.version.display_name} - {parent_it.name}',
                schedule_setting_type=1,
                duration=int(parent_it.duration or 30),
                create_user=user if (user and getattr(user, 'is_authenticated', False)) else None,
                update_user=user if (user and getattr(user, 'is_authenticated', False)) else None,
            )
            latest_sub.create_root_item()
        elif latest_sub.cpm_locked:
            return {'status': False, 'msg': '該分項網圖已鎖定，請先進入分項解除鎖定後再新增子工項'}

        sub_root = latest_sub.scheduleitem_set.filter(uplevel=None).order_by('id').first()
        existing = list(latest_sub.scheduleitem_set.exclude(uplevel=None).exclude(kind_id=10).order_by('priority', 'id'))
        next_prio = (existing[-1].priority + 1) if existing else 0
        col = len(existing) % 6
        row = len(existing) // 6
        child_name = str(payload.get('name') or f'{parent_it.name} - 細項 {len(existing) + 1}').strip()
        child_dur = max(1, int(payload.get('duration') or max(1, int(parent_it.duration or 10) // 2)))
        ScheduleItem.objects.create(
            version=latest_sub,
            uplevel=sub_root,
            kind=item_kind,
            priority=next_prio,
            is_main_item=True,
            name=child_name,
            unit_name='式',
            unit_num=decimal.Decimal('1'),
            unit_price=decimal.Decimal('0.00'),
            es=0,
            ef=child_dur,
            ls=0,
            lf=child_dur,
            duration=child_dur,
            cp=False,
            location=f'{260 + col * 260} {160 + row * 155}',
            link='[]',
        )
        _recalc_root_weight(latest_sub)
        latest_sub.cpm_release = False
        latest_sub.update_time = NOW()
        latest_sub.save(update_fields=['cpm_release', 'update_time'])
        return {'status': True, 'sub_version_id': latest_sub.id, 'tree': serialize_wbs_tree(root_version)}

    if action == 'indent_item':
        # Demote item into previous sibling's sub-schedule
        it = ScheduleItem.objects.select_related('version', 'version__project').filter(id=payload.get('item_id')).first()
        if not it:
            return {'status': False, 'msg': '找不到此工項'}
        ver = it.version
        if ver.cpm_locked:
            return {'status': False, 'msg': '此層邏輯網圖已鎖定，請先解除鎖定再調整層級'}
        siblings = list(ver.scheduleitem_set.exclude(uplevel=None).exclude(kind_id=10).order_by('priority', 'id'))
        idx = next((k for k, s in enumerate(siblings) if s.id == it.id), -1)
        if idx <= 0:
            return {'status': False, 'msg': '此工項上方沒有同層母節點可供降階'}
        prev_sibling = siblings[idx - 1]
        latest_sub = Version_Schedule.objects.filter(parent_item=prev_sibling).order_by('create_time', 'id').last()
        if not latest_sub:
            latest_sub = Version_Schedule.objects.create(
                parent=None,
                parent_item=prev_sibling,
                project=ver.project,
                project_name=f'{ver.display_name} - {prev_sibling.name}',
                schedule_setting_type=1,
                duration=int(prev_sibling.duration or 30),
                create_user=user if (user and getattr(user, 'is_authenticated', False)) else None,
                update_user=user if (user and getattr(user, 'is_authenticated', False)) else None,
            )
            latest_sub.create_root_item()
        elif latest_sub.cpm_locked:
            return {'status': False, 'msg': '目標分項網圖已鎖定，無法降階移入'}

        sub_root = latest_sub.scheduleitem_set.filter(uplevel=None).order_by('id').first()
        sub_count = latest_sub.scheduleitem_set.exclude(uplevel=None).exclude(kind_id=10).count()
        # Clean old version links referencing moved item
        try:
            ver.cpm_link = json.dumps([l for l in json.loads(ver.cpm_link or '[]') if l.get('from') != it.id and l.get('to') != it.id])
        except Exception:
            pass
        it.version = latest_sub
        it.uplevel = sub_root
        it.priority = sub_count
        it.link = '[]'
        it.save(update_fields=['version', 'uplevel', 'priority', 'link'])
        _resequence_priorities(ver)
        _recalc_root_weight(ver)
        _recalc_root_weight(latest_sub)
        ver.cpm_release = False
        ver.update_time = NOW()
        ver.save(update_fields=['cpm_link', 'cpm_release', 'update_time'])
        latest_sub.cpm_release = False
        latest_sub.update_time = NOW()
        latest_sub.save(update_fields=['cpm_release', 'update_time'])
        return {'status': True, 'tree': serialize_wbs_tree(root_version)}

    if action == 'outdent_item':
        # Promote child item from a sub-schedule up to its parent schedule right after parent_item
        it = ScheduleItem.objects.select_related('version', 'version__parent_item', 'version__parent_item__version').filter(id=payload.get('item_id')).first()
        if not it:
            return {'status': False, 'msg': '找不到此工項'}
        sub_ver = it.version
        if not sub_ver.parent_item_id or not sub_ver.parent_item:
            return {'status': False, 'msg': '此工項已在最頂層，無法再升階'}
        parent_it = sub_ver.parent_item
        parent_ver = parent_it.version
        if sub_ver.cpm_locked or parent_ver.cpm_locked:
            return {'status': False, 'msg': '母層或分項網圖已鎖定，請先解除鎖定再調整層級'}

        parent_root = parent_ver.scheduleitem_set.filter(uplevel=None).order_by('id').first()
        try:
            sub_ver.cpm_link = json.dumps([l for l in json.loads(sub_ver.cpm_link or '[]') if l.get('from') != it.id and l.get('to') != it.id])
        except Exception:
            pass
        # Insert right after parent_it in parent_ver
        parent_siblings = list(parent_ver.scheduleitem_set.exclude(uplevel=None).exclude(kind_id=10).order_by('priority', 'id'))
        insert_pos = next((k + 1 for k, s in enumerate(parent_siblings) if s.id == parent_it.id), len(parent_siblings))
        it.version = parent_ver
        it.uplevel = parent_root
        it.link = '[]'
        it.save(update_fields=['version', 'uplevel', 'link'])
        parent_siblings.insert(insert_pos, it)
        for idx, s in enumerate(parent_siblings):
            s.priority = idx
        ScheduleItem.objects.bulk_update(parent_siblings, ['priority'])

        _resequence_priorities(sub_ver)
        _recalc_root_weight(sub_ver)
        _recalc_root_weight(parent_ver)
        sub_ver.cpm_release = False
        sub_ver.update_time = NOW()
        sub_ver.save(update_fields=['cpm_link', 'cpm_release', 'update_time'])
        parent_ver.cpm_release = False
        parent_ver.update_time = NOW()
        parent_ver.save(update_fields=['cpm_release', 'update_time'])
        return {'status': True, 'tree': serialize_wbs_tree(root_version)}

    return {'status': False, 'msg': f'不支援的 WBS 操作：{action}'}
