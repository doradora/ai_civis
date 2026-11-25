from django.urls import path
from . import views

app_name = 'audit'

urlpatterns = [
    path('templates/', views.template_list, name='template_list'),
    path('templates/<int:template_id>/', views.template_edit, name='template_edit'),
    path('templates/<int:template_id>/export/docx/', views.template_export_docx, name='template_export_docx'),

    path('cases/', views.case_list, name='case_list'),
    path('cases/<int:case_id>/', views.case_edit, name='case_edit'),
    path('cases/<int:case_id>/sign/', views.case_save_signature, name='case_save_signature'),
    path('cases/<int:case_id>/export/excel/', views.case_export_excel, name='case_export_excel'),
    path('cases/<int:case_id>/export/improve-docx/', views.case_export_improve_docx, name='case_export_improve_docx'),

    path('faults/', views.fault_list, name='fault_list'),
]
