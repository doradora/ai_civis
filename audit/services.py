import io
import os

import xlsxwriter
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

from .models import AuditCaseDetail, AuditFault, AuditPhoto


def _set_run_font(run, name='標楷體', size=11, bold=False):
    run.font.name = name
    run.font.size = Pt(size)
    run.bold = bold
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is not None:
        rFonts.set(qn('w:eastAsia'), name)


def export_template_docx(template):
    """將抽查/自主檢查樣板匯出為空白 Word (.docx) 表單。"""
    doc = Document()
    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = title.add_run(f'{template.name}（{template.get_check_type_display()}）')
    _set_run_font(r, size=16, bold=True)

    info_lines = [
        f'工程名稱：{template.project.name if template.project else "（通用樣板）"}',
        f'分項工程名稱：{template.work_item_name or "＿＿＿＿＿＿＿＿＿＿"}',
        f'檢查時機：{"　".join("□ " + opt for opt in template.get_timing_options())}',
        '檢查日期：　　年　　月　　日　　　檢查位置：＿＿＿＿＿＿＿＿＿＿',
    ]
    for line in info_lines:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(3)
        _set_run_font(p.add_run(line), size=11)

    table = doc.add_table(rows=1, cols=5)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.style = 'Table Grid'

    headers = ['檢查階段', '查驗細項', '檢驗標準（定性或量化）', '實際檢查情形', '檢查結果']
    widths = [Cm(2.4), Cm(4.2), Cm(4.8), Cm(3.4), Cm(2.2)]
    for idx, h in enumerate(headers):
        cell = table.rows[0].cells[idx]
        cell.width = widths[idx]
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _set_run_font(p.add_run(h), size=10.5, bold=True)

    for stage in template.stages.all().order_by('priority', 'id'):
        criteria = list(stage.criteria.all().order_by('priority', 'id'))
        if not criteria:
            row = table.add_row()
            _set_run_font(row.cells[0].paragraphs[0].add_run(stage.name), size=10)
            _set_run_font(row.cells[4].paragraphs[0].add_run('□合格 □不合格'), size=9.5)
            continue

        start_idx = len(table.rows)
        for n, crit in enumerate(criteria, start=1):
            row = table.add_row()
            _set_run_font(row.cells[1].paragraphs[0].add_run(f'{n}. {crit.name}'), size=10)
            _set_run_font(row.cells[2].paragraphs[0].add_run(crit.standard), size=10)
            _set_run_font(row.cells[4].paragraphs[0].add_run('□合格\n□不合格\n□免檢'), size=9)
        end_idx = len(table.rows) - 1
        if end_idx > start_idx:
            table.cell(start_idx, 0).merge(table.cell(end_idx, 0))
        stage_p = table.cell(start_idx, 0).paragraphs[0]
        stage_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _set_run_font(stage_p.add_run(stage.name), size=10.5, bold=True)

    sigs = template.get_signature_labels()
    if sigs:
        p_sig = doc.add_paragraph()
        p_sig.paragraph_format.space_before = Pt(14)
        sig_text = '　　　　'.join(f'{s}：＿＿＿＿＿＿' for s in sigs)
        _set_run_font(p_sig.add_run(sig_text), size=11)

    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf.getvalue()


def export_case_excel(case):
    """匯出工程抽查驗／自主檢查紀錄 Excel (.xlsx)。"""
    output = io.BytesIO()
    wb = xlsxwriter.Workbook(output, {'in_memory': True})
    ws = wb.add_worksheet('抽查驗紀錄')

    title_fmt = wb.add_format({
        'bold': True, 'font_size': 15, 'align': 'center', 'valign': 'vcenter',
        'font_name': '標楷體', 'bg_color': '#1e3a5f', 'font_color': '#ffffff',
    })
    label_fmt = wb.add_format({
        'bold': True, 'border': 1, 'bg_color': '#f1f5f9', 'valign': 'vcenter', 'font_name': '標楷體',
    })
    val_fmt = wb.add_format({
        'border': 1, 'valign': 'vcenter', 'text_wrap': True, 'font_name': '標楷體',
    })
    hdr_fmt = wb.add_format({
        'bold': True, 'border': 1, 'align': 'center', 'valign': 'vcenter',
        'bg_color': '#dbeafe', 'font_name': '標楷體',
    })
    center_fmt = wb.add_format({
        'border': 1, 'align': 'center', 'valign': 'vcenter', 'font_name': '標楷體',
    })
    fail_fmt = wb.add_format({
        'border': 1, 'align': 'center', 'valign': 'vcenter', 'bold': True,
        'font_color': '#dc2626', 'bg_color': '#fee2e2', 'font_name': '標楷體',
    })
    pass_fmt = wb.add_format({
        'border': 1, 'align': 'center', 'valign': 'vcenter', 'bold': True,
        'font_color': '#15803d', 'bg_color': '#dcfce7', 'font_name': '標楷體',
    })

    ws.set_column(0, 0, 14)
    ws.set_column(1, 1, 28)
    ws.set_column(2, 2, 32)
    ws.set_column(3, 3, 28)
    ws.set_column(4, 4, 14)

    ws.set_row(0, 28)
    ws.merge_range('A1:E1', f'{case.name}（{case.get_check_type_display()}）', title_fmt)

    meta = [
        ('工程名稱', case.project.name, '查驗日期', str(case.check_date)),
        ('分項工程', case.work_item_name or '-', '檢查時機', case.get_check_timing_display()),
        ('檢查位置', case.location or '-', '抽查人員', case.inspector or '-'),
        ('協力廠商', case.contractor or '-', '查驗結果', '合格' if case.is_passed else f'不合格（{case.fail_count}項缺失）'),
    ]
    r = 1
    for l1, v1, l2, v2 in meta:
        ws.write(r, 0, l1, label_fmt)
        ws.merge_range(r, 1, r, 2, v1, val_fmt)
        ws.write(r, 3, l2, label_fmt)
        ws.write(r, 4, v2, val_fmt)
        r += 1

    r += 1
    for c, h in enumerate(['檢查階段', '查驗細項', '檢驗標準', '實際檢查情形', '查驗結果']):
        ws.write(r, c, h, hdr_fmt)
    r += 1

    for stage in case.stages.all().order_by('priority', 'id'):
        details = list(stage.details.all().order_by('priority', 'id'))
        if not details:
            continue
        start_r = r
        for idx, d in enumerate(details, start=1):
            ws.write(r, 1, f'{idx}. {d.name}', val_fmt)
            ws.write(r, 2, d.standard, val_fmt)
            ws.write(r, 3, d.actual_note, val_fmt)
            rfmt = pass_fmt if d.result == AuditCaseDetail.RESULT_PASS else (
                fail_fmt if d.result == AuditCaseDetail.RESULT_FAIL else center_fmt
            )
            ws.write(r, 4, d.get_result_display(), rfmt)
            r += 1
        if r - 1 > start_r:
            ws.merge_range(start_r, 0, r - 1, 0, stage.name, center_fmt)
        else:
            ws.write(start_r, 0, stage.name, center_fmt)

    r += 1
    sigs = case.get_signature_labels()
    if sigs:
        ws.merge_range(r, 0, r, 4, '　　　'.join(f'{s}：＿＿＿＿＿＿' for s in sigs), val_fmt)

    wb.close()
    output.seek(0)
    return output.getvalue()


def export_improve_docx(case):
    """匯出缺失改善對策及結果表 Word (.docx)。"""
    doc = Document()
    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _set_run_font(title.add_run(f'缺失改善追蹤表 — {case.name}'), size=15, bold=True)

    meta_p = doc.add_paragraph()
    _set_run_font(
        meta_p.add_run(
            f'工程名稱：{case.project.name}\n'
            f'查驗日期：{case.check_date}　　檢查位置：{case.location or "-"}　　抽查人員：{case.inspector or "-"}'
        ),
        size=10.5,
    )

    faults = list(
        AuditFault.objects.filter(detail__case=case)
        .select_related('detail', 'detail__stage')
        .prefetch_related('photos')
        .order_by('id')
    )
    if not faults:
        p = doc.add_paragraph()
        _set_run_font(p.add_run('本次抽查無不合格缺失項目。'), size=11)
    else:
        table = doc.add_table(rows=1, cols=6)
        table.style = 'Table Grid'
        headers = ['編號', '階段 / 查驗細項', '缺失說明', '改善對策', '改善結果', '複查狀態']
        for i, h in enumerate(headers):
            p = table.rows[0].cells[i].paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            _set_run_font(p.add_run(h), size=10, bold=True)

        for idx, f in enumerate(faults, start=1):
            row = table.add_row()
            status = '複查合格' if f.is_verified else ('已改善待複查' if f.is_improved else '改善中')
            _set_run_font(row.cells[0].paragraphs[0].add_run(str(idx)), size=10)
            _set_run_font(row.cells[1].paragraphs[0].add_run(f'[{f.detail.stage.name}] {f.detail.name}'), size=10)
            _set_run_font(row.cells[2].paragraphs[0].add_run(f.fault_note or f.detail.actual_note or '-'), size=10)
            _set_run_font(row.cells[3].paragraphs[0].add_run(f.improve_plan or '-'), size=10)
            _set_run_font(row.cells[4].paragraphs[0].add_run(f.improve_note or '-'), size=10)
            _set_run_font(row.cells[5].paragraphs[0].add_run(status), size=10, bold=True)

        # 附上改善前後相片
        for idx, f in enumerate(faults, start=1):
            photos = list(f.photos.all())
            if not photos:
                continue
            hp = doc.add_paragraph()
            hp.paragraph_format.space_before = Pt(10)
            _set_run_font(hp.add_run(f'缺失 #{idx}（{f.detail.name}）改善前後相片'), size=11, bold=True)
            for ph in photos:
                if ph.image and os.path.exists(ph.image.path):
                    cap = doc.add_paragraph()
                    _set_run_font(cap.add_run(f'[{ph.get_photo_type_display()}] {ph.caption}'), size=9.5)
                    try:
                        doc.add_picture(ph.image.path, width=Cm(9))
                    except Exception:
                        pass

    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf.getvalue()
