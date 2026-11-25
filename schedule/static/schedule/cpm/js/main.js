// colors used, named for easier identification
const blue = "#0288D1";
const pink = "#B71C1C";
const pinkfill = "#F8BBD0";
const bluefill = "#B3E5FC";
const greenfill = "#95e59c";
const cpm_api = '/schedule/api_cpm/';

// regist auto shift layout
class AutoShiftingLayout extends go.Layout {
    doLayout(coll) {
      // get collection of Node-like Parts -- ignoring all Links
      let inputs = this.collectParts(coll).filter(p => !(p instanceof go.Link));
  
      //this.shiftDown(inputs);
      this.shiftRight(inputs);
    }
  
    shiftRight(inputs) {
      let comparerX = (a, b) => (a.actualBounds.x-a.margin.left) - (b.actualBounds.x-b.margin.left);
      // list of nodes, sorted by actualBounds.x
      let sorted = new go.List(inputs).sort(comparerX);
  
      // for the left-most node, make sure any overlapping nodes are moved toward the right
      let intersections = new go.List();
      while (sorted.count > 0) {
        let node = sorted.first();
        sorted.remove(node);  // don't need to consider this node again
        this.findIntersections(node, sorted, intersections);
        if (intersections.count > 0) {
          // now INTERSECTIONS is a bunch of nodes that overlap the given NODE toward the right
          intersections.sort(comparerX);
          let c = 10;
          intersections.each(other => {
            // shift the OTHER node to just to the right of NODE
            other.moveTo(node.actualBounds.left, other.position.y - 150);
            other.ensureBounds();
            c += 10;
          });
          intersections.clear();  // done reusing this collection
          sorted.sort(comparerX);  // movement of some nodes requires re-sorting
        }
      }
    }
  
    shiftDown(inputs) {
      let comparerY = (a, b) => (a.actualBounds.y-a.margin.top) - (b.actualBounds.y-b.margin.top);
      // list of nodes, sorted by actualBounds.y
      let sorted = new go.List(inputs).sort(comparerY);
  
      // for the top-most node, make sure any overlapping nodes are moved toward the bottom
      let intersections = new go.List();
      while (sorted.count > 0) {
        let node = sorted.first();
        sorted.remove(node);  // don't need to consider this node again
        this.findIntersections(node, sorted, intersections);
        if (intersections.count > 0) {
          // now INTERSECTIONS is a bunch of nodes that overlap the given NODE toward the bottom
          intersections.sort(comparerY);
          let c = 10;
          intersections.each(other => {
            // shift the OTHER node to just below NODE
            other.moveTo(other.position.x, node.actualBounds.bottom + node.margin.bottom + other.margin.top + c);
            other.ensureBounds();
            c += 10;
          });
          intersections.clear();  // done reusing this collection
          sorted.sort(comparerY);  // movement of some nodes requires re-sorting
        }
      }
    }
  
    findIntersections(node, coll, results) {
      // pretend node is slightly smaller, so that touching sides do not count as intersections
      let b1 = node.actualBounds.copy().addMargin(node.margin).inflate(-0.01, -0.01);

    //   console.log(b1);
      if(typeof b1 !== 'object'){
        b1 = {
            G: 0.01,
            H: 80.01000000000002,
            ea: 221.98,
            da: 107.66076477050781,
            s: false,
            x: 0,
            y: 0
        };
      }

      // this is really inefficient...
      let nit = coll.iterator;
      while (nit.next()) {
        let other = nit.value;
        if (other === node) continue;
        // remember other nodes that intersect this node
        let b2 = other.actualBounds.copy().addMargin(other.margin);
        // console.log(b2);
        if (b2.intersectsRect(b1)) {
          results.add(other);
        }
      }
    }
}

const cpmApp = new Vue({
    el: "#cpm-graph",
    delimiters: ["[[", "]]"],
    data: {
        is_graph_edit: (typeof INITIAL_READONLY !== 'undefined' && INITIAL_READONLY) ? false : true,
        is_embed: (typeof IS_EMBED !== 'undefined' && IS_EMBED) ? true : false,
        is_critical_only: false,
        is_edited: false,
        schedule_version_id: SCHEDULE_VERSION_ID,

        origin_node_data_array: [
            // { "key": 1, "text": "假設工程", "length": 10 },
            // { "key": 1, "text": "假設工程", "length": 10, "earlyStart": 0, "earlyFinish": 10, "lateStart": 0, "lateFinish": 10, "pre": [ [ "start", 1, "FS", 0 ] ], "succ": [ [ 1, "end", "FS", 0 ] ], "critical": true, "__gohashid": 1012 }, 
            // { "key": "start", "text": "開始", "length": 0, "earlyStart": 0, "earlyFinish": 0, "lateStart": 0, "lateFinish": 0, "pre": [], "succ": [ [ "start", 1, "FS", 0 ] ], "critical": true, "__gohashid": 1013 }, 
            // { "key": "end", "text": "完工", "length": 0, "earlyStart": 10, "earlyFinish": 10, "lateStart": 10, "lateFinish": 10, "pre": [ [ 1, "end", "FS", 0 ] ], "succ": [], "critical": true, "__gohashid": 1014 },
            // { "key": 2, "text": "薄膜雨遮工程", "length": 20 },
            // { "key": 3, "text": "拆除工程", "length": 30 },

            // { "key": 8, "text": "水溝工程", "length": 20 },
            // { "key": 9, "text": "地磚工程", "length": 60 },
            // { "key": 10, "text": "廁所設備工程", "length": 30 },
            // { "key": 11, "text": "道路工程", "length": 60 },
            // { "key": 12, "text": "薄膜雨遮工程", "length": 15 },
            // { "key": 5, "text":"欄杆工程", "length":30 },
            // { "key": 6, "text":"採光罩工程", "length":30 },
            // { "key": 7, "text":"廁所磁磚工程", "length":60 },
            // { "key": 1, "text":"假設及雜項工程", "length":15 },
            // { "key": 2, "text":"拆除工程", "length":30 },
            // { "key": 3, "text":"打除工程", "length":45 },
            // { "key": 4, "text":"開挖整地工程", "length":30 },
        ],
        node_data_array: [],

        origin_link_data_array: [
            // { "__gohashid": 1104, "from": "start", "to": 1, "mode": "FS", "lag": 0, "fromSpot": "RightSide", "toSpot": "LeftSide" }, 
            // { "__gohashid": 1780, "from": 1, "to": "end", "mode": "FS", "lag": 0, "fromSpot": "RightSide", "toSpot": "LeftSide" }, 
            // {"from":1, "to":2, "mode":"FS", "lag":0},

            // {"from":1, "to":3, "mode":"FS", "lag":0},
            // {"from":1, "to":4, "mode":"SS", "lag":3},
            // {"from":2, "to":5, "mode":"FS", "lag":0},
            // {"from":2, "to":6, "mode":"FS", "lag":0},
            // {"from":3, "to":7, "mode":"FS", "lag":0},
            // {"from":3, "to":8, "mode":"FF", "lag":5},
            // {"from":4, "to":9, "mode":"FS", "lag":0},
            // {"from":4, "to":8, "mode":"FS", "lag":3},
            // {"from":6, "to":5, "mode":"FF", "lag":7},
            // {"from":7, "to":10, "mode":"FS", "lag":0},
            // {"from":8, "to":11, "mode":"FS", "lag":0},
            // {"from":9, "to":12, "mode":"FS", "lag":0},
            // {"from":10, "to":11, "mode":"SS", "lag":8},
        ],
        link_data_array: [],

        ans: [],
        temp_selected_part: {},
        new_item: [
            {
                name: '',
                item_length: 0
            }
        ],
        new_link:{
            from: '',
            to: '',
            fromSpot:'',
            toSpot:'',
            mode: '',
            lag: 0
        },
        edit_item_name: '',

        edit_link_modal: {},
        update_data_modal: {},
        import_data_modal: {},
        auto_count_duration_modal: {},
        temp_selected_link: {},
        add_pre: false,

        sidebar_toggle: false,
        invalid_form_msg: false,
        previous_link_data_array: [],
        previous_node_data_array: [],

        temp_save_link_data_array: [],
        temp_save_node_data_array: [],

        temp_from_port: null,
        temp_to_port: null,

        temp_remove_items: [],

        project_total_days: PROJECT_TOTAL_DAYS,
        total_unit_price: 0,
        graph_setting_duration: 0,
        detect_is_project_total_days_distance: 0,

        temp_scheduleitem_id: null,
        is_cpm_release: true,
        mapping_items_count: MAPPING_ITEMS_COUNT,
        temp_new_add_node: []
    },
    watch: {
        is_edited(newVal, oldVal){
            const vm = this;

            if(newVal){
                window.addEventListener('beforeunload', vm.reload_page_alert);
            }else{
                window.removeEventListener('beforeunload', vm.reload_page_alert);
            }
        }
    },
    created: async function(){
       
    },
    mounted: async function(){
        const vm = this;

        LOADER.open();

        // bootstrap modal register
        vm.edit_link_modal = new bootstrap.Modal(document.getElementById('edit_link_modal'));
        vm.import_data_modal = new bootstrap.Modal(document.getElementById('import_data_modal'));
        vm.update_data_modal = new bootstrap.Modal(document.getElementById('update_data_modal'));
        vm.auto_count_duration_modal = new bootstrap.Modal(document.getElementById('auto_count_duration_modal'));

         // bootstrap tooltip mount
        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'))
        const tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl)
        });

        // get origin_node_data
        vm.origin_node_data_array = await vm.get_origin_node_data();

        // get origin_link_data
        vm.origin_link_data_array = await vm.get_origin_link_data();

        // console the data
        // console.log(vm.origin_node_data_array);
        // console.log(vm.origin_link_data_array);

        // load csrf token
        CSRFMIDDLEWARETOKEN = $('input[name=csrfmiddlewaretoken]').val();
        vm.csrftoken = CSRFMIDDLEWARETOKEN;

        // add beforeunload listener for cpm callback
        window.addEventListener('beforeunload', vm.cpm_callback);

        // mount load excel button
        vm.create_item_by_EXCEL('createItemByEXCEL');

        // init diagram after got data
        vm.init_diagram_edit();

        LOADER.close();
    },
    methods: {
        cpm_callback(){
            if(window.opener.CPMCallback){
                window.opener.CPMCallback();
            };
        },
        get_origin_node_data(){
            const vm = this;

            return new Promise(async (resolve, reject) => {
                try{
                    const query_data = {
                        params: {
                            limit: 0,
                            version: vm.schedule_version_id,
                            kind: 11,
                            order_by: 'priority'
                        }
                    };

                    const cpm_item_resp = await apiGetCpmItem(query_data);
                    resolve(cpm_item_resp.data.objects);
                }
                catch(err){
                    console.log(err);
                    reject(err);
                }
            });
        },
        get_origin_link_data(){
            const vm = this;

            return new Promise(async (resolve, reject) => {
                try{
                    const cpm_link_resp = await apiGetCpmLink('/' + vm.schedule_version_id);
                    vm.is_cpm_release = cpm_link_resp.data.cpm_release;
                    vm.start_end_node = JSON.parse(cpm_link_resp.data.start_end_node);
                    resolve(JSON.parse(cpm_link_resp.data.cpm_link));
                }
                catch(err){
                    console.log(err);
                    reject(err);
                }
            });
        },
        async init_diagram_edit(){
            const vm = this;

            vm.is_edited = false;

            // Define a function for creating a "port" that is normally transparent.
            // The "name" is used as the GraphObject.portId, the "spot" is used to control how links connect
            // and where the port is positioned on the node, and the boolean "output" and "input" arguments
            // control whether the user can draw links from or to the port.
            function make_port(name, spot, output, input){
                // the port is basically just a small transparent circle
                return $(go.Shape, "Circle", {
                        fill: null,  // not seen, by default; set to a translucent gray by show_small_ports, defined below
                        stroke: null,
                        desiredSize: new go.Size(10, 10),
                        alignment: spot,  // align the port on the main Shape
                        alignmentFocus: spot,  // just inside the Shape
                        portId: name,  // declare this object to be a "port"
                        fromSpot: spot, toSpot: spot,  // declare where links may connect at this port
                        fromLinkable: output, toLinkable: input,  // declare whether the user may draw links to/from here
                        cursor: "pointer" ,
                        fromLinkableDuplicates: true,
                        toLinkableDuplicates: true,
                    },
                );
            }

            function show_small_ports(node, show) {
                node.ports.each(port => {
                    if (port.portId !== "") {  // don't change the default port, which is the big shape
                        port.fill = show ? "rgba(0,0,0,.3)" : null;
                    }
                });
            }

            // change link color if link is critical
            function link_color_converter_edit(linkdata, elt){
                let link = elt.part;

                if(vm.is_edited){
                    return blue;
                }else{
                    if (!link) return blue;
                    let f = link.fromNode;
                    if (!f || !f.data || !f.data.critical) return blue;
                    let t = link.toNode;
                    if (!t || !t.data || !t.data.critical) return blue;
                    return pink;  // when both Link.fromNode.data.critical and Link.toNode.data.critical
                }
            }

            // check if new edited node name contain unless 1 charactor 
            function validate_node_name(textblock, oldstr, newstr) {
                return newstr.length >= 1;
            };

            // check if new edited unit_price is number type and not NaN
            function validate_unit_price(textblock, oldstr, newstr) {
                return typeof parseInt(newstr) === 'number' && !isNaN(parseInt(newstr));
            };

            // check if new edited node_length is number type and not NaN or 0
            function validate_node_length(textblock, oldstr, newstr) {
                return typeof parseInt(newstr) === 'number' && !isNaN(parseInt(newstr)) && parseInt(newstr) !== 0;
            };

            // if (window.goSamples) goSamples();  // init for these samples -- you don't need to call this
            const $ = go.GraphObject.make;  // for more concise visual tree definitions
        
            let Diagram = $(go.Diagram, "DiagramDivEdit", {
                initialAutoScale: go.Diagram.None,
                layout: $(AutoShiftingLayout),
                // layout: $(go.LayeredDigraphLayout, {
                //     setsPortSpots: false,
                //     isOngoing: false,
                //     // packOption:  go.LayeredDigraphLayout.PackNone,
                //     initializeOption: go.LayeredDigraphLayout.InitDepthFirstOut,
                //     layeringOption: go.LayeredDigraphLayout.LayerLongestPathSource,
                //     columnSpacing: 20
                // }),
                "linkingTool.portTargeted": function(node, port, tempnode, tempport, toend) {
                    if(port && port.portId){
                        if(!toend){
                            vm.temp_from_port = port.portId;
                        }else if(toend){
                            vm.temp_to_port = port.portId;
                        }
                    }
                },
                "undoManager.isEnabled": true
            });

            // The node template shows the activity name in the middle as well as
            // various statistics about the activity, all surrounded by a border.
            // The border's color is determined by the node data's ".critical" property.
            // Some information is not available as properties on the node data,
            // but must be computed -- we use converter functions for that.
            Diagram.nodeTemplate =
            $(go.Node, "Auto",
                new go.Binding("location", "location", go.Point.parse).makeTwoWay(go.Point.stringify),
                { 
                    selectionChanged: vm.on_item_selection_changed_edit, 
                    margin: 0
                },
                $(go.Shape, "RoundedRectangle",  // the border
                    { name: "item", fill: bluefill, margin: 0, stroke: blue, strokeWidth: 2, spot1: go.Spot.TopLeft, spot2: go.Spot.BottomRight },
                    // new go.Binding("fill", "", function(d) { return (d.key === 'start' || d.key === 'end' ? pinkfill : bluefill); }),
                    // new go.Binding("stroke", "", function(d) { return (d.key === 'start' || d.key === 'end' ? pink : blue); }), 
                    new go.Binding("fill", "", function(b) { return (vm.is_edited ? (b.key === 'start' || b.key === 'end' ? pinkfill : bluefill) : b.critical ? pinkfill : bluefill); }),
                    new go.Binding("stroke", "", function(b) { return (vm.is_edited ? (b.key === 'start' || b.key === 'end' ? pink : blue) : b.critical ? pink : blue); })   
                ),
                $(go.Panel, "Table",
                    { 
                        padding: 0,
                        margin: 0
                    },
                    $(go.RowColumnDefinition, { column: 0, separatorStroke: "black" }),
                    $(go.RowColumnDefinition, { column: 1, separatorStroke: "black" }),
                    $(go.RowColumnDefinition, { column: 2, separatorStroke: "black" }),
                    $(go.RowColumnDefinition, { row: 0, separatorStroke: "black" }),
                    $(go.RowColumnDefinition, { row: 1, separatorStroke: "black", background: "white", coversSeparators: true }),
                    $(go.RowColumnDefinition, { row: 2, separatorStroke: "black", background: "white", coversSeparators: true }),
                    $(go.RowColumnDefinition, { row: 3, separatorStroke: "black" }),
                    $(go.TextBlock, // earlyStart
                        new go.Binding("text", "", function(d) { return d.key === 'start' ? "0" : d.key === 'end' ? parseInt(d.earlyStart) : isNaN(parseInt(d.earlyStart)) ? '' : parseInt(d.earlyStart) + 1 }),
                        { row: 0, column: 0, margin: 5, columnSpan: 1, textAlign: "center", width: 70 }),
                    $(go.TextBlock, "比率",
                        { row: 2, column: 0, margin: 5, columnSpan: 1, textAlign: "center", font: "bold 14px sans-serif" }),
                    $(go.TextBlock,
                        new go.Binding("text", "", function(d) { return d.key === 'start' || d.key === 'end' ? 0 : d.duration ? d.duration : d.length }),
                        new go.Binding("editable", "", function(d) { return d.key !== 'start' && d.key !== 'end' ? true : false; }),
                        new go.Binding("background", "", function(d) { return d.key === 'start' || d.key === 'end' ? null : "white" }),
                        { 
                            name: 'duration',
                            row: 0, column: 1, columnSpan: 1, margin: 0,
                            textAlign: "center", font: "bold 14px sans-serif",
                            textValidation: validate_node_length,
                            verticalAlignment: go.Spot.Center,
                            width: 70,
                            height: 24,
                            maxLines: 1,
                            isMultiline: false
                        }),
                    $(go.TextBlock,  // earlyFinish
                        new go.Binding("text", "", function(d) { 
                            return d.key === "start" ? "0" : d.key !== 'end' && d.earlyFinish ? d.earlyFinish : d.earlyFinish === undefined ? "0" : parseInt(d.earlyFinish) < parseInt(vm.project_total_days) ? vm.project_total_days : d.earlyFinish 
                        }),
                        { row: 0, column: 2, columnSpan: 1, margin: 5, textAlign: "center", maxSize: new go.Size(70, 20), }),

                    $(go.TextBlock,
                        new go.Binding("text", "", function(d) { return d.name ? d.name : d.text }),
                        new go.Binding("editable", "", function(d) { return d.key !== 'start' && d.key !== 'end' ? true : false; }),
                        {
                            name: 'name',
                            row: 1, column: 0, columnSpan: 3, margin: 5,
                            textAlign: "center", font: "bold 14px sans-serif",
                            textValidation: validate_node_name,
                            width: 210,
                            wrap: go.TextBlock.WrapFit,      // 允許文字根據寬度自動換行
                            overflow: go.TextBlock.OverflowClip, // 移除省略號設定
                            isMultiline: true                // 允許顯示多行文字
                        }),
                     $(go.TextBlock,
                        new go.Binding("text", "", function(d) { return d.unit_price == 0 ? "0" : d.unit_price ? parseFloat(d.unit_price).toFixed(2) : "0" }),
                        new go.Binding("editable", "", function(d) { return d.key !== 'start' && d.key !== 'end' ? true : false; }),
                        {
                            name: 'unit_price',
                            row: 2, column: 0, columnSpan: 3, margin: 5,
                            textAlign: "center", font: "bold 14px sans-serif",
                            textValidation: validate_unit_price,
                            width: 210,
                            maxLines: 1,
                            isMultiline: false
                        }),
                    $(go.TextBlock, "%",
                        { row: 2, column: 2, margin: 5, columnSpan: 1, textAlign: "center", font: "bold 14px sans-serif"}),
                    $(go.TextBlock,  // lateStart
                        new go.Binding("text", "", function(d) { return d.key === 'start' ? "0" : d.key === 'end' ? parseInt(d.lateStart) : isNaN( parseInt(d.lateStart)) ? '' : parseInt(d.lateStart) + 1 }),
                        { row: 3, column: 0, margin: 5, columnSpan: 1, textAlign: "center" }),
                    $(go.TextBlock,  // slack
                        new go.Binding("text", "",
                        function(d) { return d.key === 'start' ? '0' : d.key === 'end' ? parseInt(vm.project_total_days) - d.lateFinish : d.duration ? (isNaN(d.lateFinish - (d.earlyStart + d.duration)) ? null : (d.lateFinish - (d.earlyStart + d.duration))) : (isNaN(d.lateFinish - (d.earlyStart + d.length)) ? null : (d.lateFinish - (d.earlyStart + d.length))); }),
                        { row: 3, column: 1, margin: 5, columnSpan: 1, textAlign: "center" }),
                    $(go.TextBlock, // lateFinish
                        new go.Binding("text", "", function(d) { return d.key === "start" ? "0" : d.key !== 'end' && d.lateFinish ? d.lateFinish : d.lateFinish === undefined ? "0" : parseInt(d.lateFinish) < parseInt(vm.project_total_days) ? vm.project_total_days : d.lateFinish }),
                        { row: 3, column: 2, margin: 5, columnSpan: 1, textAlign: "center" }),
                ),  // end Table Panel
                // two small named ports, one on each side:
                make_port("Left", go.Spot.Left, true, true),
                make_port("Right", go.Spot.Right, true, true),
                // add event
                { // handle mouse enter/leave events to show/hide the ports
                    mouseEnter: (e, node) => show_small_ports(node, true),
                    mouseLeave: (e, node) => show_small_ports(node, false),
                    click: function(e, obj) { 
                        vm.temp_selected_part = obj.part.data;
                    },
                    selectionAdornmentTemplate:
                        $(go.Adornment, "Spot", 
                            $(go.Panel, "Auto",
                                // this Adornment has a rectangular blue Shape around the selected node
                                $(go.Shape, { fill: null, stroke: "dodgerblue", strokeWidth: 3 }),
                                $(go.Placeholder)
                            ), 
                            // and this Adornment has a Button to the right of the selected node
                            $("Button",
                                new go.Binding("width", "", function(d){ return d.key === 'start' || d.key === 'end' ?  0 : 30 }),
                                new go.Binding("height", "", function(d){ return d.key === 'start' || d.key === 'end' ?  0 : 30 }),
                                { 
                                    "_buttonFillOver": "red",
                                    "ButtonBorder.fill": "red",
                                    alignment: go.Spot.TopLeft, alignmentFocus: go.Spot.Right,
                                    click: vm.remove_item_confirm,
                                },  // define click behavior for Button in Adornment
                                $(go.TextBlock, "X",  // the Button content
                                    { font: "bold 15pt sans-serif", stroke: 'white' })
                            ),
                        )  // end Adornment
                },
            );  // end Node

            // The link data object does not have direct access to both nodes
            // (although it does have references to their keys: .from and .to).
            // This conversion function gets the GraphObject that was data-bound as the second argument.
            // From that we can get the containing Link, and then the Link.fromNode or .toNode,
            // and then its node data, which has the ".critical" property we need.
            //
            // But note that if we were to dynamically change the ".critical" property on a node data,
            // calling Diagram.model.updateTargetBindings(nodedata) would only update the color
            // of the nodes.  It would be insufficient to change the appearance of any Links.

            // The color of a link (including its arrowhead) is red only when both
            // connected nodes have data that is ".critical"; otherwise it is blue.
            // This is computed by the binding converter function.
            Diagram.linkTemplate =
            $(go.Link,
                new go.Binding("fromSpot", "fromSpot", go.Spot.parse),
                new go.Binding("toSpot", "toSpot", go.Spot.parse),
                {
                    routing: go.Link.AvoidsNodes,  // may be either Orthogonal or AvoidsNodes
                    corner: 10,
                    curve: go.Link.JumpOver,
                    selectionAdornmentTemplate:
                        $(go.Adornment,
                            $(go.Shape,
                                { isPanelMain: true, stroke: greenfill, strokeWidth: 3 }),
                            $(go.Shape,
                                { toArrow: "Triangle", stroke: null, scale: 1.5, fill: greenfill, strokeWidth: 3 }),
                            $(go.Panel, "Auto",  // this whole Panel is a link label
                                $(go.Shape, "RoundedRectangle", { fill: greenfill, stroke: "gray" }),
                                $(go.TextBlock, { margin: 3 },
                                    new go.Binding("text", "", function(d) { return d.lag ? d.mode + "(" + d.lag + ")" : d.mode ? d.mode : "FS" })
                                )
                            ),
                        )  // end Adornment
                },
                $(go.Shape,
                    { name: 'link_line', strokeWidth: 3 },
                    new go.Binding("stroke", "", link_color_converter_edit)
                ),
                $(go.Shape,  // arrowhead
                    { toArrow: "Triangle", stroke: null, scale: 1.5 },
                    new go.Binding("fill", "", link_color_converter_edit)
                ),
                $(go.Panel, "Auto",  // this whole Panel is a link label
                    $(go.Shape, "RoundedRectangle", { fill: "white", stroke: "gray" }),
                    $(go.TextBlock, { margin: 3 },
                        new go.Binding("text", "", function(d) { return d.lag ? d.mode + "(" + d.lag + ")" : d.mode ? d.mode : "FS" })
                    )
                ),
                {
                    click: function(e, obj) { 
                        vm.on_link_selection_changed(obj);
                    }
                }
            );

            // create an unbound Part that acts as a "legend" for the diagram
            // Diagram.add(
            //     $(go.Node, "Auto",  // the border
            //         $(go.Shape, "RoundedRectangle",  // the border
            //             { name: "item", fill: bluefill, strokeWidth: 2, spot1: go.Spot.TopLeft, spot2: go.Spot.BottomRight },
            //             new go.Binding("fill", "critical", function(b) { return (b ? pinkfill : bluefill); }),
            //             new go.Binding("stroke", "critical", function(b) { return (b ? pink : blue); })
            //         ),
            //         $(go.Panel, "Table",
            //             { padding: 0.5 },
            //             $(go.RowColumnDefinition, { column: 0, separatorStroke: "black" }),
            //             $(go.RowColumnDefinition, { column: 1, separatorStroke: "black" }),
            //             $(go.RowColumnDefinition, { column: 2, separatorStroke: "black" }),
            //             $(go.RowColumnDefinition, { row: 0, separatorStroke: "black" }),    
            //             $(go.RowColumnDefinition, { row: 1, separatorStroke: "black", background: "white", coversSeparators: true }),
            //             $(go.RowColumnDefinition, { row: 2, separatorStroke: "black", background: "white", coversSeparators: true }),
            //             $(go.RowColumnDefinition, { row: 3, separatorStroke: "black" }),    
            //             $(go.TextBlock, "最早開工時間",
            //             { row: 0, column: 0, margin: 5, textAlign: "center" }),
            //             $(go.TextBlock, "工期",
            //             { row: 0, column: 1, margin: 0, font: "bold 14px sans-serif", textAlign: "center", verticalAlignment: go.Spot.Center, background: "white", height: 24, width: 40 }),
            //             $(go.TextBlock, "最晚開始時間",
            //             { row: 0, column: 2, margin: 5, textAlign: "center" }),

            //             $(go.TextBlock, "工項名稱",
            //             {
            //                 row: 1, column: 0, columnSpan: 3, margin: 5,
            //                 textAlign: "center", font: "bold 14px sans-serif"
            //             }),
            //             $(go.TextBlock, "比率 (%)",
            //             {
            //                 row: 2, column: 0, columnSpan: 3, margin: 5,
            //                 textAlign: "center", font: "bold 14px sans-serif"
            //             }),

            //             $(go.TextBlock, "最晚開始時間",
            //             { row: 3, column: 0, margin: 5, textAlign: "center" }),
            //             $(go.TextBlock, "浮時",
            //             { row: 3, column: 1, margin: 5, textAlign: "center" }),
            //             $(go.TextBlock, "最晚結束時間",
            //             { row: 3, column: 2, margin: 5, textAlign: "center" })
            //         )  // end Table Panel
            //     ));

            // link drawn event
            Diagram.addDiagramListener("LinkDrawn", function(e) {
                vm.new_link.fromSpot="RightSide"
                vm.new_link.toSpot="LeftSide"
                vm.when_link_drawn(e);

                // console.log(vm.link_data_array)
                // 
            });

            // text edited event
            Diagram.addDiagramListener("TextEdited", function(e) {
                vm.when_text_edited(e);
            });

            // keydown event listener
            Diagram.commandHandler.doKeyDown = function() {
                vm.end_text_edit();

                vm.is_edited = true;

                let e = Diagram.lastInput;
                // The meta (Command) key substitutes for "control" for Mac commands
                let control = e.control || e.meta;

                let key = e.key;
                // console.log(key);
                // Quit on any undo/redo key combination:
                if(control && (key === 'V')){
                    if(Diagram.selection.first()){
                        let data = Diagram.selection.first().data;
                        if(data){
                            vm.add_item_copy_mode(data);
                        }

                        // go.CommandHandler.prototype.doKeyDown.call(this);

                        // let item_id = vm.ID();
                        // item_id = parseInt(item_id/100000000);

                        // let new_item = vm.node_data_array.find(item => item.key <= 0 && item.key !== 'start' && item.key !== 'end');

                        // console.log(new_item.key);

                        // if(new_item.key < 0){
                        //     vm.node_data_array = vm.node_data_array.filter(item => item.key !== new_item.key);

                        //     new_item.key = item_id;
                        //     new_item.id = item_id;

                            // vm.node_data_array.unshift(new_item);

                        // }
                    }
                }else if(key === 'Backspace' || key === 'Del'){
                    if(Diagram.selection.first()){
                        let data = Diagram.selection.first().data;

                        if(data){
                            vm.keydown_remove_item_confirm(data);
                        }
                    }
                }else if(key === 'Z'){
                    return
                }else{
                    // call base method with no arguments (default functionality)
                    go.CommandHandler.prototype.doKeyDown.call(this);
                };
            };

            // set go js rereder animate to none
            Diagram.animationManager.initialAnimationStyle = go.AnimationManager.None;

            /**
            * init graph
            **/
            vm.diagram = Diagram;
            vm.apply_edit_mode(vm.is_graph_edit);
            vm.bind_parent_bridge();
            vm.node_data_array = JSON.parse(JSON.stringify(vm.origin_node_data_array));
            vm.link_data_array = JSON.parse(JSON.stringify(vm.origin_link_data_array));

            const init_test_graph_resp = await vm.init_test_graph();
            const init_test_graph_edit_resp = await vm.init_test_graph_edit();
        },
        async init_test_graph(type = null){
            const vm = this;
            vm.is_edited = false;

            return new Promise(async(resolve, reject) => {
                try{
                    let no_start_end_node_data = vm.origin_node_data_array.filter(item => item.key !== "start" && item.key !== "end");
    
                    if(!vm.ans.length){
                        let iter = 0;
                        for(let i = 0; i < no_start_end_node_data.length; i++){
                            no_start_end_node_data[i].text = no_start_end_node_data[i].name;
                            no_start_end_node_data[i].length = no_start_end_node_data[i].duration;
                            no_start_end_node_data[i].critical = no_start_end_node_data[i].cp;
                            iter += 1;
                        }
    
                        if(iter === no_start_end_node_data.length){
                            vm.ans = no_start_end_node_data;
                        }
                    }
                    vm.add_start_and_end();
                    const calculated_resp = await vm.add_calculated_dates();
                    const add_link_mode_resp = await vm.add_link_mode();
                    const calculate_total_unit_price_resp = await vm.calculate_total_unit_price();
    
                    // // draw the cpm plot
                    vm.diagram.model = new go.GraphLinksModel(vm.node_data_array, vm.link_data_array); 
                    // console.log(vm.diagram);
                    resolve(true);
                }
                catch(err){
                    vm.origin_node_data_array = vm.previous_node_data_array;
                    vm.origin_link_data_array = vm.previous_link_data_array;
                    // vm.init_test_graph();
                    reject(err);
    
                    console.log(err);
                    Lobibox.notify("warning", {
                        title: '系統訊息',
                        msg: '設定錯誤，已恢復前一狀態，請重新設定工項連結，如有其他問題請洽工程人員，謝謝。',
                        sound: false
                    });
                }
            });
        },
        async init_test_graph_edit(type = null, is_reload = false){
            const vm = this;

            return new Promise(async(resolve, reject) => {
                try{
                    vm.add_start_and_end();
                    const calculate_total_unit_price_resp = await vm.calculate_total_unit_price();

                    if(is_reload){
                        let calculated_resp = await vm.add_calculated_dates();

                        if(calculated_resp.status){
                            vm.add_link_mode();
       
                            // draw the cpm plot  
                            vm.diagram.model = new go.GraphLinksModel(vm.node_data_array, vm.link_data_array); 
                            // console.log(vm.diagram);
                        }
                    }else{
                        vm.$forceUpdate();
                        vm.diagram.model = new go.GraphLinksModel(vm.node_data_array, vm.link_data_array);
                    }

                    resolve(true);
                }
                catch(err){
                    if(type === 'node'){
                        vm.origin_node_data_array = vm.previous_node_data_array;
                    }else if(type === 'link'){
                        vm.origin_link_data_array = vm.previous_link_data_array;
                    }
                    reject(err);
                    // vm.init_test_graph_edit();
                    console.log(err);
                    Lobibox.notify("warning", {
                        title: '系統訊息',
                        msg: '設定錯誤，已恢復前一狀態，請重新設定工項連結，如有其他問題請洽工程人員，謝謝。',
                        sound: false
                    });
                }
            });
        },
        when_link_drawn(e){
            const vm = this;

            if(e.subject.data){
                vm.new_link.from = e.subject.data.from;
                vm.new_link.to = e.subject.data.to;
                let temp_item_from = vm.node_data_array.find(item => item.key == vm.new_link.from);
                let temp_item_to = vm.node_data_array.find(item => item.key == vm.new_link.to);

                if(temp_item_from && temp_item_to){
                    try{
                        vm.new_link.from_text = temp_item_from.name ? temp_item_from.name : temp_item_from.text;
                        vm.new_link.to_text = temp_item_to.name ? temp_item_to.name : temp_item_to.text;

                        vm.add_link();
                    }
                    catch(err){
                        console.log(err);
                    }
                }
                vm.$forceUpdate();
            }
        },
        async when_text_edited(e){
            const vm = this;

            vm.is_edited = true;
            
            if(e.subject.text){
                try{
                    // console.log(e.subject.part.data.key);
                    // console.log(e.subject.text);
                    // console.log(vm.node_data_array.find(item => item.key == e.subject.part.data.key));
                    if(e.subject.name === 'name'){
                        vm.node_data_array.find(item => item.key == e.subject.part.data.key).text = e.subject.text;
                        vm.node_data_array.find(item => item.key == e.subject.part.data.key).name = e.subject.text;
                    }else if(e.subject.name === 'duration'){
                        vm.node_data_array.find(item => item.key == e.subject.part.data.key).length = parseInt(e.subject.text);
                        vm.node_data_array.find(item => item.key == e.subject.part.data.key).duration = parseInt(e.subject.text);
                    }else if(e.subject.name === 'unit_price'){
                        vm.node_data_array.find(item => item.key == e.subject.part.data.key).unit_price = parseFloat(e.subject.text);

                        const calculate_total_unit_price_resp = await vm.calculate_total_unit_price();
                    }
                }
                catch(err){
                    console.log(err);
                }
                vm.$forceUpdate();
            }
        },
        end_text_edit(){
            const vm = this;
            
            if(vm.diagram.currentTool instanceof go.TextEditingTool) {
                vm.diagram.toolManager.textEditingTool.acceptText(go.TextEditingTool.MouseDown);
            }
        },
        on_item_selection_changed_edit(node){
            const vm = this;

            let item = node.findObject("item");
            if (item !== null) {
                if(vm.is_edited){
                    if(node.isSelected){
                        item.fill = greenfill;
                    }else if(item.panel.data.key === 'start' || item.panel.data.key === 'end'){
                        item.fill = pinkfill;
                    }else{
                        item.fill = bluefill;
                    }
                }else{
                    if(node.isSelected){
                        item.fill = greenfill;
                    }else if(item.panel.data.critical){
                        item.fill = pinkfill;
                    }else{
                        item.fill = bluefill;
                    }
                }
            }
        },
        on_link_selection_changed(link){
            const vm = this;
            vm.previous_link_data_array = JSON.parse(JSON.stringify(vm.link_data_array));
            vm.temp_selected_link = link.data;

            vm.temp_selected_link.lag = parseInt(vm.temp_selected_link.lag);

            vm.temp_selected_link.from_text = vm.node_data_array.find(item => item.key === vm.temp_selected_link.from).name ? vm.node_data_array.find(item => item.key === vm.temp_selected_link.from).name : vm.node_data_array.find(item => item.key === vm.temp_selected_link.from).text;
            vm.temp_selected_link.to_text = vm.node_data_array.find(item => item.key === vm.temp_selected_link.to).name ? vm.node_data_array.find(item => item.key === vm.temp_selected_link.to).name : vm.node_data_array.find(item => item.key === vm.temp_selected_link.to).text;

            vm.$forceUpdate();

            if(link.isSelected){
                vm.edit_link_modal.show();
            }
        },
        toggle_sidebar: function(){
            const vm = this;
            if(vm.sidebar_toggle){
                vm.sidebar_toggle = false;
            }else{
                vm.sidebar_toggle = true;
            }
        },
        add_start_and_end: function(){
            const vm = this;
            let lf = 0;

            // console.log(vm.link_data_array);
            let temp_last_link = vm.link_data_array.find(item => item.to === 'end');
            if(temp_last_link){
                let temp_last_item = vm.node_data_array.find(item => item.key === temp_last_link.from);
                // console.log(temp_last_link);
                lf = temp_last_item ? temp_last_item.lf : 0;    
                vm.graph_setting_duration = lf;
            }else{
                lf = 0;
            }

            if(vm.node_data_array.find(item => item.key === 'start') || vm.node_data_array.find(item => item.key === 'end')){
                return true;
            }else{
                let start_location = vm.start_end_node.start_item;
                let end_location = vm.start_end_node.end_item;

                if(start_location === undefined){
                    start_location = "100 0";
                }

                if(end_location === undefined){
                    end_location = "800 0";
                }
    
                vm.node_data_array.push({
                    "key": 'end', 
                    "text": "完工", 
                    "name": "完工", 
                    "length": 0,
                    "earlyStart": lf, 
                    "earlyFinish": lf, 
                    "lateStart": lf, 
                    "lateFinish": lf,
                    "critical": true,
                    "location": end_location
                });

                vm.node_data_array.push({
                    "key": 'start', 
                    "text": "開工", 
                    "name": "開工", 
                    "length": 0,
                    "earlyStart": 0, 
                    "earlyFinish": 0, 
                    "lateStart": 0, 
                    "lateFinish": 0,
                    "critical": true,
                    "location": start_location
                });
            }
        },
        add_calculated_dates: function(){
            const vm = this;

            return new Promise((resolve, reject) => {
                try{
                    let iter = 0;

                    for(let i = 0; i < vm.node_data_array.length; i++){
                        for(let j = 0; j < vm.ans.length; j++){
                            if(vm.node_data_array[i].key === vm.ans[j].key){
                                vm.node_data_array[i].earlyStart = vm.ans[j].es;
                                vm.node_data_array[i].earlyFinish = vm.ans[j].ef;
                                vm.node_data_array[i].lateStart = vm.ans[j].ls;
                                vm.node_data_array[i].lateFinish = vm.ans[j].lf;
                                vm.node_data_array[i].pre = vm.ans[j].pre;
                                vm.node_data_array[i].succ = vm.ans[j].succ;
                                vm.node_data_array[i].text = vm.ans[j].name;
                                vm.node_data_array[i].length = vm.ans[j].duration;

                                if(vm.ans[j].cp === undefined){
                                    if(vm.node_data_array[i].key !== 'start' && vm.node_data_array[i].key !== 'end'){
                                        if(vm.node_data_array[i].lateFinish - (vm.node_data_array[i].earlyStart + vm.node_data_array[i].duration) === 0){
                                            vm.node_data_array[i].critical = true;
                                        }else{
                                            vm.node_data_array[i].critical = false;
                                        }
                                    }else{
                                        vm.node_data_array[i].critical = true;
                                    }
                                }else{
                                    vm.node_data_array[i].critical = vm.ans[j].cp;
                                }
                            }
                        }
                        iter += 1;
                    }
    
                    if(iter === vm.node_data_array.length){
                        resolve({ status: true });
                    }
                }
                catch(err){
                    console.log(err);
                    reject(err);
                }
               
            });
        },
        add_link_mode(){
            const vm = this;

            return new Promise((resolve, reject) => {
                let iter = 0;

                try{
                    for(let i = 0; i < vm.link_data_array.length; i++){
                        if(vm.link_data_array[i].mode === 'FS'){
                            vm.link_data_array[i].fromSpot = 'RightSide';
                            vm.link_data_array[i].toSpot = 'LeftSide';
                        }else if(vm.link_data_array[i].mode === 'FF'){
                            vm.link_data_array[i].fromSpot = 'RightSide';
                            vm.link_data_array[i].toSpot = 'RightSide';
                        }else if(vm.link_data_array[i].mode === 'SF'){
                            vm.link_data_array[i].fromSpot = 'LeftSide';
                            vm.link_data_array[i].toSpot = 'RightSide';
                        }else if(vm.link_data_array[i].mode === 'SS'){
                            vm.link_data_array[i].fromSpot = 'LeftSide';
                            vm.link_data_array[i].toSpot = 'LeftSide';
                        }

                        vm.link_data_array[i].lag = parseInt(vm.link_data_array[i].lag);
                        iter += 1;
                    }
    
                    if(iter === vm.link_data_array.length){
                        resolve(true);
                    }
                }
                catch(err){
                    reject(err);
                } 
            });
        },
        add_item_copy_mode(data){
            const vm = this;

            vm.end_text_edit();

            let item_id = vm.ID();
            item_id = parseInt(item_id/100000000);

            let start_item = vm.node_data_array.find(item => item.key === 'start');

            let loc = start_item.location.split(' ') + " " + String(parseFloat(start_item.location.split(' ')[1]) - 150);

            let new_item = {
                temp_key: item_id, 
                key: item_id, 
                text: data.text ? data.text : data.name,
                name: data.name ? data.name : data.text,
                length: data.length ? data.length : data.duration, 
                duration: data.duration ? data.duration : data.length,
                location: loc,
                uplevel: '/schedule/api/active/scheduleitem/' + ROOT_ITEM_ID + '/',
                version: `/schedule/api/active/version_schedule/${vm.schedule_version_id}/`
            };
            vm.node_data_array.push(new_item);
            vm.is_edited = true;
            vm.previous_node_data_array = JSON.parse(JSON.stringify(vm.node_data_array));
            vm.$forceUpdate();

            vm.init_test_graph_edit('node', false);
        },
        add_item_edit_mode(){
            const vm = this;

            vm.end_text_edit();

            let item_id = vm.ID();
            item_id = parseInt(item_id/100000);

            let start_item = vm.node_data_array.find(item => item.key === 'start');

            let loc = start_item.location.split(' ') + " " + String(parseFloat(start_item.location.split(' ')[1]) - 150);

            let new_item = {
                temp_key: item_id,
                key: item_id, 
                text: '工項代號: ' + item_id, 
                name: '工項代號: ' + item_id, 
                length: 1, 
                duration: 1,
                location: loc,
                uplevel: '/schedule/api/active/scheduleitem/' + ROOT_ITEM_ID + '/',
                version: `/schedule/api/active/version_schedule/${vm.schedule_version_id}/`
            };
            vm.node_data_array.push(new_item);
            vm.is_edited = true;
            vm.previous_node_data_array = JSON.parse(JSON.stringify(vm.node_data_array));
            vm.$forceUpdate();

            vm.init_test_graph_edit('node', false);
        },
        keydown_remove_item_confirm(data){
            const vm = this;
            let key = data.key;

            vm.temp_selected_part = vm.node_data_array.find(item => item.key === key);

            Lobibox.confirm({
                title: '移除工項確認',
                msg: '確定要移除工項: ' + vm.temp_selected_part.name + ' ？',
                buttons: {
                    accept: {
                        'class': 'lobibox-btn btn-danger',
                        text: '移除',
                        closeOnClick: true
                    },
                    cancel: {
                        'class': 'lobibox-btn btn-secondary',
                        text: '取消',
                        closeOnClick: true
                    },
                },
                callback: function ($this, type, ev) {
                    if(type=="accept"){
                        vm.keydown_remove_item(data);
                    }
                }
            });
        },  
        remove_item_confirm(e, b){
            const vm = this;
            const node = b.part.adornedPart;
            let key = node.data.key;

            vm.temp_selected_part = vm.node_data_array.find(item => item.key === key);

            Lobibox.confirm({
                title: '移除工項確認',
                msg: '確定要移除工項: ' + vm.temp_selected_part.name + ' ？',
                buttons: {
                    accept: {
                        'class': 'lobibox-btn btn-danger',
                        text: '移除',
                        closeOnClick: true
                    },
                    cancel: {
                        'class': 'lobibox-btn btn-secondary',
                        text: '取消',
                        closeOnClick: true
                    },
                },
                callback: function ($this, type, ev) {
                    if(type=="accept"){
                        vm.remove_item(e, b);
                    }
                }
            });
        },
        keydown_remove_item(data){
            const vm = this;
            let key = data.key;

            let temp_remove_item = vm.node_data_array.find(function(item, index, array){
                return item.key === key;
            });

            if(key !== 'start' && key !== 'end'){
                // console.log(temp_remove_item);
                if(temp_remove_item.pre_item !== undefined){
                    vm.temp_remove_items.push(`/schedule/api/active/scheduleitem/${key}/`);
                }

                vm.node_data_array = vm.node_data_array.filter(function(item, index, array){
                    return item.key !== key;
                });
    
                vm.link_data_array = vm.link_data_array.filter(function(item, index, array){
                    return item.from !== key && item.to !== key;
                });
    
                vm.is_edited = true;
                vm.init_test_graph_edit('node', false);
            }else{
                Lobibox.notify("warning", {
                    title: '系統訊息',
                    msg: '不可移除起始與結束項目。',
                    sound: false
                });
            }
        },
        remove_item(e, b){
            const vm = this;
            const node = b.part.adornedPart;
            let key = node.data.key;

            let temp_remove_item = vm.node_data_array.find(function(item, index, array){
                return item.key === key;
            });

            if(key !== 'start' && key !== 'end'){
                // console.log(temp_remove_item);
                if(temp_remove_item.pre_item !== undefined){
                    vm.temp_remove_items.push(`/schedule/api/active/scheduleitem/${key}/`);
                }

                vm.node_data_array = vm.node_data_array.filter(function(item, index, array){
                    return item.key !== key;
                });
    
                vm.link_data_array = vm.link_data_array.filter(function(item, index, array){
                    return item.from !== key && item.to !== key;
                });
    
                vm.is_edited = true;
                vm.init_test_graph_edit('node', false);
            }else{
                Lobibox.notify("warning", {
                    title: '系統訊息',
                    msg: '不可移除起始與結束項目。',
                    sound: false
                });
            }
        },
        validate_link(new_link){
            const vm = this;
            return new Promise(async (resolve, reject) => {
                try{
                    // check if the link duplicate to each node
                    let iter = 0;
                    let duplicate_count = 0;

                    for(let i = 0; i < vm.link_data_array.length; i++){
                        if(vm.link_data_array[i].from === 'start' && vm.link_data_array[i].to === 'end'){
                            resolve(false);
                        }

                        if(vm.link_data_array[i].to === 'start' || vm.link_data_array[i].from === 'end'){
                            resolve(false);
                        }

                        if((vm.link_data_array[i].from === new_link.from && vm.link_data_array[i].to === new_link.to) || (vm.link_data_array[i].from === new_link.to && vm.link_data_array[i].to === new_link.from)){
                            duplicate_count += 1;
                            if(duplicate_count > 1){
                                resolve(false);
                            }
                        }
                        iter += 1;
                    }
                    if(iter === vm.link_data_array.length){
                        resolve(true);
                    }
                }
                catch(err){
                    reject(err);
                }
            });
        },
        async add_link(){
            const vm = this;

            try{
                let new_link = JSON.parse(JSON.stringify(vm.new_link));
                new_link.lag = parseInt(new_link.lag);
    
                let validate_link_resp = await vm.validate_link(new_link);

                if(validate_link_resp){
                    // console.log(vm.link_data_array);
                    let link_index = vm.link_data_array.findIndex(item => item.from == new_link.from && item.to == new_link.to);

                    if(vm.temp_from_port === 'Left' && vm.temp_to_port === 'Left'){
                        vm.link_data_array[link_index].mode = 'SS';
                    }else if(vm.temp_from_port === 'Left' && vm.temp_to_port === 'Right'){
                        vm.link_data_array[link_index].mode = 'SF';
                    }else if(vm.temp_from_port === 'Right' && vm.temp_to_port === 'Left'){
                        vm.link_data_array[link_index].mode = 'FS';
                    }else if(vm.temp_from_port === 'Right' && vm.temp_to_port === 'Right'){
                        vm.link_data_array[link_index].mode = 'FF';
                    }
                    
                    vm.link_data_array[link_index].lag = new_link.lag;
                    vm.add_link_mode();
                    // console.log(vm.link_data_array[link_index])

                    vm.is_edited = true;

                    vm.$forceUpdate();
                    vm.diagram.model = new go.GraphLinksModel(vm.node_data_array, vm.link_data_array);

                    Object.assign(vm.new_link, {
                        from: '',
                        to: '',
                        fromSpot:'',
                        toSpot:'',
                        mode: '',
                        lag: 0
                    });
                    vm.temp_from_port = null;
                    vm.temp_to_port = null;
                    vm.$forceUpdate();
                }else{
                    // console.log(vm.link_data_array);
                    vm.init_test_graph_edit('link', false);
                    vm.link_data_array = vm.link_data_array.filter(item => item.mode);
                    vm.init_test_graph_edit('link', false);

                    Lobibox.notify("warning", {
                        title: '系統訊息',
                        msg: '新增連結錯誤，請檢查是否為重複連線形成迴圈，請重新連結或洽工程人員，謝謝。',
                        sound: false
                    });
                }
            }
            catch(err){
                console.log(err);

                vm.init_test_graph_edit('link', false);
                vm.link_data_array = vm.link_data_array.filter(item => item.mode == '');
                vm.init_test_graph_edit('link', false);
                Lobibox.notify("warning", {
                    title: '系統訊息',
                    msg: '新增連結錯誤，請檢查是否為重複連線形成迴圈，請重新連結或洽工程人員，謝謝。',
                    sound: false
                });
            }
        },
        cancel_add_link(){
            const vm = this;
            vm.init_test_graph('link');
        },
        cancel_update_link(){
            const vm = this;
            vm.link_data_array = vm.previous_link_data_array;
            vm.init_test_graph_edit('link', false);
        },
        update_link(){
            const vm = this;

            vm.end_text_edit();

            vm.is_edited = true;
            vm.edit_link_modal.hide();
            let iter = 0;

            for(let i = 0; i < vm.link_data_array.length; i++){
                vm.link_data_array[i].lag = parseInt(vm.link_data_array[i].lag);
                iter += 1;
            }

            if(iter === vm.link_data_array.length){
                vm.init_test_graph_edit('link', false);
            }
            vm.add_link_mode();
            // console.log(vm.link_data_array)
        },
        remove_link(link){
            const vm = this;

            if(link){
                vm.temp_selected_link = link;
            }

            vm.is_edited = true;
            //Find index of specific object using findIndex method.    
            let targetIndex = vm.link_data_array.findIndex((item => item.from === vm.temp_selected_link.from && item.to === vm.temp_selected_link.to && item.mode === vm.temp_selected_link.mode && item.lag == vm.temp_selected_link.lag));

            vm.temp_selected_link = {};
            vm.edit_link_modal.hide();
            vm.link_data_array.splice(targetIndex, 1);
            vm.init_test_graph_edit('link', false);
        },
        validate_diagram(fix_duration = 0){
            const vm = this;

            return new Promise(async (resolve, reject) => {
                try{
                    let data = {};

                    if(fix_duration){
                        data = {
                            nodes: vm.previous_node_data_array,
                            links: vm.previous_link_data_array,
                            fix_duration: parseInt(fix_duration)
                        };
                    }else{
                        data = {
                            nodes: vm.previous_node_data_array,
                            links: vm.previous_link_data_array,
                        };
                    }
                    
                    const cpm_resp = await axios.post(cpm_api, data);

                    if(cpm_resp.data.status){
                        // console.log(cpm_resp.data.result);
                        let start_item = cpm_resp.data.result.find(item => item.key === 'start');
                        // let end_item = cpm_resp.data.result.find(item => item.key === 'end');

                        if(start_item.lf !== 0 || start_item.ls !== 0 || start_item.ff !== 0){
                            cpm_resp.data.status = false;
                            cpm_resp.data.msg = '連結設定錯誤';
                        }
                        resolve(cpm_resp.data);
                    }else{
                        resolve(cpm_resp.data);
                    }
                }
                catch(err){
                    reject(err);
                }
            });
        },
        async check_start_end_linked(){
            const vm = this;

            return new Promise(async (resolve, reject) => {
                try{
                    let iter = 0;

                    // check if start and end are linked right
                    let wrong_start = vm.previous_link_data_array.filter(link => link.to === 'start');
                    let wrong_end = vm.previous_link_data_array.filter(link => link.from === 'end');
                    if(wrong_start.length !== 0){
                        resolve({
                            status: false,
                            msg: '工項 ' + vm.node_data_array.find(item => item.key === wrong_start[0].from).name + ' 結束連結至開工（錯誤連結）'
                        });
                    }

                    if(wrong_end.length !== 0){
                        resolve({
                            status: false,
                            msg: '工項 ' + vm.node_data_array.find(item => item.key === wrong_end[0].to).name + ' 起始連結至完工（錯誤連結）'
                        });
                    }

                    for(let i = 0; i < vm.previous_node_data_array.length; i++){
                        if(vm.previous_node_data_array[i].key !== 'start' && vm.previous_node_data_array[i].key !== 'end'){
                            // check if node are linked
                            let temp_node_to_link = vm.previous_link_data_array.filter(link => link.to === vm.previous_node_data_array[i].key);
                            let temp_node_from_link = vm.previous_link_data_array.filter(link => link.from === vm.previous_node_data_array[i].key);    
                            if(temp_node_to_link.length === 0 || temp_node_from_link.length === 0){
                                resolve({ 
                                    status: false,
                                    msg: '工項 ' + vm.previous_node_data_array[i].name + ' 尚未有起始或結束連結，請檢查'
                                });
                            }
                        }
                        iter += 1;
                    }

                    if(iter === vm.previous_node_data_array.length){
                        resolve(true);
                    }
                }
                catch(err){
                    reject(err);
                }
            });
        },
        save_edited_result(){
            const vm = this;

            vm.end_text_edit();

            LOADER.open();

            return new Promise(async (resolve, reject) => {
                try{
                    vm.is_edited = false;
    
                    vm.origin_node_data_array = JSON.parse(JSON.stringify(vm.node_data_array));
                    vm.origin_link_data_array = JSON.parse(JSON.stringify(vm.link_data_array));

                    let start_item = vm.origin_node_data_array.find(item => item.key === "start");
                    let end_item = vm.origin_node_data_array.find(item => item.key === "end");
        
                    let no_start_end_node_data = vm.origin_node_data_array.filter(item => item.key !== "start" && item.key !== "end");
                    // let no_start_end_link_data = vm.origin_link_data_array.filter(link => link.to !== 'end' && link.from !== 'start');

                    let iter = 0;
                    for(let i = 0; i < no_start_end_node_data.length; i++){
                        no_start_end_node_data[i].text = no_start_end_node_data[i].name;
                        no_start_end_node_data[i].duration = no_start_end_node_data[i].length;
                        no_start_end_node_data[i].ef = no_start_end_node_data[i].earlyFinish;
                        no_start_end_node_data[i].lf = no_start_end_node_data[i].lateFinish;
                        no_start_end_node_data[i].es = no_start_end_node_data[i].earlyStart;
                        no_start_end_node_data[i].ls = no_start_end_node_data[i].lateStart;
                        iter += 1;
                    }

                    // get new add items for link id change
                    vm.temp_new_add_node = no_start_end_node_data.filter(item => !item.id);
    
                    if(iter === no_start_end_node_data.length){
                        const patch_data = {
                            objects: no_start_end_node_data,
                            deleted_objects: vm.temp_remove_items
                        };
            
                        const patch_cpm_item_resp = await apiPatchCpmItem(patch_data);
                        const need_change_temp_item = patch_cpm_item_resp.data.objects.filter(item => item.temp_key);
                      
                        // change link from to id
                        for(let i = 0; i < vm.temp_new_add_node.length; i++){
                            let temp_new_item = need_change_temp_item.find(item => item.temp_key === vm.temp_new_add_node[i].key);
                            vm.origin_link_data_array.filter(link => link.from === vm.temp_new_add_node[i].key).map(link => link.from = temp_new_item.id);
                            vm.origin_link_data_array.filter(link => link.to === vm.temp_new_add_node[i].key).map(link => link.to = temp_new_item.id);
                        }

                        const patch_link_data = {
                            cpm_link: JSON.stringify(vm.origin_link_data_array),
                            start_end_node: JSON.stringify({
                                start_item: start_item.location,
                                end_item: end_item.location
                            })
                        };
    
                        const patch_cpm_link_resp = await axios.put('/schedule/api/active/version_schedule/' + vm.schedule_version_id + '/', patch_link_data);
        
                        vm.temp_remove_items = [];

                        // get origin_node_data
                        this.origin_node_data_array = await vm.get_origin_node_data();

                        // get origin_link_data
                        this.origin_link_data_array = await vm.get_origin_link_data();
            
                        Lobibox.notify("success", {
                            title: '系統訊息',
                            msg: '儲存成功',
                            sound: false
                        });

                        vm.temp_new_add_node = [];

                        vm.node_data_array = JSON.parse(JSON.stringify(vm.origin_node_data_array));
                        vm.link_data_array = JSON.parse(JSON.stringify(vm.origin_link_data_array));
            
                        const init_test_graph_resp = await vm.init_test_graph();
                        const init_test_graph_edit_resp = await vm.init_test_graph_edit();

                        let $ = go.GraphObject.make;

                        vm.diagram.layout = $(AutoShiftingLayout);

                        LOADER.close();

                        resolve(true);
                    }
                }
                catch(err){
                    Lobibox.notify("error", {
                        title: '系統訊息',
                        msg: '儲存失敗，請聯絡工程人員。',
                        sound: false
                    });
                    console.log(err);
                    LOADER.close();
                    reject(err);
                }
            });
        },
        save_result(fix_duration = 0){
            const vm = this;

            vm.end_text_edit();

            return new Promise(async (resolve, reject) => {

                LOADER.open();

                try{
                    let valid_resp = null;
                    vm.previous_node_data_array = JSON.parse(JSON.stringify(vm.node_data_array));
                    vm.previous_link_data_array = JSON.parse(JSON.stringify(vm.link_data_array));
    
                    vm.temp_save_node_data_array = JSON.parse(JSON.stringify(vm.previous_node_data_array));
                    vm.temp_save_link_data_array = JSON.parse(JSON.stringify(vm.previous_link_data_array));
    
                    const valid_links = await vm.check_start_end_linked();
    
                    if(valid_links === true){
                        vm.previous_node_data_array = vm.previous_node_data_array.filter(item => item.key !== "start" && item.key !== "end");
                        // vm.previous_link_data_array = vm.previous_link_data_array.filter(link => link.to !== 'end' && link.from !== 'start');
    
                        let iter_prev = 0;
                        for(let i = 0; i < vm.previous_node_data_array.length; i++){
                            vm.previous_node_data_array[i].text = vm.previous_node_data_array[i].name;
                            vm.previous_node_data_array[i].length = vm.previous_node_data_array[i].duration;
                            iter_prev += 1;
                        }
    
                        // vm.temp_save_node_data_array = JSON.parse(JSON.stringify(vm.previous_node_data_array));
                        // vm.temp_save_link_data_array = JSON.parse(JSON.stringify(vm.previous_link_data_array));
            
                        // console.log(vm.previous_link_data_array);
                    
                        if(iter_prev === vm.previous_node_data_array.length){
                            valid_resp = await vm.validate_diagram(fix_duration);
                        }
                    
                        if(valid_resp.status){
                            // Lobibox.notify("success", {
                            //     title: '系統訊息',
                            //     msg: '連結設定正確，已儲存資料。',
                            //     sound: false
                            // });
                            vm.ans = valid_resp.result;
    
                            vm.origin_node_data_array = JSON.parse(JSON.stringify(vm.temp_save_node_data_array));
                            vm.origin_link_data_array = JSON.parse(JSON.stringify(vm.temp_save_link_data_array));
        
                            vm.node_data_array = JSON.parse(JSON.stringify(vm.origin_node_data_array));
                            vm.link_data_array = JSON.parse(JSON.stringify(vm.origin_link_data_array));
    
                            let iter = 0;
                            for(let i = 0; i < vm.node_data_array.length; i++){
                                let temp_item = vm.ans.filter(item => item.key === vm.node_data_array[i].key);
                                if(temp_item[0]){
                                    vm.node_data_array[i].duration = temp_item[0].length;
                                    vm.node_data_array[i].name = temp_item[0].text;
                                    vm.node_data_array[i].ef = temp_item[0].ef;
                                    vm.node_data_array[i].lf = temp_item[0].lf;
                                    vm.node_data_array[i].es = temp_item[0].es;
                                    vm.node_data_array[i].ls = temp_item[0].ls;
                                    vm.node_data_array[i].cp = temp_item[0].lf - temp_item[0].ef === 0 ? true : false;
                                }
                               
                                iter += 1;
                            }
    
                            if(iter === vm.node_data_array.length){
    
                                vm.is_edited = false;
                                vm.origin_node_data_array = JSON.parse(JSON.stringify(vm.node_data_array));
                                vm.origin_link_data_array = JSON.parse(JSON.stringify(vm.link_data_array));

                                let start_item = vm.origin_node_data_array.find(item => item.key === "start");
                                let end_item = vm.origin_node_data_array.find(item => item.key === "end");            
                    
                                let no_start_end_node_data = vm.origin_node_data_array.filter(item => item.key !== "start" && item.key !== "end");
                                // let no_start_end_link_data = vm.origin_link_data_array.filter(link => link.to !== 'end' && link.from !== 'start');
                                
                                // get new add items for link id change
                                vm.temp_new_add_node = no_start_end_node_data.filter(item => !item.id);
            
                                const patch_data = {
                                    objects: no_start_end_node_data,
                                    deleted_objects: vm.temp_remove_items
                                };
    
                                // console.log(patch_data);
                    
                                const patch_cpm_item_resp = await apiPatchCpmItem(patch_data);
                                const need_change_temp_item = patch_cpm_item_resp.data.objects.filter(item => item.temp_key);
                            
                                // change link from to id
                                for(let i = 0; i < vm.temp_new_add_node.length; i++){
                                    let temp_new_item = need_change_temp_item.find(item => item.temp_key === vm.temp_new_add_node[i].key);
                                    vm.origin_link_data_array.filter(link => link.from === vm.temp_new_add_node[i].key).map(link => link.from = temp_new_item.id);
                                    vm.origin_link_data_array.filter(link => link.to === vm.temp_new_add_node[i].key).map(link => link.to = temp_new_item.id);
                                    vm.ans.filter(itme => itme.key === vm.temp_new_add_node[i].key).map(item => item.key = temp_new_item.id);
                                }

                                const patch_link_data = {
                                    cpm_link: JSON.stringify(vm.origin_link_data_array),
                                    start_end_node: JSON.stringify({
                                        start_item: start_item.location,
                                        end_item: end_item.location
                                    })
                                };

                                // console.log(patch_link_data);
            
                                const patch_cpm_link_resp = await axios.put('/schedule/api/active/version_schedule/' + vm.schedule_version_id + '/', patch_link_data);
                
                                vm.temp_remove_items = [];
                
                                // get origin_node_data
                                this.origin_node_data_array = await vm.get_origin_node_data();
        
                                // get origin_link_data
                                this.origin_link_data_array = await vm.get_origin_link_data();
                    
                                Lobibox.notify("success", {
                                    title: '系統訊息',
                                    msg: '計算並儲存成功',
                                    sound: false
                                });

                                vm.temp_new_add_node = [];
        
                                vm.node_data_array = JSON.parse(JSON.stringify(vm.origin_node_data_array));
                                vm.link_data_array = JSON.parse(JSON.stringify(vm.origin_link_data_array));
                    
                                const init_test_graph_resp = await vm.init_test_graph();
                                const init_test_graph_edit_resp = await vm.init_test_graph_edit();

                                const detect_is_project_total_days_distance_resp = await vm.detect_is_project_total_days_match();

                                if(detect_is_project_total_days_distance_resp.status){
                                    vm.detect_is_project_total_days_distance = detect_is_project_total_days_distance_resp.result;
                                }else{
                                    vm.detect_is_project_total_days_distance = 0;
                                }

                                let $ = go.GraphObject.make;

                                vm.diagram.layout = $(AutoShiftingLayout);        

                                LOADER.close();

                                resolve(true);
                            }

                            vm.project_total_days = PROJECT_TOTAL_DAYS;
                        }else{
                            Lobibox.notify("warning", {
                                title: '系統訊息',
                                msg: valid_resp.msg + '，請重新設定。',
                                sound: false,
                                delay: 8000,
                            });
                            vm.project_total_days = PROJECT_TOTAL_DAYS;
                            LOADER.close();
                            resolve(false);
                        }
                    }else{
                        Lobibox.notify("warning", {
                            title: '系統訊息',
                            msg: valid_links.msg,
                            sound: false
                        });
                        LOADER.close();
                        resolve(false);
                    }
                }
                catch(err){
                    Lobibox.notify("error", {
                        title: '系統訊息',
                        msg: '計算出現錯誤，請聯絡工程人員。',
                        sound: false
                    });
                    console.log(err);
                    LOADER.close();
                    reject(err);
                }
            });
        },
        detect_is_project_total_days_match(){
            const vm = this;
            return new Promise(async (resolve, reject) => {
                try{
                    let detect_is_project_total_days_distance = 0;
                    detect_is_project_total_days_distance = parseInt(vm.graph_setting_duration) - parseInt(vm.project_total_days);
                    resolve({ status: true, result: detect_is_project_total_days_distance });
                }
                catch(err){
                    reject({ status: false, result: err });
                }
            });
        },
        getBrowserZoomRatio() {
            const zoom = window.outerWidth / window.innerWidth;
            return Math.floor(zoom * 100) / 100;
        },
        export_image(){
            const vm = this;
            vm.end_text_edit();

            const img = this.diagram.makeImage({
                scale: 1,
                maxSize: new go.Size(20000, 20000),
                background: "white",
                type: "image/jpeg"
            });

            let a = document.createElement('a');
            a.href = img.src;
            a.download = "cpm.jpg";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        },
        reload_page_alert(e){
            e.preventDefault();
            e.returnValue = '';
        },
        show_import_data_modal(){
            const vm = this;

            vm.end_text_edit();

            setTimeout(() => {
                if(vm.diagram.currentTool instanceof go.TextEditingTool){
                    Lobibox.notify("warning", {
                        title: '系統訊息',
                        msg: '修改輸入尚未完成，請修正',
                        sound: false
                    });
                }else{
                    vm.import_data_modal.show();
                }
            }, 300);
        },
        show_update_data_modal(){
            const vm = this;

            vm.end_text_edit();

            setTimeout(() => {
                if(vm.diagram.currentTool instanceof go.TextEditingTool){
                    Lobibox.notify("warning", {
                        title: '系統訊息',
                        msg: '修改輸入尚未完成，請修正',
                        sound: false
                    });
                }else{
                    vm.update_item_data();
                }
            }, 300);
        },
        show_auto_count_duration_modal(){
            const vm = this;

            vm.end_text_edit();

            setTimeout(() => {
                if(vm.diagram.currentTool instanceof go.TextEditingTool){
                    Lobibox.notify("warning", {
                        title: '系統訊息',
                        msg: '修改輸入尚未完成，請修正',
                        sound: false
                    });
                }else{
                    vm.auto_count_duration_modal.show();
                }
            }, 300);
        },
        async import_item_data(){
            const vm = this;

            try{
                LOADER.open();
                const post_data = {
                    version_id: vm.schedule_version_id,
                };
    
                const copy_main_items_to_cpmitems_resp = await axios.post('/schedule/copy_main_items_to_cpmitems/', post_data, {
                    headers: {
                        'X-CSRFToken': vm.csrftoken
                    }
                });

                const patch_link_data = {
                    cpm_link: JSON.stringify([]),
                };

                const patch_cpm_link_resp = await axios.put('/schedule/api/active/version_schedule/' + vm.schedule_version_id + '/', patch_link_data);

                // get origin_node_data
                this.origin_node_data_array = await vm.get_origin_node_data();

                // get origin_link_data
                this.origin_link_data_array = await vm.get_origin_link_data();

                vm.node_data_array = JSON.parse(JSON.stringify(vm.origin_node_data_array));
                vm.link_data_array = JSON.parse(JSON.stringify(vm.origin_link_data_array));
    
                const init_test_graph_resp = await vm.init_test_graph();
                const init_test_graph_edit_resp = await vm.init_test_graph_edit();

                vm.import_data_modal.hide();

                LOADER.close();

                Lobibox.notify("success", {
                    title: '系統訊息',
                    msg: '匯入成功',
                    sound: false
                });
            }
            catch(err){
                LOADER.close();
                Lobibox.notify("error", {
                    title: '系統訊息',
                    msg: '匯入失敗，請聯絡工程人員。',
                    sound: false
                });
            }
        },
        async download_backup(){
            const vm = this;
            window.open('/schedule/make_json_scheduleitem/' + vm.schedule_version_id + '/?price_type=rate&ext=scpm');
        },
        async update_item_data(){
            const vm = this;

            try{
                LOADER.open();

                const save_result_resp = await vm.save_result();

                vm.origin_node_data_array = JSON.parse(JSON.stringify(vm.node_data_array));
                let no_start_end_node_data = vm.origin_node_data_array.filter(item => item.key !== "start" && item.key !== "end");
                // let no_start_end_link_data = vm.origin_link_data_array.filter(link => link.to !== 'end' && link.from !== 'start');
                // console.log(save_result_resp);
                if(save_result_resp === true){
                    const img = vm.diagram.makeImage({
                        scale: 1,
                        maxSize: new go.Size(20000, 20000),
                        background: "white",
                        type: "image/jpeg"
                    });

                    const img_data_url = img.src.split('base64,')[1];

                    const post_data = {
                        version_id: vm.schedule_version_id,
                        file: img_data_url,
                    };

                    const copy_main_items_to_cpmitems_resp = await axios.post('/schedule/api/active/version_schedule/release/', post_data, {
                        headers: {
                            'X-CSRFToken': vm.csrftoken
                        }
                    });

                    // get origin_link_data
                    vm.is_cpm_release = true;
                    vm.update_data_modal.hide();

                    LOADER.close();
                    Lobibox.notify("success", {
                        title: '系統訊息',
                        msg: '計算並發佈成功！',
                        sound: false
                    });
                }else{
                    Lobibox.notify("error", {
                        title: '系統訊息',
                        msg: '驗證計算有誤，請重新設定。',
                        sound: false
                    });
                }
            }
            catch(err){
                LOADER.close();
                Lobibox.notify("error", {
                    title: '系統訊息',
                    msg: '發佈失敗，請聯絡工程人員。',
                    sound: false
                });
            }
        },
        auto_fill_cpm_duration(){
            const vm = this;

            return new Promise(async (resolve, reject) => {
                try{
                    const save_result_resp = await vm.save_result(vm.project_total_days);

                    if(save_result_resp === true){
                        vm.auto_count_duration_modal.hide();
                        Lobibox.notify("success", {
                            title: '系統訊息',
                            msg: '已自動填滿工期。',
                            sound: false
                        });
                        vm.update_item_data();
                        resolve(true);
                    }else{
                        Lobibox.notify("error", {
                            title: '系統訊息',
                            msg: '計算錯誤，請聯絡工程人員。',
                            sound: false
                        });
                        resolve(false);
                    }
                }
                catch(err){
                    reject(err);
                }
            });
        },
        update_to_100_progress(){
            const vm = this;

            Lobibox.confirm({
                title: '比率調整確認',
                msg: '是否確認要由系統自動將目前的進度設定《依目前填寫之比率直接調整》至100%？<br><strong>如欲調整則需先儲存變動！</strong>',
                buttons: {
                    accept: {
                        'class': 'lobibox-btn lobibox-btn-yes',
                        text: '儲存並調整',
                        closeOnClick: true
                    },
                    cancel: {
                        'class': 'lobibox-btn lobibox-btn-no',
                        text: '取消',
                        closeOnClick: true
                    },
                },
                callback: async function ($this, type, ev) {
                    if(type=="accept"){
                        try{
                            const save_edited_result_resp = await vm.save_edited_result();

                            const data = {
                                update_to_100_progress: true
                            };
    
                            const version_schedule_resp = await axios.put('/schedule/api/active/version_schedule/' + vm.schedule_version_id + '/', data);
                  
                            Lobibox.notify('success', {
                                title: '系統訊息',
                                msg: '已調整完畢',
                            });

                            vm.reload_preserve_mode();
                        }
                        catch(err){
                            Lobibox.notify('error', {
                                title: '錯誤訊息',
                                msg: '調整未成功，請重新嘗試或聯絡工程人員。',
                            });
                        }
                    }
                }
            });
        },
        change_layout_layered_graph(){
            const vm = this;

            return new Promise((resolve, reject) => {
                let $ = go.GraphObject.make;

                vm.diagram.layout = $(go.LayeredDigraphLayout, {
                    setsPortSpots: false,
                    isOngoing: false,
                    // packOption:  go.LayeredDigraphLayout.PackNone,
                    initializeOption: go.LayeredDigraphLayout.InitDepthFirstOut,
                    layeringOption: go.LayeredDigraphLayout.LayerLongestPathSource,
                    columnSpacing: 20
                });

                resolve(vm.diagram.layout);
            });
        },
        reload_preserve_mode(){
            const vm = this;
            const url = new URL(window.location.href);
            if(vm.is_graph_edit){
                url.searchParams.delete('readonly');
            }
            window.location.href = url.toString();
        },
        apply_edit_mode(editable){
            const vm = this;
            vm.is_graph_edit = Boolean(editable);
            if(vm.diagram){
                vm.diagram.isReadOnly = !vm.is_graph_edit;
                vm.diagram.allowMove = vm.is_graph_edit;
                vm.diagram.allowLink = vm.is_graph_edit;
                vm.diagram.allowRelink = vm.is_graph_edit;
                vm.diagram.allowDelete = vm.is_graph_edit;
                vm.diagram.allowTextEdit = vm.is_graph_edit;
                vm.diagram.allowInsert = vm.is_graph_edit;
                vm.diagram.allowCopy = vm.is_graph_edit;
                vm.diagram.allowHorizontalScroll = true;
                vm.diagram.allowVerticalScroll = true;
                vm.diagram.allowZoom = true;
                vm.diagram.allowSelect = true;
                vm.$nextTick(() => {
                    if(vm.diagram){
                        vm.diagram.requestUpdate();
                    }
                });
            }
        },
        set_critical_only(enabled){
            const vm = this;
            vm.is_critical_only = Boolean(enabled);
            if(!vm.diagram) return;
            vm.diagram.skipsUndoManager = true;
            vm.diagram.nodes.each(function(node){
                const d = node.data || {};
                const isCrit = Boolean(d.critical) || d.key === 'start' || d.key === 'end';
                node.opacity = (vm.is_critical_only && !isCrit) ? 0.16 : 1.0;
            });
            vm.diagram.links.each(function(link){
                const fromData = link.fromNode && link.fromNode.data ? link.fromNode.data : {};
                const toData = link.toNode && link.toNode.data ? link.toNode.data : {};
                const fromCrit = Boolean(fromData.critical) || fromData.key === 'start' || fromData.key === 'end';
                const toCrit = Boolean(toData.critical) || toData.key === 'start' || toData.key === 'end';
                link.opacity = (vm.is_critical_only && !(fromCrit && toCrit)) ? 0.14 : 1.0;
            });
            vm.diagram.skipsUndoManager = false;
        },
        async auto_layout_view(){
            const vm = this;
            if(!vm.diagram) return;
            if(vm.is_graph_edit){
                vm.rerender_node_position();
            } else {
                const prevReadOnly = vm.diagram.isReadOnly;
                vm.diagram.isReadOnly = false;
                try{
                    await vm.change_layout_layered_graph();
                    vm.diagram.zoomToFit();
                } finally {
                    vm.diagram.isReadOnly = prevReadOnly;
                }
            }
        },
        bind_parent_bridge(){
            const vm = this;
            if(vm._parentBridgeBound) return;
            vm._parentBridgeBound = true;
            window.addEventListener('message', function(ev){
                if(ev.origin !== window.location.origin) return;
                const msg = ev.data || {};
                if(msg.type === 'cpm:set-edit-mode'){
                    vm.apply_edit_mode(msg.editable);
                } else if(msg.type === 'cpm:set-critical-only'){
                    vm.set_critical_only(msg.enabled);
                } else if(msg.type === 'cpm:auto-layout'){
                    vm.auto_layout_view();
                } else if(msg.type === 'cpm:zoom' && vm.diagram){
                    if(msg.action === 'in') vm.diagram.commandHandler.increaseZoom();
                    else if(msg.action === 'out') vm.diagram.commandHandler.decreaseZoom();
                    else if(msg.action === 'reset') vm.diagram.commandHandler.resetZoom();
                    else if(msg.action === 'fit') vm.diagram.zoomToFit();
                }
            });
        },
        async rerender_node_position(){
            const vm = this;

            Lobibox.confirm({
                title: '工項位置重新排列確認',
                msg: '是否確認要重新排列工項？<br><strong class="text-danger">注意: 會與原先自行排列方式不同，進行排列優化，且將覆蓋原有排列方式。</strong>',
                buttons: {
                    accept: {
                        'class': 'lobibox-btn lobibox-btn-yes',
                        text: '排列並儲存',
                        closeOnClick: true
                    },
                    cancel: {
                        'class': 'lobibox-btn lobibox-btn-no',
                        text: '取消',
                        closeOnClick: true
                    },
                },
                callback: async function ($this, type, ev) {
                    if(type=="accept"){
                        try{
                            const change_layout_layered_graph_resp = await vm.change_layout_layered_graph();

                            setTimeout(async () => {
                                const save_edited_result_resp = await vm.save_edited_result(); 
                            }, 500);
                  
                            Lobibox.notify('success', {
                                title: '系統訊息',
                                msg: '已調整完畢',
                            });
                        }
                        catch(err){
                            Lobibox.notify('error', {
                                title: '錯誤訊息',
                                msg: '調整未成功，請重新嘗試或聯絡工程人員。',
                            });
                        }
                    }
                }
            });
        },
        create_item_by_EXCEL(id){
            const vm = this;

            const uploader = new plupload.Uploader({
                runtimes: 'html5',
                browse_button: id,
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
                    version_id: vm.schedule_version_id
                },
                init:{
                    FilesAdded:function(up, file){
                        let msg = '';
                        let file_name = file[0].name.split('.');
                        if (file_name[file_name.length-1].toLowerCase() != 'xlsx'){
                            Lobibox.notify('warning', {
                                title: '警告訊息',
                                msg: "此功能只支援Excel的『xlsx』類型檔案",
                            });
                            return false;
                        }
                        let item_num = $('#main_table > tbody').find('tr').length;
                        if (item_num != 1){
                            msg = '您目前有自定義工項，確定要<span style="color:red">【捨棄原設定】</span>，並套用 ' + file[0].name + ' 檔案嗎？';
                        } else {
                            msg = '確定上傳這 ' + file[0].name + ' 檔案嗎?';
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
                    FileUploaded: async function(up, file, res){
                        const json = $.parseJSON(res.response);
                        if (!json['status']){
                            Lobibox.notify('error', {
                                title: '錯誤訊息',
                                msg: json['msg'],
                            });
                        } else {
                            const patch_link_data = {
                                cpm_link: JSON.stringify([]),
                            };

                            const patch_cpm_link_resp = await axios.put('/schedule/api/active/version_schedule/' + vm.schedule_version_id + '/', patch_link_data);

                            Lobibox.notify('success', {
                                title: '系統訊息',
                                msg: '匯入成功，等待頁面重新整理',
                            });
                            vm.reload_preserve_mode();
                        }
                    }
                }
            });
            uploader.init();
        },

        // helper function
        calculate_total_unit_price(){
            return new Promise(async (resolve, reject) => {
                const vm = this;
            
                try{
                    let total_unit_price = 0;
                    let iter = 0;
                    for(let i = 0; i < vm.node_data_array.length; i++){
                        let temp_unit_price = isNaN(parseFloat(vm.node_data_array[i].unit_price)) ? 0 : parseFloat(vm.node_data_array[i].unit_price);
                        total_unit_price += temp_unit_price;
                        iter += 1;
                    }
                    if(iter === vm.node_data_array.length){
                        vm.total_unit_price = total_unit_price;
                        resolve(true);
                    }
                }
                catch(err){
                    reject(err);
                }
            });
        },
        ID() {
            return parseInt(Date.now() * Math.random());
        },
        precision(a) {
            if (!isFinite(a)) return 0;
            let e = 1, p = 0;
            while (Math.round(a * e) / e !== a) { e *= 10; p++; }
            return p;
        },
        fix_float_num(num){
            let f_number = parseFloat(num);
            if(isNaN(f_number)) return 0;
            return parseFloat(f_number.toFixed(4));
        },
    }
});