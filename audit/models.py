import datetime
import json

from django.conf import settings
from django.db import models

from core.models import BaseModel, Project


class AuditTemplate(BaseModel):
    """抽查驗／自主檢查樣板（整合並簡化自 jsrcm.audit.MainTemplate 與 ProjectTemplate）"""
    TYPE_SPOT_CHECK = 'spot_check'
    TYPE_SELF_CHECK = 'self_check'
    CHECK_TYPE_CHOICES = [
        (TYPE_SPOT_CHECK, '施工抽(查)驗表'),
        (TYPE_SELF_CHECK, '自主檢查表'),
    ]

    project = models.ForeignKey(
        Project,
        verbose_name='所屬工程案(留空為共用樣板)',
        related_name='audit_templates',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
    )
    check_type = models.CharField(
        '表單種類', max_length=20, choices=CHECK_TYPE_CHOICES, default=TYPE_SPOT_CHECK
    )
    name = models.CharField('樣板名稱', max_length=256)
    work_item_name = models.CharField('分項工程名稱', max_length=256, blank=True, default='')
    note = models.TextField('樣板說明', blank=True, default='')
    signature_labels = models.TextField('簽名欄設定(JSON)', default='[]')
    timing_options = models.TextField('檢查時機選項(JSON)', default='[]')

    class Meta:
        verbose_name = '抽查樣板'
        verbose_name_plural = '抽查樣板'
        ordering = ['check_type', 'name', 'id']

    def __str__(self):
        return f'[{self.get_check_type_display()}] {self.name}'

    def get_signature_labels(self):
        try:
            data = json.loads(self.signature_labels or '[]')
            return data if isinstance(data, list) else []
        except (ValueError, TypeError):
            return []

    def set_signature_labels(self, labels):
        self.signature_labels = json.dumps([s.strip() for s in labels if s.strip()], ensure_ascii=False)

    def get_timing_options(self):
        try:
            data = json.loads(self.timing_options or '[]')
            return data if isinstance(data, list) else []
        except (ValueError, TypeError):
            return []

    def set_timing_options(self, options):
        self.timing_options = json.dumps([s.strip() for s in options if s.strip()], ensure_ascii=False)

    def init_defaults(self):
        """建立預設簽名欄、檢查時機與施工前/中/後階段。"""
        if not self.get_signature_labels():
            default_sigs = (
                settings.DEFAULT_SPOT_CHECK_SIGNATURES
                if self.check_type == self.TYPE_SPOT_CHECK
                else settings.DEFAULT_SELF_CHECK_SIGNATURES
            )
            self.set_signature_labels(default_sigs)
        if not self.get_timing_options():
            self.set_timing_options(settings.DEFAULT_TIMING_OPTIONS)
        self.save(update_fields=['signature_labels', 'timing_options'])

        if not self.stages.exists():
            for idx, stage_name in enumerate(settings.DEFAULT_STANDARD_STAGES, start=1):
                AuditTemplateStage.objects.create(
                    template=self, name=stage_name, priority=idx
                )

    def clone_template(self, target_project=None, new_name=None, user=None):
        """複製樣板及其所有檢查階段與查驗細項。"""
        cloned = AuditTemplate.objects.create(
            project=target_project if target_project is not None else self.project,
            check_type=self.check_type,
            name=new_name or f'{self.name}（複製）',
            work_item_name=self.work_item_name,
            note=self.note,
            signature_labels=self.signature_labels,
            timing_options=self.timing_options,
            create_user=user,
            update_user=user,
        )
        for stage in self.stages.all().order_by('priority', 'id'):
            new_stage = AuditTemplateStage.objects.create(
                template=cloned, name=stage.name, priority=stage.priority
            )
            for crit in stage.criteria.all().order_by('priority', 'id'):
                AuditTemplateCriterion.objects.create(
                    stage=new_stage,
                    name=crit.name,
                    standard=crit.standard,
                    priority=crit.priority,
                )
        return cloned


class AuditTemplateStage(models.Model):
    """樣板檢查階段（如：施工前、施工中、施工後）"""
    template = models.ForeignKey(
        AuditTemplate, verbose_name='所屬樣板', related_name='stages', on_delete=models.CASCADE
    )
    name = models.CharField('階段名稱', max_length=256)
    priority = models.IntegerField('排序', default=1)

    class Meta:
        verbose_name = '樣板檢查階段'
        verbose_name_plural = '樣板檢查階段'
        ordering = ['priority', 'id']

    def __str__(self):
        return f'{self.template.name} - {self.name}'


class AuditTemplateCriterion(models.Model):
    """樣板查驗細項與檢驗標準"""
    stage = models.ForeignKey(
        AuditTemplateStage, verbose_name='檢查階段', related_name='criteria', on_delete=models.CASCADE
    )
    name = models.CharField('查驗細項', max_length=512)
    standard = models.CharField('檢驗標準(定性或量化)', max_length=512, blank=True, default='')
    priority = models.IntegerField('排序', default=1)

    class Meta:
        verbose_name = '樣板查驗細項'
        verbose_name_plural = '樣板查驗細項'
        ordering = ['priority', 'id']

    def __str__(self):
        return self.name


class AuditCase(BaseModel):
    """工程抽查驗／自主檢查紀錄（簡化改寫自 jsrcm.audit.AuditCase）"""
    TIMING_HOLD_POINT = 1
    TIMING_RANDOM = 2
    TIMING_CHOICES = [
        (TIMING_HOLD_POINT, '檢驗停留點'),
        (TIMING_RANDOM, '不定期抽查'),
    ]

    project = models.ForeignKey(
        Project,
        verbose_name='所屬工程案',
        related_name='audit_cases',
        on_delete=models.CASCADE,
    )
    template = models.ForeignKey(
        AuditTemplate,
        verbose_name='來源樣板',
        related_name='cases',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    check_type = models.CharField(
        '表單種類',
        max_length=20,
        choices=AuditTemplate.CHECK_TYPE_CHOICES,
        default=AuditTemplate.TYPE_SPOT_CHECK,
    )
    name = models.CharField('表單名稱', max_length=256)
    work_item_name = models.CharField('分項工程名稱', max_length=256, blank=True, default='')
    apply_date = models.DateField('申請日期', null=True, blank=True)
    check_date = models.DateField('查驗日期', default=datetime.date.today)
    inspector = models.CharField('抽查/檢查人員', max_length=128, blank=True, default='')
    location = models.CharField('檢查位置', max_length=256, blank=True, default='')
    contractor = models.CharField('協力廠商', max_length=128, blank=True, default='')
    check_timing = models.IntegerField('檢查時機', choices=TIMING_CHOICES, default=TIMING_HOLD_POINT)
    selected_stages = models.CharField('勾選施工流程', max_length=256, blank=True, default='')
    signature_labels = models.TextField('簽名欄設定(JSON)', default='[]')
    memo = models.TextField('綜合備註', blank=True, default='')

    class Meta:
        verbose_name = '抽查驗紀錄'
        verbose_name_plural = '抽查驗紀錄'
        ordering = ['-check_date', '-id']

    def __str__(self):
        return f'{self.check_date} {self.name}'

    def get_signature_labels(self):
        try:
            data = json.loads(self.signature_labels or '[]')
            return data if isinstance(data, list) else []
        except (ValueError, TypeError):
            return []

    def get_selected_stage_list(self):
        return [s.strip() for s in (self.selected_stages or '').split(',') if s.strip()]

    def populate_from_template(self, template):
        """從樣板建立檢查階段與查驗細項快照。"""
        if not template:
            return
        self.template = template
        self.check_type = template.check_type
        if not self.name:
            self.name = template.name
        if not self.work_item_name:
            self.work_item_name = template.work_item_name
        self.signature_labels = template.signature_labels
        self.save()

        for stage in template.stages.all().order_by('priority', 'id'):
            cs = AuditCaseStage.objects.create(
                case=self, name=stage.name, priority=stage.priority
            )
            for crit in stage.criteria.all().order_by('priority', 'id'):
                AuditCaseDetail.objects.create(
                    case=self,
                    stage=cs,
                    name=crit.name,
                    standard=crit.standard,
                    result=AuditCaseDetail.RESULT_NA,
                    priority=crit.priority,
                )

    @property
    def is_passed(self):
        return not self.details.filter(result=AuditCaseDetail.RESULT_FAIL).exists()

    @property
    def pass_count(self):
        return self.details.filter(result=AuditCaseDetail.RESULT_PASS).count()

    @property
    def fail_count(self):
        return self.details.filter(result=AuditCaseDetail.RESULT_FAIL).count()

    @property
    def open_fault_count(self):
        return AuditFault.objects.filter(detail__case=self, is_verified=False).count()


class AuditCaseStage(models.Model):
    case = models.ForeignKey(
        AuditCase, verbose_name='所屬紀錄', related_name='stages', on_delete=models.CASCADE
    )
    name = models.CharField('階段名稱', max_length=256)
    priority = models.IntegerField('排序', default=1)

    class Meta:
        verbose_name = '紀錄檢查階段'
        verbose_name_plural = '紀錄檢查階段'
        ordering = ['priority', 'id']

    def __str__(self):
        return self.name


class AuditCaseDetail(models.Model):
    RESULT_PASS = 1
    RESULT_FAIL = 2
    RESULT_NA = 3
    RESULT_CHOICES = [
        (RESULT_PASS, '合格'),
        (RESULT_FAIL, '不合格'),
        (RESULT_NA, '不需檢查'),
    ]

    case = models.ForeignKey(
        AuditCase, verbose_name='所屬紀錄', related_name='details', on_delete=models.CASCADE
    )
    stage = models.ForeignKey(
        AuditCaseStage, verbose_name='檢查階段', related_name='details', on_delete=models.CASCADE
    )
    name = models.CharField('查驗細項', max_length=512)
    standard = models.CharField('檢驗標準', max_length=512, blank=True, default='')
    actual_note = models.CharField('實際檢查情形/量測數據', max_length=512, blank=True, default='')
    result = models.IntegerField('查驗結果', choices=RESULT_CHOICES, default=RESULT_NA)
    priority = models.IntegerField('排序', default=1)

    class Meta:
        verbose_name = '查驗細項結果'
        verbose_name_plural = '查驗細項結果'
        ordering = ['stage__priority', 'priority', 'id']

    def __str__(self):
        return f'{self.name} ({self.get_result_display()})'


class AuditFault(BaseModel):
    """缺失與改善追蹤（整合 jsrcm.audit.Fault 與 deficiency 改善流程）"""
    detail = models.OneToOneField(
        AuditCaseDetail,
        verbose_name='對應不合格細項',
        related_name='fault',
        on_delete=models.CASCADE,
    )
    fault_note = models.TextField('缺失說明', blank=True, default='')
    improve_plan = models.TextField('改善對策', blank=True, default='')
    improve_note = models.TextField('改善結果說明', blank=True, default='')
    is_improved = models.BooleanField('廠商已改善', default=False)
    is_verified = models.BooleanField('複查確認合格', default=False)
    improved_date = models.DateField('改善完成日期', null=True, blank=True)

    class Meta:
        verbose_name = '缺失改善紀錄'
        verbose_name_plural = '缺失改善紀錄'
        ordering = ['is_verified', '-id']

    def __str__(self):
        return f'缺失 #{self.id} - {self.detail.name}'


def _audit_photo_upload(instance, filename):
    return f'audit/photos/case_{instance.case_id}/{filename}'


class AuditPhoto(models.Model):
    TYPE_GENERAL = 'general'
    TYPE_FAULT = 'fault'
    TYPE_IMPROVE = 'improve'
    PHOTO_TYPE_CHOICES = [
        (TYPE_GENERAL, '一般檢驗照片'),
        (TYPE_FAULT, '缺失照片（改善前）'),
        (TYPE_IMPROVE, '改善照片（改善後）'),
    ]

    case = models.ForeignKey(
        AuditCase, verbose_name='所屬紀錄', related_name='photos', on_delete=models.CASCADE
    )
    fault = models.ForeignKey(
        AuditFault,
        verbose_name='對應缺失',
        related_name='photos',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
    )
    photo_type = models.CharField('照片類型', max_length=16, choices=PHOTO_TYPE_CHOICES, default=TYPE_GENERAL)
    caption = models.CharField('照片說明', max_length=256, blank=True, default='')
    image = models.ImageField('照片檔案', upload_to=_audit_photo_upload)
    create_time = models.DateTimeField('上傳時間', auto_now_add=True)

    class Meta:
        verbose_name = '查驗相片'
        verbose_name_plural = '查驗相片'
        ordering = ['id']


def _audit_sign_upload(instance, filename):
    return f'audit/signatures/case_{instance.case_id}/{filename}'


class AuditSignature(models.Model):
    case = models.ForeignKey(
        AuditCase, verbose_name='所屬紀錄', related_name='signatures', on_delete=models.CASCADE
    )
    role_name = models.CharField('簽名角色', max_length=128)
    image = models.ImageField('簽名圖檔', upload_to=_audit_sign_upload)
    signed_at = models.DateTimeField('簽署時間', auto_now=True)

    class Meta:
        verbose_name = '電子簽名檔'
        verbose_name_plural = '電子簽名檔'
        unique_together = (('case', 'role_name'),)
