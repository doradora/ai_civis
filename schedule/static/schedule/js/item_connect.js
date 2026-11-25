function show_hide_sub_item(){
    var $obj = $(this);
    var $tr = $obj.closest('tr');
    var item_id = $tr.attr('row_id');
    var symbol = $tr.find('span[name="symbol"]').html() + '.';
    if (!$tr.find('span[name="symbol"]').html()){
        symbol = '';
    }
    var open = $obj.attr('src').indexOf('close')==-1;
    if (open){
        $obj.attr('src', $obj.attr('src').replace('open', 'close'));
    } else {
        $obj.attr('src', $obj.attr('src').replace('close', 'open'));
    }

    $.each($('[name="symbol"]'), function(){
        var $obj = $(this);
        var $sub_tr = $obj.closest('tr');
        var sub_symbol = $obj.html();
        if (sub_symbol.slice(0, symbol.length) == symbol){
            if (open){
                if ((sub_symbol.slice(symbol.length, sub_symbol.length).match(/\./g)||[]).length == 0){
                    $sub_tr.show();
                }
            } else {
                if (sub_symbol){
                    if ($sub_tr.find('.show_hide_sub_item').length == 1){
                        $sub_tr.find('.show_hide_sub_item').attr('src', $sub_tr.find('.show_hide_sub_item').attr('src').replace('close', 'open'));
                    };
                    $sub_tr.hide();
                }
            }
        }
    });
}

function get_items(){
    var $obj = $(this);
    var row_id = $obj.attr('row_id');
    $('#title_item_name').html($obj.closest('tr').find('span[name="name"]').html());
    $('#target_item_id').val(row_id);
    var include_item = $obj.closest('tr').attr('include_item').split('-');
    $('#edit_item_dialog').find('table > tbody').html('');
    var $div = $('#init_items_html').tmpl({}).appendTo($('#edit_item_dialog').find('table > tbody'));
    // $.each(connect_ids, function(k,v){
    //     if (include_item.indexOf(String(v)) == -1){
    //         $('#select_need_' + v).closest('td').append('<a href="#" class="get_connect_item" data-toggle="tooltip" data-placement="bottom" title="" data-original-title="查詢中"><b>!</b></a>');
    //         $('#select_need_' + v).remove();
    //     }
    // });

    $.each(include_item, function(k,v){
        $('#select_need_' + v).show();
        $('#select_need_' + v).html('已選');
        $('#select_need_' + v).addClass('btn-success');
    });
    $('#edit_item_dialog').modal('show');
}

// function get_connect_items(){
//     $.ajax({
//         url: '/dailyreport/api/v1/scheduleitem/get_connect_items/?version_id=' + version_id,
//         type: 'GET',
//         contentType: 'application/json',
//         dataType: 'json',
//         success: function (json, text, xhr) {
//             connect_ids = json['connect_ids'];
//         },
//         error: function (json) {
//             Lobibox.notify('error', {
//                 title: '錯誤訊息',
//                 msg: json.responseText,
//             });
//         },
//     })
// }

function select_need(){
    var $obj = $(this);
    var kind = $obj.attr('kind');
    var ids = $obj.attr('ids').split('.');
    var html = $obj.html();
    $('#loading').show();
    if (html=='已選'){
        $.each(ids, function(k, v){
            $('#select_need_' + v).html('選擇');
            $('#select_need_' + v).removeClass('btn-success');
        });
        $obj.html('選擇');
        $obj.removeClass('btn-success');
        $('#loading').hide();
    } else {
        if (kind=='目錄'){
            $.each(ids, function(k, v){
                $('#select_need_' + v).html('已選');
                $('#select_need_' + v).addClass('btn-success');
            });
            $('#loading').hide();
        } else {
            $obj.html('已選');
            $obj.addClass('btn-success');
            for (i=1;i<ids.length;i++){
                var dir_ids = $('#select_need_' + ids[i]).attr('ids').split('.');
                var select = true;
                for (j=1;j<dir_ids.length;j++){
                    if ($('#select_need_' + dir_ids[j]).html() == '選擇'){
                        select = false;
                    }
                }
                if (select){
                    $('#select_need_' + ids[i]).html('已選');
                    $('#select_need_' + ids[i]).addClass('btn-success');
                }
            }
            $('#loading').hide();
        }
    }
}

function save_connect_item(){
    var $obj = $(this);
    var target_item_id = $('#target_item_id').val();
    var include_item = '-';
    $('#loading').show();
    $('.select_need').each(function(){
        var $obj = $(this);
        var row_id = $obj.attr('row_id');
        if ($obj.html()=='已選'){
            include_item += row_id + '-';
        }
    })
    var data = {
        csrfmiddlewaretoken: CSRFMIDDLEWARETOKEN,
        include_item: include_item,
    }

    $.ajax({
        url: '/dailyreport/api/v1/scheduleitem/' + target_item_id + '/',
        type: 'PUT',
        data: JSON.stringify(data),
        contentType: 'application/json',
        dataType: 'json',
        success: function (json, text, xhr) {
            $('#edit_item_dialog').modal('hide');
            $('#main_table > tbody').find('tr[row_id="' + target_item_id + '"]').attr('include_item', include_item);
            Lobibox.notify('success', {
                title: '系統訊息',
                msg: '已更新連結工項',
            });
            // get_connect_items();
            $('#loading').hide();
        },
        error: function (json) {
            Lobibox.notify('error', {
                title: '錯誤訊息',
                msg: json.responseText,
            });
        },
    })
}

// function get_connect_item(){
//     var $obj = $(this);
//     var row_id = $obj.closest('tr').attr('id').replace('tr_item_', '');
//     $.ajax({
//         url: '/dailyreport/api/v1/scheduleitem/?include_item__icontains=-' + row_id + '-',
//         type: 'GET',
//         contentType: 'application/json',
//         dataType: 'json',
//         beforeSend: function(XHR) {
//             XHR.setRequestHeader('X-CSRFToken', CSRFMIDDLEWARETOKEN);
//         },
//         success: function (json, text, xhr) {
//             $obj.attr('data-original-title', '已連結 [' + json.objects[0].read_level_symbol + '] ' + json.objects[0].name);
//             $obj.removeClass('get_connect_item');
//             $obj.tooltip('show');
//         },
//         error: function (json) {
//             Lobibox.notify('error', {
//                 title: '錯誤訊息',
//                 msg: json.responseText,
//             });
//         }
//     });
// }

$(document).ready(function(){
    $(document).on('click', '.show_hide_sub_item', show_hide_sub_item);
    $(document).on('click', '.select_need', select_need);
    // $(document).on('mouseover', '.get_connect_item', get_connect_item);
    $('.get_items').click(get_items);
    // get_connect_items();
    $('#save_connect_item').click(save_connect_item);

    $(".tip").tooltip();
    // $('#block_body').scroll(function () {
    //     var scroll = $(this).scrollTop();
    //     var header = $('#main_table > tbody').offset().top + 160;
    //     if (scroll >= header){
    //         $('#table-header').show();
    //     } else {
    //         $('#table-header').hide();
    //     }
    // });
});