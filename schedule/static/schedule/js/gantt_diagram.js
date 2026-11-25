function initial_gantt(){
    gantt.config.scales = [
        {unit: "day", step: 1, format: dayScaleTemplate},
    ];
    gantt.config.min_column_width = 25; //每隔寬度

    gantt.config.columns=[
        {name: "text", label: "工項名稱", width: "*", tree: true, resize: true, width: 200},
        {
            name: "cp", label: "要徑", width: 50, align: "center",
            template: function (item) {
                if (item.cp) return "✓";
                return '';
            }
        },
        {name: "start_date", label: "開始時間", align: "center", hide: true },
        {name: "duration", label: "工期", align: "right", resize: true, width: 50},
        {name: "unit_price", label: "進度(%)", resize: true, align: "right", width: 50},
        {name: "add", label:"", width: 36}
    ];

    //左右拖動時 顯示日期
    gantt.templates.leftside_text = function (start, end, task) {
        var state = gantt.getState(),
            modes = gantt.config.drag_mode;

        var d = date_to_moment(start);
        var index_day = d.diff(moment(start_date), 'days')+1;

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
        var index_day = d.diff(moment(start_date), 'days')+1;
        if (state.drag_id == task.id) {
            if (state.drag_mode == modes.move || (state.drag_mode == modes.resize && !state.drag_from_start)) {
                return index_day;
            }
        }
        if (task['type'] != 'project' && task['type'] != 'milestone'){
            return String(task.unit_price) + '%';
        } else {
            return "";
        }        
    };

    gantt.templates.lightbox_header = function(start_date,end_date,task){
        return (gantt.templates.task_text("","",task)).substr(0, 70);
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
    gantt.config.lightbox.project_sections=[
        {name: "name_dir", map_to: "text", type: "my_input", focus: true},
        {name: "cp", map_to: "cp", type:"my_checkbox"},
    ];

    gantt.config.lightbox.sections=[
        {name: "name", map_to: "text", type: "my_input", focus: true},
        {name: "unit_price_False", map_to: "unit_price", type: "my_input_number"},
        {name: "range", height: 40, type: "template", map_to: "range_template" }, 
        {name: "cp", map_to: "cp", type:"my_checkbox"},
    ];

    gantt.attachEvent("onBeforeLightbox", function(id) {
        var task = gantt.getTask(id);
        if (!task['es']){
            var sd = date_to_moment(task['start_date']);
            task['es'] = Math.max(sd.diff(moment(start_date), 'days')+1, 1);
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

    //有變動show出儲存按鈕
    gantt.attachEvent("onBeforeTaskUpdate", function(id, task){
        if ($('.gantt_cal_larea').is(":visible")){
            //視窗更新
            var es = $('.gantt_cal_larea').find('[name="es"]').val();
            var ef = $('.gantt_cal_larea').find('[name="ef"]').val();

            if (!int_check.test(es) || !int_check.test(ef)){
                Lobibox.notify('warning', {
                    title: '系統訊息',
                    msg: '起訖天數請輸入整數!!!',
                });
            } else if (parseInt(es) > parseInt(ef)){
                Lobibox.notify('warning', {
                    title: '系統訊息',
                    msg: '開始天數不可超過結束天數!!!',
                });
            } else {
                es = Math.max(parseInt(es), 1);
                ef = Math.max(parseInt(ef), 1);
                if ($('#reject_over_day').prop('checked')){
                    es = Math.min(es, total_duration);
                    ef = Math.min(ef, total_duration);
                };
                if (es != task['es'] || ef != task['ef']){
                    task['es'] = es;
                    task['ef'] = ef;
                    var d1 = date_to_moment(new Date(start_date));
                    d1 = d1.add(es-1, 'd').format('YYYY-MM-DD 00:00:00');
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
            if (date_to_moment(task['start_date']) < moment(start_date)){
                task['start_date'] = new Date(moment(start_date).format('YYYY-MM-DD 00:00:00'));
            };
            if (date_to_moment(task['end_date']) < moment(start_date)){
                task['end_date'] = new Date(moment(start_date).add(1, 'd').format('YYYY-MM-DD 00:00:00'));
            };

            var es = date_to_moment(task['start_date']).diff(moment(start_date), 'days')+1;
            var ef = date_to_moment(task['end_date']).diff(moment(start_date), 'days');
            if ($('#reject_over_day').prop('checked')){
                if ((ef-es+1) != task['duration_old']){
                    //拉單邊
                    if (ef > total_duration){
                        ef = total_duration;
                        var d2 = date_to_moment(new Date(start_date));
                        d2 = d2.add(ef, 'd').format('YYYY-MM-DD 00:00:00');
                        task['end_date'] = new Date(d2);
                    }
                } else {
                    //拖整格
                    if (ef > total_duration){
                        ef = total_duration;
                        es = total_duration - task['duration_old'] + 1;
                        var d1 = date_to_moment(new Date(start_date));
                        d1 = d1.add(es-1, 'd').format('YYYY-MM-DD 00:00:00');
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

    gantt.attachEvent("onAfterTaskAdd", function(id, task){
        var es = $('.gantt_cal_larea').find('[name="es"]').val();
        var ef = $('.gantt_cal_larea').find('[name="ef"]').val();
        if (!int_check.test(es) || !int_check.test(ef)){
            Lobibox.notify('warning', {
                title: '系統訊息',
                msg: '起訖天數請輸入整數!!!',
            });
        } else if (parseInt(es) > parseInt(ef)){
            Lobibox.notify('warning', {
                title: '系統訊息',
                msg: '開始天數不可超過結束天數!!!',
            });
        } else {
            es = Math.max(parseInt(es), 1);
            ef = Math.max(parseInt(ef), 1);
            if ($('#reject_over_day').prop('checked')){
                es = Math.min(es, total_duration);
                ef = Math.min(ef, total_duration);
            };
            task['es'] = es;
            task['ef'] = ef;
            var d1 = date_to_moment(new Date(start_date));
            d1 = d1.add(es-1, 'd').format('YYYY-MM-DD 00:00:00');
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
    gantt.attachEvent("onAfterLinkAdd", function(id, link){
        var task = gantt.getTask(link.source);
        task['update'] = true;
        $('.download_gantt_image').hide();
        $('#div_update_dutton').show();
        return true;
    });

    // link刪除連結
    gantt.attachEvent("onAfterLinkDelete", function(id, link){
        var task = gantt.getTask(link.source);
        task['update'] = true;
        $('.download_gantt_image').hide();
        $('#div_update_dutton').show();
        return true;
    });

    gantt.attachEvent("onTaskCreated", function(task){
        if (!task['parent']){
            task['start_date'] = start_date;
        };
        task['update'] = true;
        update_progress();
        $('.download_gantt_image').hide();
        $('#div_update_dutton').show();
        return true;
    });

    gantt.attachEvent("onAfterTaskDelete", function(task){
        update_progress();
        delete_ids.push(String(task));
        $('.download_gantt_image').hide();
        $('#div_update_dutton').show();
        return true;
    });
}

function date_to_moment(date){
    var y = date.getFullYear();
    var m = date.getMonth()+1;
    var d = date.getDate();
    return moment(`${y}-${m}-${d}`);
}

function moment_to_date(date){
    return new Date(date.format('YYYY-MM-DD'));
}

function get_task_link(task){
    //取得task的link
    var all_links = gantt.getLinks();
    var links = [];
    $.each(all_links, function(k, link){
        if (link.source == String(task['id'])){
            links.push(link);
        }
    })
    return JSON.stringify(links);
}

function update_items(){
    var data = {
        objects: [],
        deleted_objects: [],
    };
    var all_tasks = gantt.getTaskByTime();
    var priority_map = {};
    $.each(delete_ids, function(k, v){
        if (v < 10000000000){
            data['deleted_objects'].push(`/schedule/api/active/scheduleitem/${v}/`);
        }
    });

    $.each(all_tasks, function(key){
        var task = all_tasks[key];
        if (task['id'] > 0 && task['update']){
            if (task['type'] == 'task' || task["id"] > 10000000000){
                //工項
                var s = date_to_moment(task['start_date']);
                var e = date_to_moment(task['end_date']);
                var es = s.diff(moment(start_date), 'days')+1;
                var ef = e.diff(moment(start_date), 'days');
                if (priority_map[task["parent"]] == undefined){
                    priority_map[task["parent"]] = 0;
                } else {
                    priority_map[task["parent"]] += 1;
                }
                if (!task["unit_price"] || !float_check.test(task["unit_price"])){
                    task["unit_price"] = 0;
                }

                var tmp = {
                    es: es,
                    ef: ef,
                    name: task["text"],
                    unit_price: task["unit_price"],
                    old_id: task["id"],
                    cp: task["cp"],
                    is_patch: true,
                };
                if (task["id"] > 10000000000){
                    if (task["parent"]){
                        tmp['uplevel'] = '/schedule/api/active/scheduleitem/' + task["parent"] + '/';
                    } else {
                        tmp['uplevel'] = '/schedule/api/active/scheduleitem/' + root_item_id + '/';
                    };
                    tmp['kind'] = '/dailyreport/api/v1/option/11/';
                    tmp['version'] = '/schedule/api/active/version_schedule/' + version_id + '/';
                } else {
                    tmp['resource_uri'] ='/schedule/api/active/scheduleitem/' + task['id'] + '/';
                };
                tmp['link'] = get_task_link(task);
                task['update'] = false;
                data["objects"].push(tmp);
            } else {
                //資料夾
                if (priority_map[task["parent"]] == undefined){
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

    function do_update_items(data){
        $.ajax({
            url: '/schedule/api/active/scheduleitem/',
            type: 'PATCH',
            data: JSON.stringify(data),
            contentType: 'application/json',
            dataType: 'json',
            beforeSend: function(XHR) {
                XHR.setRequestHeader('X-CSRFToken', CSRFMIDDLEWARETOKEN);
            },
            success: function (json, text, xhr) {
                for (i=0;i<json.objects.length;i++){
                    if (json.objects[i]['old_id'] && json.objects[i]['old_id'] > 10000000000){
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

    function do_update_links(data){
        var link_data = {'objects': []};
        for (i=0;i<data.length;i++){
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
            beforeSend: function(XHR) {
                XHR.setRequestHeader('X-CSRFToken', CSRFMIDDLEWARETOKEN);
            },
            success: function (json, text, xhr) {
            },
            error: function (json) {
            }
        });
    };
}

var ScaleTemplate_30 = function(date){
    var d = date_to_moment(date);
    var index_day = d.diff(moment(start_date), 'days')+1;
    return `<span style='line-height:20px;'>${index_day}~${index_day+29}</span>`;
};

var ScaleTemplate_15 = function(date){
    var d = date_to_moment(date);
    var index_day = d.diff(moment(start_date), 'days')+1;
    return `<span style='line-height:20px;'>${index_day}~${index_day+14}</span>`;
};

var ScaleTemplate_10 = function(date){
    var d = date_to_moment(date);
    var index_day = d.diff(moment(start_date), 'days')+1;
    return `<span style='line-height:20px;'>${index_day}~${index_day+9}</span>`;
};

var ScaleTemplate_7 = function(date){
    var d = date_to_moment(date);
    var index_day = d.diff(moment(start_date), 'days')+1;
    return `<span style='line-height:20px;'>${index_day}~${index_day+6}</span>`;
};

var dayScaleTemplate = function(date){
    var d = date_to_moment(date);
    var index_day = d.diff(moment(start_date), 'days')+1;
    return `<span style='line-height:20px;'>${index_day}</span>`;
};


function change_scale(){
    var $obj = $(this);
    var scale = parseInt($obj.attr('scale'));
    if (scale == 30){
        var format_tmp = ScaleTemplate_30;
    } else if (scale == 15){
        var format_tmp = ScaleTemplate_15;
    } else if (scale == 10){
        var format_tmp = ScaleTemplate_10;
    } else if (scale == 7){
        var format_tmp = ScaleTemplate_7;
    } else if (scale == 1){
        var format_tmp = dayScaleTemplate;
    };
    gantt.config.scales = [
        {unit: "day", step: scale, format: format_tmp} //第二刻度
    ];
    if (scale == 1){
        gantt.config.min_column_width = 25; //每隔寬度
    } else {
        gantt.config.min_column_width = 60; //每隔寬度
    };
    $('.change_scale').removeClass('btn-primary');
    $('.change_scale').addClass('btn-info');
    $obj.addClass('btn-primary');
    $obj.removeClass('btn-info');
    gantt.init("gantt_here", new Date(start_date), new Date(end_date)); //只畫出這個範圍的圖
    resize_window();
}

function resize_window(){
    var height = $(window).height();
    var head_height = parseInt($('.header').css('height').replace('px', ''));
    $('#gantt_here').css('height', `${height-head_height-40}px`);
}

function update_progress(){
    var all_tasks = gantt.getTaskByTime();
    var total_progress = 0;
    $.each(all_tasks, function(key){
        var task = all_tasks[key];
        if (float_check.test(task['unit_price']) && (task['type']=='task'||task['id']>10000000000)) {
            total_progress = FloatAdd(total_progress, parseFloat(task['unit_price']));
        };
    });
    total_progress = Math.round(total_progress*100000) / 100000
    $('#total_progress').html(total_progress);
}

function scroll_to_end(){
    var d = date_to_moment(new Date(start_date));
    d = d.add(total_duration, 'd').format('YYYY-MM-DD 00:00:00');
    gantt.showDate(new Date(d));
}

function update_ef(){
    var $obj = $(this);
    var $div = $obj.closest('div');
    var es = parseInt($div.find('[name="es"]').val());
    var duration = parseInt($div.find('[name="duration"]').val());
    $div.find('[name="ef"]').val(es + duration -1);
    $div.find('span[name="show_ef"]').html(es + duration -1);
}

$(document).ready(function(){
    gantt.plugins({ 
        marker: true 
    }); 
    initial_gantt();
    resize_window();

    $('#reject_over_day').click(function(){
        var $obj = $(this);
        if ($obj.prop('checked')){
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
    $(document).on('keyup', '.update_ef', update_ef);
    $('#update_items').click(update_items);

    $("#close_btn").on("click", function(){
        if(window.opener && window.opener.GanttCallback){
            window.opener.GanttCallback();
        };
        window.close();
    });

    $(window).on("beforeunload", function() { 
        if(window.opener && window.opener.GanttCallback){
            window.opener.GanttCallback();
        };
    })
    window.onresize = resize_window;
})