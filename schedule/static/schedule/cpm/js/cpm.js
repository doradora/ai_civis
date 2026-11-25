function make_Node(key,txt,dur){
    //節點物件
    return {
        es: 0,
        ef: 0,
        dur: 0,
        tf: 0,
        ls: 10000000000,
        lf: 10000000000,
        key: key,
        txt: txt,
        dur: dur,
        pre: [], // pre link 0: from, 1: to, 2: mode, 3: lag
        succ: [], // succ link 0: from, 1: to, 2: mode, 3: lag
    }
}

function all_in(a, A){
    //判斷是否全部包含
    var elems = a;
    var count = elems.length;
    var go = false;
    var return_status = 1;
    $.each(elems, function(k, v){
        if (A.indexOf(v) == -1){
            return_status = 0;
        };
        if (!--count) {go = true};
    });
    if (go) {
        return return_status;
    };
}

function make_do_order(do_order, y){
    //節點順序
    if (y.length == 0){
        return [do_order, y];
    };
    for (k in y){
        var v = y[k];
        if (all_in(v, do_order)){
            do_order.push(parseInt(k));
            delete y[k];
            return [do_order, y];
        }
    };
    return [do_order, y];
}

function get_cp(nodeDataArray, linkDataArray){
    //整理資料
    var x = {};
    var all_key = []; // node, NOT include "start"  "end" Node
    for (i=0;i<nodeDataArray.length;i++){
        var temp = nodeDataArray[i];
        x[temp.key] = make_Node(temp.key, temp.text, temp.length);
        all_key.push(temp.key);
    };
    var link = [];
    for (i=0;i<linkDataArray.length;i++){
        var temp = linkDataArray[i];
        var row = [temp.from, temp.to, temp.mode, temp.lag];
        link.push(row);
        x[temp.to].pre.push(row);
        x[temp.from].succ.push(row);
    };
    all_key.sort()
    x["start"] = make_Node("start", "start", 0);
    x["end"] = make_Node("end", "end", 0);
    
    for (i=0;i<all_key.length;i++){  // build up the Link-data
        var k = all_key[i];
        if (x[k].pre.length == 0){
            x[k].pre.push(["start", k, "FS", 0]);
            x["start"].succ.push(["start", k, "FS", 0]);
        };
        if (x[k].succ.length == 0){
            x[k].succ.push([k, "end", "FS", 0]);
            x["end"].pre.push([k, "end", "FS", 0]);
        };
    };
    var y = {};
    for (i=0;i<all_key.length;i++){  // buicollect the "from" Node-id
        var k = all_key[i];
        var temp = [];
        $.each(x[k].pre, function(k, v){
            temp.push(v[0]);
        });
        y[k] = temp;
    };

    //開始運算
    var do_order = ['start'];
    for (rep=0; rep<(all_key.length+1);rep++){
        var result = make_do_order(do_order, y);
        do_order = result[0];
        y = result[1];
        if (rep>all_key.length){
            return {'status': false, 'msg': 'DATA error'};
        };
    };
    do_order.push('end');

    //#Do ES, EF
    for (i=1;i<do_order.length;i++){
        var k = do_order[i];
        var pre = x[k].pre;
        for (j=0; j<pre.length;j++){
            var f = pre[j][0];
            var t = pre[j][1];
            var m = pre[j][2];
            var lag = pre[j][3];
            if (m=='FS'){
                x[t].es = Math.max(x[f].ef+lag, x[t].es);
            } else if (m=='SS'){
                x[t].es = Math.max(x[f].es+lag, x[t].es);
            } else if (m=='SF'){
                x[t].ef = Math.max(x[f].es+lag, x[t].ef);
            } else if (m=='FF'){
                x[t].ef = Math.max(x[f].ef+lag, x[t].ef);
            }
            x[k].ef = Math.max(x[k].es+x[k].dur, x[k].ef);
            x[k].es = Math.max(x[k].es, x[k].ef-x[k].dur);
        }
    }
    x["end"].ls = x["end"].ef;
    x["end"].lf = x["end"].ef;

    //#Do LS, LF
    var do_order2 = do_order.reverse();
    for (i=1;i<do_order2.length;i++){
        var k = do_order2[i];
        var succ = x[k].succ;
        for (j=0; j<succ.length;j++){
            var f = succ[j][0];
            var t = succ[j][1];
            var m = succ[j][2];
            var lag = succ[j][3];
            if (m=='FS'){
                x[f].lf = Math.min(x[f].lf, x[t].ls-lag);
            } else if (m=='SS'){
                x[f].ls = Math.min(x[f].ls, x[t].ls-lag);
            } else if (m=='SF'){
                x[f].ls = Math.min(x[f].ls, x[t].lf-lag);
            } else if (m=='FF'){
                x[f].lf = Math.min(x[f].lf, x[t].lf-lag);
            };
            x[k].lf = Math.min(x[k].ls+x[k].dur, x[k].lf);
            x[k].ls = Math.min(x[k].ls, x[k].lf-x[k].dur);
        }
    };
    var ans = [];
    for (i=0;i<do_order.length;i++){
        var k = do_order[i];
        x[k].tf = x[k].lf-x[k].es-x[k].dur;
        ans.push(x[k]);
    };
    return {'status': true, 'ans': ans};
}

//----------------------------------------------------------------------------------

// var nodeDataArray = [
//     { "key": 8, "text": "水溝工程", "length": 20},
//     { "key": 9, "text": "地磚工程", "length": 60},
//     { "key": 10, "text": "廁所設備工程", "length": 30},
//     { "key": 11, "text": "道路工程", "length": 60},
//     { "key": 12, "text": "薄膜雨遮工程", "length": 15},
//     {"key":5, "text":"欄杆工程", "length":30},
//     {"key":6, "text":"採光罩工程", "length":30},
//     {"key":7, "text":"廁所磁磚工程", "length":60},
//     {"key":1, "text":"假設及雜項工程", "length":15},
//     {"key":22, "text":"拆除工程", "length":30},
//     {"key":3, "text":"打除工程", "length":45},
//     {"key":4, "text":"開挖整地工程", "length":30},
// ];
// var linkDataArray=[
//     {"from":1, "to":22, "mode":"FS", "lag":0},
//     {"from":1, "to":3, "mode":"FS", "lag":0},
//     {"from":1, "to":4, "mode":"SS", "lag":3},
//     {"from":22, "to":5, "mode":"FS", "lag":0},
//     {"from":22, "to":6, "mode":"FS", "lag":0},
//     {"from":3, "to":7, "mode":"FS", "lag":0},
//     {"from":3, "to":8, "mode":"FF", "lag":5},
//     {"from":4, "to":9, "mode":"FS", "lag":0},
//     {"from":4, "to":8, "mode":"FS", "lag":3},
//     {"from":6, "to":5, "mode":"FF", "lag":7},
//     {"from":7, "to":10, "mode":"FS", "lag":0},
//     {"from":8, "to":11, "mode":"FS", "lag":0},
//     {"from":9, "to":12, "mode":"FS", "lag":0},
//     {"from":10, "to":11, "mode":"SS", "lag":8},
// ];

// var result = get_cp(nodeDataArray, linkDataArray);

// 成功
// result = {'status': true, 'ans': ans}
// 失敗
// result = {'status': false, 'msg': msg}