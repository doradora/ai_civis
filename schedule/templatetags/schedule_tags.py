# -*- coding: utf-8 -*-
import re
from django import template

register = template.Library()


@register.filter
def cutzero(value, args=''):
    value = str(value)
    if '.' not in value:
        return value
    return re.sub(r'\.$', '', re.sub(r'0+$', '', value))


@register.filter
def decimal_format(value, args=0):
    if not args:
        return value
    try:
        value = round(float(value), int(args))
        return ('{:.%sf}' % (args)).format(value)
    except Exception:
        return value


@register.filter
def taiwan_date(value, args=''):
    if not value:
        return ''
    value = str(value)
    year, month, day = value.split('-')
    return '%s-%s-%s' % (int(year) - 1911, month.zfill(2), day.zfill(2))


@register.filter
def date_format(value, args=1):
    if not value:
        return ''
    try:
        value = str(value)
        year, month, day = value.split('-')
        if args == 1:
            return '%s-%s-%s' % (int(year) - 1911, month.zfill(2), day.zfill(2))
        if args == 2:
            return '%s/%s/%s' % (int(year) - 1911, month.zfill(2), day.zfill(2))
        if args == 3:
            return '%s年%s月%s日' % (int(year) - 1911, month.zfill(2), day.zfill(2))
        if args == 4:
            return '%s-%s-%s' % (int(year), month.zfill(2), day.zfill(2))
        if args == 5:
            return '%s/%s/%s' % (int(year), month.zfill(2), day.zfill(2))
        if args == 6:
            return '%s年%s月%s日' % (int(year), month.zfill(2), day.zfill(2))
    except Exception:
        return value
    return value


@register.filter
def taiwan_date_ch(value, args=''):
    if not value:
        return ''
    try:
        value = str(value)
        year, month, day = value.split('-')
        return '%s年%s月%s日' % (int(year) - 1911, month.zfill(2), day.zfill(2))
    except Exception:
        return value


@register.filter(is_safe=True)
def intcomma2(value):
    try:
        if not value:
            return value
        if float(value) < 1000:
            return value
        if float(value) < 0:
            minus, value = '-', -1 * float(value)
        else:
            minus = ''
        value = str(value)
        if value.count('.') == 1:
            x, y = value.split('.')
        else:
            x, y = value, 0
        x = int(x)
        result = ''
        while x >= 1000:
            x, r = divmod(x, 1000)
            result = ',%03d%s' % (r, result)
        if y:
            return '%s%d%s.%s' % (minus, x, result, y)
        return '%s%d%s' % (minus, x, result)
    except Exception:
        return value


@register.filter
def check_half_date(value):
    try:
        value = float(str(value).replace(' ', '').replace(',', '').replace('-', ''))
    except Exception:
        return ''
    if value - int(value) == 0.5:
        return '中午12點'
    return ''
