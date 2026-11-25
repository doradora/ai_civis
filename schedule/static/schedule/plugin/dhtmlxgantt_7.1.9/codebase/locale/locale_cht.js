var gantt_cht = {
    date: {
        month_full: ["1月", "2月", "3月", "4月", "5月", "6月", 
            "7月", "8月", "9月", "10月", "11月", "12月"],
        month_short:["1月", "2月", "3月", "4月", "5月", "6月", 
            "7月", "8月", "9月", "10月", "11月", "12月"],
        day_full: ["週日", "週一", "週二", "週三", "週四",
            "週五", "週六"],
        day_short:  ["週日", "週一", "週二", "週三", "週四",
        "週五", "週六"],
    },
    labels: {
        new_task: "新工項",
        icon_save: "更新",
        icon_cancel: "取消",
        icon_details: "Details",
        icon_edit: "Edit",
        icon_delete: "移除",
        gantt_save_btn: "New Label",
        gantt_cancel_btn: "New Label",
        gantt_delete_btn: "New Label",
        confirm_closing: "",// Your changes will be lost, are you sure?
        confirm_deleting: "您要刪除此項目，刪除後將無法恢復?",
        section_description: "工項名稱",
        section_time: "持續時間",
        section_type: "Type",

        /* grid columns */
        column_wbs: "WBS",
        column_text: "工項名稱",
        column_start_date: "開始時間",
        column_duration: "持續時間",
        column_add: "",

        section_name_dir:"資料夾名稱",
        section_name:"工項名稱",
        section_cp:"是否為要徑",
        section_unit_price_True:"進度(元)",
        section_unit_price_False:"進度(%)",
        section_range:"持續區間",
        section_es:"預訂開始",
        section_ef:"預定結束",

        /* link confirmation */
        link: "連結線",
        confirm_link_deleting: "將被刪除",
        link_start: " (start)",
        link_end: " (end)",

        type_task: "Task",
        type_project: "Project",
        type_milestone: "Milestone",

        minutes: "Minutes",
        hours: "Hours",
        days: "Days",
        weeks: "Week",
        months: "Months",
        years: "Years",

        /* message popup */
        message_ok: "OK",
        message_cancel: "Cancel",

        /* constraints */
        section_constraint: "Constraint",
        constraint_type: "Constraint type",
        constraint_date: "Constraint date",
        asap: "As Soon As Possible",
        alap: "As Late As Possible",
        snet: "Start No Earlier Than",
        snlt: "Start No Later Than",
        fnet: "Finish No Earlier Than",
        fnlt: "Finish No Later Than",
        mso: "Must Start On",
        mfo: "Must Finish On",

        /* resource control */
        resources_filter_placeholder: "type to filter",
        resources_filter_label: "hide empty"
    }
};