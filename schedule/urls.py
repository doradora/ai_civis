# -*- coding: utf-8 -*-
from django.urls import path, re_path
from django.views.generic import RedirectView

from schedule import api, views

urlpatterns = [
    # 預設入口導向完整 jsrcm 預定進度精靈首頁
    path('', RedirectView.as_view(url='/schedule/manage_schedule/', permanent=False), name='schedule_index'),

    # Tastypie 相容 REST API（/schedule/api/active/...）
    re_path(r'^api/active/version_schedule/release/?$', api.version_schedule_release, name='api_release'),
    re_path(r'^api/active/version_schedule/?$', api.version_schedule_list, name='api_version_schedule_list'),
    re_path(r'^api/active/version_schedule/(?P<pk>[0-9]+)/?$', api.version_schedule_detail, name='api_version_schedule_detail'),

    re_path(r'^api/active/scheduleitem/change_item_priority/?$', api.scheduleitem_change_item_priority, name='api_change_item_priority'),
    re_path(r'^api/active/scheduleitem/get_delete_sub_ids/?$', api.scheduleitem_get_delete_sub_ids, name='api_get_delete_sub_ids'),
    re_path(r'^api/active/scheduleitem/?$', api.scheduleitem_list, name='api_scheduleitem_list'),
    re_path(r'^api/active/scheduleitem/(?P<pk>[0-9]+)/?$', api.scheduleitem_detail, name='api_scheduleitem_detail'),

    # 頁面路由（完整保留 jsrcm URL 與 name）
    re_path(r'^manage_schedule/$', views.manage_schedule, name='schedule.views.manage_schedule'),
    re_path(r'^item_profile/(?P<version_id>[0-9]+)/$', views.item_profile, name='schedule.views.item_profile'),
    re_path(r'^cpm_diagram/$', views.cpm_diagram, name='schedule.views.cpm_diagram'),
    re_path(r'^gantt_diagram/$', views.gantt_diagram, name='schedule.views.gantt_diagram'),

    # 功能端點（完整保留 jsrcm URL 與 name）
    re_path(r'^create_sch_item_by_excel/$', views.create_sch_item_by_excel, name='schedule.views.create_sch_item_by_excel'),
    re_path(r'^create_sch_item_by_json/$', views.create_sch_item_by_json, name='schedule.views.create_sch_item_by_json'),
    re_path(r'^create_item/$', views.create_item, name='schedule.views.create_item'),
    re_path(r'^update_priority/$', views.update_priority, name='schedule.views.update_priority'),
    re_path(r'^delete_all_item/$', views.delete_all_item, name='schedule.views.delete_all_item'),
    re_path(r'^create_item_by_month/$', views.create_item_by_month, name='schedule.views.create_item_by_month'),
    re_path(r'^create_item_by_range/$', views.create_item_by_range, name='schedule.views.create_item_by_range'),
    re_path(r'^draw_sch_s_curve/(?P<version_id>[0-9]+)/$', views.draw_sch_s_curve, name='schedule.views.draw_sch_s_curve'),
    re_path(r'^api_cpm/$', views.api_cpm, name='schedule.views.api_cpm'),
    re_path(r'^copy_items_to_scheduleitems/$', views.copy_items_to_scheduleitems, name='schedule.views.copy_items_to_scheduleitems'),
    re_path(r'^copy_main_items_to_scheduleitems/$', views.copy_main_items_to_scheduleitems, name='schedule.views.copy_main_items_to_scheduleitems'),
    re_path(r'^copy_main_items_to_cpmitems/$', views.copy_main_items_to_cpmitems, name='schedule.views.copy_main_items_to_cpmitems'),
    re_path(r'^download_file/(?P<table_name>.+)/(?P<file_id>.+)/$', views.download_file, name='schedule.views.downliad_file'),

    # 匯出端點（完整保留 jsrcm URL 與 name）
    re_path(r'^make_excel_scheduleitem/(?P<version_id>[0-9]+)/$', views.make_excel_scheduleitem, name='schedule.views.make_excel_scheduleitem'),
    re_path(r'^make_json_scheduleitem/(?P<version_id>[0-9]+)/$', views.make_json_scheduleitem, name='schedule.views.make_json_scheduleitem'),
    re_path(r'^make_gantt_schedule_excel/(?P<version_id>[0-9]+)/$', views.make_gantt_schedule_excel, name='schedule.views.make_gantt_schedule_excel'),
    re_path(r'^make_gantt_schedule_png/(?P<version_id>[0-9]+)/$', views.make_gantt_schedule_png, name='schedule.views.make_gantt_schedule_png'),
    re_path(r'^make_adm_png/(?P<version_id>[0-9]+)/$', views.make_adm_png, name='schedule.views.make_adm_png'),
]
