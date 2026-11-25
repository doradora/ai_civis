function search(){
    var $obj = $('#search');
    var string = 'order_by=-create_time';
    var p__name__icontains = $('.search-form').find('.search-name-input[name="p__name__icontains"]').val();
    if(p__name__icontains){
        string += '&p__name__icontains=' + p__name__icontains;
    }
    var page = parseInt($obj.attr('page'));
    var per_page = $('#pageChooseSelect').val();
    per_page = parseInt(per_page);
    string += '&offset=' + ((page-1) * per_page);
    string += '&limit=' + per_page;
    
    url = '/schedule/api/active/version_schedule/?' + string;
    $('#div_result').html('');
    $('#ajax_loading_screen').show();
    $.ajax({
        url: url,
        type: 'GET',
        contentType: 'application/json',
        dataType: 'json',
        success: function (data) {
            $('#ajax_loading_screen').hide();
            for (var i=0; i<data.objects.length; i++){
                data.objects[i]['sort'] = i+1+(page-1)*per_page;
                data.objects[i]['create_time'] = data.objects[i]['create_time'].replace('T', ' ').slice(0,19);
                data.objects[i]['update_time'] = data.objects[i]['update_time'].replace('T', ' ').slice(0,19);
                var $div = $('#version_obj').tmpl(data.objects[i]).appendTo($('#div_result'));
            }
            //製造分頁
            if (data.meta.total_count){
                if ($('.pagination').html()) {
                    $('.pagination').twbsPagination('destroy');
                }
                $('.pagination').twbsPagination({
                    totalPages: Math.ceil(data.meta.total_count/per_page),
                    startPage: page,
                    first: '<span aria-hidden="true">&laquo;</span>',
                    prev: '<span aria-hidden="true">&lsaquo;</span>',
                    next: '<span aria-hidden="true">&rsaquo;</span>',
                    last: '<span aria-hidden="true">&raquo;</span>',
                    visiblePages: Math.min(Math.ceil(data.meta.total_count/per_page), 10),
                    onPageClick: function (event, page) {
                        renew_search(page);
                    }
                });
            } else {
                if ($('.pagination').html()) {
                    $('.pagination').twbsPagination('destroy');
                }
            }
            $('.total_count').html('共有' + Math.ceil(data.meta.total_count/per_page) + '頁，' + data.meta.total_count + '筆資料');
        },
        error: function(json){
            $('#ajax_loading_screen').hide();
        }
    })
}

function renew_search(page){
    $('#search').attr('page', page);
    $('#search').click();
    $('#search').attr('page', '1');
}

function get_dailyreport_version(){
    var $dialog = $('#create_version_dialog');
    var project_uri = $dialog.find('[name="project"]').val();
    if (project_uri){
        $dialog.find('[name="project_name"]').hide();
        $.ajax({
            url: '/dailyreport/api/v1/version/?order_by=-start_date&project=' + project_uri.split('/')[5],
            type: 'GET',
            contentType: 'application/json',
            dataType: 'json',
            beforeSend: function(XHR) {
                XHR.setRequestHeader('X-CSRFToken', CSRFMIDDLEWARETOKEN);
            },
            success: function (json, text, xhr) {
                if (json.objects.length != 0){
                    $dialog.find('[name="version"]').html('');
                    var total_changed = 0;
                    var num1 = 0;
                    $.each(json.objects, function(k, v){
                        if (v['is_change']){
                            total_changed += 1;
                        };
                    });
                    $.each(json.objects, function(k, v){
                        if (k==json.objects.length-1){
                            v['start_date'] = '初始版本';
                        } else if (v['is_change']){
                            v['start_date'] = `${v['start_date']} [第${total_changed-num1-1}次變更]`;
                            num1 += 1;
                        } else {
                            v['start_date'] = `${v['start_date']} [一般版本]`;
                        };
                        
                        $dialog.find('[name="version"]').append(`<option value="/dailyreport/api/v1/version/${v['id']}/">${v['start_date']}</option>`);
                    });
                    $dialog.find('[name="version"]').append('<option value="">無對應</option>');
                } else {
                    $dialog.find('[name="version"]').html('<option value="">無對應</option>');
                }
            },
            error: function (json) {
                Lobibox.notify('error', {
                    title: '錯誤訊息',
                    msg: json.responseText,
                });
            }
        });
    } else {
        $dialog.find('[name="version"]').html('<option value="">無對應</option>');
        $dialog.find('[name="project_name"]').html('');
        $dialog.find('[name="project_name"]').show();
        $dialog.find('[name="project_name"]').focus();
    }
}

function create_version(){
    var $obj = $(this);
    var $dialog = $('#create_version_dialog');
    var project_uri = $dialog.find('[name="project"]').val();
    var project_name = $dialog.find('[name="project_name"]').val();
    if (project_uri){
        project_name = $dialog.find('[name="project"]').find('option:selected').attr('name');
    };
    var version_uri = $dialog.find('[name="version"]').val();
    var schedule_setting_type = $dialog.find('[name="schedule_setting_type"]').val();
    if (!version_uri){
        version_uri = null;
    };
    if (!project_uri && !project_name){
        Lobibox.notify('warning', {
            title: '系統訊息',
            msg: '請選擇工程或自行輸入工程名稱。',
        });
    } else {
        if (!project_uri){
            project_uri = null;
        };
        $obj.prop('disabled', true);
        $.ajax({
            url: '/schedule/api/active/version_schedule/',
            type: 'POST',
            data: JSON.stringify({
                project: project_uri,
                project_name: project_name,
                version: version_uri,
                schedule_setting_type: schedule_setting_type,
            }),
            contentType: 'application/json',
            dataType: 'json',
            beforeSend: function(XHR) {
                XHR.setRequestHeader('X-CSRFToken', CSRFMIDDLEWARETOKEN);
            },
            success: function (json, text, xhr) {
                window.location = '/schedule/item_profile/' + json['id'] + '/';
                Lobibox.notify('success', {
                    title: '系統訊息',
                    msg: '新增成功，請等待系統跳轉',
                });
            },
            error: function (json) {
                $obj.prop('disabled', false);
                Lobibox.notify('error', {
                    title: '錯誤訊息',
                    msg: json.responseText,
                });
            }
        });
    };
}

function delete_version(){
    var $obj = $(this);
    var row_id = $obj.attr('row_id');
    Lobibox.confirm({
        msg: '是否確認要刪除此草稿，刪除後將無法恢復!!!',
        buttons: {
            accept: {
                'class': 'lobibox-btn lobibox-btn-yes',
                text: '確認刪除',
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
                    url: '/schedule/api/active/version_schedule/' + row_id + '/',
                    type: 'DELETE',
                    contentType: 'application/json',
                    dataType: 'json',
                    beforeSend: function(XHR) {
                        XHR.setRequestHeader('X-CSRFToken', CSRFMIDDLEWARETOKEN);
                    },
                    success: function (json, text, xhr) {
                        $('#tr_' + row_id).remove();
                        Lobibox.notify('success', {
                            title: '系統訊息',
                            msg: '版本已刪除',
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

$(document).ready(function(){
    $('[data-toggle="tooltip"]').tooltip();

    $('#create_version').click(create_version);
    $(document).on('click', '.delete_version', delete_version);

    $("#pageChooseSelect").change(function(){
        $('#search').trigger('click');
    });

    $('#search').click(search);
    search();
    get_dailyreport_version();

    // search when clicked enter 
    $(".search-name-input").keypress(function(event){
        var keycode = (event.keyCode ? event.keyCode : event.which);
        if(keycode == '13'){
            $('#search').trigger('click');
        }
    });
});