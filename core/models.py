from django.contrib.auth.models import User
from django.db import models


class BaseModel(models.Model):
    """簡化版共用基底模型，保留建立/更新時間與操作人記錄。"""
    create_user = models.ForeignKey(
        User,
        verbose_name='建立者',
        related_name='%(app_label)s_%(class)s_created',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    update_user = models.ForeignKey(
        User,
        verbose_name='更新者',
        related_name='%(app_label)s_%(class)s_updated',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    create_time = models.DateTimeField('建立時間', auto_now_add=True)
    update_time = models.DateTimeField('更新時間', auto_now=True)

    class Meta:
        abstract = True


class Project(BaseModel):
    """簡化版工程案實體，供進度管理與施工抽查驗模組共用。"""
    name = models.CharField('工程名稱', max_length=256)
    code = models.CharField('工程編號', max_length=64, blank=True, default='')
    year = models.IntegerField('年度', default=115)
    contract_amount = models.DecimalField(
        '契約金額(元)', max_digits=16, decimal_places=0, default=0
    )
    duration = models.PositiveIntegerField('核定工期(日曆天)', default=180)
    start_date = models.DateField('開工日期', null=True, blank=True)
    contractor = models.CharField('施工廠商', max_length=128, blank=True, default='')
    supervisor = models.CharField('監造單位', max_length=128, blank=True, default='')
    note = models.TextField('備註', blank=True, default='')

    class Meta:
        verbose_name = '工程案'
        verbose_name_plural = '工程案'
        ordering = ['-id']

    def __str__(self):
        return f'[{self.year}] {self.name}'
