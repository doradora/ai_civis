from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path

from schedule import api as schedule_api

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('core.urls')),
    path('schedule/', include('schedule.urls')),
    path('audit/', include('audit.urls')),
    # 相容 jsrcm manage_schedule.js 的契約版本查詢端點
    re_path(r'^dailyreport/api/v1/version/?$', schedule_api.dailyreport_version_stub),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
