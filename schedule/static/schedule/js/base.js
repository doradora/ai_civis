var int_check = /^-?[0-9]*$/;
var float_check = /^[+|-]?\d*\.?\d*$/;
var date_check = /^(([1-9]\d{0,3}|0)\-\d{2}\-\d{2})|(([1-9]\d{0,3}|0)\.\d{2}\.\d{2})|(([1-9]\d{0,3}|0)\/\d{2}\/\d{2})$/;
var email_check = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

//浮點數相加
function FloatAdd(arg1, arg2){
    var r1, r2, m;
    try { r1 = arg1.toString().split(".")[1].length; } catch (e) { r1 = 0; }
    try { r2 = arg2.toString().split(".")[1].length; } catch (e) { r2 = 0; }
    m = Math.pow(10, Math.max(r1, r2));
    return (FloatMul(arg1, m) + FloatMul(arg2, m)) / m;
}

//浮點數相減
function FloatSubtraction(arg1, arg2){
    var r1, r2, m, n;
    try { r1 = arg1.toString().split(".")[1].length } catch (e) { r1 = 0 }
    try { r2 = arg2.toString().split(".")[1].length } catch (e) { r2 = 0 }
    m = Math.pow(10, Math.max(r1, r2));
    n = (r1 >= r2) ? r1 : r2;
    return ((arg1 * m - arg2 * m) / m).toFixed(n);
}

//浮點數相乘
function FloatMul(arg1, arg2){
    if (!arg1 || !arg2){
        return 0;
    }
    var m = 0, s1 = arg1.toString(), s2 = arg2.toString();
    try { m += s1.split(".")[1].length; } catch (e) { }
    try { m += s2.split(".")[1].length; } catch (e) { }
    return Number(s1.replace(".", "")) * Number(s2.replace(".", "")) / Math.pow(10, m);
}

//浮點數相除
function FloatDiv(arg1, arg2){
    if (!arg1 || !arg2){
        return 0;
    }
    var t1 = 0, t2 = 0, r1, r2;
    try { t1 = arg1.toString().split(".")[1].length } catch (e) { }
    try { t2 = arg2.toString().split(".")[1].length } catch (e) { }
    with (Math) {
        r1 = Number(arg1.toString().replace(".", ""))
        r2 = Number(arg2.toString().replace(".", ""))
        return (r1 / r2) * pow(10, t2 - t1);
    }
}

function TransformThousands(num) {
//用來轉換成為千分位表示的數字用的
    var date_check=/^(([1-9]\d{0,3}|0)\-\d{2}\-\d{2})|(([1-9]\d{0,3}|0)\.\d{2}\.\d{2})|(([1-9]\d{0,3}|0)\/\d{2}\/\d{2})$/;
    if (date_check.test(num)){
        return num;
    }
    num = num + "";
    if (!num.includes('.')) num += '.';
    return num.replace(/(\d)(?=(\d{3})+\.)/g, function($0, $1) {
      return $1 + ',';
    }).replace(/\.$/, '');
}

//用來移除千分位表示的數字用的
function remove_TransformThousands(num) {
    num = String(num);
    if (num.indexOf(",") >= 0){
        var num = num.ReplaceAll(',', '');
    }
    return num;
}

function intcomma(num) {
//用來轉換成為千分位表示的數字用的
    var date_check=/^(([1-9]\d{0,3}|0)\-\d{2}\-\d{2})|(([1-9]\d{0,3}|0)\.\d{2}\.\d{2})|(([1-9]\d{0,3}|0)\/\d{2}\/\d{2})$/;
    if (date_check.test(num)){
        return num;
    }
    num = num + "";
    if (!num.includes('.')) num += '.';
    return num.replace(/(\d)(?=(\d{3})+\.)/g, function($0, $1) {
      return $1 + ',';
    }).replace(/\.$/, '');
}

//用來移除千分位表示的數字用的
function remove_intcomma(num) {
    num = String(num);
    if (num.indexOf(",") >= 0){
        var num = num.ReplaceAll(',', '');
    }
    return num;
}

//轉換input千分位符號使用
function inputcomma() {
    var $obj = $(this);
    var value = $obj.val();
    if (!value){
        $obj.val(0);
    } else {
        $obj.val(TransformThousands(value));
    }
}

//移除input千分位符號使用
function remove_inputcomma() { 
    var $obj = $(this);
    var value = $obj.val();
    $obj.val(remove_TransformThousands(value));
}

jQuery.needExist = function(id_tag, name) {
    // input 欄位驗證
    var value = $('#'+id_tag).val();
    if (value == '') {
        Lobibox.notify('warning', {
            title: '警告訊息',
            msg: '未填寫 '+ name + ' 欄位',
        });
          throw "";
        return false;
    } else {
        return value;
    }
}

String.prototype.ReplaceAll = function (AFindText,ARepText)
{
  raRegExp = new RegExp(AFindText,"g");
  return this.replace(raRegExp,ARepText)
} 

var gettext = function (s) {
    return s;
}

//取得瀏覽器視窗高度
function getBrowserHeight() {
    if ($.support.msie) {
        return document.compatMode == "CSS1Compat" ? document.documentElement.clientHeight :
                 document.body.clientHeight;
    } else {
        return self.innerHeight;
    };
}

//取得瀏覽器視窗寬度
function getBrowserWidth() {
    if ($.support.msie) {
        return document.compatMode == "CSS1Compat" ? document.documentElement.clientWidth :
                 document.body.clientWidth;
    } else {
        return self.innerWidth;
    };
} 

function cutZero(old){
    old = String(old);
    newstr = old;
    if (old.indexOf(".") != -1){
        var leng = old.length-old.indexOf(".")-1;
        if(old.indexOf(".")>-1){
            for(i=leng;i>0;i--){
                if(newstr.lastIndexOf("0")>-1 && newstr.substr(newstr.length-1,1)==0){
                    var k = newstr.lastIndexOf("0");
                    if(newstr.charAt(k-1)=="."){
                        return  newstr.substring(0,k-1);
                    }else{
                        newstr=newstr.substring(0,k);
                    }
                }else{
                    return newstr;
                }
            }
        }
    }
    return old;
}

function BlurUpdateInfo(){
    //整理欄位資訊
    var $obj = $(this);
    if ($obj.attr('do_nothing') == 'true'){
        return false;
    }
    var row_id = $obj.attr('row_id');
    var field_type = $obj.attr('field_type');
    var field_name = $obj.attr('field_name');
    var table_name = $obj.attr('table_name');
    var module_name = $obj.attr('module_name');
    var class_name = $obj.attr('class');
    var is_select = $obj.attr('is_select');
    var value = $obj.val();
    var old_value = $obj.attr('old_value');
    if (field_type=='int' || field_type=='float'){
        value = String(value).ReplaceAll('"', '').ReplaceAll("'", '').ReplaceAll(',', '').ReplaceAll(' ', '').ReplaceAll('　', '');
    };
    if (value == old_value){
        if ($obj.attr('no_change') != 'true'){
            $('#show_part_'+field_name+"_"+row_id).show();
            $('#edit_part_'+field_name+"_"+row_id).hide();
        }
        return false;
    }
    if (!value && (field_type=='date' || field_type=='key')){
        value = null;
    } else if (!value && (field_type=='int' || field_type=='float')){
        value = 0;
    } else if (!value && field_type=='str'){
        value = '';
    } else if (!value){
        value = null;
    };
    //判斷是否為選單(ForeignKey 欄位)
    
    var listname_field_name = 'listname_'+field_name;
    //檢查各種格式是否正確
    if ((class_name.indexOf('needExist')) > -1 && !value){
        var message = field_name + '不可為空值！';
        Lobibox.notify('warning', {
            title: '警告訊息',
            msg: message,
        });
        $('#edit_part_'+field_name+"_"+row_id).attr('value', old_value);
        return false;
    };
    if (field_type=='int' && value){
        if(!(int_check.test(value))){
            var message = field_name + '須為整數！';
            Lobibox.notify('warning', {
                title: '警告訊息',
                msg: message,
            });
            $obj.val(old_value);
            return false;
        }
    };
    if (field_type=='float' && value){
        if(!(float_check.test(value))){
            var message = field_name + '須為數字！';
            Lobibox.notify('warning', {
                title: '警告訊息',
                msg: message,
            });
            $obj.val(old_value);
            return false;
        }
    };
    if (field_type=='date' && value){
        if(!(date_check.test(value))){
            var message = field_name + '須為日期格式(如2013-01-19)！';
            Lobibox.notify('warning', {
                title: '警告訊息',
                msg: message,
            });
            $obj.attr('value', old_value);
            return false;
        }
    };
    if (field_type=='email' && value){
        if(!(email_check.test(value))){
            var message = field_name + '須為Email格式！';
            Lobibox.notify('warning', {
                title: '警告訊息',
                msg: message,
            });
            $obj.attr('value', old_value);
            return false;
        }
    };
    if (value == 'true'){
        value = true;
    } else if (value == 'false'){
        value = false;
    };
    //送資料到進行修改
    var url = '/'+module_name+'/api/active/'+table_name+'/'+row_id+'/';

    if (value!=old_value){
        $obj.addClass('input_change');
        if (table_name=='item'){
            $obj.closest('tr').find('input').prop('disabled', true);
            $('#item_change_loading').show();
        };
        var data = {
            csrfmiddlewaretoken: CSRFMIDDLEWARETOKEN
        }
        data[field_name] = value;
        $.ajax({
            url: url,
            type: 'PUT',
            data: JSON.stringify(data),
            contentType: 'application/json',
            dataType: 'json',
            success: function (json, text, xhr) {
                $obj.removeClass('input_change');
                //取新的資料回來修改template
                if (table_name=='item'){
                    $obj.closest('tr').find('input').prop('disabled', false);
                    $('#item_change_loading').hide();
                };
                if (is_select){
                    if (!value){value = ''};
                    $obj.val(String(value));
                    $obj.attr('old_value', String(value));
                    if (!json[listname_field_name]){
                        json[listname_field_name] = '';
                    }
                } else {
                    if (field_type=='float'||field_type=='int'){
                        if (json[field_name]==0){
                            json[field_name] = 0;
                        }
                        json[field_name] = cutZero(json[field_name]);
                    };
                    if ($obj.hasClass('datepicker')&&json[field_name].indexOf('T')!=-1){
                        json[field_name] = json[field_name].split('T')[0];
                    }
                    $obj.val(json[field_name]);
                    $obj.attr('old_value', json[field_name]);
                }
            },
            error: function(json){
                if (json.responseText){
                    Lobibox.notify('error', {
                        title: '錯誤訊息',
                        msg: json.responseText,
                    });
                    $obj.val(old_value);
                    $obj.change();
                } else {
                    Lobibox.confirm({
                        msg: '更新發生問題，可能是網路關係，是否要重新整理頁面？',
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
                                window.location.reload();
                            }else{
                                return false;
                            }
                        }
                    });
                }
            }
        })
    };
}

function edit_version_project_name(){
    var old_name = $('#version_project_name').html();
    Lobibox.prompt('text', //Any input type will be valid
        {
            title: '請輸入要變更的專案名稱',
            //Attributes of <input>
            attrs: {
                value: old_name,
            },
            callback : function($this,type,ev){
                if (type == 'ok'){
                    var value = $this.getValue();
                    if (!value){
                        Lobibox.notify('warning', {
                            title: '錯誤訊息',
                            msg: '請輸入要變更的專案名稱',
                        });
                    } else {
                        $.ajax({
                            url: '/schedule/api/active/version_schedule/' + version_id + '/',
                            type: 'PUT',
                            data: JSON.stringify({
                                project_name: value
                            }),
                            contentType: 'application/json',
                            dataType: 'json',
                            beforeSend: function(XHR) {
                                XHR.setRequestHeader('X-CSRFToken', CSRFMIDDLEWARETOKEN);
                            },
                            success: function (json, text, xhr) {
                                $('#version_project_name').html(value);
                                Lobibox.notify('success', {
                                    title: '系統訊息',
                                    msg: '專案名稱已變更',
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

$.datepicker.regional['zh-TW'] = {
    clearText: '清除', clearStatus: '清除已選日期',
    closeText: '關閉', closeStatus: '取消選擇',
    prevText: '<上一月', prevStatus: '顯示上個月',
    nextText: '下一月>', nextStatus: '顯示下個月',
    currentText: '今天', currentStatus: '顯示本月',
    monthNames: ['一月','二月','三月','四月','五月','六月',
    '七月','八月','九月','十月','十一月','十二月'],
    monthNamesShort: ['一月','二月','三月','四月','五月','六月',
    '七月','八月','九月','十月','十一月','十二月'],
    monthStatus: '選擇月份', yearStatus: '選擇年份',
    weekHeader: '周', weekStatus: '',
    dayNames: ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'],
    dayNamesShort: ['周日','周一','周二','周三','周四','周五','周六'],
    dayNamesMin: ['日','一','二','三','四','五','六'],
    dayStatus: '設定每周第一天', dateStatus: '選擇 m月 d日, DD',
    dateFormat: 'yy-mm-dd', firstDay: 0, 
    initStatus: '請選擇日期', isRTL: false
};
$.datepicker.setDefaults($.datepicker.regional['zh-TW']);

$(document).ready(function(){
    $(document).on('blur', '.BlurUpdateInfo', BlurUpdateInfo);
    $(document).on('keypress', '.BlurUpdateInfo', function(event) {
        var $obj = $(this);
        if (!$obj.is("textarea") && event.which == 13){
            $obj.blur();
        }
    });
    $('#edit_version_project_name').click(edit_version_project_name);

    var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'))
    var tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl)
    });

    $(".datepicker").datepicker({
        changeMonth: true,
        changeYear: true,
    });
})