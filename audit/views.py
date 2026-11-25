import base64
import datetime
import json
from urllib.parse import quote

from django.contrib import messages
from django.core.files.base import ContentFile
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from core.models import Project

from .models import (
    AuditCase,
    AuditCaseDetail,
    AuditFault,
    AuditPhoto,
    AuditSignature,
    AuditTemplate,
    AuditTemplateCriterion,
    AuditTemplateStage,
)
from .services import export_case_excel, export_improve_docx, export_template_docx


def template_list(request):
    if request.method == 'POST':
        action = request.POST.get('action', 'create')
        user = request.user if request.user.is_authenticated else None

        if action == 'delete':
            tpl = get_object_or_404(AuditTemplate, id=request.POST.get('template_id'))
            name = tpl.name
            tpl.delete()
            messages.success(request, f'已刪除樣板「{name}」。')
            return redirect('audit:template_list')

        if action == 'clone':
            tpl = get_object_or_404(AuditTemplate, id=request.POST.get('template_id'))
            cloned = tpl.clone_template(user=user)
            messages.success(request, f'已複製建立樣板「{cloned.name}」。')
            return redirect('audit:template_edit', template_id=cloned.id)

        name = request.POST.get('name', '').strip()
        if not name:
            messages.error(request, '請輸入樣板名稱。')
            return redirect('audit:template_list')

        project_id = request.POST.get('project_id', '').strip()
        project = Project.objects.filter(id=project_id).first() if project_id else None
        check_type = request.POST.get('check_type', AuditTemplate.TYPE_SPOT_CHECK)
        tpl = AuditTemplate.objects.create(
            project=project,
            check_type=check_type,
            name=name,
            work_item_name=request.POST.get('work_item_name', '').strip(),
            note=request.POST.get('note', '').strip(),
            create_user=user,
            update_user=user,
        )
        tpl.init_defaults()
        messages.success(request, f'已建立樣板「{tpl.name}」，並自動建立預設階段與簽名欄。')
        return redirect('audit:template_edit', template_id=tpl.id)

    check_type = request.GET.get('check_type', '').strip()
    templates = AuditTemplate.objects.select_related('project').prefetch_related('stages__criteria')
    if check_type:
        templates = templates.filter(check_type=check_type)

    return render(request, 'audit/template_list.html', {
        'templates': templates,
        'projects': Project.objects.all(),
        'check_type': check_type,
    })


def template_edit(request, template_id):
    tpl = get_object_or_404(AuditTemplate.objects.select_related('project'), id=template_id)

    if request.method == 'POST':
        action = request.POST.get('action', 'update_meta')

        if action == 'update_meta':
            tpl.name = request.POST.get('name', tpl.name).strip() or tpl.name
            tpl.work_item_name = request.POST.get('work_item_name', '').strip()
            tpl.check_type = request.POST.get('check_type', tpl.check_type)
            tpl.note = request.POST.get('note', '').strip()
            project_id = request.POST.get('project_id', '').strip()
            tpl.project = Project.objects.filter(id=project_id).first() if project_id else None
            sigs = [s.strip() for s in request.POST.get('signature_labels_text', '').splitlines() if s.strip()]
            timings = [s.strip() for s in request.POST.get('timing_options_text', '').splitlines() if s.strip()]
            tpl.set_signature_labels(sigs)
            tpl.set_timing_options(timings)
            tpl.save()
            messages.success(request, '已更新樣板基本設定。')

        elif action == 'add_stage':
            sname = request.POST.get('stage_name', '').strip()
            if sname:
                last = tpl.stages.order_by('-priority').first()
                AuditTemplateStage.objects.create(
                    template=tpl, name=sname, priority=(last.priority + 1) if last else 1
                )
                messages.success(request, f'已新增檢查階段「{sname}」。')

        elif action == 'delete_stage':
            st = get_object_or_404(AuditTemplateStage, id=request.POST.get('stage_id'), template=tpl)
            st.delete()
            messages.success(request, '已刪除檢查階段。')

        elif action == 'add_criterion':
            stage = get_object_or_404(AuditTemplateStage, id=request.POST.get('stage_id'), template=tpl)
            cname = request.POST.get('criterion_name', '').strip()
            cstd = request.POST.get('criterion_standard', '').strip()
            if cname:
                last = stage.criteria.order_by('-priority').first()
                AuditTemplateCriterion.objects.create(
                    stage=stage, name=cname, standard=cstd, priority=(last.priority + 1) if last else 1
                )
                messages.success(request, f'已新增查驗細項「{cname}」。')

        elif action == 'update_criterion':
            crit = get_object_or_404(AuditTemplateCriterion, id=request.POST.get('criterion_id'), stage__template=tpl)
            crit.name = request.POST.get('criterion_name', crit.name).strip() or crit.name
            crit.standard = request.POST.get('criterion_standard', '').strip()
            crit.save(update_fields=['name', 'standard'])
            messages.success(request, '已更新查驗細項。')

        elif action == 'delete_criterion':
            crit = get_object_or_404(AuditTemplateCriterion, id=request.POST.get('criterion_id'), stage__template=tpl)
            crit.delete()
            messages.success(request, '已刪除查驗細項。')

        return redirect('audit:template_edit', template_id=tpl.id)

    stages = tpl.stages.prefetch_related('criteria').order_by('priority', 'id')
    return render(request, 'audit/template_edit.html', {
        'template': tpl,
        'stages': stages,
        'projects': Project.objects.all(),
        'signature_labels_text': '\n'.join(tpl.get_signature_labels()),
        'timing_options_text': '\n'.join(tpl.get_timing_options()),
    })


def template_export_docx(request, template_id):
    tpl = get_object_or_404(AuditTemplate, id=template_id)
    data = export_template_docx(tpl)
    filename = quote(f'抽查樣板_{tpl.name}.docx')
    resp = HttpResponse(
        data,
        content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    resp['Content-Disposition'] = f"attachment; filename*=UTF-8''{filename}"
    return resp


def case_list(request):
    if request.method == 'POST':
        action = request.POST.get('action', 'create')
        user = request.user if request.user.is_authenticated else None

        if action == 'delete':
            c = get_object_or_404(AuditCase, id=request.POST.get('case_id'))
            name = c.name
            c.delete()
            messages.success(request, f'已刪除抽查紀錄「{name}」。')
            return redirect('audit:case_list')

        project = get_object_or_404(Project, id=request.POST.get('project_id'))
        template = get_object_or_404(AuditTemplate, id=request.POST.get('template_id'))
        check_date_str = request.POST.get('check_date', '').strip()
        try:
            check_date = datetime.date.fromisoformat(check_date_str) if check_date_str else datetime.date.today()
        except ValueError:
            check_date = datetime.date.today()

        case = AuditCase.objects.create(
            project=project,
            template=template,
            check_type=template.check_type,
            name=request.POST.get('name', '').strip() or template.name,
            work_item_name=template.work_item_name,
            check_date=check_date,
            inspector=request.POST.get('inspector', '').strip() or '現場工程師',
            location=request.POST.get('location', '').strip(),
            contractor=request.POST.get('contractor', '').strip() or project.contractor,
            check_timing=int(request.POST.get('check_timing') or AuditCase.TIMING_HOLD_POINT),
            create_user=user,
            update_user=user,
        )
        case.populate_from_template(template)
        messages.success(request, f'已從樣板「{template.name}」建立抽查紀錄。')
        return redirect('audit:case_edit', case_id=case.id)

    project_id = request.GET.get('project_id', '').strip()
    check_type = request.GET.get('check_type', '').strip()
    cases = AuditCase.objects.select_related('project', 'template').prefetch_related('details')
    if project_id:
        cases = cases.filter(project_id=project_id)
    if check_type:
        cases = cases.filter(check_type=check_type)

    return render(request, 'audit/case_list.html', {
        'cases': cases,
        'projects': Project.objects.all(),
        'templates': AuditTemplate.objects.all(),
        'selected_project_id': project_id,
        'check_type': check_type,
    })


def case_edit(request, case_id):
    case = get_object_or_404(AuditCase.objects.select_related('project', 'template'), id=case_id)

    if request.method == 'POST':
        action = request.POST.get('action', 'save_case')
        if action == 'save_case':
            case.name = request.POST.get('name', case.name).strip() or case.name
            case.work_item_name = request.POST.get('work_item_name', '').strip()
            case.inspector = request.POST.get('inspector', '').strip()
            case.location = request.POST.get('location', '').strip()
            case.contractor = request.POST.get('contractor', '').strip()
            case.check_timing = int(request.POST.get('check_timing') or case.check_timing)
            case.memo = request.POST.get('memo', '').strip()

            cd = request.POST.get('check_date', '').strip()
            if cd:
                try:
                    case.check_date = datetime.date.fromisoformat(cd)
                except ValueError:
                    pass
            ad = request.POST.get('apply_date', '').strip()
            if ad:
                try:
                    case.apply_date = datetime.date.fromisoformat(ad)
                except ValueError:
                    pass
            else:
                case.apply_date = None

            selected = request.POST.getlist('selected_stages')
            case.selected_stages = ', '.join(selected)
            case.save()

            # 批次更新所有查驗細項結果與實際情形，並自動建立/同步缺失紀錄
            for detail in case.details.all():
                res_val = request.POST.get(f'result_{detail.id}')
                note_val = request.POST.get(f'note_{detail.id}', '').strip()
                if res_val in ('1', '2', '3'):
                    detail.result = int(res_val)
                detail.actual_note = note_val
                detail.save(update_fields=['result', 'actual_note'])

                if detail.result == AuditCaseDetail.RESULT_FAIL:
                    AuditFault.objects.get_or_create(
                        detail=detail,
                        defaults={'fault_note': note_val or f'「{detail.name}」查驗不合格，請辦理改善。'},
                    )

            messages.success(request, '已儲存抽查驗紀錄（不合格項目已自動建立缺失追蹤）。')
            return redirect('audit:case_edit', case_id=case.id)

        elif action == 'upload_photo':
            img = request.FILES.get('image')
            if img:
                fault_id = request.POST.get('fault_id', '').strip()
                fault = AuditFault.objects.filter(id=fault_id, detail__case=case).first() if fault_id else None
                AuditPhoto.objects.create(
                    case=case,
                    fault=fault,
                    photo_type=request.POST.get('photo_type', AuditPhoto.TYPE_GENERAL),
                    caption=request.POST.get('caption', '').strip(),
                    image=img,
                )
                messages.success(request, '已上傳照片。')
            else:
                messages.error(request, '請選擇照片檔案。')
            return redirect('audit:case_edit', case_id=case.id)

        elif action == 'delete_photo':
            ph = get_object_or_404(AuditPhoto, id=request.POST.get('photo_id'), case=case)
            ph.delete()
            messages.success(request, '已刪除照片。')
            return redirect('audit:case_edit', case_id=case.id)

    stages = case.stages.prefetch_related('details__fault').order_by('priority', 'id')
    faults = AuditFault.objects.filter(detail__case=case).select_related('detail', 'detail__stage').prefetch_related('photos')
    photos = case.photos.select_related('fault').all()
    sig_map = {s.role_name: s for s in case.signatures.all()}
    signature_slots = [
        {'role_name': role, 'signature': sig_map.get(role)}
        for role in (case.get_signature_labels() or ['檢查人員簽名'])
    ]

    return render(request, 'audit/case_edit.html', {
        'case': case,
        'stages': stages,
        'faults': faults,
        'photos': photos,
        'signature_slots': signature_slots,
        'selected_stage_list': case.get_selected_stage_list(),
    })


@require_POST
def case_save_signature(request, case_id):
    case = get_object_or_404(AuditCase, id=case_id)
    try:
        payload = json.loads(request.body.decode('utf-8'))
    except ValueError:
        return JsonResponse({'status': False, 'msg': '無效的 JSON 請求'})

    role_name = str(payload.get('role_name', '')).strip()
    data_url = str(payload.get('data_url', '')).strip()
    if not role_name or ',' not in data_url:
        return JsonResponse({'status': False, 'msg': '缺少簽名角色或圖檔資料'})

    _, b64_data = data_url.split(',', 1)
    img_bytes = base64.b64decode(b64_data)
    filename = f'sign_{case.id}_{abs(hash(role_name)) % 100000}.png'

    sig, _ = AuditSignature.objects.get_or_create(case=case, role_name=role_name)
    sig.image.save(filename, ContentFile(img_bytes), save=True)
    return JsonResponse({'status': True, 'image_url': sig.image.url})


def case_export_excel(request, case_id):
    case = get_object_or_404(AuditCase, id=case_id)
    content = export_case_excel(case)
    filename = quote(f'抽查紀錄_{case.name}_{case.check_date}.xlsx')
    resp = HttpResponse(
        content,
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    resp['Content-Disposition'] = f"attachment; filename*=UTF-8''{filename}"
    return resp


def case_export_improve_docx(request, case_id):
    case = get_object_or_404(AuditCase, id=case_id)
    content = export_improve_docx(case)
    filename = quote(f'缺失改善表_{case.name}_{case.check_date}.docx')
    resp = HttpResponse(
        content,
        content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    resp['Content-Disposition'] = f"attachment; filename*=UTF-8''{filename}"
    return resp


def fault_list(request):
    if request.method == 'POST':
        fault = get_object_or_404(AuditFault, id=request.POST.get('fault_id'))
        action = request.POST.get('action', 'update_fault')

        if action == 'upload_fault_photo':
            img = request.FILES.get('image')
            if img:
                AuditPhoto.objects.create(
                    case=fault.detail.case,
                    fault=fault,
                    photo_type=request.POST.get('photo_type', AuditPhoto.TYPE_IMPROVE),
                    caption=request.POST.get('caption', '').strip(),
                    image=img,
                )
                messages.success(request, '已上傳缺失/改善照片。')
            return redirect(request.POST.get('next') or 'audit:fault_list')

        fault.fault_note = request.POST.get('fault_note', '').strip()
        fault.improve_plan = request.POST.get('improve_plan', '').strip()
        fault.improve_note = request.POST.get('improve_note', '').strip()
        fault.is_improved = request.POST.get('is_improved') == 'on'
        fault.is_verified = request.POST.get('is_verified') == 'on'
        if fault.is_improved and not fault.improved_date:
            fault.improved_date = datetime.date.today()
        fault.save()
        messages.success(request, f'已更新缺失 #{fault.id} 改善狀態。')
        return redirect(request.POST.get('next') or 'audit:fault_list')

    status = request.GET.get('status', 'all')
    faults = AuditFault.objects.select_related(
        'detail', 'detail__stage', 'detail__case', 'detail__case__project'
    ).prefetch_related('photos')
    if status == 'open':
        faults = faults.filter(is_verified=False)
    elif status == 'closed':
        faults = faults.filter(is_verified=True)

    return render(request, 'audit/fault_list.html', {
        'faults': faults,
        'status': status,
    })
