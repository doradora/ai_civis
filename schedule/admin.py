from django.contrib import admin
from .models import Option, ScheduleItem, Version_Schedule


@admin.register(Option)
class OptionAdmin(admin.ModelAdmin):
    list_display = ('id', 'swarm', 'value')


class ScheduleItemInline(admin.TabularInline):
    model = ScheduleItem
    extra = 0
    fields = ('priority', 'kind', 'uplevel', 'name', 'duration', 'es', 'ef', 'ls', 'lf', 'unit_price', 'cp', 'is_main_item')


@admin.register(Version_Schedule)
class VersionScheduleAdmin(admin.ModelAdmin):
    list_display = ('id', 'project_name', 'project', 'schedule_setting_type', 'duration', 'cpm_release', 'update_time')
    list_filter = ('schedule_setting_type', 'cpm_release')
    search_fields = ('project_name',)
    inlines = [ScheduleItemInline]


@admin.register(ScheduleItem)
class ScheduleItemAdmin(admin.ModelAdmin):
    list_display = ('id', 'version', 'kind', 'name', 'priority', 'duration', 'es', 'ef', 'ls', 'lf', 'unit_price', 'cp')
    list_filter = ('kind', 'cp', 'is_main_item')
    search_fields = ('name',)
