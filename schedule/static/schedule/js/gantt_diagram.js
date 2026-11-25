function initial_gantt() {
    gantt.config.scales = [
        { unit: "day", step: 1, format: dayScaleTemplate },
    ];
    gantt.config.min_column_width = 25; //每隔寬度

    var cpmConstrained = (typeof is_cpm_constrained !== 'undefined' && is_cpm_constrained);

    if (cpmConstrained) {
        gantt.config.columns = [
            { name: "text", label: "工項名稱", width: "*", tree: true, resize: true, min_width: 180 },
            {
                name: "cp", label: "要徑", width: 46, align: "center",
                template: function (item) {
                    return item.cp ? "<span style='color:#e11d48;font-weight:700;'>✓</span>" : "";
                }
            },
            { name: "duration", label: "工期", align: "right", width: 46 },
            {
                name: "cpm_tf", label: "浮時", width: 52, align: "right",
                template: function (item) {
                    var tf = parseInt(item.cpm_tf || 0, 10);
                    return tf > 0 ? ("<span style='color:#2563eb;font-weight:600;'>+" + tf + "</span>") : "<span style='color:#94a3b8;'>0</span>";
                }
            },
            { name: "unit_price", label: "進度(%)", align: "right", width: 56 }
        ];
        gantt.config.drag_resize = false;
        gantt.config.drag_links = false;
        gantt.config.drag_progress = false;
        gantt.config.details_on_dblclick = false;
        gantt.config.row_height = 38;
        gantt.config.bar_height = 24;
        gantt.templates.task_class = function (start, end, task) {
            if (task.cp || parseInt(task.cpm_tf || 0, 10) <= 0) {
                return "gantt_task_critical";
            }
            return "gantt_task_float";
        };
    } else {
        gantt.config.columns = [
            { name: "text", label: "工項名稱", width: "*", tree: true, resize: true, width: 200 },
            {
                name: "cp", label: "要徑", width: 50, align: "center",
                template: function (item) {
                    if (item.cp) return "✓";
                    return '';
                }
            },
            { name: "start_date", label: "開始時間", align: "center", hide: true },
            { name: "duration", label: "工期", align: "right", resize: true, width: 50 },
            { name: "unit_price", label: "進度(%)", resize: true, align: "right", width: 50 },
            { name: "add", label: "", width: 36 }
        ];
    }

    //左右拖動時 顯示日期
    gantt.templates.leftside_text = function (start, end, task) {
        var state = gantt.getState(),
            modes = gantt.config.drag_mode;

        var d = date_to_moment(start);
        var index_day = d.diff(moment(start_date), 'days') + 1;

        if (state.drag_id == task.id) {
            if (state.drag_mode == modes.move || (state.drag_mode == modes.resize && state.drag_from_start)) {
                return index_day;
            }
        }
        return "";
    };

    gantt.templates.rightside_text = function (start, end, task) {
        var state = gantt.getState(),
            modes = gantt.config.drag_mode;

        var d = date_to_moment(start);
        var index_day = d.diff(moment(start_date), 'days') + 1;
        if (state.drag_id == task.id) {
            if (state.drag_mode == modes.move || (state.drag_mode == modes.resize && !state.drag_from_start)) {
                return index_day;
            }
        }
        if (task['type'] != 'project' && task['type'] != 'milestone') {
            return String(task.unit_price) + '%';
        } else {
            return "";
        }
    };

    gantt.templates.lightbox_header = function (start_date, end_date, task) {
        return (gantt.templates.task_text("", "", task)).substr(0, 70);
    };

    gantt.form_blocks["my_input"] = {
        render: function (sns) {
            return "<input type='text' style='width:90%;margin:0 10 0 10;'>";
        },
        set_value: function (node, value, task) {
            node.value = value || "";
        },
        get_value: function (node, task) {
            return node.value;
        },
        focus: function (node) {
            var a = node;
            a.select();
            a.focus();
        }
    };

    gantt.form_blocks["my_input_number"] = {
        render: function (sns) {
            return "<input type='number' style='width:90%;margin:0 10 0 10;'>";
        },
        set_value: function (node, value, task) {
            node.value = value || "";
        },
        get_value: function (node, task) {
            return node.value;
        },
        focus: function (node) {
            var a = node;
            a.select();
            a.focus();
        }
    };

    gantt.form_blocks["my_input_day"] = {
        render: function (sns) {
            return "<input type='number' style='width:60px;margin:0 10 0 10;'>";
        },
        set_value: function (node, value, task) {
            node.value = value || "";
        },
        get_value: function (node, task) {
            return node.value;
        },
        focus: function (node) {
            var a = node;
            a.select();
            a.focus();
        }
    };

    gantt.form_blocks["my_checkbox"] = {
        render: function (sns) {
            return "<input type='checkbox' style='width:20px;height:20px;margin:0 10 10 10;'>";
        },
        set_value: function (node, value, task) {
            $(node).prop('checked', value);
        },
        get_value: function (node, task) {
            return $(node).prop('checked');
        },
        focus: function (node) {
            var a = node;
            a.select();
            a.focus();
        }
    };
    gantt.config.lightbox.project_sections = [
        { name: "name_dir", map_to: "text", type: "my_input", focus: true },
        { name: "cp", map_to: "cp", type: "my_checkbox" },
    ];

    gantt.config.lightbox.sections = [
        { name: "name", map_to: "text", type: "my_input", focus: true },
        { name: "unit_price_False", map_to: "unit_price", type: "my_input_number" },
        { name: "range", height: 40, type: "template", map_to: "range_template" },
        { name: "cp", map_to: "cp", type: "my_checkbox" },
    ];

    gantt.attachEvent("onBeforeLightbox", function (id) {
        var task = gantt.getTask(id);
        if (!task['es']) {
            var sd = date_to_moment(task['start_date']);
            task['es'] = Math.max(sd.diff(moment(start_date), 'days') + 1, 1);
            task['ef'] = task['es'];
        };
        task.range_template = /*html*/`
            <div>
                <div class="form-group">
                    第
                    <input 
                        type="text" class="update_ef" type="number" name="es" style="width:60px;text-align: right" value="${task['es']}" aria-describedby="helpId" placeholder=""
                    >
                    天開始，工期：
                        <input 
                        type="text" class="update_ef" type="number" name="duration" style="width:60px;text-align: right;" value="${task['duration']}" aria-describedby="helpId" placeholder=""
                    >
                     (第 <span name="show_ef">${task['ef']}</span>天)
                    <input 
                        type="text" type="number" name="ef" style="width:60px;text-align: right;display:none" value="${task['ef']}" aria-describedby="helpId" placeholder=""
                    >
                </div>
            </div>
        `;
        return true;
    });

    var version_duration = parseInt($('#version_duration').html());
    var sch_end_date = moment(start_date).add(version_duration, 'd');
    var sch_end_date_marker = gantt.addMarker({
        start_date: new Date(sch_end_date.format('YYYY-MM-DD 00:00:00')), //a Date object that sets the marker's date
        css: "today", //a CSS class applied to the marker
        text: `目標天數(${version_duration})`, //the marker title
        title: `目標天數(${version_duration})` // the marker's tooltip
    });

    gantt.i18n.setLocale(gantt_cht);
    gantt.init("gantt_here", new Date(start_date), new Date(end_date));
    gantt.parse({
        tasks: item_data,
        links: item_links
    });

    // CPM 限制模式：鎖定要徑工項，並將非要徑工項拖曳嚴格限制在 [ES, LF] 區間內
    if (cpmConstrained) {
        function renderCpmFloatLayer() {
            var $barsArea = $('.gantt_bars_area');
            if (!$barsArea.length) return;
            var $layer = $barsArea.find('#cpm-float-layer');
            if (!$layer.length) {
                $layer = $('<div id="cpm-float-layer" class="gantt_cpm_float_layer"></div>');
                $barsArea.prepend($layer);
            }
            $layer.empty();

            var rowH = gantt.config.row_height || 38;
            var barH = gantt.config.bar_height || 24;
            gantt.eachTask(function (task) {
                if (!task || task.cp) return;
                var tf = parseInt(task.cpm_tf || 0, 10);
                var minEs = parseInt(task.cpm_min_start || 0, 10);
                var maxLf = parseInt(task.cpm_max_end || 0, 10);
                if (tf <= 0 || minEs <= 0 || maxLf < minEs) return;

                var winStart = new Date(moment(start_date).add(minEs - 1, 'd').format('YYYY-MM-DD 00:00:00'));
                var winEnd = new Date(moment(start_date).add(maxLf, 'd').format('YYYY-MM-DD 00:00:00'));
                var left = gantt.posFromDate(winStart);
                var right = gantt.posFromDate(winEnd);
                var rowTop = gantt.getTaskTop(task.id);
                if (left === null || right === null || rowTop === null || isNaN(left) || isNaN(right) || isNaN(rowTop)) return;

                var taskNode = gantt.getTaskNode ? gantt.getTaskNode(task.id) : null;
                var barTop = (taskNode && taskNode.style && taskNode.style.top)
                    ? parseInt(taskNode.style.top, 10)
                    : (rowTop + Math.floor((rowH - barH) / 2));
                var actualBarH = (taskNode && taskNode.offsetHeight) ? taskNode.offsetHeight : barH;

                var width = Math.max(8, right - left);
                var $bar = $('<div class="gantt_cpm_float_window"></div>');
                $bar.css({
                    left: left + 'px',
                    width: width + 'px',
                    top: barTop + 'px',
                    height: actualBarH + 'px'
                });
                $bar.attr('title', 'CPM 允許調整範圍：第 ' + minEs + ' 天 (ES) ～ 第 ' + maxLf + ' 天 (LF)，總浮時 +' + tf + ' 天');
                $layer.append($bar);
            });
        }

        gantt.attachEvent("onGanttRender", renderCpmFloatLayer);
        gantt.attachEvent("onDataRender", renderCpmFloatLayer);
        renderCpmFloatLayer();

        function clampTaskToCpmWindow(task) {
            var minEs = parseInt(task.cpm_min_start || 1, 10);
            var maxLf = parseInt(task.cpm_max_end || total_duration, 10);
            var dur = parseInt(task.cpm_duration || task.duration_old || 1, 10);
            var maxEs = Math.max(minEs, maxLf - dur + 1);

            var curEs = date_to_moment(task.start_date).diff(moment(start_date), 'days') + 1;
            var clampedEs = Math.min(maxEs, Math.max(minEs, curEs));
            var clampedEf = clampedEs + dur - 1;

            var d1 = moment(start_date).add(clampedEs - 1, 'd').format('YYYY-MM-DD 00:00:00');
            var d2 = moment(start_date).add(clampedEf, 'd').format('YYYY-MM-DD 00:00:00');
            task.start_date = new Date(d1);
            task.end_date = new Date(d2);
            task.es = clampedEs;
            task.ef = clampedEf;
            task.duration = dur;
            task.duration_old = dur;
        }

        gantt.attachEvent("onBeforeTaskDrag", function (id, mode, e) {
            var task = gantt.getTask(id);
            if (mode !== "move") return false;
            if (task.cp || parseInt(task.cpm_tf || 0, 10) <= 0) {
                Lobibox.notify('warning', {
                    title: 'CPM 限制',
                    msg: '要徑工項（TF = 0）已鎖定，不可移動。',
                    delay: 2200
                });
                return false;
            }
            return true;
        });

        gantt.attachEvent("onTaskDrag", function (id, mode, task, original) {
            if (mode === "move") {
                clampTaskToCpmWindow(task);
                scheduleLiveSCurveUpdate();
            }
        });

        gantt.attachEvent("onAfterTaskDrag", function (id, mode, e) {
            var task = gantt.getTask(id);
            clampTaskToCpmWindow(task);
            gantt.updateTask(id);
            $('.sc-preset-btn').removeClass('active');
            scheduleLiveSCurveUpdate();
        });

        function applyCpmPreset(mode) {
            var changed = false;
            gantt.batchUpdate(function () {
                gantt.eachTask(function (task) {
                    if (!task || task.type === 'project' || task.type === 'milestone') return;
                    if (task.cp || parseInt(task.cpm_tf || 0, 10) <= 0) return;

                    var minEs = parseInt(task.cpm_min_start || 1, 10);
                    var maxLf = parseInt(task.cpm_max_end || total_duration, 10);
                    var dur = parseInt(task.cpm_duration || task.duration_old || 1, 10);
                    var maxEs = Math.max(minEs, maxLf - dur + 1);

                    var newEs = minEs;
                    var newEf = minEs + dur - 1;
                    var newDur = dur;

                    if (mode === 'esef') {
                        newEs = minEs;
                        newEf = minEs + dur - 1;
                    } else if (mode === 'lslf') {
                        newEs = maxEs;
                        newEf = maxLf;
                    } else if (mode === 'avg') {
                        newEs = Math.round((minEs + maxEs) / 2);
                        newEf = newEs + dur - 1;
                    } else if (mode === 'full') {
                        newEs = minEs;
                        newEf = maxLf;
                        newDur = Math.max(1, maxLf - minEs + 1);
                    }

                    var d1 = moment(start_date).add(newEs - 1, 'd').format('YYYY-MM-DD 00:00:00');
                    var d2 = moment(start_date).add(newEf, 'd').format('YYYY-MM-DD 00:00:00');
                    task.start_date = new Date(d1);
                    task.end_date = new Date(d2);
                    task.es = newEs;
                    task.ef = newEf;
                    task.duration = newDur;
                    task.duration_old = newDur;
                    task.update = true;
                    gantt.updateTask(task.id);
                    changed = true;
                });
            });

            $('.sc-preset-btn').removeClass('active');
            $('.sc-preset-btn[data-preset="' + mode + '"]').addClass('active');

            renderCpmFloatLayer();
            scheduleLiveSCurveUpdate();
            if (typeof syncAdmFromGantt === 'function') {
                syncAdmFromGantt(false);
            }

            if (changed) {
                $('#div_update_dutton').show();
                var labelMap = {
                    esef: '最早完成 (ES)',
                    avg: '平均開始時間',
                    lslf: '最晚完成 (LS)',
                    full: '最長施工時間 (ES~LF)'
                };
                Lobibox.notify('info', {
                    title: '已套用快速排程',
                    msg: '所有非要徑工項已調整為「' + (labelMap[mode] || mode) + '」，如需保存請點擊「送出資料並更新」。',
                    delay: 2600
                });
            }
        }

        $(document).off('click.cpmPreset').on('click.cpmPreset', '#apply_cpm_preset_btn', function () {
            var mode = $('#cpm_preset_select').val();
            applyCpmPreset(mode);
            var modalEl = document.getElementById('cpm_quick_schedule_modal');
            if (modalEl && window.bootstrap) {
                var inst = bootstrap.Modal.getInstance(modalEl);
                if (inst) inst.hide();
            }
        });
    }

    // Live-Linked S-Curve Controller (updates in real time while dragging!)
    var liveSCurveChart = null;
    var liveSCurveRaf = null;

    function computeLiveSCurveData() {
        var maxDay = Math.max(1, parseInt(total_duration || 1, 10));
        var leafTasks = [];
        gantt.eachTask(function (t) {
            if (!t || t.type === 'project' || t.type === 'milestone') return;
            var curEs = date_to_moment(t.start_date).diff(moment(start_date), 'days') + 1;
            var curEf = date_to_moment(t.end_date).diff(moment(start_date), 'days');
            if (curEf < curEs) curEf = curEs;
            var maxLf = parseInt(t.cpm_max_end || curEf, 10);
            if (curEf > maxDay) maxDay = curEf;
            if (cpmConstrained && maxLf > maxDay) maxDay = maxLf;
            leafTasks.push({
                es: curEs,
                ef: curEf,
                unit_price: parseFloat(t.unit_price) || 0,
                minEs: parseInt(t.cpm_min_start || curEs, 10),
                maxLf: maxLf,
                dur: parseInt(t.cpm_duration || (curEf - curEs + 1), 10)
            });
        });

        var dailyCur = new Array(maxDay).fill(0);
        var dailyEarly = cpmConstrained ? new Array(maxDay).fill(0) : null;
        var dailyLate = cpmConstrained ? new Array(maxDay).fill(0) : null;

        leafTasks.forEach(function (t) {
            if (!t.unit_price) return;
            var span = Math.max(1, t.ef - t.es + 1);
            var perDay = t.unit_price / span;
            for (var d = t.es - 1; d < t.ef; d++) {
                if (d >= 0 && d < maxDay) dailyCur[d] += perDay;
            }
            if (cpmConstrained) {
                var cDur = Math.max(1, t.dur);
                var cPerDay = t.unit_price / cDur;
                var eStart = Math.max(1, t.minEs);
                var eEnd = eStart + cDur - 1;
                for (var d1 = eStart - 1; d1 < eEnd; d1++) {
                    if (d1 >= 0 && d1 < maxDay) dailyEarly[d1] += cPerDay;
                }
                var lEnd = Math.max(cDur, t.maxLf);
                var lStart = Math.max(1, lEnd - cDur + 1);
                for (var d2 = lStart - 1; d2 < lEnd; d2++) {
                    if (d2 >= 0 && d2 < maxDay) dailyLate[d2] += cPerDay;
                }
            }
        });

        var labels = ['第0天'];
        var cumCur = [0];
        var cumEarly = cpmConstrained ? [0] : null;
        var cumLate = cpmConstrained ? [0] : null;
        var accCur = 0, accEarly = 0, accLate = 0;

        for (var i = 0; i < maxDay; i++) {
            labels.push('第' + (i + 1) + '天');
            accCur += dailyCur[i];
            cumCur.push(Number(accCur.toFixed(2)));
            if (cpmConstrained) {
                accEarly += dailyEarly[i];
                accLate += dailyLate[i];
                cumEarly.push(Number(accEarly.toFixed(2)));
                cumLate.push(Number(accLate.toFixed(2)));
            }
        }
        return { labels: labels, cur: cumCur, early: cumEarly, late: cumLate };
    }

    function updateLiveSCurve() {
        var canvasEl = document.getElementById('gantt_live_scurve_canvas');
        if (!canvasEl || typeof Chart === 'undefined') return;
        var d = computeLiveSCurveData();

        var datasets = [];
        if (cpmConstrained) {
            datasets.push({
                label: '最早進度 (ES)',
                data: d.early,
                fill: false,
                borderColor: 'rgba(16, 185, 129, 0.75)',
                borderDash: [5, 4],
                borderWidth: 1.6,
                pointRadius: 0,
                cubicInterpolationMode: 'monotone'
            });
            datasets.push({
                label: '最晚進度 (LS)',
                data: d.late,
                fill: false,
                borderColor: 'rgba(245, 158, 11, 0.8)',
                borderDash: [5, 4],
                borderWidth: 1.6,
                pointRadius: 0,
                cubicInterpolationMode: 'monotone'
            });
        }
        datasets.push({
            label: '目前排程 S 曲線',
            data: d.cur,
            fill: true,
            backgroundColor: 'rgba(37, 99, 235, 0.08)',
            borderColor: '#2563eb',
            borderWidth: 2.4,
            pointRadius: 0,
            pointHoverRadius: 4,
            cubicInterpolationMode: 'monotone'
        });

        if (!liveSCurveChart) {
            var ctx = canvasEl.getContext('2d');
            liveSCurveChart = new Chart(ctx, {
                type: 'line',
                data: { labels: d.labels, datasets: datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 0 },
                    legend: { display: false },
                    tooltips: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: function (tooltipItem, data) {
                                var dsLabel = data.datasets[tooltipItem.datasetIndex].label || '';
                                return dsLabel + '：' + tooltipItem.yLabel + '%';
                            }
                        }
                    },
                    scales: {
                        xAxes: [{
                            ticks: { autoSkip: true, maxTicksLimit: 12, fontSize: 11, fontColor: '#64748b' },
                            gridLines: { display: false }
                        }],
                        yAxes: [{
                            ticks: {
                                min: 0,
                                suggestedMax: 100,
                                stepSize: 25,
                                fontSize: 11,
                                fontColor: '#64748b',
                                callback: function (v) { return v + '%'; }
                            },
                            gridLines: { color: '#f1f5f9' }
                        }]
                    }
                }
            });
        } else {
            liveSCurveChart.data.labels = d.labels;
            liveSCurveChart.data.datasets = datasets;
            liveSCurveChart.update(0);
        }
    }

    function scheduleLiveSCurveUpdate() {
        if (liveSCurveRaf) cancelAnimationFrame(liveSCurveRaf);
        liveSCurveRaf = requestAnimationFrame(function () {
            liveSCurveRaf = null;
            updateLiveSCurve();
        });
    }

    // S-Curve Dock Height Ratio & Drag Resizer
    var scurveRatioPct = parseInt(localStorage.getItem('gantt_scurve_ratio') || '35', 10);
    if (isNaN(scurveRatioPct) || scurveRatioPct < 15 || scurveRatioPct > 75) scurveRatioPct = 35;

    function applySCurveHeightRatio(pct, persist) {
        scurveRatioPct = Math.min(75, Math.max(15, parseInt(pct, 10) || 35));
        var $body = $('#gantt-scurve-body');
        if (!$body.is(':hidden')) {
            var winH = $(window).height();
            var headH = $('.header').outerHeight() || 0;
            var noticeH = $('.sc-gantt-notice').outerHeight() || 0;
            var barH = $('.sc-gantt-scurve-bar').outerHeight() || 36;
            var usableH = Math.max(280, winH - headH - noticeH);
            var targetBodyH = Math.max(110, Math.round(usableH * (scurveRatioPct / 100)) - barH);
            $body.css('height', targetBodyH + 'px');
        }
        if (persist) {
            try { localStorage.setItem('gantt_scurve_ratio', String(scurveRatioPct)); } catch (e) {}
        }
        resize_window();
        gantt.setSizes();
        if (liveSCurveChart) liveSCurveChart.resize();
    }

    // Restore saved ratio in dropdown if it matches one of the presets
    if ($('#gantt_scurve_ratio option[value="' + scurveRatioPct + '"]').length) {
        $('#gantt_scurve_ratio').val(String(scurveRatioPct));
    }

    $('#gantt_scurve_ratio').off('change').on('change', function () {
        var val = parseInt($(this).val(), 10);
        if ($('#gantt-scurve-body').is(':hidden')) {
            $('#gantt-scurve-body').show();
            $('#toggle-gantt-scurve-icon').text('expand_more');
            $('#toggle-gantt-scurve-text').text('收合');
        }
        applySCurveHeightRatio(val, true);
        scheduleLiveSCurveUpdate();
    });

    // Drag-to-resize top border of S-curve dock
    (function initSCurveResizer() {
        var $resizer = $('#gantt-scurve-resizer');
        if (!$resizer.length) return;
        var dragging = false;
        var startY = 0;
        var startBodyH = 0;

        $resizer.on('mousedown', function (ev) {
            if ($('#gantt-scurve-body').is(':hidden')) return;
            dragging = true;
            startY = ev.clientY;
            startBodyH = $('#gantt-scurve-body').outerHeight() || 180;
            $('body').css('user-select', 'none');
            ev.preventDefault();
        });

        $(window).on('mousemove.scurveResize', function (ev) {
            if (!dragging) return;
            var dy = startY - ev.clientY;
            var winH = $(window).height();
            var headH = $('.header').outerHeight() || 0;
            var noticeH = $('.sc-gantt-notice').outerHeight() || 0;
            var barH = $('.sc-gantt-scurve-bar').outerHeight() || 36;
            var usableH = Math.max(280, winH - headH - noticeH);
            var nextBodyH = Math.min(Math.round(usableH * 0.72), Math.max(100, startBodyH + dy));
            $('#gantt-scurve-body').css('height', nextBodyH + 'px');
            scurveRatioPct = Math.round(((nextBodyH + barH) / usableH) * 100);
            resize_window();
            gantt.setSizes();
            if (liveSCurveChart) liveSCurveChart.resize();
        });

        $(window).on('mouseup.scurveResize', function () {
            if (!dragging) return;
            dragging = false;
            $('body').css('user-select', '');
            try { localStorage.setItem('gantt_scurve_ratio', String(scurveRatioPct)); } catch (e) {}
        });
    })();

    $('#toggle-gantt-scurve').off('click').on('click', function () {
        var $body = $('#gantt-scurve-body');
        var isHidden = $body.is(':hidden');
        $body.toggle(isHidden);
        $('#toggle-gantt-scurve-icon').text(isHidden ? 'expand_more' : 'expand_less');
        $('#toggle-gantt-scurve-text').text(isHidden ? '收合' : '展開');
        if (isHidden) {
            applySCurveHeightRatio(scurveRatioPct, false);
            scheduleLiveSCurveUpdate();
        } else {
            resize_window();
            gantt.setSizes();
        }
    });

    $(window).off('resize.scurveRatio').on('resize.scurveRatio', function () {
        applySCurveHeightRatio(scurveRatioPct, false);
    });

    applySCurveHeightRatio(scurveRatioPct, false);

    // Live-Linked ADM Arrow Diagram Subview (same level as Gantt; reads live Gantt task positions!)
    var ganttAdmInstance = null;
    var activeGanttSubview = 'gantt';

    function collectLiveAdmNodesFromGantt() {
        var nodes = [];
        gantt.eachTask(function (t) {
            if (!t || t.type === 'project' || t.type === 'milestone') return;
            var curEs = date_to_moment(t.start_date).diff(moment(start_date), 'days') + 1;
            var curEf = date_to_moment(t.end_date).diff(moment(start_date), 'days');
            if (curEf < curEs) curEf = curEs;
            var minEs = parseInt(t.cpm_min_start || curEs, 10);
            var maxLf = parseInt(t.cpm_max_end || curEf, 10);
            var cDur = parseInt(t.cpm_duration || (curEf - curEs + 1), 10);
            var ls0 = Math.max(0, maxLf - cDur);
            nodes.push({
                id: t.id,
                name: t.text || '未命名工項',
                es: Math.max(0, curEs - 1),
                ef: curEf,
                rawEs0: Math.max(0, minEs - 1),
                rawEf1: minEs + cDur - 1,
                ls: ls0,
                lf: maxLf,
                duration: Math.max(1, curEf - curEs + 1),
                unit_price: parseFloat(t.unit_price) || 0,
                cp: Boolean(t.cp)
            });
        });
        return nodes;
    }

    function syncAdmFromGantt(autoFit) {
        if (!cpmConstrained || activeGanttSubview !== 'adm') return;
        var nodes = collectLiveAdmNodesFromGantt();
        var links = (typeof cpm_links_data !== 'undefined' && Array.isArray(cpm_links_data)) ? cpm_links_data : [];

        if (!ganttAdmInstance && typeof window.AdmCanvas === 'function') {
            var maxDayForRec = Math.max(1, parseInt(total_duration || 1, 10));
            nodes.forEach(function (n) {
                if (n.ef > maxDayForRec) maxDayForRec = n.ef;
            });
            var recStep = (typeof window.AdmCanvas.recommendGridStep === 'function')
                ? window.AdmCanvas.recommendGridStep(maxDayForRec)
                : 5;
            var $stepSel = $('#adm-grid-step');
            $stepSel.find('option').each(function () {
                var baseTxt = $(this).text().replace('（建議）', '');
                if ($(this).val() === String(recStep)) {
                    $(this).text(baseTxt + '（建議）');
                } else {
                    $(this).text(baseTxt);
                }
            });
            $stepSel.val(String(recStep));

            ganttAdmInstance = new window.AdmCanvas({
                container: document.getElementById('adm-canvas-mount'),
                tooltipEl: document.getElementById('adm-tooltip'),
                zoomLabelEl: document.getElementById('adm-zoom-reset'),
                nodes: nodes,
                links: links,
                valueType: 'esef',
                stretch: parseFloat($('#adm-stretch-range').val()) || 1.0,
                fontSize: ($('#adm-font-size').val() && !isNaN(parseFloat($('#adm-font-size').val()))) ? parseFloat($('#adm-font-size').val()) : 'auto',
                gridStep: String(recStep),
                projectTitle: (typeof project_display_name !== 'undefined') ? project_display_name : ''
            });
            $('#adm-zoom-in').off('click').on('click', function () { ganttAdmInstance.zoomIn(); });
            $('#adm-zoom-out').off('click').on('click', function () { ganttAdmInstance.zoomOut(); });
            $('#adm-zoom-reset').off('click').on('click', function () { ganttAdmInstance.zoomReset(); });
            $('#adm-zoom-fit').off('click').on('click', function () { ganttAdmInstance.fitToView(); });
            $('#adm-stretch-range').off('input').on('input', function () {
                var v = parseFloat(this.value) || 1.2;
                $('#adm-stretch-label').text(v.toFixed(1) + 'x');
                ganttAdmInstance.setStretch(v);
            });
            $('#adm-font-size').off('input change').on('input change', function () {
                var raw = String(this.value || '').trim();
                if (!raw) {
                    ganttAdmInstance.setFontSize('auto');
                } else {
                    var num = parseFloat(raw);
                    if (!isNaN(num) && num >= 8 && num <= 64) {
                        ganttAdmInstance.setFontSize(num);
                    }
                }
            });
            $('#adm-font-auto-btn').off('click').on('click', function () {
                $('#adm-font-size').val('');
                ganttAdmInstance.setFontSize('auto');
            });
            $('#adm-grid-step').off('change').on('change', function () {
                ganttAdmInstance.setGridStep(this.value);
            });
            $('#adm-critical-only').off('change').on('change', function () {
                ganttAdmInstance.setCriticalOnly(this.checked);
            });
            $('#adm-download-btn').off('click').on('click', function () {
                var baseName = ((typeof project_display_name !== 'undefined' && project_display_name) ? project_display_name : '預定進度') + '_ADM箭線圖.png';
                ganttAdmInstance.exportPng(baseName);
            });
        } else if (ganttAdmInstance) {
            ganttAdmInstance.setData(nodes, links, autoFit);
        }
    }

    function switchGanttSubview(mode) {
        activeGanttSubview = mode;
        $('#gantt-adm-switcher .sc-mini-seg-btn').removeClass('active');
        $('#gantt-adm-switcher .sc-mini-seg-btn[data-subview="' + mode + '"]').addClass('active');

        if (mode === 'adm') {
            $('#gantt_here').hide();
            $('#gantt-scale-wrap').hide();
            $('#gantt-scurve-dock').hide();
            $('#gantt-adm-panel').show();
            resize_window();
            syncAdmFromGantt(true);
        } else {
            $('#gantt-adm-panel').hide();
            $('#gantt_here').show();
            $('#gantt-scale-wrap').show();
            $('#gantt-scurve-dock').show();
            resize_window();
            gantt.setSizes();
            renderCpmFloatLayer();
            scheduleLiveSCurveUpdate();
        }
    }

    $('#btn-subview-gantt').off('click').on('click', function () { switchGanttSubview('gantt'); });
    $('#btn-subview-adm').off('click').on('click', function () { switchGanttSubview('adm'); });

    gantt.attachEvent("onAfterTaskUpdate", scheduleLiveSCurveUpdate);
    gantt.attachEvent("onAfterTaskAdd", scheduleLiveSCurveUpdate);
    gantt.attachEvent("onAfterTaskDelete", scheduleLiveSCurveUpdate);
    if (!cpmConstrained) {
        gantt.attachEvent("onTaskDrag", scheduleLiveSCurveUpdate);
    }
    scheduleLiveSCurveUpdate();

    //有變動show出儲存按鈕
    gantt.attachEvent("onBeforeTaskUpdate", function (id, task) {
        if ($('.gantt_cal_larea').is(":visible")) {
            //視窗更新
            var es = $('.gantt_cal_larea').find('[name="es"]').val();
            var ef = $('.gantt_cal_larea').find('[name="ef"]').val();

            if (!int_check.test(es) || !int_check.test(ef)) {
                Lobibox.notify('warning', {
                    title: '系統訊息',
                    msg: '起訖天數請輸入整數!!!',
                });
            } else if (parseInt(es) > parseInt(ef)) {
                Lobibox.notify('warning', {
                    title: '系統訊息',
                    msg: '開始天數不可超過結束天數!!!',
                });
            } else {
                es = Math.max(parseInt(es), 1);
                ef = Math.max(parseInt(ef), 1);
                if ($('#reject_over_day').prop('checked')) {
                    es = Math.min(es, total_duration);
                    ef = Math.min(ef, total_duration);
                };
                if (es != task['es'] || ef != task['ef']) {
                    task['es'] = es;
                    task['ef'] = ef;
                    var d1 = date_to_moment(new Date(start_date));
                    d1 = d1.add(es - 1, 'd').format('YYYY-MM-DD 00:00:00');
                    task['start_date'] = new Date(d1);
                    var d2 = date_to_moment(new Date(start_date));
                    d2 = d2.add(ef, 'd').format('YYYY-MM-DD 00:00:00');
                    task['end_date'] = new Date(d2);
                    task['duration'] = ef - es + 1;
                    task['duration_old'] = ef - es + 1;
                }
            };
        } else {
            //拖曳更新
            if (date_to_moment(task['start_date']) < moment(start_date)) {
                task['start_date'] = new Date(moment(start_date).format('YYYY-MM-DD 00:00:00'));
            };
            if (date_to_moment(task['end_date']) < moment(start_date)) {
                task['end_date'] = new Date(moment(start_date).add(1, 'd').format('YYYY-MM-DD 00:00:00'));
            };

            var es = date_to_moment(task['start_date']).diff(moment(start_date), 'days') + 1;
            var ef = date_to_moment(task['end_date']).diff(moment(start_date), 'days');
            if ($('#reject_over_day').prop('checked')) {
                if ((ef - es + 1) != task['duration_old']) {
                    //拉單邊
                    if (ef > total_duration) {
                        ef = total_duration;
                        var d2 = date_to_moment(new Date(start_date));
                        d2 = d2.add(ef, 'd').format('YYYY-MM-DD 00:00:00');
                        task['end_date'] = new Date(d2);
                    }
                } else {
                    //拖整格
                    if (ef > total_duration) {
                        ef = total_duration;
                        es = total_duration - task['duration_old'] + 1;
                        var d1 = date_to_moment(new Date(start_date));
                        d1 = d1.add(es - 1, 'd').format('YYYY-MM-DD 00:00:00');
                        task['start_date'] = new Date(d1);
                        var d2 = date_to_moment(new Date(start_date));
                        d2 = d2.add(ef, 'd').format('YYYY-MM-DD 00:00:00');
                        task['end_date'] = new Date(d2);
                    }
                }
            };
            task['es'] = es;
            task['ef'] = ef;
            task['duration'] = ef - es + 1;
            task['duration_old'] = ef - es + 1;
        };
        update_progress();
        task['update'] = true;
        $('.download_gantt_image').prop('disabled', true);
        $('.download_gantt_image').hide();
        $('#div_update_dutton').show();
    });

    gantt.attachEvent("onAfterTaskAdd", function (id, task) {
        var es = $('.gantt_cal_larea').find('[name="es"]').val();
        var ef = $('.gantt_cal_larea').find('[name="ef"]').val();
        if (!int_check.test(es) || !int_check.test(ef)) {
            Lobibox.notify('warning', {
                title: '系統訊息',
                msg: '起訖天數請輸入整數!!!',
            });
        } else if (parseInt(es) > parseInt(ef)) {
            Lobibox.notify('warning', {
                title: '系統訊息',
                msg: '開始天數不可超過結束天數!!!',
            });
        } else {
            es = Math.max(parseInt(es), 1);
            ef = Math.max(parseInt(ef), 1);
            if ($('#reject_over_day').prop('checked')) {
                es = Math.min(es, total_duration);
                ef = Math.min(ef, total_duration);
            };
            task['es'] = es;
            task['ef'] = ef;
            var d1 = date_to_moment(new Date(start_date));
            d1 = d1.add(es - 1, 'd').format('YYYY-MM-DD 00:00:00');
            task['start_date'] = new Date(d1);
            var d2 = date_to_moment(new Date(start_date));
            d2 = d2.add(ef, 'd').format('YYYY-MM-DD 00:00:00');
            task['end_date'] = new Date(d2);
            task['duration'] = ef - es + 1;
            task['duration_old'] = ef - es + 1;
        };
        update_progress();
        $('.download_gantt_image').hide();
        $('#div_update_dutton').show();
        return true;
    });

    // link連結
    gantt.attachEvent("onAfterLinkAdd", function (id, link) {
        var task = gantt.getTask(link.source);
        task['update'] = true;
        $('.download_gantt_image').hide();
        $('#div_update_dutton').show();
        return true;
    });

    // link刪除連結
    gantt.attachEvent("onAfterLinkDelete", function (id, link) {
        var task = gantt.getTask(link.source);
        task['update'] = true;
        $('.download_gantt_image').hide();
        $('#div_update_dutton').show();
        return true;
    });

    gantt.attachEvent("onTaskCreated", function (task) {
        if (!task['parent']) {
            task['start_date'] = start_date;
        };
        task['update'] = true;
        update_progress();
        $('.download_gantt_image').hide();
        $('#div_update_dutton').show();
        return true;
    });

    gantt.attachEvent("onAfterTaskDelete", function (task) {
        update_progress();
        delete_ids.push(String(task));
        $('.download_gantt_image').hide();
        $('#div_update_dutton').show();
        return true;
    });
}

function date_to_moment(date) {
    var y = date.getFullYear();
    var m = date.getMonth() + 1;
    var d = date.getDate();
    return moment(`${y}-${m}-${d}`);
}

function moment_to_date(date) {
    return new Date(date.format('YYYY-MM-DD'));
}

function get_task_link(task) {
    //取得task的link
    var all_links = gantt.getLinks();
    var links = [];
    $.each(all_links, function (k, link) {
        if (link.source == String(task['id'])) {
            links.push(link);
        }
    })
    return JSON.stringify(links);
}

function update_items() {
    var data = {
        objects: [],
        deleted_objects: [],
    };
    var all_tasks = gantt.getTaskByTime();
    var priority_map = {};
    $.each(delete_ids, function (k, v) {
        if (v < 10000000000) {
            data['deleted_objects'].push(`/schedule/api/active/scheduleitem/${v}/`);
        }
    });

    $.each(all_tasks, function (key) {
        var task = all_tasks[key];
        if (task['id'] > 0 && task['update']) {
            if (task['type'] == 'task' || task["id"] > 10000000000) {
                //工項
                var s = date_to_moment(task['start_date']);
                var e = date_to_moment(task['end_date']);
                var es = s.diff(moment(start_date), 'days') + 1;
                var ef = e.diff(moment(start_date), 'days');
                if (priority_map[task["parent"]] == undefined) {
                    priority_map[task["parent"]] = 0;
                } else {
                    priority_map[task["parent"]] += 1;
                }
                if (!task["unit_price"] || !float_check.test(task["unit_price"])) {
                    task["unit_price"] = 0;
                }

                var isCpmShift = (typeof is_cpm_constrained !== 'undefined' && is_cpm_constrained);
                var es_payload = isCpmShift ? Math.max(0, es - 1) : es;
                var tmp = {
                    es: es_payload,
                    ef: ef,
                    name: task["text"],
                    unit_price: task["unit_price"],
                    old_id: task["id"],
                    cp: task["cp"],
                    is_patch: true,
                    cpm_float_shift: isCpmShift,
                };
                if (task["id"] > 10000000000) {
                    if (task["parent"]) {
                        tmp['uplevel'] = '/schedule/api/active/scheduleitem/' + task["parent"] + '/';
                    } else {
                        tmp['uplevel'] = '/schedule/api/active/scheduleitem/' + root_item_id + '/';
                    };
                    tmp['kind'] = '/dailyreport/api/v1/option/11/';
                    tmp['version'] = '/schedule/api/active/version_schedule/' + version_id + '/';
                } else {
                    tmp['resource_uri'] = '/schedule/api/active/scheduleitem/' + task['id'] + '/';
                };
                tmp['link'] = get_task_link(task);
                task['update'] = false;
                data["objects"].push(tmp);
            } else {
                //資料夾
                if (priority_map[task["parent"]] == undefined) {
                    priority_map[task["parent"]] = 0;
                } else {
                    priority_map[task["parent"]] += 1;
                };
                var tmp = {
                    name: task["text"],
                    resource_uri: '/schedule/api/active/scheduleitem/' + task['id'] + '/',
                };
                tmp['link'] = get_task_link(task);
                task['update'] = false;
                data["objects"].push(tmp);
            }
        }
    });

    $('#div_update_dutton').hide();
    $('#loading').show();

    do_update_items(data);

    function do_update_items(data) {
        $.ajax({
            url: '/schedule/api/active/scheduleitem/',
            type: 'PATCH',
            data: JSON.stringify(data),
            contentType: 'application/json',
            dataType: 'json',
            beforeSend: function (XHR) {
                XHR.setRequestHeader('X-CSRFToken', CSRFMIDDLEWARETOKEN);
            },
            success: function (json, text, xhr) {
                for (i = 0; i < json.objects.length; i++) {
                    if (json.objects[i]['old_id'] && json.objects[i]['old_id'] > 10000000000) {
                        gantt.changeTaskId(json.objects[i]['old_id'], json.objects[i]['id']);
                    }
                };
                do_update_links(json.objects);

                Lobibox.notify('success', {
                    title: '更新成功',
                    msg: '預定進度已更新',
                });
                // window.location.reload();
                $('.download_gantt_image').prop('disabled', false);
                $('.download_gantt_image').show();
                $('#div_update_dutton').hide();
                $('#loading').hide();
                updated = true;
                delete_ids = [];
            },
            error: function (json) {
                Lobibox.notify('error', {
                    title: '錯誤訊息',
                    msg: json.responseText,
                });
                $('#div_update_dutton').show();
                $('#loading').hide();
            }
        });
    };

    function do_update_links(data) {
        var link_data = { 'objects': [] };
        for (i = 0; i < data.length; i++) {
            var task = gantt.getTaskBy('id', data[i]['id'])[0];
            link_data['objects'].push({
                resource_uri: '/schedule/api/active/scheduleitem/' + task['id'] + '/',
                link: get_task_link(task),
            });
        };
        $.ajax({
            url: '/schedule/api/active/scheduleitem/',
            type: 'PATCH',
            data: JSON.stringify(link_data),
            contentType: 'application/json',
            dataType: 'json',
            beforeSend: function (XHR) {
                XHR.setRequestHeader('X-CSRFToken', CSRFMIDDLEWARETOKEN);
            },
            success: function (json, text, xhr) {
            },
            error: function (json) {
            }
        });
    };
}

var ScaleTemplate_30 = function (date) {
    var d = date_to_moment(date);
    var index_day = d.diff(moment(start_date), 'days') + 1;
    return `<span style='line-height:20px;'>${index_day}~${index_day + 29}</span>`;
};

var ScaleTemplate_15 = function (date) {
    var d = date_to_moment(date);
    var index_day = d.diff(moment(start_date), 'days') + 1;
    return `<span style='line-height:20px;'>${index_day}~${index_day + 14}</span>`;
};

var ScaleTemplate_10 = function (date) {
    var d = date_to_moment(date);
    var index_day = d.diff(moment(start_date), 'days') + 1;
    return `<span style='line-height:20px;'>${index_day}~${index_day + 9}</span>`;
};

var ScaleTemplate_7 = function (date) {
    var d = date_to_moment(date);
    var index_day = d.diff(moment(start_date), 'days') + 1;
    return `<span style='line-height:20px;'>${index_day}~${index_day + 6}</span>`;
};

var dayScaleTemplate = function (date) {
    var d = date_to_moment(date);
    var index_day = d.diff(moment(start_date), 'days') + 1;
    return `<span style='line-height:20px;'>${index_day}</span>`;
};


function change_scale() {
    var $obj = $(this);
    var scale = parseInt($obj.val() || $obj.attr('scale'), 10);
    if (scale == 30) {
        var format_tmp = ScaleTemplate_30;
    } else if (scale == 15) {
        var format_tmp = ScaleTemplate_15;
    } else if (scale == 10) {
        var format_tmp = ScaleTemplate_10;
    } else if (scale == 7) {
        var format_tmp = ScaleTemplate_7;
    } else if (scale == 1) {
        var format_tmp = dayScaleTemplate;
    };
    gantt.config.scales = [
        { unit: "day", step: scale, format: format_tmp } //第二刻度
    ];
    if (scale == 1) {
        gantt.config.min_column_width = 25; //每隔寬度
    } else {
        gantt.config.min_column_width = 60; //每隔寬度
    };
    gantt.init("gantt_here", new Date(start_date), new Date(end_date)); //只畫出這個範圍的圖
    resize_window();
}

function resize_window() {
    var height = $(window).height();
    var head_height = parseInt($('.header').css('height').replace('px', '')) || 0;
    var dock_visible = $('#gantt-scurve-dock').is(':visible');
    var dock_height = dock_visible ? ($('#gantt-scurve-dock').outerHeight() || 0) : 0;
    var notice_height = $('.sc-gantt-notice').outerHeight() || 0;
    var avail = Math.max(220, height - head_height - dock_height - notice_height - 4);
    $('#gantt_here').css('height', avail + 'px');
    $('#gantt-adm-panel').css('height', avail + 'px');
}

function update_progress() {
    var all_tasks = gantt.getTaskByTime();
    var total_progress = 0;
    $.each(all_tasks, function (key) {
        var task = all_tasks[key];
        if (float_check.test(task['unit_price']) && (task['type'] == 'task' || task['id'] > 10000000000)) {
            total_progress = FloatAdd(total_progress, parseFloat(task['unit_price']));
        };
    });
    total_progress = Math.round(total_progress * 100000) / 100000
    $('#total_progress').html(total_progress);
}

function scroll_to_end() {
    var d = date_to_moment(new Date(start_date));
    d = d.add(total_duration, 'd').format('YYYY-MM-DD 00:00:00');
    gantt.showDate(new Date(d));
}

function update_ef() {
    var $obj = $(this);
    var $div = $obj.closest('div');
    var es = parseInt($div.find('[name="es"]').val());
    var duration = parseInt($div.find('[name="duration"]').val());
    $div.find('[name="ef"]').val(es + duration - 1);
    $div.find('span[name="show_ef"]').html(es + duration - 1);
}

$(document).ready(function () {
    gantt.plugins({
        marker: true
    });
    initial_gantt();
    resize_window();

    $('#reject_over_day').click(function () {
        var $obj = $(this);
        if ($obj.prop('checked')) {
            Lobibox.notify('success', {
                title: '系統提示',
                msg: '目前您開啟了編輯限制於總天數內功能，您的變更將會被限制在目標天數內',
                position: 'bottom center'
            });
        } else {
            Lobibox.notify('success', {
                title: '系統提示',
                msg: '目前您關閉了編輯限制功能',
                position: 'bottom center'
            });
        }
    });

    $(document).on('click', '.change_scale', change_scale);
    $(document).on('change', '#gantt_scale_select', change_scale);
    $(document).on('keyup', '.update_ef', update_ef);
    $('#update_items').click(update_items);

    $("#close_btn").on("click", function () {
        if (window.opener && window.opener.GanttCallback) {
            window.opener.GanttCallback();
        };
        window.close();
    });

    $(window).on("beforeunload", function () {
        if (window.opener && window.opener.GanttCallback) {
            window.opener.GanttCallback();
        };
    })
    window.onresize = resize_window;
})