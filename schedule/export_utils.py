# -*- coding: utf-8 -*-
"""
完整移植自 jsrcm.modules.export_file.views_schedule 與 lib_schedule：
- do_make_excel_scheduleitem: 匯出日報表系統匯入用 Excel（比率/金額格式）
- do_make_gantt_schedule_excel: 匯出完整甘特圖 Excel（含 CPM圖、ADM圖、甘特圖 + S曲線圖表、逐日進度四個工作表）
- ProgressChart & do_make_gantt_schedule_png: 匯出甘特圖 + S 曲線 PNG（相容 Pillow 10/11 textbbox）
"""
import datetime
import decimal
import os
import re
import string
from base64 import b64decode
from collections import namedtuple
from io import BytesIO

import xlsxwriter
from django.http import HttpResponse
from PIL import Image, ImageDraw, ImageFont


def round_fix(num, d=0):
    d_str = str(10 ** (-1 * int(d)))
    return float(str(decimal.Decimal(str(num)).quantize(decimal.Decimal(d_str), decimal.ROUND_HALF_UP)))


def cutzero(value, args=''):
    value = str(value)
    if '.' not in value:
        return value
    return re.sub(r'\.$', '', re.sub(r'0+$', '', value))


def str_count(s):
    count_en = count_dg = count_sp = count_zh = count_pu = 0
    s_len = len(s)
    for c in s:
        if c in string.ascii_letters:
            count_en += 1
        elif c.isdigit():
            count_dg += 1
        elif c.isspace():
            count_sp += 1
        elif c.isalpha():
            count_zh += 1
        else:
            count_pu += 1
    return namedtuple('Count', ['total', 'zh', 'en', 'space', 'digit', 'punc'])(
        s_len, count_zh, count_en, count_sp, count_dg, count_pu
    )


def decimal_point_set(decimal_point=0):
    decimal_point = int(decimal_point)
    return '0.%s_ ' % ('0' * decimal_point)


def myfmt(
    workbook=None,
    border_single=None,
    border=1,
    diag_type=False,
    bg_color='',
    shrink='',
    align='center',
    valign='vcenter',
    text_wrap='',
    font_name='標楷體',
    font_size=12,
    num_format='',
    bold=False,
    underline=False,
):
    if border_single is None:
        border_single = [0, 0, 0, 0]
    fmt = workbook.add_format()
    if border:
        fmt.set_border(border)
    else:
        if border_single[0]:
            fmt.set_top(border_single[0])
        if border_single[1]:
            fmt.set_bottom(border_single[1])
        if border_single[2]:
            fmt.set_left(border_single[2])
        if border_single[3]:
            fmt.set_right(border_single[3])
    if bg_color:
        fmt.set_bg_color(bg_color)
    if shrink:
        fmt.set_shrink(shrink)
    if align:
        fmt.set_align(align)
    if text_wrap:
        fmt.set_text_wrap(text_wrap)
    if font_name:
        fmt.set_font_name(font_name)
    if font_size:
        fmt.set_font_size(font_size)
    if num_format:
        fmt.set_num_format(num_format)
    if bold:
        fmt.set_bold(bold)
    if underline:
        fmt.set_underline()
    if diag_type:
        fmt.set_diag_type(diag_type)
    fmt.set_align(align)
    fmt.set_align(valign)
    return fmt


def make_excel_scheduleitem_call(data, f_type='response'):
    content = do_make_excel_scheduleitem(data)
    if f_type == 'response':
        response = HttpResponse(
            content,
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        response['Content-Disposition'] = 'attachment; filename=file.xlsx'
        return response
    return content


def do_make_excel_scheduleitem(data):
    output = BytesIO()
    workbook = xlsxwriter.Workbook(
        output,
        {
            'strings_to_numbers': True,
            'strings_to_formulas': False,
            'strings_to_urls': False,
        },
    )

    worksheet = workbook.add_worksheet('sheet1')
    worksheet.set_margins(left=0.5, right=0.5, top=0.5, bottom=0.5)
    worksheet.set_header(header='', margin=0.0)
    worksheet.set_paper(9)
    row = 0

    column_width = [5, 18, 60, 18, 18, 18, 0]
    for i, e in enumerate(column_width):
        worksheet.set_column(i, i, e)
    worksheet.set_row(row, 115)
    worksheet.merge_range(
        row,
        0,
        row,
        5,
        '(1) 以下藍字部分為範例，請刪除後，照此格式貼上您的施工項目。\n'
        '(2) 若為分類項目(可以不使用)，如第3列所表示的第一階段，請再標註欄位加上『*』字號，且不需填寫天數及金額，系統會自動運算。\n'
        '(3) 項次不可為空白。\n'
        '(4) 系統上若選擇 使用『金額』進行計算，下方請填寫金額，若選擇『比率』，則請填寫百分比，例如：15% 填寫 15\n'
        '(5) 完成編輯後，請直接上傳此檔案，不須轉檔。\n'
        '(6) 請勿刪除 此段說明文字。',
        myfmt(workbook=workbook, text_wrap=True, align='left', bg_color='#E7E7E7'),
    )
    row += 1

    bg_color = '#BCFFF6'
    worksheet.write(row, 0, '標註', myfmt(workbook=workbook, shrink=True, bg_color=bg_color, align='left'))
    worksheet.write(row, 1, '項次', myfmt(workbook=workbook, shrink=True, bg_color=bg_color, align='left'))
    worksheet.write(row, 2, '工項名稱', myfmt(workbook=workbook, shrink=True, bg_color=bg_color, align='left'))
    worksheet.write(row, 3, '預定開始天數', myfmt(workbook=workbook, shrink=True, bg_color=bg_color))
    worksheet.write(row, 4, '預定結束天數', myfmt(workbook=workbook, shrink=True, bg_color=bg_color, align='right'))
    worksheet.write(row, 5, '花費金額或比率', myfmt(workbook=workbook, shrink=True, bg_color=bg_color, align='right'))
    worksheet.write(row, 6, '要徑', myfmt(workbook=workbook, shrink=True, bg_color=bg_color, align='right'))
    row += 1

    price_type = data.get('price_type', 'rate')
    engs_price = decimal.Decimal(str(data.get('engs_price') or '0'))

    items = data.get('items', [])
    for i in items[1:]:
        unit_price = i['unit_price']
        if price_type == 'money':
            up_dec = decimal.Decimal(str(unit_price)) if unit_price else decimal.Decimal('0')
            up_dec *= engs_price / decimal.Decimal('100')
            unit_price = round(float(str(up_dec)), 0)
        bg_color = ''
        mark = '*' if i['kind__id'] == 10 else ''
        worksheet.write(row, 0, mark, myfmt(workbook=workbook, shrink=True, align='left', bg_color=bg_color))
        worksheet.write(row, 1, i['symbol'], myfmt(workbook=workbook, shrink=True, align='left', bg_color=bg_color))
        worksheet.write(row, 2, i['name'], myfmt(workbook=workbook, text_wrap=True, align='left', bg_color=bg_color))
        worksheet.write(row, 3, i['es'], myfmt(workbook=workbook, shrink=True, bg_color=bg_color, align='right'))
        worksheet.write(row, 4, i['ef'], myfmt(workbook=workbook, shrink=True, bg_color=bg_color, align='right'))
        worksheet.write(row, 5, unit_price, myfmt(workbook=workbook, shrink=True, align='right', bg_color=bg_color))
        worksheet.write(row, 6, '*' if i.get('cp', False) else '', myfmt(workbook=workbook, shrink=True, align='right', bg_color=bg_color))
        row += 1

    worksheet.center_horizontally()
    worksheet.fit_to_pages(1, 0)
    worksheet.freeze_panes(2, 0)

    workbook.close()
    output.seek(0)
    return output.read()


def make_gantt_schedule_excel_call(data, f_type='response'):
    content = do_make_gantt_schedule_excel(data)
    if f_type == 'response':
        response = HttpResponse(
            content,
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        response['Content-Disposition'] = 'attachment; filename=file.xlsx'
        return response
    return content


def do_make_gantt_schedule_excel(data):
    def colnum_string(n):
        s = ''
        while n > 0:
            n, remainder = divmod(n - 1, 26)
            s = chr(65 + remainder) + s
        return s

    output = BytesIO()
    workbook = xlsxwriter.Workbook(
        output,
        {
            'strings_to_numbers': True,
            'strings_to_formulas': False,
            'strings_to_urls': False,
        },
    )

    if data.get('version_file', ''):
        worksheet = workbook.add_worksheet('CPM圖')
        worksheet.set_margins(left=0.5, right=0.5, top=0.5, bottom=0.5)
        worksheet.set_header(header='', margin=0.0)
        worksheet.set_paper(9)
        content = bytes(data.get('version_file', ''), 'utf-8')
        f = BytesIO(b64decode(content))
        worksheet.insert_image('A1', 'image.jpg', {'image_data': f, 'x_offset': 5, 'y_offset': 5, 'x_scale': 1, 'y_scale': 1})

    if data.get('adm_file', ''):
        worksheet = workbook.add_worksheet('ADM圖')
        worksheet.set_margins(left=0.5, right=0.5, top=0.5, bottom=0.5)
        worksheet.set_header(header='', margin=0.0)
        worksheet.set_paper(9)
        content = bytes(data.get('adm_file', ''), 'utf-8')
        f = BytesIO(b64decode(content))
        worksheet.insert_image('A1', 'image.png', {'image_data': f, 'x_offset': 5, 'y_offset': 5, 'x_scale': 1, 'y_scale': 1})

    worksheet = workbook.add_worksheet('甘特圖')
    worksheet.set_margins(left=0.5, right=0.5, top=0.5, bottom=0.5)
    worksheet.set_header(header='', margin=0.0)
    worksheet.set_paper(9)
    row = 0

    column_width = [10, 30, 10, 13, 0.1] + [8] * 200
    for i, e in enumerate(column_width):
        worksheet.set_column(i, i, e)

    col_num_before_sch = 4
    col_width = 8
    col_height = 25
    unit_num_format = decimal_point_set(data['decimal_point'])
    unit_format_new = '_-* #,##{i}_-;-* #,##{i}_-;_-* ""_-;_-@_-'.format(i=unit_num_format)

    worksheet.write(row, 0, data['project_name'], myfmt(workbook=workbook, align='center', bold=True))
    row += 1

    title_arr = [
        {'range': 'A2:A3', 'value': '項次'},
        {'range': 'B2:B3', 'value': '工程項目'},
        {'range': 'C2:C3', 'value': '權重\n（％)'},
        {'range': 'D2:D3', 'value': '累計百分比\n（％）'},
    ]
    for i in title_arr:
        worksheet.merge_range(i['range'], i['value'], myfmt(workbook=workbook, align='center', bold=True, text_wrap=True))

    row += 2
    worksheet.merge_range(
        1,
        col_num_before_sch,
        1,
        col_num_before_sch + len(data['all_duration_range']) - 1,
        data['duration'],
        myfmt(workbook=workbook, align='center', shrink=True),
    )

    for i in range(len(data['all_duration_range'])):
        worksheet.write(2, i + col_num_before_sch, data['all_duration_range'][i], myfmt(workbook=workbook, align='center', shrink=True))

    for i in range(len(data['items'])):
        plus_symbol = '☆' if data['items'][i]['cp'] else ''
        worksheet.write(row, 0, data['items'][i]['symbol'] + plus_symbol, myfmt(workbook=workbook, align='left', shrink=True))

        if data['items'][i]['is_dir']:
            worksheet.merge_range(row, 1, row, 2, data['items'][i]['name'], myfmt(workbook=workbook, align='left', shrink=True))
        else:
            worksheet.write(row, 1, data['items'][i]['name'], myfmt(workbook=workbook, align='left', shrink=True))
            worksheet.write(row, 2, data['items'][i]['unit_rate'], myfmt(workbook=workbook, align='right', shrink=True, num_format=unit_num_format))

        worksheet.write(row, 3, 100 - i * 100 / max(1, len(data['items'])), myfmt(workbook=workbook, align='right', shrink=True, border=0, num_format=unit_num_format))

        for d in range(len(data['items'][i]['data'])):
            if float(data['items'][i]['data'][d]) > 0:
                if data['items'][i]['is_dir']:
                    bg_color = '#a6edb5'
                    value = 0
                else:
                    bg_color = '#a6d1ed'
                    value = data['items'][i]['data'][d]
                if data['items'][i]['cp']:
                    bg_color = '#FFD7D7'
            else:
                bg_color = '#ffffff'
                value = data['items'][i]['data'][d]

            worksheet.write(row, d + col_num_before_sch, value, myfmt(workbook=workbook, align='center', shrink=True, bg_color=bg_color, num_format=unit_format_new))
        row += 1

    worksheet.write(row, 0, '', myfmt(workbook=workbook, align='right', shrink=True))
    worksheet.write(row, 1, '', myfmt(workbook=workbook, align='right', shrink=True, num_format='#,##0_ '))
    worksheet.write_formula(row, 2, '=SUM(C4:C' + str(row) + ')', myfmt(workbook=workbook, align='right', shrink=True, num_format=unit_num_format))
    worksheet.write(row, 3, '0', myfmt(workbook=workbook, align='right', shrink=True, num_format=unit_num_format, border=0))
    worksheet.merge_range(row, col_num_before_sch, row, col_num_before_sch + len(data['all_duration_range']) - 1, '', myfmt(workbook=workbook, align='right', bold=True))
    row += 1

    worksheet.merge_range(row, 0, row, 3, '預定進度(%)', myfmt(workbook=workbook, align='right', shrink=True))
    worksheet.write(row, 4, 0, myfmt(workbook=workbook, align='right', shrink=True, num_format=unit_num_format))
    for i in range(len(data['sch_progres_delta'])):
        col_letter = colnum_string(i + col_num_before_sch + 2)
        worksheet.write_formula(row, i + col_num_before_sch + 1, '=SUM(' + col_letter + '4:' + col_letter + str(row) + ')', myfmt(workbook=workbook, align='right', shrink=True, num_format=unit_num_format))
    row += 1

    s_line_chart_data_row = row
    s_line_chart_data_end_col = col_num_before_sch

    worksheet.merge_range(row, 0, row, 3, '預定累計進度(%)', myfmt(workbook=workbook, align='right', shrink=True))
    for i in range(len(data['sch_progress'])):
        pre_col_letter = colnum_string(i + col_num_before_sch)
        top_col_letter = colnum_string(i + col_num_before_sch + 1)

        if i == 0:
            worksheet.write_formula(row, i + col_num_before_sch, '=SUM(' + top_col_letter + str(row) + ')', myfmt(workbook=workbook, align='right', shrink=True, num_format=unit_num_format))
        else:
            worksheet.write_formula(row, i + col_num_before_sch, '=SUM(' + pre_col_letter + str(row + 1) + '+' + top_col_letter + str(row) + ')', myfmt(workbook=workbook, align='right', shrink=True, num_format=unit_num_format))
        if i == len(data['sch_progress']) - 1:
            s_line_chart_data_end_col = i + col_num_before_sch
    row += 1

    last_col = worksheet.dim_colmax
    worksheet.set_default_row(col_height)
    worksheet.merge_range(0, 0, 0, last_col, data['project_name'], myfmt(workbook=workbook, align='center', bold=True, font_size=20))

    if data['items']:
        chart = workbook.add_chart({'type': 'line'})
        chart.add_series({
            'values': ['甘特圖', s_line_chart_data_row, col_num_before_sch, s_line_chart_data_row, s_line_chart_data_end_col],
            'line': {'width': 6},
        })
        chart.set_plotarea({
            'fill': {'none': True},
            'layout': {'x': 0, 'y': 0, 'width': 1, 'height': 1},
        })
        chart.set_x_axis({'visible': False, 'line': {'none': True}})
        chart.set_y_axis({
            'visible': False,
            'max': 101,
            'min': -1,
            'line': {'none': True},
            'major_gridlines': {'visible': False},
        })
        chart.set_legend({'none': True})
        chart.set_chartarea({'border': {'none': True}, 'fill': {'none': True}})

        col_char_ratio = 7.637
        row_char_ratio = 4 / 3
        chart.set_size({
            'width': max(200, col_width * len(data['items'][0]['data']) * col_char_ratio),
            'height': max(120, col_height * len(data['items']) * row_char_ratio),
        })
        worksheet.insert_chart('F4', chart, {'x_offset': -31, 'y_offset': 0})

    worksheet = workbook.add_worksheet('逐日進度')
    worksheet.set_margins(left=0.5, right=0.5, top=0.5, bottom=0.5)
    worksheet.set_header(header='', margin=0.0)
    worksheet.set_paper(9)
    row = 0
    for i, e in enumerate([15, 12]):
        worksheet.set_column(i, i, e)

    worksheet.write(row, 0, '天數', myfmt(workbook=workbook, align='center'))
    worksheet.write(row, 1, '預定進度', myfmt(workbook=workbook, align='right'))
    row += 1
    for d in data['progress']:
        progress = data['progress'][d]
        worksheet.write(row, 0, int(d), myfmt(workbook=workbook, align='center'))
        worksheet.write(row, 1, progress['sch'] / 100.0, myfmt(workbook=workbook, shrink=True, align='right', num_format='0.00%'))
        row += 1

    workbook.close()
    output.seek(0)
    return output.read()


class ProgressChart:
    """完整移植自 jsrcm.modules.export_file.lib_schedule.ProgressChart（修正 Pillow 10+ textbbox）"""

    def __init__(self, items_num=0):
        base_dir = os.path.dirname(__file__)
        font_file = os.path.join(base_dir, 'bkai00mp.ttf')
        self._datas = []
        self._initday = ''
        c = {
            'width': 1620,
            'height': 1350,
            'enddate_x': 20,
            'enddate_y': 70,
            'title_x': 680,
            'title_y': 10,
            'design_x': 750,
            'design_y': 60,
            'design_x1': 720,
            'design_x2': 740,
            'design_y1': 65,
            'design_y2': 75,
            'act_x': 750,
            'act_y': 85,
            'act_x1': 720,
            'act_x2': 740,
            'act_y1': 90,
            'act_y2': 100,
            'titlefontsize': ImageFont.truetype(font_file, 32),
            'leftwidth': 100,
            'bottomheight': 230,
            'dayaxiswidth': 1460,
            'dayaxisscaleheight': 4,
            'dayaxistextheight': 0,
            'percentaxisheight': 960,
            'dayaxisfontsize': ImageFont.truetype(font_file, 22),
            'dayaxiscolor': (0, 0, 0, 150),
            'act_percent_linecolor': (255, 0, 0, 255),
            'design_percent_linecolor': (20, 64, 191, 255),
            'gantt_bar_dir_color': (0, 170, 0, 255),
            'gantt_bar_item_color': (0, 216, 255, 255),
            'link_linecolor': (255, 117, 20, 255),
            'cp_item_color': (177, 63, 255, 255),
            'gantt_bar_height': 26,
            'table_thead_fontsize': ImageFont.truetype(font_file, 14),
            'table_thead_fontsize_16': ImageFont.truetype(font_file, 16),
            'gantt_bar_dir_fontsize': ImageFont.truetype(font_file, 20),
            'gantt_bar_item_fontsize': ImageFont.truetype(font_file, 20),
            'scale_day_fontsize': ImageFont.truetype(font_file, 14),
            'yearfontcolor': (20, 64, 191, 255),
            'bgcolor': (255, 255, 255, 255),
            'dayaxisbetweentext': 16,
            'gridcolor': (230, 230, 230, 230),
            'tablebordercolor': (0, 0, 0, 255),
            'changeordercolor': (0, 0, 0, 255),
            'fileformat': 'png',
            'left_item_table_width': 520,
        }

        if items_num * (c['gantt_bar_height'] + 3) > c['percentaxisheight']:
            c['percentaxisheight'] = items_num * (c['gantt_bar_height'] + 3)
            c['height'] = c['percentaxisheight'] + 390

        if items_num:
            for key in ['width', 'leftwidth', 'enddate_x', 'title_x', 'design_x', 'design_x1', 'design_x2', 'act_x', 'act_x1', 'act_x2']:
                c[key] += c['left_item_table_width']

        c['dayaxis_y'] = c['height'] - c['bottomheight']
        self._config = c

    def _textsize(self, text, font):
        bbox = self._dw.textbbox((0, 0), str(text), font=font)
        return (bbox[2] - bbox[0], bbox[3] - bbox[1])

    def NewChart(self, draw_other_line=True):
        c = self._config
        bgcolor = c['bgcolor'] if draw_other_line else (255, 255, 255, 0)
        self._im = Image.new('RGBA', (c['width'], c['height']), bgcolor)
        self._dw = ImageDraw.Draw(self._im)

    def DrawDayAxis(self, draw=True):
        c = self._config
        if draw:
            self._dw.line(
                (c['leftwidth'], c['height'] - c['bottomheight'], c['leftwidth'] + c['dayaxiswidth'], c['height'] - c['bottomheight']),
                fill=c['dayaxiscolor'],
            )

    def DrawX(self, draw=True):
        c = self._config
        design_percents, workingdates = self._datas
        design_percents.reverse()
        workingdates.reverse()

        y = c['dayaxis_y']
        c['daywidth'] = c['dayaxiswidth'] * 1.0 / len(workingdates)

        if draw:
            for i, date in enumerate(workingdates):
                x = c['leftwidth'] + c['dayaxiswidth'] - c['daywidth'] * i
                self._dw.line((x, c['height'] - c['bottomheight'], x, c['height'] - c['bottomheight'] - c['percentaxisheight']), fill=c['gridcolor'])
                height = c['dayaxisscaleheight']
                if i == 0:
                    self._drawlittleXtext(date, x, y, c['dayaxisbetweentext'])
                self._drawlittleXscale(x, y, height)
            x = c['leftwidth'] + c['dayaxiswidth'] - c['daywidth'] * (len(workingdates))
            self._drawlittleXtext(workingdates[-1], x, y, 5)

    def DrawScaleMonth(self):
        c = self._config
        design_percents, workingdates = self._datas
        workingdates.reverse()

        scale_height = 15
        y = c['height'] - (c['bottomheight'] + c['percentaxisheight']) - scale_height
        c['daywidth'] = c['dayaxiswidth'] * 1.0 / len(workingdates)

        start_x = c['leftwidth']
        month_line_x = [start_x]
        month_string = []
        for i, _ in enumerate(workingdates):
            x = c['leftwidth'] + c['daywidth'] * (i + 1)
            if i == len(workingdates) - 1:
                month_line_x.append(x)
                continue
            if ((i + 1) % 30) == 0:
                month_string.append(f'{i + 31}')
                month_line_x.append(x)
        s = workingdates[0]
        if s not in month_string:
            month_string.insert(0, '30')
        month_string[-1] = len(workingdates)

        self._dw.line((c['leftwidth'], y - scale_height, c['leftwidth'] + c['dayaxiswidth'], y - scale_height), fill=c['tablebordercolor'])
        self._dw.line((c['leftwidth'], y + scale_height, c['leftwidth'] + c['dayaxiswidth'], y + scale_height), fill=c['tablebordercolor'])

        for i in range(len(month_line_x) - 1):
            mid = (month_line_x[i] + month_line_x[i + 1]) / 2
            s = month_string[i]
            self._dw.text((mid - 15, y - scale_height / 2), str(s), font=c['gantt_bar_dir_fontsize'], fill=self._config['dayaxiscolor'])
            self._dw.line((month_line_x[i], y + scale_height, month_line_x[i], y - scale_height), fill=c['tablebordercolor'])
            self._dw.line((month_line_x[i + 1], y + scale_height, month_line_x[i + 1], y - scale_height), fill=c['tablebordercolor'])

    def DrawSchLine(self):
        c = self._config
        design_percents, workingdates = self._datas

        for i, data in enumerate(design_percents):
            _d = data['日期']
            if _d <= workingdates[-1]:
                x = c['leftwidth'] + c['dayaxiswidth'] - c['daywidth'] * (len(workingdates) - 1)
            else:
                try:
                    x = c['leftwidth'] + c['dayaxiswidth'] - c['daywidth'] * workingdates.index(_d)
                except ValueError:
                    x = c['leftwidth']

            x0 = x
            design_y0 = c['dayaxis_y'] - data['預定累計進度'] * c['pixel_per_percent']
            try:
                x1 = c['leftwidth'] + c['dayaxiswidth'] - c['daywidth'] * workingdates.index(design_percents[i + 1]['日期'])
            except Exception:
                x1 = c['leftwidth']

            if i < len(design_percents) - 1:
                design_y1 = c['dayaxis_y'] - design_percents[i + 1]['預定累計進度'] * c['pixel_per_percent']
            else:
                design_y1 = c['dayaxis_y']

            self._dw.line((x0, design_y0, x1, design_y1), width=3, fill=c['design_percent_linecolor'])

    def DrawLinkLine(self, items):
        c = self._config
        _, workingdates = self._datas
        max_n = len(workingdates)
        c['daywidth'] = c['dayaxiswidth'] * 1.0 / len(workingdates)
        x0 = c['leftwidth'] + c['daywidth']
        y0 = c['height'] - c['bottomheight'] - c['percentaxisheight']
        bar_height = c['gantt_bar_height']
        interval = c['percentaxisheight'] / max(1, len(items))
        item_positions = {}
        item_positions_ids = []
        if interval > bar_height:
            for n, j in enumerate(items):
                subs = j['subs'] if j['show_split_bar'] else [j]
                for ni, i in enumerate(subs):
                    es = min(i['es'] - 1, max_n)
                    ef = min(i['ef'] - 1, max_n)
                    x1, x2 = x0 + c['daywidth'] * (es - 1), x0 + c['daywidth'] * ef
                    y1, y2 = y0 + interval * n, y0 + interval * n + bar_height
                    if ni == 0:
                        item_positions[j['id']] = {'item': i, 'pos': [x1, y1, x2, y2]}
                        item_positions_ids.append(j['id'])
                    item_positions[i['id']] = {'item': i, 'pos': [x1, y1, x2, y2]}
                    item_positions_ids.append(i['id'])

        split_with = 15
        for i_id in item_positions_ids:
            item = item_positions[i_id]['item']
            x1, y1, x2, y2 = item_positions[i_id]['pos']
            for link in item['get_link']:
                if int(link['target']) not in item_positions:
                    continue
                a1, b1, a2, b2 = item_positions[int(link['target'])]['pos']
                if link['type'] in ['0', '2']:
                    l1 = ((x2, y1 + bar_height / 2.0), (x2 + split_with, y1 + bar_height / 2.0))
                else:
                    l1 = ((x1, y1 + bar_height / 2.0), (x1 - split_with, y1 + bar_height / 2.0))

                if link['type'] in ['0', '1']:
                    l2 = ((a1, b1 + bar_height / 2.0), (a1 - split_with, b1 + bar_height / 2.0))
                    p1 = (l2[0][0], l2[0][1])
                    p2 = (l2[0][0] - split_with / 1.5, l2[0][1] - bar_height / 2.0)
                    p3 = (l2[0][0] - split_with / 1.5, l2[0][1] + bar_height / 2.0)
                else:
                    l2 = ((a2, b1 + bar_height / 2.0), (a2 + split_with, b1 + bar_height / 2.0))
                    p1 = (l2[0][0], l2[0][1])
                    p2 = (l2[0][0] + split_with / 1.5, l2[0][1] - bar_height / 2.0)
                    p3 = (l2[0][0] + split_with / 1.5, l2[0][1] + bar_height / 2.0)

                l3 = l4 = l5 = l1
                if l1[1][1] == l2[1][1]:
                    l3 = ((l1[1][0], l1[1][1]), (l2[1][0], l2[1][1]))
                elif link['type'] == '0':
                    if l1[1][0] < l2[1][0]:
                        l3 = ((l1[1][0], l1[1][1]), (l1[1][0], l2[1][1]))
                        l4 = ((l1[1][0], l2[1][1]), (l2[1][0], l2[1][1]))
                    else:
                        l3 = ((l1[1][0], l1[1][1]), (l1[1][0], l1[1][1] + interval / 2.0))
                        l4 = ((l1[1][0], l1[1][1] + interval / 2.0), (l2[1][0], l1[1][1] + interval / 2.0))
                        l5 = ((l2[1][0], l1[1][1] + interval / 2.0), (l2[1][0], l2[1][1]))
                elif link['type'] == '1':
                    if l1[1][0] < l2[1][0]:
                        l3 = ((l1[1][0], l1[1][1]), (l1[1][0], l2[1][1]))
                        l4 = ((l1[1][0], l2[1][1]), (l2[1][0], l2[1][1]))
                    else:
                        l3 = ((l1[1][0], l1[1][1]), (l2[1][0], l1[1][1]))
                        l4 = ((l2[1][0], l1[1][1]), (l2[1][0], l2[1][1]))
                elif link['type'] == '2':
                    if l1[1][0] < l2[1][0]:
                        l3 = ((l1[1][0], l1[1][1]), (l2[1][0], l1[1][1]))
                        l4 = ((l2[1][0], l1[1][1]), (l2[1][0], l2[1][1]))
                    else:
                        l3 = ((l1[1][0], l1[1][1]), (l1[1][0], l2[1][1]))
                        l4 = ((l1[1][0], l2[1][1]), (l2[1][0], l2[1][1]))
                elif link['type'] == '3':
                    if l1[1][0] < l2[1][0]:
                        l3 = ((l1[1][0], l1[1][1]), (l1[1][0], l1[1][1] + interval / 2.0))
                        l4 = ((l1[1][0], l1[1][1] + interval / 2.0), (l2[1][0], l1[1][1] + interval / 2.0))
                        l5 = ((l2[1][0], l1[1][1] + interval / 2.0), (l2[1][0], l2[1][1]))
                    else:
                        l3 = ((l1[1][0], l1[1][1]), (l2[1][0], l1[1][1]))
                        l4 = ((l2[1][0], l1[1][1]), (l2[1][0], l2[1][1]))

                for seg in (l1, l2, l3, l4, l5):
                    self._dw.line(seg, width=3, fill=c['link_linecolor'])
                self._dw.polygon([p1, p2, p3], fill=c['link_linecolor'])

        workingdates.reverse()

    def DrawGatttBar(self, items, unit_type):
        if not items:
            return
        self.DrawLinkLine(items)
        c = self._config
        tx4 = c['leftwidth'] - 80
        ty1 = c['height'] - c['bottomheight'] - c['percentaxisheight'] - 30
        tx5 = c['leftwidth']
        ty2 = c['height'] - c['bottomheight']
        ty3 = ty2 + 40
        tx1 = 10
        tx2 = tx1 + 100
        tx3 = tx4 - 100

        self._dw.line(((tx1, ty1), (tx5, ty1)), fill=c['tablebordercolor'])
        self._dw.line(((tx1, ty2), (tx5, ty2)), fill=c['tablebordercolor'])
        self._dw.line(((tx1, ty1 + 30), (tx4, ty1 + 30)), fill=c['tablebordercolor'])
        self._dw.line(((tx1, ty3), (tx4, ty3)), fill=c['tablebordercolor'])
        self._dw.line(((tx1, ty1), (tx1, ty3)), fill=c['tablebordercolor'])
        self._dw.text((tx1 + 30, ty1 + 5), '項次', font=c['gantt_bar_dir_fontsize'], fill=self._config['tablebordercolor'])
        self._dw.line(((tx2, ty1), (tx2, ty3)), fill=c['tablebordercolor'])
        self._dw.text((tx2 + (tx3 - tx2) / 2 - 40, ty1 + 5), '工項名稱', font=c['gantt_bar_dir_fontsize'], fill=self._config['tablebordercolor'])
        self._dw.line(((tx3, ty1), (tx3, ty3)), fill=c['tablebordercolor'])
        self._dw.text((tx3 + 20, ty1 + 5), f'權重({unit_type})', font=c['gantt_bar_dir_fontsize'], fill=self._config['tablebordercolor'])
        self._dw.line(((tx4, ty1), (tx4, ty3)), fill=c['tablebordercolor'])
        self._dw.line(((tx5, ty1), (tx5, ty2)), fill=c['tablebordercolor'])
        self._dw.text((tx3 - 45, ty2 + 15), '合計', font=c['gantt_bar_dir_fontsize'], fill=self._config['dayaxiscolor'])

        sum_unit_price = 0
        _, workingdates = self._datas
        max_n = len(workingdates)
        c['daywidth'] = c['dayaxiswidth'] * 1.0 / len(workingdates)
        x0 = c['leftwidth'] + c['daywidth']
        y0 = c['height'] - c['bottomheight'] - c['percentaxisheight']
        bar_height = c['gantt_bar_height']
        interval = c['percentaxisheight'] / len(items)

        if interval > bar_height:
            for n, j in enumerate(items):
                cleaned = j['name'].replace('。', '中').replace('『', '中').replace('』', '中').replace('，', '中').replace('、', '中')
                name_analysis = str_count(cleaned)
                if (name_analysis.total + name_analysis.zh) > 27:
                    s = 12
                    name_analysis = str_count(cleaned[:s])
                    while s < len(cleaned) and (name_analysis.total + name_analysis.zh) < 27:
                        s += 1
                        name_analysis = str_count(cleaned[:s])
                    name = j['name'][:s] + '...'
                else:
                    name = j['name']
                subs = j['subs'] if j['show_split_bar'] else [j]
                y1 = y0 + interval * n
                last_sub = subs[-1]
                for ni, i in enumerate(subs):
                    es = min(i['es'] - 1, max_n)
                    ef = min(i['ef'] - 1, max_n)
                    x1, x2 = x0 + c['daywidth'] * (es - 1), x0 + c['daywidth'] * ef
                    y1, y2 = y0 + interval * n, y0 + interval * n + bar_height
                    if ni == 0:
                        self._dw.text((tx2 + 5, y1 + 3), str(name), font=c['gantt_bar_dir_fontsize'], fill=self._config['dayaxiscolor'])
                    fill_color = c['gantt_bar_dir_color'] if i['kind__value'] == '目錄' else c['gantt_bar_item_color']
                    self._dw.rectangle(((x1, y1), (x2, y2)), fill=fill_color)
                    if i['cp']:
                        width = 3
                        color = c['cp_item_color']
                        self._dw.text((x1 + 3, y1 + 3), '★', font=c['gantt_bar_dir_fontsize'], fill=self._config['dayaxiscolor'])
                    else:
                        width = 1
                        color = c['tablebordercolor']
                    self._dw.line(((x1, y1), (x2, y1)), width=width, fill=color)
                    self._dw.line(((x1, y1), (x1, y2)), width=width, fill=color)
                    self._dw.line(((x2, y1), (x2, y2)), width=width, fill=color)
                    self._dw.line(((x1, y2), (x2, y2)), width=width, fill=color)
                    if j['show_split_bar']:
                        unit_price_str = cutzero(round_fix(i['unit_price'], 3))
                        self._dw.text((x2 - 10 - len(unit_price_str) * 9, y1 + 3), unit_price_str, font=c['gantt_bar_dir_fontsize'], fill=self._config['dayaxiscolor'])
                    last_sub = i

                if (j['kind__value'] == '目錄' and j['show_split_bar']) or j['kind__value'] != '目錄':
                    unit_price_str = cutzero(round_fix(j['unit_price'], 3))
                    self._dw.text((tx4 - 10 - len(unit_price_str) * 9, y1 + 3), unit_price_str, font=c['gantt_bar_dir_fontsize'], fill=self._config['dayaxiscolor'])
                    sum_unit_price += last_sub['unit_price']

                symbol = j['symbol']
                if len(symbol) > 7:
                    symbol = symbol[:7] + '...'
                self._dw.text((tx1 + 5, y1 + 3), str(symbol), font=c['gantt_bar_dir_fontsize'], fill=self._config['dayaxiscolor'])
                if n != len(items) - 1:
                    self._dw.line(((tx1, y1 + (interval + bar_height) / 2), (tx4, y1 + (interval + bar_height) / 2)), fill=c['tablebordercolor'])

        sum_str = cutzero(round_fix(sum_unit_price, 3))
        self._dw.text((tx4 - 10 - len(sum_str) * 9, ty2 + 15), sum_str, font=c['gantt_bar_dir_fontsize'], fill=self._config['dayaxiscolor'])
        workingdates.reverse()

    def DrawBottomProgressTable(self, full_data_days_design=None):
        if full_data_days_design is None:
            full_data_days_design = []
        c = self._config
        _, workingdates = self._datas
        max_n = len(workingdates)

        design_percents = full_data_days_design
        workingdates.reverse()
        design_percents_dict = {data['日期']: [data['預定累計進度'], i + 1] for i, data in enumerate(design_percents)}

        max_td = 17
        if max_n < max_td * 7:
            td_range = 7
        elif max_n < max_td * 15:
            td_range = 15
        elif max_n < max_td * 30:
            td_range = 30
        else:
            td_range = 30
            for r in range(30, 60):
                td_range = r
                if int(max_n / td_range * 1.0) <= max_td:
                    break

        tx4 = c['leftwidth'] - 95
        tx5 = c['leftwidth']
        tx6 = tx5 + c['dayaxiswidth']
        td_h = 30
        ty1 = c['height'] - c['bottomheight'] + 40
        ty2 = ty1 + td_h
        ty3 = ty1 + td_h * 1
        ty4 = ty1 + td_h * 2
        ty5 = ty1 + td_h * 3

        self._dw.line(((tx4, ty1), (tx6, ty1)), fill=c['tablebordercolor'])
        self._dw.text((tx4 + 40, ty1 + 8), '天數', font=c['table_thead_fontsize_16'], fill=self._config['tablebordercolor'])
        self._dw.line(((tx4, ty2), (tx6, ty2)), fill=c['tablebordercolor'])
        self._dw.line(((tx4, ty3), (tx6, ty3)), fill=c['tablebordercolor'])
        self._dw.text((tx4 + 25, ty3 + 8), '預定(%)', font=c['table_thead_fontsize_16'], fill=self._config['tablebordercolor'])
        self._dw.line(((tx4, ty4), (tx6, ty4)), fill=c['tablebordercolor'])
        self._dw.text((tx4 + 5, ty4 + 8), '累積預定(%)', font=c['table_thead_fontsize_16'], fill=self._config['tablebordercolor'])
        self._dw.line(((tx4, ty5), (tx6, ty5)), fill=c['tablebordercolor'])

        self._dw.line(((tx4, ty1), (tx4, ty5)), fill=c['tablebordercolor'])
        self._dw.line(((tx5, ty1), (tx5, ty5)), fill=c['tablebordercolor'])
        self._dw.line(((tx6, ty1), (tx6, ty5)), fill=c['tablebordercolor'])

        seed = 0
        last_sch_progress = 0
        while (seed + td_range) < max_n and (max_n - (seed + td_range) > (td_range / 2)):
            seed += td_range
            x = tx5 + c['daywidth'] * seed
            self._dw.line((x, ty1, x, ty5), fill=c['tablebordercolor'])
            sch_date = seed
            while sch_date not in design_percents_dict and design_percents_dict and sch_date >= design_percents[0]['日期']:
                sch_date -= 1

            self._dw.text((x - 36, ty1 + 8), str(seed), font=c['gantt_bar_dir_fontsize'], fill=self._config['tablebordercolor'])
            if sch_date not in design_percents_dict:
                value = 0
                last_sch_progress = 0
            else:
                value = design_percents_dict[sch_date][0] - last_sch_progress
                last_sch_progress = design_percents_dict[sch_date][0]
            val_str = cutzero(round_fix(value, 3))
            self._dw.text((x - 10 - len(val_str) * 9, ty3 + 8), val_str, font=c['gantt_bar_dir_fontsize'], fill=self._config['tablebordercolor'])

            cum_val = 0 if sch_date not in design_percents_dict else design_percents_dict[sch_date][0]
            cum_str = cutzero(round_fix(cum_val, 3))
            self._dw.text((x - 10 - len(cum_str) * 9, ty4 + 8), cum_str, font=c['gantt_bar_dir_fontsize'], fill=self._config['tablebordercolor'])

        sch_date = workingdates[-1]
        while sch_date not in design_percents_dict and design_percents_dict and sch_date >= design_percents[0]['日期']:
            sch_date -= 1

        self._dw.text((tx6 - 36, ty1 + 8), str(int(max_n)), font=c['gantt_bar_dir_fontsize'], fill=self._config['tablebordercolor'])
        value = 0 if sch_date not in design_percents_dict else design_percents_dict[sch_date][0] - last_sch_progress
        val_str = cutzero(round_fix(value, 3))
        self._dw.text((tx6 - 10 - len(val_str) * 9, ty3 + 8), val_str, font=c['gantt_bar_dir_fontsize'], fill=self._config['tablebordercolor'])

        cum_val = 0 if sch_date not in design_percents_dict else design_percents_dict[sch_date][0]
        cum_str = cutzero(round_fix(cum_val, 3))
        self._dw.text((tx6 - 10 - len(cum_str) * 9, ty4 + 8), cum_str, font=c['gantt_bar_dir_fontsize'], fill=self._config['tablebordercolor'])

        design_percents.reverse()
        workingdates.reverse()

    def DrawTitle(self, title=''):
        c = self._config
        self._dw.text((c['title_x'] - 120, c['title_y']), str(title), font=c['titlefontsize'], fill=self._config['dayaxiscolor'])
        self._dw.rectangle(((c['design_x1'], c['design_y1']), (c['design_x2'], c['design_y2'])), fill=c['design_percent_linecolor'])
        self._dw.text((c['design_x'], c['design_y']), '預定進度', font=c['dayaxisfontsize'], fill=self._config['dayaxiscolor'])

    def DrawPercentAxis(self, draw=True):
        c = self._config
        x = c['leftwidth']
        init_y = c['height'] - c['bottomheight']
        if draw:
            self._dw.line((x, init_y, x, init_y - c['percentaxisheight']), fill=c['dayaxiscolor'])
        c['pixel_per_percent'] = c['percentaxisheight'] * 1.0 / self._maxpercent

        for i in range(1, 11):
            y = init_y - c['pixel_per_percent'] * i * 10
            if draw:
                self._drawlittleYscale(x, y, c['dayaxisscaleheight'])
                self._drawlittleYtext(str(i * 10), x, y, c['dayaxisbetweentext'])
                self._dw.line((c['leftwidth'], y, c['leftwidth'] + c['dayaxiswidth'], y), fill=c['gridcolor'])
        if self._maxpercent >= 103:
            y = init_y - c['pixel_per_percent'] * self._maxpercent
            if draw:
                self._drawlittleYscale(x, y, c['dayaxisscaleheight'])
                self._drawlittleYtext(str(int(self._maxpercent)), x, y, c['dayaxisbetweentext'])
                self._dw.line((c['leftwidth'], y, c['leftwidth'] + c['dayaxiswidth'], y), fill=c['gridcolor'])

    def _drawlittleYtext(self, text, x, y, width):
        c = self._config
        text_w, text_h = self._textsize(str(text), font=c['dayaxisfontsize'])
        self._dw.text((x - width / 2 - text_w, y - (text_h / 2)), str(text), font=c['dayaxisfontsize'], fill=self._config['dayaxiscolor'])

    def _drawlittleYscale(self, x, y, height):
        self._dw.line((x - height, y, x + height, y), fill=self._config['dayaxiscolor'])

    def _drawlittleXscale(self, x, y, height):
        self._dw.line((x, y - height, x, y + height), fill=self._config['dayaxiscolor'])

    def DrawScheduleDay(self, day):
        c = self._config
        _, text_h = self._textsize(f'預定進度設定總天數：{day}', font=c['dayaxisfontsize'])
        self._dw.text((c['enddate_x'] + 1200, c['enddate_y'] + text_h), f'預定進度設定總天數：{day}', font=c['dayaxisfontsize'], fill=self._config['dayaxiscolor'])

    def _drawlittleXtext(self, text, x, y, height):
        c = self._config
        text = str(text)
        text_w, _ = self._textsize(text, font=c['dayaxisfontsize'])
        i = c['dayaxistextheight'] % 4 + 1
        color = self._config['yearfontcolor'] if len(text) == 8 else self._config['dayaxiscolor']
        self._dw.text((x - (text_w / 2), y + height * i), text, font=c['dayaxisfontsize'], fill=color)
        c['dayaxistextheight'] += 1

    def SaveChart(self, filename='test.png'):
        self._im.save(filename, self._config['fileformat'])

    def SetItem(self, datas):
        self._maxpercent = datas[0][-1]['預定累計進度'] if datas[0] else 100
        if self._maxpercent < 100:
            self._maxpercent = 100
        self._datas = datas


def make_gantt_schedule_png_call(data, f_type='response'):
    content = do_make_gantt_schedule_png(data)
    if f_type == 'response':
        response = HttpResponse(content, content_type='image/png')
        response['Content-Disposition'] = 'attachment; filename=gantt.png'
        return response
    return content


def do_make_gantt_schedule_png(data):
    draw_other_line = data['only_s_curve'] is False
    pc = ProgressChart(items_num=len(data['items']) if data['gantta'] else 0)
    pc.SetItem((data['multi_version_design_percents'], data['working_dates']))
    pc.NewChart(draw_other_line=draw_other_line)
    pc.DrawDayAxis(draw=draw_other_line)
    pc.DrawPercentAxis(draw=draw_other_line)
    pc.DrawX(draw=draw_other_line)

    if draw_other_line:
        if data['gantta']:
            pc.DrawGatttBar(data['items'], '%')
        pc.DrawScheduleDay(day=len(data['working_dates']))
        pc.DrawBottomProgressTable(full_data_days_design=data['full_data_days_design'])

    pc.DrawSchLine()
    pc.DrawScaleMonth()
    pc.DrawTitle(title='預定進度精靈進度管理S曲線圖')

    buf = BytesIO()
    pc.SaveChart(buf)
    png = buf.getvalue()
    buf.close()
    return png
