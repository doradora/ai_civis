/**
 * Interactive Multi-Level WBS Tree Planner (0. WBS 工項架構)
 * Connects directly to /schedule/api/active/version_schedule/<id>/wbs_tree/,
 * /wbs_action/, and /import_wbs_json/.
 */
(function (global, $) {
    'use strict';

    function escHtml(str) {
        return String(str === null || str === undefined ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function fmtMoney(val) {
        if (val === null || val === undefined || isNaN(Number(val))) {
            return '<span class="text-muted">—</span>';
        }
        return Math.round(Number(val)).toLocaleString('zh-TW') + ' 元';
    }

    function fmtDayPill(dayVal, tooltip) {
        if (dayVal === null || dayVal === undefined || dayVal === '') {
            return '<span class="sc-wbs-day-pending" title="完成步驟 1 網圖計算後自動連動顯示">待計算</span>';
        }
        var titleAttr = tooltip ? (' title="' + escHtml(tooltip) + '"') : '';
        return '<span class="sc-wbs-day-pill"' + titleAttr + '>第 <strong>' + dayVal + '</strong> 天</span>';
    }

    function fmtCpCell(hasResult, isCp, floatDays) {
        if (!hasResult) {
            return '<span class="text-muted small" title="完成步驟 1 網圖計算後自動標示要徑">—</span>';
        }
        if (isCp) {
            return '<span class="sc-wbs-cp-badge is-cp" title="要徑工項（總浮時 0 天）"><span class="material-icons">check</span></span>';
        }
        var fTip = (floatDays !== null && floatDays !== undefined) ? ('非要徑（總浮時 ' + floatDays + ' 天）') : '非要徑工項';
        return '<span class="sc-wbs-cp-badge" title="' + escHtml(fTip) + '"></span>';
    }

    function stageBadgeHtml(code, label) {
        if (code === 'done') {
            return '<span class="badge rounded-pill bg-success-subtle text-success border border-success-subtle">' + escHtml(label) + '</span>';
        }
        if (code === 'step2') {
            return '<span class="badge rounded-pill bg-primary-subtle text-primary border border-primary-subtle">' + escHtml(label) + '</span>';
        }
        return '<span class="badge rounded-pill bg-warning-subtle text-warning-emphasis border border-warning-subtle">' + escHtml(label) + '</span>';
    }

    class WbsPlanner {
        constructor(options) {
            this.versionId = options.versionId;
            this.mountEl = options.mountEl;
            this.onStructureChanged = typeof options.onStructureChanged === 'function' ? options.onStructureChanged : null;
            this.tree = null;
            this.collapsed = {}; // nodeId -> bool
            this.dirtyItems = {}; // itemId -> { id, name, duration, unit_price }
            this._bindGlobalEvents();
        }

        _headers() {
            return { 'X-CSRFToken': global.CSRFMIDDLEWARETOKEN || '' };
        }

        hasUnsavedEdits() {
            return Object.keys(this.dirtyItems).length > 0;
        }

        _updateSaveButtonState() {
            var count = Object.keys(this.dirtyItems).length;
            var $btn = $('#wbs-save-all-btn');
            if (count > 0) {
                $btn.removeClass('sc-btn-outline-clean').addClass('sc-btn-success-solid')
                    .prop('disabled', false)
                    .find('.js-save-label').text('儲存修改 (' + count + ')');
            } else {
                $btn.removeClass('sc-btn-success-solid').addClass('sc-btn-outline-clean')
                    .prop('disabled', true)
                    .find('.js-save-label').text('已儲存');
            }
        }

        load() {
            var self = this;
            if (!this.mountEl) return;
            $(this.mountEl).html('<div class="text-center text-secondary py-5"><div class="spinner-border spinner-border-sm text-primary me-2"></div>載入 WBS 工項架構中...</div>');
            $.ajax({
                url: '/schedule/api/active/version_schedule/' + this.versionId + '/wbs_tree/',
                type: 'GET',
                dataType: 'json',
                success: function (res) {
                    if (res && res.status && res.tree) {
                        self.tree = res.tree;
                        self.dirtyItems = {};
                        self.render();
                    } else {
                        $(self.mountEl).html('<div class="alert alert-danger m-3">無法載入 WBS 樹狀結構。</div>');
                    }
                },
                error: function () {
                    $(self.mountEl).html('<div class="alert alert-danger m-3">讀取 WBS 樹狀結構失敗，請重新整理再試。</div>');
                }
            });
        }

        _postAction(payload, onSuccess) {
            var self = this;
            $.ajax({
                url: '/schedule/api/active/version_schedule/' + this.versionId + '/wbs_action/',
                type: 'POST',
                data: JSON.stringify(payload),
                contentType: 'application/json',
                dataType: 'json',
                headers: self._headers(),
                success: function (res) {
                    if (res && res.status && res.tree) {
                        self.tree = res.tree;
                        self.dirtyItems = {};
                        self.render();
                        if (self.onStructureChanged) self.onStructureChanged(res.tree);
                        if (typeof onSuccess === 'function') onSuccess(res);
                    } else {
                        Lobibox.notify('warning', { title: '無法執行', msg: (res && res.msg) || '操作失敗' });
                    }
                },
                error: function (xhr) {
                    var msg = (xhr.responseJSON && xhr.responseJSON.msg) || '操作失敗，請稍後再試';
                    Lobibox.notify('warning', { title: '提示', msg: msg });
                }
            });
        }

        savePendingEdits(callback) {
            var ids = Object.keys(this.dirtyItems);
            if (!ids.length) {
                if (typeof callback === 'function') callback();
                return;
            }
            var items = ids.map(function (k) { return this.dirtyItems[k]; }, this);
            this._postAction({ action: 'save_items', items: items }, function () {
                Lobibox.notify('success', { title: '已儲存', msg: 'WBS 工項修改已儲存並同步至網圖。' });
                if (typeof callback === 'function') callback();
            });
        }

        _renderLevelHeaderRow(lvlTree, depth) {
            var indentPx = depth * 24;
            var weightCls = lvlTree.weight_valid ? 'text-success bg-success-subtle border-success-subtle' : 'text-danger bg-danger-subtle border-danger-subtle';
            var weightTxt = lvlTree.weight_valid
                ? '100% ✓'
                : (lvlTree.weight_total + '%（差額 ' + (lvlTree.weight_diff > 0 ? '+' : '') + lvlTree.weight_diff + '%）');
            var overrunHtml = lvlTree.overrun_days > 0
                ? '<span class="sc-overrun-pill ms-1">超期 +' + lvlTree.overrun_days + ' 天</span>'
                : '';
            var balanceBtn = lvlTree.editable && lvlTree.node_count > 0 && !lvlTree.weight_valid
                ? '<button type="button" class="btn btn-sm sc-btn-outline-clean sc-btn-sm py-0 px-2 js-wbs-balance" data-ver-id="' + lvlTree.version_id + '">配平100%</button>'
                : '';
            var addBtn = lvlTree.editable
                ? '<button type="button" class="btn btn-sm sc-btn-outline-clean sc-btn-sm py-0 px-2 js-wbs-add-item" data-ver-id="' + lvlTree.version_id + '"><span class="material-icons" style="font-size:14px;">add</span>工項</button>'
                : '';
            var openLink = depth > 0
                ? '<a href="' + escHtml(lvlTree.url) + '" class="btn btn-sm sc-btn sc-btn-primary py-0 px-2" style="font-size:0.74rem;">進入網圖</a>'
                : '';
            var deleteSubBtn = depth > 0
                ? '<button type="button" class="btn btn-sm btn-outline-danger py-0 px-1 js-wbs-delete-sub-ver" data-ver-id="' + lvlTree.version_id + '" data-ver-name="' + escHtml(lvlTree.project_name) + '" title="刪除此分項子網圖（連同其細項）"><span class="material-icons" style="font-size:15px;">delete_outline</span></button>'
                : '';
            var levelTag = depth === 0 ? 'L1 母網圖' : ('L' + (depth + 1) + ' 分項');
            var folderIcon = depth === 0 ? 'folder_open' : 'account_tree';
            var budgetVal = (lvlTree.budget !== null && lvlTree.budget !== undefined) ? lvlTree.budget : '';
            var levelDurText = lvlTree.has_schedule_result && lvlTree.cpm_max_day > 0
                ? (lvlTree.cpm_max_day + ' 日')
                : (lvlTree.duration > 0 ? (lvlTree.duration + ' 日') : '—');
            var levelDurTitle = '目標工期：' + lvlTree.duration + ' 日' + (lvlTree.cpm_max_day > 0 ? ('｜計算總工期：' + lvlTree.cpm_max_day + ' 日') : '');

            return '<tr class="sc-wbs-level-row depth-' + depth + '" data-level-ver-id="' + lvlTree.version_id + '" data-level-budget="' + budgetVal + '">' +
                '<td style="padding-left:' + (12 + indentPx) + 'px; white-space:nowrap;">' +
                    '<span class="badge rounded-pill bg-primary-subtle text-primary border border-primary-subtle">' + levelTag + '</span>' +
                '</td>' +
                '<td class="text-center"><span class="text-muted small">—</span></td>' +
                '<td>' +
                    '<div class="d-flex align-items-center flex-wrap gap-2">' +
                        '<span class="material-icons text-warning" style="font-size:18px;">' + folderIcon + '</span>' +
                        '<strong class="text-dark">' + escHtml(lvlTree.project_name) + '</strong>' +
                        '<span class="badge rounded-pill bg-dark-subtle text-dark">v' + lvlTree.version_number + '</span>' +
                        stageBadgeHtml(lvlTree.stage_code, lvlTree.stage_label) +
                        '<span class="small text-secondary">共 ' + lvlTree.node_count + ' 項</span>' +
                        overrunHtml +
                    '</div>' +
                '</td>' +
                '<td class="text-center fw-bold text-dark" title="' + escHtml(levelDurTitle) + '">' + levelDurText + '</td>' +
                '<td class="text-center">' + fmtDayPill(lvlTree.plan_start) + '</td>' +
                '<td class="text-center">' + fmtDayPill(lvlTree.plan_end) + '</td>' +
                '<td class="text-end">' +
                    '<span class="badge rounded-pill border js-level-weight-badge ' + weightCls + '">' + weightTxt + '</span>' +
                '</td>' +
                '<td class="text-end fw-bold text-dark sc-wbs-money js-level-budget-cell">' + fmtMoney(lvlTree.budget) + '</td>' +
                '<td class="text-end" style="white-space:nowrap;">' +
                    '<div class="d-inline-flex align-items-center gap-1">' +
                        balanceBtn + addBtn + openLink + deleteSubBtn +
                    '</div>' +
                '</td>' +
            '</tr>';
        }

        _renderNodesRecursive(lvlTree, depth) {
            var self = this;
            var html = this._renderLevelHeaderRow(lvlTree, depth);
            var nodes = lvlTree.nodes || [];

            if (!nodes.length) {
                html += '<tr class="sc-wbs-empty-row">' +
                    '<td colspan="9" style="padding-left:' + (28 + depth * 24) + 'px;" class="text-secondary small py-3">' +
                        '此層尚無工項，可點擊上方「+ 工項」或使用「匯入 WBS JSON」快速建立階層工項。' +
                    '</td>' +
                '</tr>';
                return html;
            }

            var lvlBudget = (lvlTree.budget !== null && lvlTree.budget !== undefined) ? Number(lvlTree.budget) : null;

            nodes.forEach(function (node, idx) {
                var hasSub = Boolean(node.sub_schedule);
                var isCollapsed = Boolean(self.collapsed[node.id]);
                var indentPx = depth * 24;
                var disabledAttr = lvlTree.editable ? '' : 'disabled';
                var toggleHtml = hasSub
                    ? '<button type="button" class="sc-wbs-expand-btn js-wbs-toggle" data-node-id="' + node.id + '" title="展開／收合分項子網圖">' +
                        '<span class="material-icons">' + (isCollapsed ? 'chevron_right' : 'expand_more') + '</span></button>'
                    : '<span class="sc-wbs-expand-placeholder"></span>';

                var itemIcon = hasSub
                    ? '<span class="material-icons text-primary" style="font-size:17px;" title="已展開分項子網圖">folder</span>'
                    : '<span class="material-icons text-secondary" style="font-size:16px;">description</span>';

                var subStatusHtml = '';
                if (hasSub) {
                    subStatusHtml = '<a href="' + escHtml(node.sub_schedule.url) + '" class="sc-wbs-sub-link" title="進入此節點之分項網圖">' +
                        '↳ ' + node.sub_schedule.node_count + ' 細項 · v' + node.sub_schedule.version_number +
                        ' (' + escHtml(node.sub_schedule.stage_label) + ')</a>';
                }

                var actionBtns = '';
                actionBtns += '<button type="button" class="btn btn-sm sc-btn-outline-clean sc-btn-sm py-0 px-2 js-wbs-add-child" data-item-id="' + node.id + '" title="在此工項下方新增分項子工項（自動建立分項子網圖）">+ 子項</button>';
                if (lvlTree.editable && idx > 0) {
                    actionBtns += '<button type="button" class="btn btn-sm sc-btn-outline-clean sc-btn-sm py-0 px-1 js-wbs-indent" data-item-id="' + node.id + '" title="降階移入上方工項之分項網圖"><span class="material-icons" style="font-size:15px;">format_indent_increase</span></button>';
                }
                if (lvlTree.editable && depth > 0) {
                    actionBtns += '<button type="button" class="btn btn-sm sc-btn-outline-clean sc-btn-sm py-0 px-1 js-wbs-outdent" data-item-id="' + node.id + '" title="升階移回上層母網圖"><span class="material-icons" style="font-size:15px;">format_indent_decrease</span></button>';
                }
                if (lvlTree.editable) {
                    actionBtns += '<button type="button" class="btn btn-sm btn-outline-danger py-0 px-1 js-wbs-delete" data-item-id="' + node.id + '" data-item-name="' + escHtml(node.name) + '" title="刪除此工項"><span class="material-icons" style="font-size:15px;">delete_outline</span></button>';
                }

                var schedTooltip = node.has_result
                    ? ('ES: 第' + (node.es + 1) + '天 / EF: 第' + node.ef + '天｜LS: 第' + (node.ls + 1) + '天 / LF: 第' + node.lf + '天｜總浮時: ' + (node.float_days || 0) + '天')
                    : '完成步驟 1 網圖計算後自動連動';

                html += '<tr class="sc-wbs-item-row' + (node.cp ? ' is-critical' : '') + '" data-item-id="' + node.id + '" data-ver-id="' + lvlTree.version_id + '" data-level-budget="' + (lvlBudget !== null ? lvlBudget : '') + '">' +
                    '<td style="padding-left:' + (10 + indentPx) + 'px; white-space:nowrap;">' +
                        '<div class="d-inline-flex align-items-center gap-1">' +
                            toggleHtml +
                            '<span class="sc-wbs-code">' + escHtml(node.wbs_code) + '</span>' +
                        '</div>' +
                    '</td>' +
                    '<td class="text-center">' + fmtCpCell(node.has_result, node.cp, node.float_days) + '</td>' +
                    '<td>' +
                        '<div class="d-flex align-items-center gap-1">' +
                            itemIcon +
                            '<input type="text" class="form-control form-control-sm sc-wbs-input js-wbs-field" data-field="name" value="' + escHtml(node.name) + '" ' + disabledAttr + '>' +
                            subStatusHtml +
                        '</div>' +
                    '</td>' +
                    '<td>' +
                        '<div class="sc-wbs-unit-wrap">' +
                            '<input type="number" class="form-control form-control-sm sc-wbs-num js-wbs-field" data-field="duration" min="1" step="1" value="' + node.duration + '" ' + disabledAttr + '>' +
                            '<span class="sc-wbs-unit">日</span>' +
                        '</div>' +
                    '</td>' +
                    '<td class="text-center" style="white-space:nowrap;">' + fmtDayPill(node.plan_start, schedTooltip) + '</td>' +
                    '<td class="text-center" style="white-space:nowrap;">' + fmtDayPill(node.plan_end, schedTooltip) + '</td>' +
                    '<td>' +
                        '<div class="sc-wbs-unit-wrap">' +
                            '<input type="number" class="form-control form-control-sm sc-wbs-num js-wbs-field" data-field="unit_price" min="0" max="100" step="0.01" value="' + Number(node.unit_price || 0).toFixed(2) + '" ' + disabledAttr + '>' +
                            '<span class="sc-wbs-unit">%</span>' +
                        '</div>' +
                    '</td>' +
                    '<td class="text-end sc-wbs-money js-wbs-price-cell" style="white-space:nowrap;">' + fmtMoney(node.allocated_price) + '</td>' +
                    '<td class="text-end" style="white-space:nowrap;">' +
                        '<div class="d-inline-flex align-items-center gap-1">' + actionBtns + '</div>' +
                    '</td>' +
                '</tr>';

                if (hasSub && !isCollapsed) {
                    html += self._renderNodesRecursive(node.sub_schedule, depth + 1);
                }
            });

            return html;
        }

        render() {
            if (!this.mountEl || !this.tree) return;
            var bodyHtml = this._renderNodesRecursive(this.tree, 0);
            var tableHtml =
                '<div class="table-responsive sc-wbs-table-wrap">' +
                    '<table class="table table-sm align-middle mb-0 sc-wbs-table">' +
                        '<thead>' +
                            '<tr>' +
                                '<th style="width:105px;">項次</th>' +
                                '<th style="width:54px;text-align:center;" title="由步驟 1 CPM 要徑分析自動算出">要徑</th>' +
                                '<th style="min-width:240px;">工項名稱（可直接編輯）</th>' +
                                '<th style="width:94px;text-align:center;">工期</th>' +
                                '<th style="width:96px;text-align:center;" title="連動步驟 1 網圖與步驟 2 甘特圖調整結果">預定開始</th>' +
                                '<th style="width:96px;text-align:center;" title="連動步驟 1 網圖與步驟 2 甘特圖調整結果">預定結束</th>' +
                                '<th style="width:108px;text-align:center;">花費比率 (%)</th>' +
                                '<th style="width:128px;text-align:right;" title="依契約金額與花費比率即時連動換算">換算價格 (元)</th>' +
                                '<th style="width:176px;text-align:right;">階層操作</th>' +
                            '</tr>' +
                        '</thead>' +
                        '<tbody>' + bodyHtml + '</tbody>' +
                    '</table>' +
                '</div>';
            $(this.mountEl).html(tableHtml);
            this._updateSaveButtonState();
        }

        _bindGlobalEvents() {
            var self = this;
            var $root = $(this.mountEl);

            // Track inline field edits + live-update price & level weight sum instantaneously
            $root.on('input change', '.js-wbs-field', function () {
                var $tr = $(this).closest('tr');
                var id = parseInt($tr.data('item-id'), 10);
                var verId = parseInt($tr.data('ver-id'), 10);
                if (!id) return;
                var rateVal = parseFloat($tr.find('[data-field="unit_price"]').val()) || 0;
                self.dirtyItems[id] = {
                    id: id,
                    name: $tr.find('[data-field="name"]').val(),
                    duration: $tr.find('[data-field="duration"]').val(),
                    unit_price: $tr.find('[data-field="unit_price"]').val()
                };
                $tr.addClass('is-dirty');

                // Instant price recalculation for this row
                var rawBudget = $tr.attr('data-level-budget');
                if (rawBudget !== '' && rawBudget !== undefined && !isNaN(Number(rawBudget)) && Number(rawBudget) > 0) {
                    var rowPrice = Math.round(Number(rawBudget) * (rateVal / 100));
                    $tr.find('.js-wbs-price-cell').html(fmtMoney(rowPrice));
                }

                // Instant weight sum badge recalculation for this level
                if (verId) {
                    var sum = 0;
                    $root.find('tr.sc-wbs-item-row[data-ver-id="' + verId + '"]').each(function () {
                        sum += parseFloat($(this).find('[data-field="unit_price"]').val()) || 0;
                    });
                    sum = Math.round(sum * 10000) / 10000;
                    var diff = Math.round((sum - 100) * 10000) / 10000;
                    var ok = Math.abs(diff) < 1e-4;
                    var $badge = $root.find('tr.sc-wbs-level-row[data-level-ver-id="' + verId + '"] .js-level-weight-badge');
                    if ($badge.length) {
                        $badge
                            .toggleClass('text-success bg-success-subtle border-success-subtle', ok)
                            .toggleClass('text-danger bg-danger-subtle border-danger-subtle', !ok)
                            .text(ok ? '100% ✓' : (sum + '%（差額 ' + (diff > 0 ? '+' : '') + diff + '%）'));
                    }
                }

                self._updateSaveButtonState();
            });

            // Expand / collapse sub-schedule tree
            $root.on('click', '.js-wbs-toggle', function () {
                var nodeId = $(this).data('node-id');
                self.collapsed[nodeId] = !self.collapsed[nodeId];
                self.render();
            });

            // Add sibling item in level
            $root.on('click', '.js-wbs-add-item', function () {
                var verId = parseInt($(this).data('ver-id'), 10);
                self.savePendingEdits(function () {
                    self._postAction({ action: 'add_item', target_version_id: verId });
                });
            });

            // Balance weights to 100% in level
            $root.on('click', '.js-wbs-balance', function () {
                var verId = parseInt($(this).data('ver-id'), 10);
                self.savePendingEdits(function () {
                    self._postAction({ action: 'balance_100', target_version_id: verId }, function () {
                        Lobibox.notify('success', { title: '配平完成', msg: '該層工項權重已依比例調整為 100%。' });
                    });
                });
            });

            // Add child item (auto-creates linked sub-schedule!)
            $root.on('click', '.js-wbs-add-child', function () {
                var itemId = parseInt($(this).data('item-id'), 10);
                self.collapsed[itemId] = false;
                self.savePendingEdits(function () {
                    self._postAction({ action: 'add_child_item', item_id: itemId }, function () {
                        Lobibox.notify('success', { title: '已新增分項子工項', msg: '已自動建立／更新對應分項子網圖。' });
                    });
                });
            });

            // Indent (demote into previous sibling's sub-schedule)
            $root.on('click', '.js-wbs-indent', function () {
                var itemId = parseInt($(this).data('item-id'), 10);
                self.savePendingEdits(function () {
                    self._postAction({ action: 'indent_item', item_id: itemId });
                });
            });

            // Outdent (promote back to parent schedule)
            $root.on('click', '.js-wbs-outdent', function () {
                var itemId = parseInt($(this).data('item-id'), 10);
                self.savePendingEdits(function () {
                    self._postAction({ action: 'outdent_item', item_id: itemId });
                });
            });

            // Delete entire sub-schedule version from WBS tree header
            $root.on('click', '.js-wbs-delete-sub-ver', function () {
                var verId = parseInt($(this).data('ver-id'), 10);
                var verName = $(this).data('ver-name') || '此分項子網圖';
                if (!verId) return;
                Lobibox.confirm({
                    title: '刪除分項子網圖確認',
                    msg: '確定要刪除分項子網圖「<strong>' + escHtml(verName) + '</strong>」嗎？（該子網圖下的細項與巢狀子網圖將一併移除，且無法恢復）',
                    buttons: {
                        accept: { 'class': 'lobibox-btn lobibox-btn-yes', text: '確定刪除', closeOnClick: true },
                        cancel: { 'class': 'lobibox-btn lobibox-btn-no', text: '取消', closeOnClick: true }
                    },
                    callback: function ($this, type) {
                        if (type !== 'accept') return;
                        $.ajax({
                            url: '/schedule/api/active/version_schedule/' + verId + '/',
                            type: 'DELETE',
                            dataType: 'json',
                            headers: self._headers(),
                            success: function () {
                                Lobibox.notify('success', { title: '已刪除', msg: '分項子網圖已刪除。' });
                                self.load();
                                if (self.onStructureChanged) self.onStructureChanged(self.tree);
                            },
                            error: function () {
                                Lobibox.notify('error', { title: '刪除失敗', msg: '無法刪除此分項子網圖，請稍後再試。' });
                            }
                        });
                    }
                });
            });

            // Delete item
            $root.on('click', '.js-wbs-delete', function () {
                var itemId = parseInt($(this).data('item-id'), 10);
                var itemName = $(this).data('item-name') || '';
                Lobibox.confirm({
                    title: '刪除工項確認',
                    msg: '確定要刪除工項「<strong>' + escHtml(itemName) + '</strong>」嗎？（若該工項下有分項網圖，分項網圖將會保留但解除母節點連結）',
                    buttons: {
                        accept: { 'class': 'lobibox-btn lobibox-btn-yes', text: '確定刪除', closeOnClick: true },
                        cancel: { 'class': 'lobibox-btn lobibox-btn-no', text: '取消', closeOnClick: true }
                    },
                    callback: function ($this, type) {
                        if (type !== 'accept') return;
                        self.savePendingEdits(function () {
                            self._postAction({ action: 'delete_item', item_id: itemId });
                        });
                    }
                });
            });
        }

        importJsonText(rawText, onDone) {
            var self = this;
            var parsed;
            try {
                parsed = JSON.parse(rawText);
            } catch (err) {
                Lobibox.notify('error', { title: 'JSON 格式錯誤', msg: String(err.message || err) });
                return;
            }
            $.ajax({
                url: '/schedule/api/active/version_schedule/' + this.versionId + '/import_wbs_json/',
                type: 'POST',
                data: JSON.stringify({ data: parsed }),
                contentType: 'application/json',
                dataType: 'json',
                headers: self._headers(),
                success: function (res) {
                    if (res && res.status) {
                        self.tree = res.tree;
                        self.dirtyItems = {};
                        self.render();
                        if (self.onStructureChanged) self.onStructureChanged(res.tree);
                        Lobibox.notify('success', {
                            title: 'WBS JSON 匯入成功',
                            msg: '已建立 ' + (res.created_items || 0) + ' 個工項、' + (res.created_sub_schedules || 0) + ' 份分項子網圖（格式：' + (res.format || 'JSON') + '）'
                        });
                        if (typeof onDone === 'function') onDone(res);
                    } else {
                        Lobibox.notify('error', { title: '匯入失敗', msg: (res && res.msg) || '格式錯誤' });
                    }
                },
                error: function (xhr) {
                    var msg = (xhr.responseJSON && xhr.responseJSON.msg) || '匯入失敗，請確認格式或先解除網圖鎖定';
                    Lobibox.notify('error', { title: '匯入失敗', msg: msg });
                }
            });
        }
    }

    global.WbsPlanner = WbsPlanner;
})(window, window.jQuery);
