import datetime
from decimal import Decimal, InvalidOperation

from django.contrib import messages
from django.shortcuts import get_object_or_404, redirect, render

from audit.models import AuditCase, AuditFault, AuditTemplate
from schedule.models import Version_Schedule

from .models import Project


def dashboard(request):
    projects = Project.objects.all()[:6]
    recent_schedules = Version_Schedule.objects.select_related('project').order_by('-update_time')[:5]
    recent_cases = AuditCase.objects.select_related('project', 'template').all()[:5]

    stats = {
        'project_count': Project.objects.count(),
        'schedule_count': Version_Schedule.objects.count(),
        'template_count': AuditTemplate.objects.count(),
        'case_count': AuditCase.objects.count(),
        'open_fault_count': AuditFault.objects.filter(is_verified=False).count(),
    }
    return render(request, 'core/dashboard.html', {
        'stats': stats,
        'projects': projects,
        'recent_schedules': recent_schedules,
        'recent_cases': recent_cases,
    })


def project_list(request):
    if request.method == 'POST':
        action = request.POST.get('action', 'create')
        if action == 'delete':
            proj = get_object_or_404(Project, id=request.POST.get('project_id'))
            name = proj.name
            proj.delete()
            messages.success(request, f'已刪除工程案「{name}」。')
            return redirect('core:project_list')

        name = request.POST.get('name', '').strip()
        if not name:
            messages.error(request, '請輸入工程名稱。')
            return redirect('core:project_list')

        try:
            contract_amount = Decimal(request.POST.get('contract_amount') or '0')
        except InvalidOperation:
            contract_amount = Decimal('0')

        start_date_str = request.POST.get('start_date', '').strip()
        start_date = None
        if start_date_str:
            try:
                start_date = datetime.date.fromisoformat(start_date_str)
            except ValueError:
                start_date = None

        user = request.user if request.user.is_authenticated else None
        if action == 'update':
            proj = get_object_or_404(Project, id=request.POST.get('project_id'))
            proj.name = name
            proj.code = request.POST.get('code', '').strip()
            proj.year = int(request.POST.get('year') or 115)
            proj.contract_amount = contract_amount
            proj.duration = max(1, int(request.POST.get('duration') or 180))
            proj.start_date = start_date
            proj.contractor = request.POST.get('contractor', '').strip()
            proj.supervisor = request.POST.get('supervisor', '').strip()
            proj.note = request.POST.get('note', '').strip()
            proj.update_user = user
            proj.save()
            messages.success(request, f'已更新工程案「{proj.name}」。')
        else:
            proj = Project.objects.create(
                name=name,
                code=request.POST.get('code', '').strip(),
                year=int(request.POST.get('year') or 115),
                contract_amount=contract_amount,
                duration=max(1, int(request.POST.get('duration') or 180)),
                start_date=start_date,
                contractor=request.POST.get('contractor', '').strip(),
                supervisor=request.POST.get('supervisor', '').strip(),
                note=request.POST.get('note', '').strip(),
                create_user=user,
                update_user=user,
            )
            messages.success(request, f'已建立工程案「{proj.name}」。')
        return redirect('core:project_list')

    q = request.GET.get('q', '').strip()
    projects = Project.objects.all()
    if q:
        projects = projects.filter(name__icontains=q)
    return render(request, 'core/project_list.html', {
        'projects': projects,
        'q': q,
    })
