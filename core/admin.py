from django.contrib import admin
from .models import Project


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ('id', 'code', 'year', 'name', 'duration', 'contract_amount', 'contractor', 'supervisor')
    search_fields = ('name', 'code', 'contractor', 'supervisor')
    list_filter = ('year',)
