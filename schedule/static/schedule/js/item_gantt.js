function trigger_export_gannt_excel(){
    var $dialog = $('#export_gantt_xlsx_dialog');
    let data_range = $dialog.find('[name="data_range"]').val();
    let value_type = $dialog.find('[name="value_type"]').val();
    window.location.href =`/schedule/make_gantt_schedule_excel/${version_id}/?data_range=${data_range}&value_type=${value_type}`;
}

function trigger_export_dailyreport_excel(){
    var $dialog = $('#export_dailyreport_xlsx_dialog');
    let value_type = $dialog.find('[name="value_type"]').val();
    window.location.href =`/schedule/make_excel_scheduleitem/${version_id}/?price_type=rate&value_type=${value_type}`;
}

function trigger_export_adm_excel(){
    var $dialog = $('#export_adm_dialog');
    let value_type = $dialog.find('[name="value_type"]').val();
    window.location.href =`/schedule/make_adm_png/${version_id}/?value_type=${value_type}`;
}

function trigger_export_png_btn(){
    var $dialog = $('#export_png_dialog');
    let data_range = $dialog.find('[name="data_range"]').val();
    let photo_type = $dialog.find('[name="photo_type"]').val();
    var r_num = parseInt(Math.random() * 10000000);
    var url = `/schedule/make_gantt_schedule_png/${version_id}/?range=${data_range}`;
    if (photo_type == 's'){
        url += '&gantta=false';
    } else if (photo_type == 'gantt&s'){
        url += '&gantta=true';
    };
    const fileName = 'photo_s_gantt.png';
    var el = document.createElement("a");
    el.setAttribute("href", url);
    el.setAttribute("download", fileName);
    document.body.appendChild(el);
    el.click();
    el.remove();
}

function update_to_100_progress(){
    var $obj = $(this);
    Lobibox.confirm({
        msg: '是否確認要由系統自動將目前的進度設定《依比例直接調整》至100%？',
        buttons: {
            accept: {
                'class': 'lobibox-btn lobibox-btn-yes',
                text: '確認調整',
                closeOnClick: true
            },
            cancel: {
                'class': 'lobibox-btn lobibox-btn-no',
                text: '取消',
                closeOnClick: true
            },
        },
        callback: function ($this, type, ev) {
            if(type=="accept"){
                $.ajax({
                    url: '/schedule/api/active/version_schedule/' + version_id + '/',
                    type: 'PUT',
                    data: JSON.stringify({
                        update_to_100_progress: true
                    }),
                    contentType: 'application/json',
                    dataType: 'json',
                    beforeSend: function(XHR) {
                        XHR.setRequestHeader('X-CSRFToken', CSRFMIDDLEWARETOKEN);
                    },
                    success: function (json, text, xhr) {
                        window.location.reload();
                        Lobibox.notify('success', {
                            title: '系統訊息',
                            msg: '已調整完畢',
                        });
                    },
                    error: function (json) {
                        Lobibox.notify('error', {
                            title: '錯誤訊息',
                            msg: json.responseText,
                        });
                    }
                });
            }
        }
    })
}

var GanttWin;
function GanttCallback(){
    window.location.reload();
}

function open_gantt(e){
    var duration = parseInt($('#version_duration').html());
    if (duration <= 0){
        Lobibox.notify('warning', {
            title: '系統訊息',
            msg: "請先設定此草稿之目標總天數",
        });
    } else {
        var h = screen.height; 
        var w = screen.width; 
        var optionStr = "toolbar=no ,location=0, status=no, titlebar=no, menubar=no, top=0, width=" + w + ", height=" + h;
        GanttWin = window.open(`/schedule/gantt_diagram/?version_id=${version_id}`, `gantt_${version_id}`, optionStr);
        return false; 
    }
}

var CPMWin;
function CPMCallback(){
    window.location.reload();
}

function open_cpm(e){
    var duration = parseInt($('#version_duration').html());
    if (duration <= 0){
        Lobibox.notify('warning', {
            title: '系統訊息',
            msg: "請先設定此草稿之目標總天數",
        });
    } else {
        var h = screen.height; 
        var w = screen.width; 
        var optionStr = "toolbar=no ,location=0, status=no, titlebar=no, menubar=no, top=0, width=" + w + ", height=" + h;
        CPMWin = window.open(`/schedule/cpm_diagram/?version_id=${version_id}`, `cpm_${version_id}`, optionStr);
        return false; 
    }
}

var config = {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: "預定進度",
            fill: false,
            pointStyle: 'dash',
            cubicInterpolationMode: "monotone", 
            backgroundColor: window.chartColors.blue,
            borderColor: window.chartColors.blue,
            data: [],
        }]
    },
    options: {
        chartArea: {
            backgroundColor: 'white'
        },
        responsive: true,
        maintainAspectRatio: false,
        title:{
            display:true,
            text:'預定進度S曲線圖',
            fontSize: 30,
            padding: 20,
        },
        tooltips: {
            mode: 'index',
            intersect: false,
        },
        hover: {
            mode: 'nearest',
            intersect: true
        },
        scales: {
            xAxes: [{
                display: true,
                scaleLabel: {
                    display: true,
                    labelString: '天數',
                    fontSize: 18,
                },
            }],
            yAxes: [{
                display: true,
                scaleLabel: {
                    display: true,
                    labelString: '進度',
                    fontSize: 18,
                },
                ticks: {
                    suggestedMin: 0,
                    suggestedMax: 100,
                }
            }],
        }
    },
};

Chart.plugins.register({
    afterDatasetsDraw: function(chartInstance, easing) {
        // To only draw at the end of animation, check for easing === 1
        var ctx = chartInstance.chart.ctx;
        ctx.font = "16px Microsoft JhengHei";
        ctx.fillStyle = "black";
        ctx.fillText(`座標顯示相對天數`, 50, 5);
    }
});

Chart.pluginService.register({
    beforeDraw: function (chart, easing) {
        if (chart.config.options.chartArea && chart.config.options.chartArea.backgroundColor) {
            var helpers = Chart.helpers;
            var ctx = chart.chart.ctx;
            var chartArea = chart.chartArea;
            ctx.save();
            ctx.fillStyle = chart.config.options.chartArea.backgroundColor;
            ctx.fillRect(0, 0, chartArea.right, chartArea.bottom+chartArea.top);
            ctx.restore();
        }
    }
});

window.onload = function() {
    var ctx = document.getElementById("canvas").getContext("2d");
    Chart.defaults.global.defaultFontColor = "black";
    Chart.defaults.global.defaultFontFamily = "Microsoft JhengHei";
    ctx.fillStyle = "white";
    window.myLine = new Chart(ctx, config);
};

function draw_s_curve(){
    var $obj = $(this);
    var duration = parseInt($('#version_duration').html());
    if (duration <= 0){
        Lobibox.notify('warning', {
            title: '系統訊息',
            msg: "請先設定此草稿之目標總天數",
        });
    } else {
        $('#loading').show();
        $('#div_s_curve').show();
        $('#div_s_curve_background').show();
        var data = {
            csrfmiddlewaretoken: CSRFMIDDLEWARETOKEN
        };
        $.ajax({
            url: '/schedule/draw_sch_s_curve/' + version_id + '/',
            type: 'POST',
            data: data,
            dataType: 'json',
            success: function (json, text, xhr) {
                $('#canvas').remove();
                $('#div_canvas').append('<canvas id="canvas" height="180 px"></canvas>');
                var ctx = document.getElementById("canvas").getContext("2d");
                config.data.labels = json['data']['date'];
                config.data.datasets[0].data = json['data']['progress'];
                Chart.plugins.register({
                    afterDatasetsDraw: function(chartInstance, easing) {
                        var ctx = chartInstance.chart.ctx;
                        ctx.font = "16px Microsoft JhengHei";
                        ctx.fillStyle = "black";
                        ctx.fillText("版本設定天數：" + json['max_day'], 50, 25);
                    }
                });
                window.myLine = new Chart(ctx, config);
                $('#loading').hide();
            },
            error: function () {
            },
        })
    }
}

function createItemByEXCEL($buttom){
    var buttom_id = $buttom.attr('id');
    var uploader = new plupload.Uploader({
        runtimes: 'html5',
        browse_button: buttom_id,
        url: '/schedule/create_sch_item_by_excel/',
        multi_selection: false,
        max_file_size : '100mb',
        multipart: true,
        filters : [
            { title: "Excel", extensions: "xlsx" }
        ],
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
        },
        multipart_params : {
            csrfmiddlewaretoken: CSRFMIDDLEWARETOKEN,
            version_id: version_id
        },
        init:{
            FilesAdded:function(up, file){
                var file_name = file[0].name.split('.');
                if (file_name[file_name.length-1].toLowerCase() != 'xlsx'){
                    Lobibox.notify('warning', {
                        title: '警告訊息',
                        msg: "此功能只支援Excel的『xlsx』類型檔案",
                    });
                    return false;
                }
                var item_num = $('#main_table > tbody').find('tr').length;
                if (item_num != 1){
                    var msg = '您目前有自定義工項，確定要<span style="color:red">【捨棄原設定】</span>，並套用 ' + file[0].name + ' 檔案嗎？';
                } else {
                    var msg = '確定上傳這 ' + file[0].name + ' 檔案嗎?';
                };
                Lobibox.confirm({
                    msg: msg,
                    buttons: {
                        accept: {
                            'class': 'lobibox-btn lobibox-btn-yes',
                            text: '確定',
                            closeOnClick: true
                        },
                        cancel: {
                            'class': 'lobibox-btn lobibox-btn-no',
                            text: '取消',
                            closeOnClick: true
                        },
                    },
                    callback: function ($this, type, ev) {
                        if(type=="accept"){
                            up.start();
                        }else{
                            up.splice();
                        }
                    }
                });
            },
            FileUploaded:function(up, file, res){
                var json = $.parseJSON(res.response);
                if (!json['status']){
                    Lobibox.notify('error', {
                        title: '錯誤訊息',
                        msg: json['msg'],
                    });
                } else {
                    Lobibox.notify('success', {
                        title: '系統訊息',
                        msg: '匯入成功，等待頁面重新整理',
                    });
                    window.location.reload();
                }
            }
        }
    });
    uploader.init();
}

function createItemByJSON($buttom){
    var buttom_id = $buttom.attr('id');
    var uploader = new plupload.Uploader({
        runtimes: 'html5',
        browse_button: buttom_id,
        url: '/schedule/create_sch_item_by_json/',
        multi_selection: false,
        max_file_size : '100mb',
        multipart: true,
        // filters : [
        //     { title: "Json", extensions: "json" },
        //     { title: "SCPM", extensions: "scpm" }
        // ],
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
        },
        multipart_params : {
            csrfmiddlewaretoken: CSRFMIDDLEWARETOKEN,
            version_id: version_id
        },
        init:{
            FilesAdded:function(up, file){
                var file_name = file[0].name.split('.');
                var file_ext = file_name[file_name.length-1].toLowerCase();
                if (file_ext != 'json' && file_ext != 'scpm'){
                    Lobibox.notify('warning', {
                        title: '警告訊息',
                        msg: "此功能只支援精靈專用的『json』或『scpm』類型檔案",
                    });
                    return false;
                }
                var item_num = $('#main_table > tbody').find('tr').length;
                if (item_num != 1){
                    var msg = '您目前有自定義工項，確定要<span style="color:red">【捨棄原設定】</span>，並套用 ' + file[0].name + ' 檔案嗎？';
                } else {
                    var msg = '確定上傳這 ' + file[0].name + ' 檔案嗎?';
                };
                Lobibox.confirm({
                    msg: msg,
                    buttons: {
                        accept: {
                            'class': 'lobibox-btn lobibox-btn-yes',
                            text: '確定',
                            closeOnClick: true
                        },
                        cancel: {
                            'class': 'lobibox-btn lobibox-btn-no',
                            text: '取消',
                            closeOnClick: true
                        },
                    },
                    callback: function ($this, type, ev) {
                        if(type=="accept"){
                            up.start();
                        }else{
                            up.splice();
                        }
                    }
                });
            },
            FileUploaded:function(up, file, res){
                var json = $.parseJSON(res.response);
                if (!json['status']){
                    Lobibox.notify('error', {
                        title: '錯誤訊息',
                        msg: json['msg'],
                    });
                } else {
                    Lobibox.notify('success', {
                        title: '系統訊息',
                        msg: '匯入成功，等待頁面重新整理',
                    });
                    window.location.reload();
                }
            }
        }
    });
    uploader.init();
}

function copy_items_to_scheduleitems(){
    var $obj = $(this);
    if (confirm('您確定要複製契約工項為進度項目嗎? (目前設定項目將會被捨棄)')){
        var data = {
            csrfmiddlewaretoken: CSRFMIDDLEWARETOKEN,
            version_id: version_id
        }
        $.ajax({
            url: '/schedule/copy_items_to_scheduleitems/',
            type: 'POST',
            data: data,
            dataType: 'json',
            success: function (json, text, xhr) {
                if (json['status']){
                    alert('複製成功，頁面將重新整理!!');
                    window.location.reload();
                } else {
                    alert(json['msg']);
                }
            },
            error: function () {
            },
        })
    }
}

function copy_main_items_to_scheduleitems(){
    var $obj = $(this);
    if (confirm('您確定要複製契約(總表階層)工項為進度項目嗎? (目前設定項目將會被捨棄)')){
        var data = {
            csrfmiddlewaretoken: CSRFMIDDLEWARETOKEN,
            version_id: version_id
        }
        $.ajax({
            url: '/schedule/copy_main_items_to_scheduleitems/',
            type: 'POST',
            data: data,
            dataType: 'json',
            success: function (json, text, xhr) {
                if (json['status']){
                    alert('複製成功，頁面將重新整理!!');
                    window.location.reload();
                } else {
                    alert(json['msg']);
                }
            },
            error: function () {
            },
        })
    }
}

function recount_day(){
    var $obj = $(this);
    var row_id = $obj.attr('row_id');
    var field_name = $obj.attr('field_name');
    var day = parseInt($obj.val());
    var dir_list = $('#tr_item_' + row_id).attr('top_dir').split('.');
    var delta = parseInt($('#edit_part_delta_' + row_id).val());

    for (i=1;i<dir_list.length;i++){
        var min_day = 100000;
        var max_day = 1;
        var sub_items = $('tr[uplevel_id=' + dir_list[i] + ']');
        for (j=0;j<sub_items.length;j++){
            var id = sub_items[j].id.replace('tr_item_', '');
            var es_item_day = parseInt($('#edit_part_es_' + id).val());
            if (!es_item_day && es_item_day != 0){
                es_item_day = parseInt($('#span_part_es_' + id).val());
            }
            var ef_item_day = parseInt($('#edit_part_ef_' + id).val());
            if (!ef_item_day && ef_item_day != 0){
                ef_item_day = parseInt($('#span_part_ef_' + id).val());
            }
            if (es_item_day<min_day){
                min_day = es_item_day;
            }
            if (ef_item_day>max_day){
                max_day = ef_item_day;
            }
        }
        if (field_name=='es'){
            $('#span_part_es_' + dir_list[i]).val(min_day);
            if (min_day>max_day){
                $('#span_part_ef_' + dir_list[i]).val(min_day);
            }
        } else if (field_name=='ef'){
            $('#span_part_ef_' + dir_list[i]).val(max_day);
        }
    }

    if (field_name=='es'){
        var ef_day = parseInt($('#edit_part_ef_' + row_id).val());
        $('#edit_part_ef_' + row_id).attr('value', day+delta-1);
        $('#edit_part_ef_' + row_id).attr('old_value', day+delta-1);
        $('#show_part_ef_' + row_id).html(day+delta-1);
        $('#edit_part_delta_' + row_id).change();
    }
}

function update_ef_from_delta(){
    var $obj = $(this);
    var row_id = $obj.attr('row_id');
    var delta = $obj.val();
    if (!int_check.test(delta)){
        $obj.css('background-color', 'pink');
        Lobibox.notify('error', {
            title: '系統訊息',
            msg: "請輸入正整數",
        });
    } else if (parseInt(delta) < 1){
        $obj.css('background-color', 'pink');
        Lobibox.notify('error', {
            title: '系統訊息',
            msg: "最小工期為1",
        });
    } else if (parseInt(delta) > 3650){
        $obj.css('background-color', 'pink');
        Lobibox.notify('error', {
            title: '系統訊息',
            msg: "最大工期為3650",
        });
    } else {
        $obj.css('background-color', '');
        delta = parseInt(delta);
        var es = parseInt($('#edit_part_es_' + row_id).val());
        $('#edit_part_ef_' + row_id).val(es + delta - 1);
        $('#edit_part_ef_' + row_id).blur();
        $('#edit_part_ef_' + row_id).change();
    }
}

function arrow_keys_to_detect(event){
    var $obj = $(this);
    var tabindex = $obj.attr('tabindex');
    var first = parseInt(tabindex.substring(0, tabindex.length-1));
    var last = parseInt(tabindex[tabindex.length-1]);
    if ($obj.attr('id')){
        var field_type = $obj.attr('id').split('_')[0];
    } else {
        var field_type = $obj.attr('class').split('_')[0];
    };
    
    $('.tr_hover').css('background-color', '');
    if (event.keyCode == 38) { //上
        var n = 1;
        while ($('input[tabindex=' + String(first-n) + String(last) + ']').length==0 && n <= 10){
            n += 1;
        }
        $('input[tabindex=' + String(first-n) + String(last) + ']').focus();
        var row_id = $('input[tabindex=' + String(first-n) + String(last) + ']').attr('item_id');
        if (!row_id){
            var row_id = $('input[tabindex=' + String(first-n) + String(last) + ']').attr('row_id');
        }
        $('#tr_' + field_type + '_' + row_id).css('background-color', 'rgba(100, 255, 100, 0.5)');
    } else if (event.keyCode == 40) { //下
        var n = 1;
        while ($('input[tabindex=' + String(first+n) + String(last) + ']').length==0 && n <= 10){
            n += 1;
        }
        $('input[tabindex=' + String(first+n) + String(last) + ']').focus();
        var row_id = $('input[tabindex=' + String(first+n) + String(last) + ']').attr('item_id');
        if (!row_id){
            var row_id = $('input[tabindex=' + String(first+n) + String(last) + ']').attr('row_id');
        }
        $('#tr_' + field_type + '_' + row_id).css('background-color', 'rgba(100, 255, 100, 0.5)');
    }
}

function show_hide_sub_item(){
    var $obj = $(this);
    var $tr = $obj.closest('tr');
    var item_id = $tr.attr('row_id');
    var open = $obj.attr('src').indexOf('close')==-1;
    if (open){
        $obj.attr('src', $obj.attr('src').replace('open', 'close'));
    } else {
        $obj.attr('src', $obj.attr('src').replace('close', 'open'));
    }

    //已經讀取過了，頁面上有工項
    $.each($('#main_table > tbody').find('tr'), function(){
        var $sub_tr = $(this);
        var uplevel_id = $sub_tr.attr('uplevel_id');
        var sub_item_id = $sub_tr.attr('row_id');
        if (uplevel_id==item_id){
            if (open){
                $sub_tr.show();
            } else {
                if ($sub_tr.find('.show_hide_sub_item').length == 1){
                    $sub_tr.find('.show_hide_sub_item').attr('src', $sub_tr.find('.show_hide_sub_item').attr('src').replace('close', 'open'));
                    close_sub_items(sub_item_id);
                };
                $sub_tr.hide();
            }
        }
    });
}

function close_sub_items(item_id){
    var subs = $('#main_table > tbody').find('tr[uplevel_id="' + item_id + '"]');
    subs.hide();
    if (subs){
        $.each(subs, function(){
            var $sub_tr = $(this);
            var sub_item_id = $sub_tr.attr('row_id');
            if ($sub_tr.find('.show_hide_sub_item').length == 1){
                $sub_tr.find('.show_hide_sub_item').attr('src', $sub_tr.find('.show_hide_sub_item').attr('src').replace('close', 'open'));
                close_sub_items(sub_item_id);
            };
        });
    }
}

function set_main_item(){
    var $obj = $(this);
    var row_id = $obj.closest('tr').attr('row_id');
    var uplevel_id = $obj.closest('tr').attr('uplevel_id');
    var is_main_item = $obj.prop('checked') == true;

    var data = {
        csrfmiddlewaretoken: CSRFMIDDLEWARETOKEN,
        is_main_item: is_main_item,
    };

    $('#loading').show();
    do_main_item(data);
    function do_main_item(data){
        $.ajax({
            url: '/schedule/api/active/scheduleitem/' + row_id + '/',
            type: 'PUT',
            data: JSON.stringify(data),
            contentType: 'application/json',
            dataType: 'json',
            success: function (json, text, xhr) {
                $('#loading').hide();
                if (!data['is_main_item']){
                    dis_checked_main_item(uplevel_id);
                } else {
                    $.each($('#main_table > tbody').find('tr[uplevel_id="' + uplevel_id + '"]'),function(){
                        var $obj = $(this);
                         $obj.find('.set_main_item').prop('checked', true);
                    })
                };
            },
            error: function (json) {
                $('#loading').hide();
                if (data['is_main_item']){
                    $obj.prop('checked', false);
                } else {
                    $obj.prop('checked', true);
                }
                Lobibox.notify('error', {
                    title: '錯誤訊息',
                    msg: json.responseText,
                });
            },
        })
        $('#nothing').click();
    }
}


function dis_checked_main_item(uplevel_id){
    $.each($('#main_table > tbody').find('tr[uplevel_id="' + uplevel_id + '"]'), function(){
        var $tr = $(this);
        $tr.find('.set_main_item').prop('checked', false);
        if ($tr.attr('kind_id') == 10){
            dis_checked_main_item($tr.attr('row_id'));
        }
    })
}

function set_cp(){
    var $obj = $(this);
    var row_id = $obj.closest('tr').attr('row_id');
    var cp = $obj.prop('checked') == true;

    var data = {
        csrfmiddlewaretoken: CSRFMIDDLEWARETOKEN,
        cp: cp,
    };

    do_main_item(data);
    
    function do_main_item(data){
        $.ajax({
            url: '/schedule/api/active/scheduleitem/' + row_id + '/',
            type: 'PUT',
            data: JSON.stringify(data),
            contentType: 'application/json',
            dataType: 'json',
            success: function (json, text, xhr) {
            },
            error: function (json) {
                if (data['cp']){
                    $obj.prop('checked', false);
                } else {
                    $obj.prop('checked', true);
                }
                Lobibox.notify('error', {
                    title: '錯誤訊息',
                    msg: json.responseText,
                });
            },
        })
        $('#nothing').click();
    }
}

function transfer_money_or_rate(e) {
    //輸入數字後自動轉換對應的金額或比率
    var value = remove_TransformThousands(e.target.value);
    var row_id = $(e.target).attr('row_id');
    var money = FloatMul(value, engs_price);
    $('#transfer_value_' + row_id).html(TransformThousands(parseInt(money/100)));
}

function update_unit_price(){
    var $obj = $(this);
    var row_id = $obj.attr('row_id');
    var value = $obj.val().replace(/ /g,"").replace(/,/g,"");
    var old_value = $obj.attr('old_value');
    if (!float_check.test(value)){
        Lobibox.notify('warning', {
            title: '系統訊息',
            msg: '請輸入數字',
        });
        $obj.val(old_value);
        return false;
    } else {
        var rate = FloatDiv(value, engs_price);
        var $input = $('input[field_name="unit_price"][row_id="' + row_id + '"]');
        $input.val(rate*100);
        $input.blur();
        var old_value = $obj.attr('old_value', value);
    }
}

function recount_price(){
    //用來更新 變更後的目錄類型總價
    var round_type = $('#round_type').val();
    var $obj = $(this);
    var row_id = $obj.attr('row_id');
    var price = $('#edit_part_unit_price_' + row_id).val();
    var old_price = $('#edit_part_unit_price_' + row_id).attr('old_value');
    var A = old_price;
    var B = price;
    var dulta = FloatSubtraction(B, A);
    if (!float_check.test(dulta)){
        return false;
    }
    var dir_list = $('#tr_item_' + row_id).attr('top_dir').split('.');
    $.each(dir_list, function(k, dir_id){
        if (dir_id){
            var rate = 0;
            var $subs = $('#main_table > tbody').find('tr.table-light').filter(function() { 
                var elm = $(this);
                return elm.attr('top_dir').indexOf('.' + dir_id) != -1;
            });
            $.each($subs, function(){
                var $tr = $(this);
                var $input = $tr.find('input[field_name="unit_price"]');
                rate = FloatAdd(rate, $input.val());
            })
            rate = Math.round(rate*10000000000)/10000000000;
            var money = Math.round(FloatMul(rate, engs_price)/100);
            $("#show_part_unit_price_" + dir_id).html(rate);
            $("#transfer_value_" + dir_id).html(intcomma(cutZero(money)));
        }
    });
}

function create_item(){
    var $obj = $(this);
    var id = $obj.attr('id');
    var row_id = $('#reset_right_menu').attr('row_id');
    var table_name = $('#reset_right_menu').attr('table_name');
    if (id=='create_same_dir'){
        var level = 'same_dir';
    } else if (id=='create_sub_dir'){
        var level = 'sub_dir';
    } else if (id=='create_item'){
        var level = 'item';
    };
    var ok = true;

    if (ok){
        var data = {
            csrfmiddlewaretoken: CSRFMIDDLEWARETOKEN,
            table_name: table_name,
            row_id: row_id,
            level: level,
        }
        $.ajax({
            url: '/schedule/create_item/',
            type: 'POST',
            data: data,
            dataType: 'json',
            success: function (json) {
                if (json['status']){
                    var html = $(json['html']);
                    for (i=0;i<json['target_ids'].length;i++){
                        if ($('#tr_item_' + json['target_ids'][i]).length != 0){
                            var target_id = json['target_ids'][i];
                            break;
                        }
                    };
                    html.insertAfter($('#tr_item_' + target_id));
                    $('.right_click_menu', html).contextMenu('reset_right_menu', {
                        onContextMenu: function(e) {
                            return true;
                        },
                        onShowMenu: function(e, menu) {
                            var $tr = $(e.target).closest('tr');
                            var row_id = $tr.attr('row_id');
                            var need_right_click = true;
                            var uplevel_id = $tr.attr('uplevel_id');
                            var kind = $tr.attr('kind');
                            var onetype = $tr.attr('onetype');
                            var invoice_item = $tr.attr('invoice_item');
                            var invoice_main = $tr.attr('invoice_main');
                            var project_link = $tr.attr('project_link'); //連結工程案
                            $('#reset_right_menu').attr('row_id', row_id);
                            $('#reset_right_menu').attr('kind', kind);
                            $('#delete_all_item', menu).remove();
                            if (!need_right_click){
                                $('#create_same_dir, #create_sub_dir, #create_item, #update_priority, #update_priority_outdent, #update_priority_indent, #delete_item', menu).remove();
                            } else if (!uplevel_id) {
                                $('#create_same_dir, #update_priority, #update_priority_outdent, #update_priority_indent, #delete_item', menu).remove();
                            } else if (kind != '目錄'){
                                $('#create_same_dir, #create_sub_dir', menu).remove();
                            };
                        return menu;
                        }
                    });
                    $('#tr_item_' + json['new_row_id']).click();
                    $('#tr_item_' + json['new_row_id']).effect("highlight", {color: 'red'}, 1500);1
                } else {
                    Lobibox.notify('error', {
                        title: '錯誤訊息',
                        msg: json['msg'],
                    });
                }
            },
            error: function (json) {
                Lobibox.notify('error', {
                    title: '錯誤訊息',
                    msg: json.responseText,
                });
            },
        })
    }
}

function delete_item(){
    var $obj = $(this);
    var row_id = $('#reset_right_menu').attr('row_id');
    $('#tr_item_' + row_id).click();
    var table_name = $('#reset_right_menu').attr('table_name');
    var msg = '確定要刪除這個項目嗎？若為目錄類型，亦將會一併刪除所屬全部工項!!!';
    $.ajax({
        url: '/schedule/api/active/' + table_name + '/get_delete_sub_ids/?row_id=' + row_id,
        type: 'GET',
        contentType: 'application/json',
        dataType: 'json',
        success: function (json, text, xhr) {
            var delete_ids = json['delete_ids'].split('.');
            Lobibox.confirm({
                msg: msg,
                buttons: {
                    accept: {
                        'class': 'lobibox-btn lobibox-btn-yes',
                        text: '確定刪除',
                        closeOnClick: true
                    },
                    cancel: {
                        'class': 'lobibox-btn lobibox-btn-no',
                        text: '取消',
                        closeOnClick: true
                    },
                },
                callback: function ($this, type, ev) {
                    if(type=="accept"){
                        Lobibox.confirm({
                            msg: '再次確認!!! 將會刪除 ' + String(delete_ids.length) + ' 個項目，此動作將無法恢復!!!',
                            buttons: {
                                accept: {
                                    'class': 'lobibox-btn lobibox-btn-yes',
                                    text: '確定刪除',
                                    closeOnClick: true
                                },
                                cancel: {
                                    'class': 'lobibox-btn lobibox-btn-no',
                                    text: '取消',
                                    closeOnClick: true
                                },
                            },
                            callback: function ($this, type, ev) {
                                if(type=="accept"){
                                    $("#loading").show();
                                    $.ajax({
                                        url: '/schedule/api/active/' + table_name + '/' + row_id + '/',
                                        type: 'DELETE',
                                        contentType: 'application/json',
                                        dataType: 'json',
                                        success: function (json, text, xhr) {
                                            for (n=0; n<delete_ids.length; n++){
                                                var delete_id = delete_ids[n];
                                                $('#edit_part_unit_price_' + delete_id).attr('value', '0');
                                                $('#edit_part_unit_price_' + delete_id).change();
                                                $('#tr_item_' + delete_id).remove();
                                            };
                                            $("#loading").hide();
                                            recount_price();
                                        },
                                        error: function (json) {
                                            Lobibox.notify('error', {
                                                title: '錯誤訊息',
                                                msg: json.responseText,
                                            });
                                        },
                                    })
                                }else{
                                    return false;
                                }
                            }
                        });
                    }else{
                        return false;
                    }
                }
            });
        },
        error: function (json) {
            Lobibox.notify('error', {
                title: '錯誤訊息',
                msg: json.responseText,
            });
        },
    })
    $('#nothing').click();
}

function delete_all_item(){
    Lobibox.confirm({
        msg: '確定要刪除所有的工項嗎!!!',
        buttons: {
            accept: {
                'class': 'lobibox-btn lobibox-btn-yes',
                text: '確定刪除',
                closeOnClick: true
            },
            cancel: {
                'class': 'lobibox-btn lobibox-btn-no',
                text: '取消',
                closeOnClick: true
            },
        },
        callback: function ($this, type, ev) {
            if(type=="accept"){
                $.ajax({
                    url: '/schedule/delete_all_item/',
                    type: 'POST',
                    data: JSON.stringify({
                        'table_name': 'ScheduleItem',
                        'version_id': version_id,
                    }),
                    contentType: 'application/json',
                    dataType: 'json',
                    beforeSend: function(XHR) {
                        XHR.setRequestHeader('X-CSRFToken', CSRFMIDDLEWARETOKEN);
                    },
                    success: function (json, text, xhr) {
                        Lobibox.notify('success', {
                            title: '系統訊息',
                            msg: "已刪除所有工項",
                        });
                        window.location.reload();
                    },
                    error: function (json, text, xhr) {
                        console.log(json);
                    },
                })
            }else{
                return false;
            }
        }
    });
}

function update_priority() {
    var $obj = $(this);
    var id = $obj.attr('id');
    var kind = $('#reset_right_menu').attr('kind');
    var row_id = $('#reset_right_menu').attr('row_id');
    $('#tr_item_' + row_id).click();
    var table_name = $('#reset_right_menu').attr('table_name');
    if (id=='update_priority_outdent') {
        var direction = 'outdent';
    } else if (id=='update_priority_indent') {
        var direction = 'indent';
    };
    var data = {
        csrfmiddlewaretoken: CSRFMIDDLEWARETOKEN,
        table_name: table_name,
        row_id: row_id,
        direction: direction,
    };
    $.ajax({
        url: '/schedule/update_priority/',
        type: 'POST',
        data: data,
        dataType: 'json',
        success: function (json) {
            if (json['status']){
                if (direction=='up'){
                    $('#tr_item_' + row_id).insertBefore($('#tr_item_' + json['target_id']));
                } else if (direction=='down') {
                    $('#tr_item_' + row_id).insertAfter($('#tr_item_' + json['target_id']));
                } else if (direction=='outdent') {
                    var class_name = $('#td_item_name_' + row_id).attr('class');
                    var padding_name = class_name.split(' ')[0];
                    var padding_num = padding_name.split('_')[1];
                    var padding_num_2 = String(parseInt(padding_num) - 1);
                    $('#td_item_name_' + row_id).attr('class', class_name.replace(padding_num, padding_num_2))
                    $('#tr_item_' + row_id).insertAfter($('#tr_item_' + json['target_id']));
                    $('#tr_item_' + row_id).attr('uplevel_id', json['new_uplevel']);
                } else if (direction=='indent') {
                    var class_name = $('#td_item_name_' + row_id).attr('class');
                    var padding_name = class_name.split(' ')[0];
                    var padding_num = padding_name.split('_')[1];
                    var padding_num_2 = String(parseInt(padding_num) + 1);
                    $('#td_item_name_' + row_id).attr('class', class_name.replace(padding_num, padding_num_2))
                    $('#tr_item_' + row_id).insertAfter($('#tr_item_' + json['target_id']));
                    $('#tr_item_' + row_id).attr('uplevel_id', json['new_uplevel']);
                } ;

                $('#tr_item_' + row_id).effect("highlight", {color: 'red'}, 1500);
                var show_or_hide_type = $('#show_or_hide_item').attr('now');

                if (kind=='目錄'){
                    var target_id = row_id;
                    var sub_item_ids = json['sub_item_ids'].split('_');
                    for (t_id=0; t_id<sub_item_ids.length; t_id++){
                        $('#tr_item_' + sub_item_ids[t_id]).insertAfter($('#tr_item_' + target_id));
                        if (show_or_hide_type=='hide' && $('#tr_item_' + sub_item_ids[t_id]).attr('kind') == '工項'){
                            $('#tr_item_' + sub_item_ids[t_id]).hide();
                        }
                        target_id = sub_item_ids[t_id];
                        if (direction=='outdent'){
                            var class_name = $('#td_item_name_' + sub_item_ids[t_id]).attr('class');
                            if (class_name){
                                var padding_name = class_name.split(' ')[0];
                                var padding_num = padding_name.split('_')[1];
                                var padding_num_2 = String(parseInt(padding_num) - 1);
                                $('#td_item_name_' + sub_item_ids[t_id]).attr('class', class_name.replace(padding_num, padding_num_2));
                            }
                        } else if (direction=='indent'){
                            var class_name = $('#td_item_name_' + sub_item_ids[t_id]).attr('class');
                            if (class_name) {
                                var padding_name = class_name.split(' ')[0];
                                var padding_num = padding_name.split('_')[1];
                                var padding_num_2 = String(parseInt(padding_num) + 1);
                                $('#td_item_name_' + sub_item_ids[t_id]).attr('class', class_name.replace(padding_num, padding_num_2));
                            }
                        };
                        $('#tr_item_' + sub_item_ids[t_id]).effect("highlight", {color: 'green'}, 1500);
                    }
                };
                if (show_or_hide_type == 'hide'){
                    $('tr[kind=工項]').hide();
                };
                recount_price();
            } else {
                Lobibox.notify('error', {
                    title: '錯誤訊息',
                    msg: json['msg'],
                });
                return false;
            }
        },
        error: function (json) {
            Lobibox.notify('error', {
                title: '錯誤訊息',
                msg: json.responseText,
            });
        },
    })
}

function new_update_priority(){
    var $obj = $(this);
    var id = $obj.attr('id');
    var kind = $('#reset_right_menu').attr('kind');
    var row_id = $('#reset_right_menu').attr('row_id');
    var $tr = $('#tr_item_' + row_id);
    var uplevel_id = $tr.attr('uplevel_id');
    $('#change_item_priority').attr('uplevel_id', uplevel_id);
    $('#table_update_priority_list > tbody').find('tr').remove();
    $('#loading').show();
    $.ajax({
        url: '/schedule/api/active/scheduleitem/?limit=0&order_by=priority&uplevel=' + uplevel_id,
        type: 'GET',
        contentType: 'application/json',
        dataType: 'json',
        beforeSend: function(XHR) {
            XHR.setRequestHeader('X-CSRFToken', CSRFMIDDLEWARETOKEN);
        },
        success: function (json, text, xhr) {
            $('#loading').hide();
            for (i=0; i<json.objects.length;i++){
                json.objects[i]['sort'] = i+1;
                var item = json.objects[i];
                json.objects[i]['id'] = item['id'];
                json.objects[i]['symbol'] = item['read_level_symbol'];
                json.objects[i]['name'] = item['name'];
                var $div = $('#HidePriorityTr').tmpl(json.objects[i]).appendTo($('#table_update_priority_list > tbody:last'));
            }
            $('#table_update_priority_list > tbody').sortable({
                opacity: 0.6,    //拖曳時透明
                cursor: 'pointer',  //游標設定
                axis: 'y',       //只能垂直拖曳
                update: function(event, ui) { 
                    $(".sort").each(function(){
                        $(this).html($(".sort").index($(this))+1);
                    });
                } 
            });
            $('#update_priority_dialog').modal('show');
        },
        error: function (json) {
            Lobibox.notify('error', {
                title: '錯誤訊息',
                msg: json.responseText,
            });
        }
    });
}

function change_item_priority(){
    var $obj = $(this);
    var uplevel_id = $obj.attr('uplevel_id');
    var data = {
        csrfmiddlewaretoken: CSRFMIDDLEWARETOKEN,
        objects: []
    };
    $('#loading').show();
    $(".tr_priority").each(function(){
        var $obj = $(this);
        data['objects'].push({
            'row_id': $obj.attr('row_id'),
            'priority': $(".tr_priority").index($obj)
        });
    });
    $.ajax({
        url: '/schedule/api/active/scheduleitem/change_item_priority/',
        type: 'POST',
        data: JSON.stringify(data),
        contentType: 'application/json',
        dataType: 'json',
        success: function (json, text, xhr) {
            $('#loading').hide();
            $('#update_priority_dialog').modal('hide');
            $(".tr_priority").each(function(){
                var $obj = $(this);
                var priority = $(".tr_priority").index($obj);
                if (priority != 0){
                    var this_item = $('#tr_item_' + $(".tr_priority:eq(" + priority + ")").attr('row_id'));
                    var before_item = $('#tr_item_' + $(".tr_priority:eq(" + (priority-1) + ")").attr('row_id'));
                    this_item.insertAfter(before_item);
                }
            });
            $(".tr_priority").each(function(){
                var $obj = $(this);
                var priority = $(".tr_priority").index($obj);
                var this_item = $('#tr_item_' + $(".tr_priority:eq(" + priority + ")").attr('row_id'));
                var sub_item_ids = read_deep_sub_item_in_list(this_item, []);
                sub_item_ids = sub_item_ids.reverse();
                for (i=0;i<sub_item_ids.length;i++){
                    $('#tr_item_' + sub_item_ids[i]).insertAfter($('#tr_item_' + this_item.attr('row_id')));
                }
            });
        },
        error: function(json){
            console.log(json.responseText);
        }
    })
}

//尋找下階，並回傳
function read_deep_sub_item_in_list(item){
    item_ids = []
    function read_item_in_list(i, is){
        $.each($('#main_table').find('tr[uplevel_id="' + i.attr('row_id') + '"]'), function(){
            var $obj = $(this);
            is.push($obj.attr('row_id'));
            item_ids = read_item_in_list($obj, item_ids);
        })
        return item_ids
    }
    item_ids = read_item_in_list(item, item_ids)
    return item_ids
}

function create_item_by_month(){
    var $dialog = $('#month_create_dialog');
    var start_date = $dialog.find('[name="start_date"]').val();
    var end_date = $dialog.find('[name="end_date"]').val();
    if (!date_check.test(start_date) || ! date_check.test(end_date)){
        Lobibox.notify('warning', {
            title: '系統訊息',
            msg: '請輸入正確的日期格式',
        });
    } else if (moment(start_date) >= moment(end_date)){
        Lobibox.notify('warning', {
            title: '系統訊息',
            msg: '起訖日期關係錯誤',
        });
    } else {
        Lobibox.confirm({
            msg: '系統將會取代目前現有項目設定？ (無法恢復)',
            buttons: {
                accept: {
                    'class': 'lobibox-btn lobibox-btn-yes',
                    text: '確認新增工項',
                    closeOnClick: true
                },
                cancel: {
                    'class': 'lobibox-btn lobibox-btn-no',
                    text: '取消',
                    closeOnClick: true
                },
            },
            callback: function ($this, type, ev) {
                if(type=="accept"){
                    Lobibox.notify('success', {
                        title: '系統訊息',
                        msg: '系統創建中，請稍後頁面重新整理。',
                        delay: 10000
                    });
                    $.ajax({
                        url: '/schedule/create_item_by_month/',
                        type: 'POST',
                        data: JSON.stringify({
                            version_id: version_id,
                            start_date: start_date,
                            end_date: end_date,
                        }),
                        contentType: 'application/json',
                        dataType: 'json',
                        beforeSend: function(XHR) {
                            XHR.setRequestHeader('X-CSRFToken', CSRFMIDDLEWARETOKEN);
                        },
                        success: function (json, text, xhr) {
                            window.location.reload();
                        },
                        error: function (json) {
                            Lobibox.notify('error', {
                                title: '錯誤訊息',
                                msg: json.responseText,
                            });
                        }
                    });
                }
            }
        })
    }
}

function create_item_by_range(){
    var $dialog = $('#range_create_dialog');
    var duration = $dialog.find('[name="duration"]').val();
    var scale = $dialog.find('[name="scale"]').val();
    if (!duration || !scale || !int_check.test(duration) || ! int_check.test(scale)){
        Lobibox.notify('warning', {
            title: '系統訊息',
            msg: '請輸入整數',
        });
    } else if (parseInt(scale) > parseInt(duration)){
        Lobibox.notify('warning', {
            title: '系統訊息',
            msg: '間格天數不可大於總工期',
        });
    } else {
        Lobibox.confirm({
            msg: '系統將會取代目前現有項目設定？ (無法恢復)',
            buttons: {
                accept: {
                    'class': 'lobibox-btn lobibox-btn-yes',
                    text: '確認新增工項',
                    closeOnClick: true
                },
                cancel: {
                    'class': 'lobibox-btn lobibox-btn-no',
                    text: '取消',
                    closeOnClick: true
                },
            },
            callback: function ($this, type, ev) {
                if(type=="accept"){
                    Lobibox.notify('success', {
                        title: '系統訊息',
                        msg: '系統創建中，請稍後頁面重新整理。',
                        delay: 10000
                    });
                    $.ajax({
                        url: '/schedule/create_item_by_range/',
                        type: 'POST',
                        data: JSON.stringify({
                            version_id: version_id,
                            duration: duration,
                            scale: scale,
                        }),
                        contentType: 'application/json',
                        dataType: 'json',
                        beforeSend: function(XHR) {
                            XHR.setRequestHeader('X-CSRFToken', CSRFMIDDLEWARETOKEN);
                        },
                        success: function (json, text, xhr) {
                            window.location.reload();
                        },
                        error: function (json) {
                            Lobibox.notify('error', {
                                title: '錯誤訊息',
                                msg: json.responseText,
                            });
                        }
                    });
                }
            }
        })
    }
}

function set_duration(){
    var duration = $('#version_duration').html();
    Lobibox.prompt('text', //Any input type will be valid
        {
            title: '請輸入此版本總天數',
            attrs: {
                placeholder: "帳號(不可使用中文)",
                value: duration
            },
            callback : function($this,type,ev){
                if (type == 'ok'){
                    var value = $this.getValue();
                    if (!int_check.test(value)){
                        Lobibox.notify('warning', {
                            title: '系統訊息',
                            msg: '請輸入整數',
                        });
                    } else if (parseInt(value) <= 0){
                        Lobibox.notify('warning', {
                            title: '系統訊息',
                            msg: '工期天數最少為1天',
                        });
                    } else {
                        $.ajax({
                            url: '/schedule/api/active/version_schedule/' + version_id + '/',
                            type: 'PUT',
                            data: JSON.stringify({
                                duration: parseInt(value)
                            }),
                            contentType: 'application/json',
                            dataType: 'json',
                            beforeSend: function(XHR) {
                                XHR.setRequestHeader('X-CSRFToken', CSRFMIDDLEWARETOKEN);
                            },
                            success: function (json, text, xhr) {
                                $('#version_duration').html(parseInt(value));
                                $('#msg_no_duration').remove();
                                Lobibox.notify('success', {
                                    title: '系統訊息',
                                    msg: '已完成設定工期',
                                });
                            },
                            error: function (json) {
                                Lobibox.notify('error', {
                                    title: '錯誤訊息',
                                    msg: json.responseText,
                                });
                            }
                        });
                    }
                }
            }
        }
    );
}

function update_mapping_version(){
    var version = $('#set_version_dialog').find('[name="version"]').val();
    if (version){
        Lobibox.confirm({
            msg: '是否確認要對應該契約版本？ 確定對應後無法再次修改!!',
            buttons: {
                accept: {
                    'class': 'lobibox-btn lobibox-btn-yes',
                    text: '確認對應',
                    closeOnClick: true
                },
                cancel: {
                    'class': 'lobibox-btn lobibox-btn-no',
                    text: '取消',
                    closeOnClick: true
                },
            },
            callback: function ($this, type, ev) {
                if(type=="accept"){
                    $.ajax({
                        url: '/schedule/api/active/version_schedule/' + version_id + '/',
                        type: 'PUT',
                        data: JSON.stringify({
                            version: version
                        }),
                        contentType: 'application/json',
                        dataType: 'json',
                        beforeSend: function(XHR) {
                            XHR.setRequestHeader('X-CSRFToken', CSRFMIDDLEWARETOKEN);
                        },
                        success: function (json, text, xhr) {
                            window.location.reload();
                        },
                        error: function (json) {
                            Lobibox.notify('error', {
                                title: '錯誤訊息',
                                msg: json.responseText,
                            });
                        }
                    });
                }
            }
        })
    } else {
        $('#set_version_dialog').modal('hide');
        Lobibox.notify('error', {
            title: '系統訊息',
            msg: '無對應契約版本',
        });
    }
}

function clone_to_version(){
    var $dialog = $('#clone_version_dialog');
    var version = $dialog.find('[name="version"]').val();
    var project = '/project/api/v1/project/' + project_id + '/';
    var schedule_setting_type = $dialog.find('[name="schedule_setting_type"]').val();
    if (!version){
        version = null;
    };
    if (!project_id){
        project = null;
    };
    $.ajax({
        url: '/schedule/api/active/version_schedule/',
        type: 'POST',
        data: JSON.stringify({
            project: project,
            project_name: project_name,
            version: version,
            clone_version: version_id,
            schedule_setting_type: schedule_setting_type,
            duration: parseInt($('#version_duration').html()),
        }),
        contentType: 'application/json',
        dataType: 'json',
        beforeSend: function(XHR) {
            XHR.setRequestHeader('X-CSRFToken', CSRFMIDDLEWARETOKEN);
        },
        success: function (json, text, xhr) {
            Lobibox.notify('success', {
                title: '系統訊息',
                msg: '複製成功，請等待系統跳轉',
            });

            window.location = '/schedule/item_profile/' + json['id'] + '/';
        },
        error: function (json) {
            Lobibox.notify('error', {
                title: '錯誤訊息',
                msg: json.responseText,
            });
        }
    });
}

$(document).ready(function(){
    $('.right_click_menu').contextMenu('reset_right_menu', {
        onContextMenu: function(e) {
            return true;
        },
        onShowMenu: function(e, menu) {
            var $tr = $(e.target).closest('tr');
            var row_id = $tr.attr('row_id');
            var uplevel_id = $tr.attr('uplevel_id');
            var kind = $tr.attr('kind');
            $('#reset_right_menu').attr('row_id', row_id);
            $('#reset_right_menu').attr('kind', kind);
            if (!uplevel_id) {
                $('#create_same_dir, #update_priority, #update_priority_up, #update_priority_down, #update_priority_outdent, #update_priority_indent, #delete_item', menu).remove();
            } else if (kind != '目錄'){
                $('#create_same_dir, #create_sub_dir, #delete_all_item', menu).remove();
            } else {
                $('#delete_all_item', menu).remove();
            }
            return menu;
        }
    });

    $('#draw_s_curve').click(draw_s_curve);
    $("#save-image-btn").click(function() {
        $("#canvas").get(0).toBlob(function(blob) {
            var today = new Date();
            var version_start_date = $('#version_start_date').html();
            saveAs(blob, `${version_start_date}-${project_name}-預定進度S曲線圖.png`);
        });
    });
    $('.open_gantt').click(open_gantt);
    $('.open_cpm').click(open_cpm);
    $('#trigger-export-gannt-excel-btn').click(trigger_export_gannt_excel);
    $('#trigger-export-dailyreport-excel-btn').click(trigger_export_dailyreport_excel);
    $('#trigger-export-adm-btn').click(trigger_export_adm_excel);

    $('#trigger-export-png-btn').click(trigger_export_png_btn);

    $('#update_to_100_progress').click(update_to_100_progress);
    $('.arrow_keys_to_detect').keydown(arrow_keys_to_detect); // 讓input可以用上下左右鍵來快速移動

    $(".uploaderEXCEL").each(function(){
        var $obj = $(this);
        createItemByEXCEL($obj);
    });

    $(".uploaderJSON").each(function(){
        var $obj = $(this);
        createItemByJSON($obj);
    });

    $('#copy_items_to_scheduleitems').click(copy_items_to_scheduleitems);
    $('#copy_main_items_to_scheduleitems').click(copy_main_items_to_scheduleitems);

    $(document).on('change', '.recount_day', recount_day);
    $(document).on('change', '.update_ef_from_delta', update_ef_from_delta);
    $(document).on('click', '.show_hide_sub_item', show_hide_sub_item);
    $(document).on('click', '.set_main_item', set_main_item);
    $(document).on('click', '.set_cp', set_cp);
    $(document).on('change', '.update_unit_price', update_unit_price);
    $(document).on('change', '.recount_price', recount_price);

    $('#create_same_dir').click(create_item);
    $('#create_sub_dir').click(create_item);
    $('#create_item').click(create_item);
    $('#delete_item').click(delete_item);
    $('#delete_all_item').click(delete_all_item);
    $('#update_priority_outdent').click(update_priority);
    $('#update_priority_indent').click(update_priority);
    $('#update_priority').click(new_update_priority);
    $('#change_item_priority').click(change_item_priority);

    $('#create_item_by_month').click(create_item_by_month);
    $('#create_item_by_range').click(create_item_by_range);

    $('#set_duration').click(set_duration);
    $('#update_mapping_version').click(update_mapping_version);
    $('#clone_to_version').click(clone_to_version);


    if (schedule_setting_type == 1 && $('#cpm-image').length != 0){
        // View an image.
        const viewer = new Viewer(document.getElementById('cpm-image'), {
            inline: true,
            toolbar: false,
            navbar: false,
            viewed() {
                viewer.zoomTo(1);
            },
        });
    }
})