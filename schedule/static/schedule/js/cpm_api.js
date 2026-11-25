// dailyreport api
const dailyreportRequest = axios.create({
    baseURL: '/schedule/api/active/',
    params: {
    }
});

// dailyreport api
const dailyreportVersionScheduleRequest = axios.create({
    baseURL: '/schedule/api/active/version_schedule/',
    params: {
    }
});

// get cpm item api
const apiGetCpmItem = data => dailyreportRequest.get('/scheduleitem/', data);

// patch cpm item api
const apiPatchCpmItem = data => dailyreportRequest.patch('/scheduleitem/', data, {
    headers: {
        'X-CSRFToken': CSRFMIDDLEWARETOKEN
    }
});

// post cpm item release api
const apiPostCpmItemRelease = data => dailyreportRequest.patch('/scheduleitem/release', data, {
    headers: {
        'X-CSRFToken': CSRFMIDDLEWARETOKEN
    }
});

// get cpm link api
const apiGetCpmLink = data => dailyreportVersionScheduleRequest.get(data);

// post cpm link api
const apiPostCpmLink = data => dailyreportVersionScheduleRequest.post(data, {
    headers: {
        'X-CSRFToken': CSRFMIDDLEWARETOKEN
    }
});

