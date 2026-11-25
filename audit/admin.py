from django.contrib import admin
from .models import (
    AuditCase,
    AuditCaseDetail,
    AuditCaseStage,
    AuditFault,
    AuditPhoto,
    AuditSignature,
    AuditTemplate,
    AuditTemplateCriterion,
    AuditTemplateStage,
)


@admin.register(AuditTemplate)
class AuditTemplateAdmin(admin.ModelAdmin):
    list_display = ('id', 'check_type', 'name', 'work_item_name', 'project', 'update_time')
    list_filter = ('check_type',)


@admin.register(AuditCase)
class AuditCaseAdmin(admin.ModelAdmin):
    list_display = ('id', 'check_date', 'project', 'check_type', 'name', 'inspector', 'is_passed')
    list_filter = ('check_type', 'check_timing')


@admin.register(AuditFault)
class AuditFaultAdmin(admin.ModelAdmin):
    list_display = ('id', 'detail', 'is_improved', 'is_verified', 'improved_date')
    list_filter = ('is_improved', 'is_verified')


admin.site.register(AuditTemplateStage)
admin.site.register(AuditTemplateCriterion)
admin.site.register(AuditCaseStage)
admin.site.register(AuditCaseDetail)
admin.site.register(AuditPhoto)
admin.site.register(AuditSignature)
