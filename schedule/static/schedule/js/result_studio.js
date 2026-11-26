/**
 * Step 3 Composite Progress Result Studio Canvas (Pure Frontend SVG Engine)
 * Supports selectable base layers:
 *   1. 'adm'   : Time-Scaled ADM Arrow Diagram (box / circle3 nodes) + Date-Aligned S-Curve Overlay
 *   2. 'gantt' : Time-Scaled Engineering Gantt Chart (+ optional [ES, LF] float tracks) + Date-Aligned S-Curve Overlay
 *   3. 'pdm'   : GoJS PDM Network Snapshot (adjustable opacity) + Overlaid S-Curve Plot
 * Features:
 *   - Exact day-coordinate alignment between ADM / Gantt timelines, vertical day-interval grid lines,
 *     overlaid S-curve (current + optional ES/LS envelopes + interval % callouts), and bottom interval progress table.
 *   - Interactive pan, wheel zoom, fit-to-view, hover tooltips, critical-path highlight.
 *   - WYSIWYG 2x PNG download, vector SVG download, and print/PDF output.
 */
(function (global) {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const FONT_FAMILY = "'Noto Sans TC', 'Microsoft JhengHei', -apple-system, BlinkMacSystemFont, sans-serif";

    function createSvgEl(tag, attrs) {
        const el = document.createElementNS(SVG_NS, tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                if (attrs[k] !== undefined && attrs[k] !== null) {
                    el.setAttribute(k, String(attrs[k]));
                }
            });
        }
        return el;
    }

    function wrapText(text, maxChars, maxLines) {
        const str = String(text || '').trim();
        if (!str) return ['未命名'];
        const cap = Math.max(2, Math.min(20, maxChars));
        const limit = maxLines || 4;
        const lines = [];
        for (let i = 0; i < str.length; i += cap) {
            lines.push(str.slice(i, i + cap));
            if (lines.length === limit && i + cap < str.length) {
                lines[limit - 1] = lines[limit - 1].slice(0, -1) + '…';
                break;
            }
        }
        return lines;
    }

    function truncateText(text, maxChars) {
        const str = String(text || '').trim();
        if (!str) return '未命名';
        if (str.length <= maxChars) return str;
        return str.slice(0, Math.max(1, maxChars - 1)) + '…';
    }

    function visualCharUnits(text) {
        const str = String(text || '').trim();
        let units = 0;
        for (let i = 0; i < str.length; i++) {
            units += (str.charCodeAt(i) > 255) ? 1.0 : 0.56;
        }
        return units;
    }

    function truncateByVisualUnits(text, maxUnits) {
        const str = String(text || '').trim();
        if (!str) return '未命名';
        if (visualCharUnits(str) <= maxUnits) return str;
        let acc = 0;
        let out = '';
        for (let i = 0; i < str.length; i++) {
            const w = (str.charCodeAt(i) > 255) ? 1.0 : 0.56;
            if (acc + w > maxUnits - 1.0) {
                return out + '…';
            }
            acc += w;
            out += str[i];
        }
        return out;
    }

    function formatPct(val) {
        const num = Number(val || 0);
        if (Math.abs(num - Math.round(num)) < 0.05) {
            return String(Math.round(num)) + '%';
        }
        return num.toFixed(1) + '%';
    }

    function recommendGridStep(totalDuration) {
        const d = Math.max(1, Number(totalDuration) || 1);
        const candidates = [1, 5, 7, 10, 15, 30];
        let best = 10;
        let bestDist = Infinity;
        candidates.forEach(function (s) {
            const count = d / s;
            const dist = Math.abs(count - 12);
            if (count >= 4 && count <= 28 && dist < bestDist) {
                bestDist = dist;
                best = s;
            }
        });
        if (bestDist === Infinity) {
            if (d <= 20) return 1;
            if (d <= 80) return 5;
            if (d <= 160) return 10;
            if (d <= 300) return 15;
            return 30;
        }
        return best;
    }

    class ResultStudioCanvas {
        constructor(options) {
            this.container = options.container;
            this.tooltipEl = options.tooltipEl || null;
            this.zoomLabelEl = options.zoomLabelEl || null;
            this.rawNodes = Array.isArray(options.nodes) ? options.nodes : [];
            this.rawLinks = Array.isArray(options.links) ? options.links : [];
            this.projectTitle = options.projectTitle || '工程預定進度';
            this.targetDuration = Number(options.targetDuration || 0);

            // Base layer & visual settings
            this.baseLayer = options.baseLayer || 'adm'; // 'adm' | 'gantt' | 'pdm'
            this.nodeStyle = options.nodeStyle || 'box'; // 'box' | 'circle3' (ADM)
            this.stretch = Number(options.stretch || 1.1); // 0.6 ~ 3.0 (ADM / Gantt)
            this.fontSize = options.fontSize || 'auto'; // 'auto' | 8..48
            this.gridStep = options.gridStep || 'auto'; // 'auto' | 1 | 5 | 7 | 10 | 15 | 30
            this.criticalOnly = Boolean(options.criticalOnly);
            this.showFloat = false; // Step 3 Gantt shows finalized scheduled bars only (no [ES, LF] float tracks)

            // PDM base image state
            this.pdmImageUrl = options.pdmImageUrl || '';
            this.pdmImageW = Number(options.pdmImageW || 1200);
            this.pdmImageH = Number(options.pdmImageH || 680);
            this.pdmOpacity = options.pdmOpacity !== undefined ? Number(options.pdmOpacity) : 0.78;

            // S-Curve overlay settings
            this.showSCurve = options.showSCurve !== false;
            this.showEnvelope = Boolean(options.showEnvelope);
            this.showPctLabels = options.showPctLabels !== false;
            this.showProgressTable = options.showProgressTable !== false;
            this.scurveOpacity = options.scurveOpacity !== undefined ? Number(options.scurveOpacity) : 0.95;
            this.showHeader = options.showHeader !== false;

            // Detailed label & table display settings
            // labelEveryN: 'auto' | integer >= 1 (how many grid intervals between text labels; last tick ALWAYS shown!)
            this.labelEveryN = options.labelEveryN || 'auto';
            this.tableMergeByLabelStep = options.tableMergeByLabelStep !== false;
            this.dayLabelFormat = options.dayLabelFormat || 'full'; // 'full' ('第N天') | 'short' ('N天') | 'num' ('N')
            this.tableDecimals = options.tableDecimals !== undefined ? Number(options.tableDecimals) : 1;
            this.startDateStr = options.startDateStr || ''; // '' = relative days; 'YYYY-MM-DD' = calendar date mode
            this.durationMode = options.durationMode || 'calendar'; // 'calendar' | 'workday_sun' | 'workday_wknd'
            this.calendarDateFormat = options.calendarDateFormat || 'md'; // 'md' ('03/15') | 'roc' ('115/03/15') | 'ymd' ('2026/03/15')
            this._calendarLookup = null;
            this.lastEffectiveLabelN = 1;
            this.lastGridStep = 5;
            this.lastMaxDay = 1;
            this.onMetaChange = typeof options.onMetaChange === 'function' ? options.onMetaChange : null;

            // Viewport transform state
            this.scale = 1;
            this.tx = 0;
            this.ty = 0;
            this.minScale = 0.2;
            this.maxScale = 3.5;
            this.isPanning = false;
            this.panStart = { x: 0, y: 0, tx: 0, ty: 0 };
            this.contentW = 1120;
            this.contentH = 560;

            this._buildSvg();
            this._bindEvents();
            this.render(true);
        }

        _buildSvg() {
            this.container.innerHTML = '';
            this.svg = createSvgEl('svg', {
                width: '100%',
                height: '100%',
                class: 'sc-adm-svg sc-result-svg'
            });

            const defs = createSvgEl('defs');

            const mkCrit = createSvgEl('marker', {
                id: 'rs-arrow-crit',
                viewBox: '0 0 10 10',
                refX: '9',
                refY: '5',
                markerWidth: '7',
                markerHeight: '7',
                orient: 'auto'
            });
            mkCrit.appendChild(createSvgEl('path', { d: 'M 0 1 L 10 5 L 0 9 z', fill: '#ef4444' }));
            defs.appendChild(mkCrit);

            const mkNorm = createSvgEl('marker', {
                id: 'rs-arrow-norm',
                viewBox: '0 0 10 10',
                refX: '9',
                refY: '5',
                markerWidth: '6.5',
                markerHeight: '6.5',
                orient: 'auto'
            });
            mkNorm.appendChild(createSvgEl('path', { d: 'M 0 1 L 10 5 L 0 9 z', fill: '#1e293b' }));
            defs.appendChild(mkNorm);

            // Subtle blue area gradient for S-curve fill
            const areaGrad = createSvgEl('linearGradient', {
                id: 'rs-scurve-grad',
                x1: '0%', y1: '0%', x2: '0%', y2: '100%'
            });
            areaGrad.appendChild(createSvgEl('stop', { offset: '0%', 'stop-color': '#2563eb', 'stop-opacity': '0.16' }));
            areaGrad.appendChild(createSvgEl('stop', { offset: '100%', 'stop-color': '#2563eb', 'stop-opacity': '0.01' }));
            defs.appendChild(areaGrad);

            this.svg.appendChild(defs);

            this.viewport = createSvgEl('g', { class: 'rs-viewport' });
            this.bgLayer = createSvgEl('g', { class: 'rs-bg-layer' });
            this.gridLayer = createSvgEl('g', { class: 'rs-grid-layer' });
            this.baseLayerGroup = createSvgEl('g', { class: 'rs-base-layer' });
            this.scurveLayer = createSvgEl('g', { class: 'rs-scurve-layer' });
            this.axisLayer = createSvgEl('g', { class: 'rs-axis-layer' });
            this.tableLayer = createSvgEl('g', { class: 'rs-table-layer' });
            this.headerLayer = createSvgEl('g', { class: 'rs-header-layer' });

            this.viewport.appendChild(this.bgLayer);
            this.viewport.appendChild(this.gridLayer);
            this.viewport.appendChild(this.baseLayerGroup);
            this.viewport.appendChild(this.scurveLayer);
            this.viewport.appendChild(this.axisLayer);
            this.viewport.appendChild(this.tableLayer);
            this.viewport.appendChild(this.headerLayer);
            this.svg.appendChild(this.viewport);

            this.container.appendChild(this.svg);
        }

        _prepareTasks() {
            const linkMap = {};
            const predMap = {};
            this.rawLinks.forEach(function (l) {
                const f = String(l.from);
                const t = String(l.to);
                const mode = l.mode || 'FS';
                if (!linkMap[f]) linkMap[f] = [];
                linkMap[f].push({ to: t, mode: mode });
                if (f !== 'start' && t !== 'end') {
                    if (!predMap[t]) predMap[t] = [];
                    predMap[t].push({ from: f, mode: mode });
                }
            });

            const nodeById = {};
            const items = this.rawNodes.map(function (n, idx) {
                const id = String(n.id);
                const curEs0 = Math.max(0, Number(n.es || 0));
                const curEf1 = Math.max(curEs0 + 1, Number(n.ef || (curEs0 + Number(n.duration || 1))));
                const dur = Math.max(1, Number(n.duration || (curEf1 - curEs0)));
                const ls0 = Math.max(0, Number(n.ls !== undefined ? n.ls : curEs0));
                const lf1 = Math.max(ls0 + dur, Number(n.lf !== undefined ? n.lf : curEf1));
                const obj = {
                    index: idx + 1,
                    id: id,
                    name: n.name || '未命名工項',
                    es: curEs0,        // 0-based current scheduled start
                    ef: curEf1,        // 1-based current scheduled end
                    ls: ls0,           // 0-based latest start
                    lf: lf1,           // 1-based latest finish
                    duration: dur,
                    cp: Boolean(n.cp),
                    unit_price: Math.max(0, Number(n.unit_price || 0)),
                    origEs0: 0,
                    links: linkMap[id] || []
                };
                nodeById[id] = obj;
                return obj;
            });

            // Forward pass over CPM DAG to recover true original earliest-start (origEs0)
            // even after non-critical tasks were float-shifted in Step 2 Gantt.
            if (items.length > 0) {
                const hasAnyLink = Object.keys(predMap).length > 0;
                if (hasAnyLink) {
                    const maxIter = Math.min(items.length + 2, 120);
                    for (let iter = 0; iter < maxIter; iter++) {
                        let changed = false;
                        for (let i = 0; i < items.length; i++) {
                            const v = items[i];
                            const preds = predMap[v.id];
                            if (!preds || !preds.length) continue;
                            let best = v.origEs0;
                            for (let j = 0; j < preds.length; j++) {
                                const p = preds[j];
                                const u = nodeById[p.from];
                                if (!u) continue;
                                let cand = 0;
                                if (p.mode === 'SS') {
                                    cand = u.origEs0;
                                } else if (p.mode === 'FF') {
                                    cand = u.origEs0 + u.duration - v.duration;
                                } else if (p.mode === 'SF') {
                                    cand = u.origEs0 - v.duration;
                                } else {
                                    cand = u.origEs0 + u.duration;
                                }
                                if (cand > best) best = cand;
                            }
                            if (best !== v.origEs0) {
                                v.origEs0 = best;
                                changed = true;
                            }
                        }
                        if (!changed) break;
                    }
                    items.forEach(function (t) {
                        t.origEs0 = Math.max(0, Math.min(t.origEs0, t.es, t.ls));
                    });
                } else {
                    items.forEach(function (t) {
                        t.origEs0 = Math.max(0, Math.min(t.es, t.ls));
                    });
                }
            }

            items.forEach(function (t) {
                t.rawEs = t.origEs0 + 1;
                t.rawEf = t.origEs0 + t.duration;
                t.rawLs = t.ls + 1;
                t.rawLf = t.lf;
                t.tf = Math.max(0, t.ls - t.origEs0);
            });

            return items;
        }

        _computeSCurves(tasks, maxDay) {
            const totalDays = Math.max(1, Math.ceil(maxDay));
            const curDaily = new Array(totalDays + 1).fill(0);
            const esDaily = new Array(totalDays + 1).fill(0);
            const lsDaily = new Array(totalDays + 1).fill(0);
            let totalWeight = 0;

            tasks.forEach(function (t) {
                const w = Number(t.unit_price || 0);
                totalWeight += w;
                if (w <= 0) return;

                // Current scheduled range [es, ef] (0-based es, 1-based ef)
                const curS = Math.max(0, Math.floor(t.es));
                const curE = Math.min(totalDays, Math.max(curS + 1, Math.ceil(t.ef)));
                const curLen = Math.max(1, curE - curS);
                const curRate = w / curLen;
                for (let d = curS + 1; d <= curE; d++) {
                    curDaily[d] += curRate;
                }

                // Earliest-start envelope [origEs0, origEs0 + duration]
                const esS = Math.max(0, Math.floor(t.origEs0));
                const esE = Math.min(totalDays, Math.max(esS + 1, Math.ceil(t.origEs0 + t.duration)));
                const esLen = Math.max(1, esE - esS);
                const esRate = w / esLen;
                for (let d = esS + 1; d <= esE; d++) {
                    esDaily[d] += esRate;
                }

                // Latest-start envelope [ls, lf]
                const lsS = Math.max(0, Math.floor(t.ls));
                const lsE = Math.min(totalDays, Math.max(lsS + 1, Math.ceil(t.lf)));
                const lsLen = Math.max(1, lsE - lsS);
                const lsRate = w / lsLen;
                for (let d = lsS + 1; d <= lsE; d++) {
                    lsDaily[d] += lsRate;
                }
            });

            const norm = totalWeight > 0 ? (100 / totalWeight) : 0;
            const curCum = new Array(totalDays + 1).fill(0);
            const esCum = new Array(totalDays + 1).fill(0);
            const lsCum = new Array(totalDays + 1).fill(0);

            for (let d = 1; d <= totalDays; d++) {
                curCum[d] = Math.min(100, curCum[d - 1] + curDaily[d] * norm);
                esCum[d] = Math.min(100, esCum[d - 1] + esDaily[d] * norm);
                lsCum[d] = Math.min(100, lsCum[d - 1] + lsDaily[d] * norm);
            }
            if (totalWeight > 0) {
                curCum[totalDays] = 100;
                esCum[totalDays] = 100;
                lsCum[totalDays] = 100;
            }

            return {
                totalDays: totalDays,
                totalWeight: totalWeight,
                curCum: curCum,
                esCum: esCum,
                lsCum: lsCum
            };
        }

        _buildTicks(minDay, maxDay, step) {
            const ticks = [];
            const start = Math.floor(minDay);
            const end = Math.ceil(maxDay);
            for (let d = start; d <= end; d += step) {
                ticks.push(d);
            }
            if (ticks.length === 0 || ticks[ticks.length - 1] < end) {
                ticks.push(end);
            }
            this.lastGridStep = step;
            this.lastMaxDay = end;
            this._calendarLookup = this._buildCalendarLookup(end);
            return ticks;
        }

        _buildCalendarLookup(maxDay) {
            const raw = String(this.startDateStr || '').trim();
            if (!raw) return null;
            const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
            if (!m) return null;
            const y = parseInt(m[1], 10);
            const mo = parseInt(m[2], 10) - 1;
            const d = parseInt(m[3], 10);
            const startObj = new Date(y, mo, d);
            if (isNaN(startObj.getTime())) return null;

            const mode = this.durationMode || 'calendar';
            function isCounted(dt) {
                const dow = dt.getDay(); // 0=Sun, 6=Sat
                if (mode === 'workday_sun') return dow !== 0;
                if (mode === 'workday_wknd') return dow !== 0 && dow !== 6;
                return true;
            }

            const total = Math.max(1, Math.ceil(maxDay || 1));
            const arr = new Array(total + 1);
            arr[0] = new Date(y, mo, d);

            const cur = new Date(y, mo, d);
            for (let idx = 1; idx <= total; idx++) {
                while (!isCounted(cur)) {
                    cur.setDate(cur.getDate() + 1);
                }
                arr[idx] = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate());
                cur.setDate(cur.getDate() + 1);
            }
            return arr;
        }

        _formatCalendarDate(dt, fmt) {
            if (!dt) return '';
            const y = dt.getFullYear();
            const mm = String(dt.getMonth() + 1).padStart(2, '0');
            const dd = String(dt.getDate()).padStart(2, '0');
            if (fmt === 'roc') return String(y - 1911) + '/' + mm + '/' + dd;
            if (fmt === 'ymd') return String(y) + '/' + mm + '/' + dd;
            return mm + '/' + dd;
        }

        _getDurationModeLabel() {
            if (this.durationMode === 'workday_sun') return '工作天（不含週日）';
            if (this.durationMode === 'workday_wknd') return '工作天（不含六日）';
            return '日曆天';
        }

        _getDateForDay(day) {
            if (!this._calendarLookup || !this._calendarLookup.length) return null;
            const idx = Math.max(0, Math.min(this._calendarLookup.length - 1, Math.round(day)));
            return this._calendarLookup[idx] || null;
        }

        _buildSubtitleDurationText(maxDay) {
            if (this._calendarLookup) {
                const sDt = this._getDateForDay(0);
                const eDt = this._getDateForDay(maxDay);
                const fmt = (this.calendarDateFormat === 'ymd') ? 'ymd' : 'roc';
                return '開工 ' + this._formatCalendarDate(sDt, fmt) +
                    ' ～ 預定完工 ' + this._formatCalendarDate(eDt, fmt) +
                    '（' + maxDay + ' ' + this._getDurationModeLabel() + '）';
            }
            return '總工期 ' + maxDay + ' 天';
        }

        _formatDayLabel(day, preferCompact) {
            if (this._calendarLookup) {
                const dt = this._getDateForDay(day);
                if (dt) {
                    return this._formatCalendarDate(dt, this.calendarDateFormat || 'md');
                }
            }
            const dStr = String(Math.round(day));
            if (this.dayLabelFormat === 'num') return dStr;
            if (this.dayLabelFormat === 'short' || preferCompact) return dStr + '天';
            return '第' + dStr + '天';
        }

        /**
         * Select which tick indices display text labels (X-axis day text, S-curve % badges,
         * and bottom progress table columns) based on labelEveryN ('auto' or integer N).
         * Guarantees: index 0 (start) and last index (maxDay) are ALWAYS displayed!
         */
        _selectDisplayedTickIndices(ticks, xOf, axisFontSize) {
            const M = ticks.length - 1;
            if (M <= 0) {
                this.lastEffectiveLabelN = 1;
                return [0];
            }

            const sampleLabel = this._formatDayLabel(ticks[M], false);
            const estLabelW = Math.max(30, visualCharUnits(sampleLabel) * axisFontSize * 1.08 + 12);
            const totalW = Math.max(1, xOf(ticks[M]) - xOf(ticks[0]));
            const avgIntervalW = totalW / M;

            let stride;
            if (this.labelEveryN === 'auto' || !this.labelEveryN) {
                // Ensure both day text labels AND bottom table cells (~42px) have comfortable breathing room
                const minNeedW = Math.max(estLabelW, Math.round(axisFontSize * 3.4));
                stride = Math.max(1, Math.ceil(minNeedW / Math.max(1, avgIntervalW)));
            } else {
                stride = Math.max(1, Math.min(M, parseInt(this.labelEveryN, 10) || 1));
            }
            this.lastEffectiveLabelN = stride;

            const indices = [0];
            for (let i = stride; i < M; i += stride) {
                indices.push(i);
            }

            // Always include the very last tick (M). If the penultimate shown tick is so close
            // to M that its label would collide with the last tick's label, drop the penultimate one
            // so the LAST cell / tick ALWAYS displays cleanly!
            if (indices.length > 1) {
                const prevIdx = indices[indices.length - 1];
                const gapToLast = xOf(ticks[M]) - xOf(ticks[prevIdx]);
                const minLastGap = (this.labelEveryN === 'auto')
                    ? Math.max(estLabelW * 0.85, 28)
                    : Math.min(estLabelW * 0.72, avgIntervalW * Math.max(0.55, stride * 0.45));
                if (gapToLast < minLastGap) {
                    indices.pop();
                }
            }
            if (indices[indices.length - 1] !== M) {
                indices.push(M);
            }

            if (this.onMetaChange) {
                const sDt = this._getDateForDay(0);
                const eDt = this._getDateForDay(this.lastMaxDay);
                const summaryFmt = (this.calendarDateFormat === 'ymd') ? 'ymd' : 'roc';
                this.onMetaChange({
                    effectiveLabelN: stride,
                    step: this.lastGridStep,
                    gridStep: this.lastGridStep,
                    maxDay: this.lastMaxDay,
                    totalIntervals: M,
                    displayedCount: indices.length - 1,
                    hasCalendarDate: Boolean(this._calendarLookup),
                    startDateText: sDt ? this._formatCalendarDate(sDt, summaryFmt) : '',
                    endDateText: eDt ? this._formatCalendarDate(eDt, summaryFmt) : '',
                    durationModeLabel: this._getDurationModeLabel()
                });
            }
            return indices;
        }

        _renderHeader(titleX, contentW, uiScale, subtitle, legendItems) {
            if (!this.showHeader) return 0;
            const headerH = Math.round(64 * uiScale);
            const titleFont = Math.round(18 * uiScale);
            const subFont = Math.round(11.5 * uiScale);

            const baseLabelMap = {
                adm: 'ADM 箭線圖',
                gantt: '甘特圖',
                pdm: 'PDM 邏輯網圖'
            };
            const baseLabel = baseLabelMap[this.baseLayer] || '進度圖';
            const titleStr = (this.projectTitle ? this.projectTitle + ' — ' : '')
                + '預定進度成果圖（' + baseLabel + (this.showSCurve ? ' + S 曲線' : '') + '）';

            // Soft header backdrop bar
            this.headerLayer.appendChild(createSvgEl('rect', {
                x: 0, y: 0, width: contentW, height: headerH,
                fill: '#f8fafc'
            }));
            this.headerLayer.appendChild(createSvgEl('line', {
                x1: 0, y1: headerH, x2: contentW, y2: headerH,
                stroke: '#e2e8f0', 'stroke-width': '1.2'
            }));

            const titleEl = createSvgEl('text', {
                x: titleX,
                y: Math.round(28 * uiScale),
                'font-size': String(titleFont),
                'font-weight': '800',
                'font-family': FONT_FAMILY,
                fill: '#0f172a'
            });
            titleEl.textContent = titleStr;
            this.headerLayer.appendChild(titleEl);

            // Subtitle + inline legend on second line of header
            const subY = Math.round(50 * uiScale);
            if (subtitle) {
                const subEl = createSvgEl('text', {
                    x: titleX,
                    y: subY,
                    'font-size': String(subFont),
                    'font-weight': '600',
                    'font-family': FONT_FAMILY,
                    fill: '#64748b'
                });
                subEl.textContent = subtitle;
                this.headerLayer.appendChild(subEl);
            }

            // Right-aligned compact legend
            if (legendItems && legendItems.length) {
                let lx = contentW - Math.round(28 * uiScale);
                const legFont = Math.round(11 * uiScale);
                for (let i = legendItems.length - 1; i >= 0; i--) {
                    const item = legendItems[i];
                    const approxTextW = item.label.length * legFont * 0.95;
                    const swatchW = Math.round(18 * uiScale);
                    const gap = Math.round(6 * uiScale);
                    const itemX = lx - approxTextW - swatchW - gap;

                    const txt = createSvgEl('text', {
                        x: lx,
                        y: subY,
                        'text-anchor': 'end',
                        'font-size': String(legFont),
                        'font-weight': '600',
                        'font-family': FONT_FAMILY,
                        fill: '#334155'
                    });
                    txt.textContent = item.label;
                    this.headerLayer.appendChild(txt);

                    if (item.kind === 'line') {
                        this.headerLayer.appendChild(createSvgEl('line', {
                            x1: itemX,
                            y1: subY - Math.round(4 * uiScale),
                            x2: itemX + swatchW,
                            y2: subY - Math.round(4 * uiScale),
                            stroke: item.color,
                            'stroke-width': String((item.width || 2.5) * uiScale),
                            'stroke-dasharray': item.dash || ''
                        }));
                    } else {
                        this.headerLayer.appendChild(createSvgEl('rect', {
                            x: itemX,
                            y: subY - Math.round(9 * uiScale),
                            width: swatchW,
                            height: Math.round(9 * uiScale),
                            rx: '2',
                            fill: item.color,
                            stroke: item.stroke || 'none',
                            'stroke-width': item.stroke ? '1.2' : '0'
                        }));
                    }

                    lx = itemX - Math.round(16 * uiScale);
                }
            }

            return headerH;
        }

        _renderSCurveOverlay(cfg) {
            if (!this.showSCurve) return;
            const self = this;
            const plotLeft = cfg.plotLeft;
            const plotRight = cfg.plotRight;
            const plotTop = cfg.plotTop;
            const plotBot = cfg.plotBot;
            const xOf = cfg.xOf;
            const ticks = cfg.ticks;
            const curves = cfg.curves;
            const uiScale = cfg.uiScale;
            const axisFontSize = cfg.axisFontSize;

            const plotH = Math.max(60, plotBot - plotTop);
            const yOfPct = function (pct) {
                const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
                return plotBot - (clamped / 100) * plotH;
            };

            // 1. Horizontal % guide lines & Right-side Percentage Y-Axis (0% - 100%)
            const pctTicks = [0, 20, 40, 60, 80, 100];
            this.axisLayer.appendChild(createSvgEl('line', {
                x1: plotRight, y1: plotTop, x2: plotRight, y2: plotBot,
                stroke: '#2563eb', 'stroke-width': '1.6', 'stroke-opacity': '0.75'
            }));

            pctTicks.forEach(function (p) {
                const py = yOfPct(p);
                if (p > 0 && p < 100) {
                    self.scurveLayer.appendChild(createSvgEl('line', {
                        x1: plotLeft, y1: py, x2: plotRight, y2: py,
                        stroke: '#93c5fd', 'stroke-width': '1', 'stroke-dasharray': '3 5',
                        'stroke-opacity': '0.5'
                    }));
                }
                self.axisLayer.appendChild(createSvgEl('line', {
                    x1: plotRight, y1: py, x2: plotRight + 6, y2: py,
                    stroke: '#2563eb', 'stroke-width': '1.4'
                }));
                const lbl = createSvgEl('text', {
                    x: plotRight + 10,
                    y: py + Math.round(axisFontSize * 0.36),
                    'text-anchor': 'start',
                    'font-size': String(axisFontSize),
                    'font-weight': '700',
                    'font-family': FONT_FAMILY,
                    fill: '#1d4ed8'
                });
                lbl.textContent = p + '%';
                self.axisLayer.appendChild(lbl);
            });

            // Right axis title
            const yTitle = createSvgEl('text', {
                x: plotRight + Math.round(12 * uiScale),
                y: plotTop - Math.round(10 * uiScale),
                'text-anchor': 'start',
                'font-size': String(Math.max(10, Math.round(axisFontSize * 0.92))),
                'font-weight': '700',
                'font-family': FONT_FAMILY,
                fill: '#1d4ed8'
            });
            yTitle.textContent = '累計進度';
            this.axisLayer.appendChild(yTitle);

            const overlayG = createSvgEl('g', {
                opacity: String(this.scurveOpacity),
                class: 'rs-scurve-paths'
            });

            // Helper to build polyline points string for day 0..totalDays
            function buildPts(cumArr) {
                const pts = [];
                for (let d = 0; d <= curves.totalDays; d++) {
                    pts.push(xOf(d).toFixed(1) + ',' + yOfPct(cumArr[d]).toFixed(1));
                }
                return pts.join(' ');
            }

            // 2. Subtle area fill beneath main S-curve (only light so base layer stays super clear)
            const areaPts = [xOf(0).toFixed(1) + ',' + plotBot.toFixed(1)]
                .concat((function () {
                    const arr = [];
                    for (let d = 0; d <= curves.totalDays; d++) {
                        arr.push(xOf(d).toFixed(1) + ',' + yOfPct(curves.curCum[d]).toFixed(1));
                    }
                    return arr;
                })())
                .concat([xOf(curves.totalDays).toFixed(1) + ',' + plotBot.toFixed(1)])
                .join(' ');
            overlayG.appendChild(createSvgEl('polygon', {
                points: areaPts,
                fill: 'url(#rs-scurve-grad)',
                'pointer-events': 'none'
            }));

            // 3. Optional ES (Earliest) & LS (Latest) envelope curves
            if (this.showEnvelope) {
                overlayG.appendChild(createSvgEl('polyline', {
                    points: buildPts(curves.esCum),
                    fill: 'none',
                    stroke: '#ffffff',
                    'stroke-width': String((3.6 * uiScale).toFixed(1)),
                    'stroke-opacity': '0.65',
                    'pointer-events': 'none'
                }));
                overlayG.appendChild(createSvgEl('polyline', {
                    points: buildPts(curves.esCum),
                    fill: 'none',
                    stroke: '#10b981',
                    'stroke-width': String((2.1 * uiScale).toFixed(1)),
                    'stroke-dasharray': '7 4',
                    'stroke-linecap': 'round',
                    'stroke-linejoin': 'round',
                    'pointer-events': 'none'
                }));

                overlayG.appendChild(createSvgEl('polyline', {
                    points: buildPts(curves.lsCum),
                    fill: 'none',
                    stroke: '#ffffff',
                    'stroke-width': String((3.6 * uiScale).toFixed(1)),
                    'stroke-opacity': '0.65',
                    'pointer-events': 'none'
                }));
                overlayG.appendChild(createSvgEl('polyline', {
                    points: buildPts(curves.lsCum),
                    fill: 'none',
                    stroke: '#f59e0b',
                    'stroke-width': String((2.1 * uiScale).toFixed(1)),
                    'stroke-dasharray': '7 4',
                    'stroke-linecap': 'round',
                    'stroke-linejoin': 'round',
                    'pointer-events': 'none'
                }));
            }

            // 4. Main Current Planned S-Curve (with crisp white halo so it reads sharply over red/black base lines)
            const curPtsStr = buildPts(curves.curCum);
            overlayG.appendChild(createSvgEl('polyline', {
                points: curPtsStr,
                fill: 'none',
                stroke: '#ffffff',
                'stroke-width': String((6.2 * uiScale).toFixed(1)),
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
                'stroke-opacity': '0.88',
                'pointer-events': 'none'
            }));
            overlayG.appendChild(createSvgEl('polyline', {
                points: curPtsStr,
                fill: 'none',
                stroke: '#2563eb',
                'stroke-width': String((3.1 * uiScale).toFixed(1)),
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
                'pointer-events': 'none'
            }));

            // 5. Milestone dots & % badges aligned strictly to day grid ticks!
            //    Dots appear on every grid tick; % pill badges follow displayedIndices (last tick ALWAYS shown!)
            const badgeFont = Math.max(9.5, Math.round(axisFontSize * 0.92));
            const dotR = Math.max(3.2, Math.round(4.0 * uiScale));
            const displayedSet = new Set(cfg.displayedIndices || ticks.map(function (_, i) { return i; }));
            const lastTickIdx = ticks.length - 1;
            let lastBadgeX = -9999;
            const minBadgeGap = Math.round(38 * uiScale);

            ticks.forEach(function (d, idx) {
                const dayIdx = Math.max(0, Math.min(curves.totalDays, Math.round(d)));
                const pct = curves.curCum[dayIdx] || 0;
                const px = xOf(dayIdx);
                const py = yOfPct(pct);
                const isDisplayed = displayedSet.has(idx);
                const isLast = idx === lastTickIdx;

                const ptGroup = createSvgEl('g', { style: 'cursor: pointer;' });
                ptGroup.appendChild(createSvgEl('circle', {
                    cx: px, cy: py, r: String(dotR + 4),
                    fill: 'transparent'
                }));
                ptGroup.appendChild(createSvgEl('circle', {
                    cx: px, cy: py, r: String(isDisplayed || isLast ? dotR : Math.max(2.2, dotR * 0.65)),
                    fill: '#ffffff',
                    stroke: '#2563eb',
                    'stroke-width': String(((isDisplayed || isLast ? 2.2 : 1.5) * uiScale).toFixed(1))
                }));

                // Show % callout pill on displayed intervals (and ALWAYS on the very last point!)
                if (self.showPctLabels && idx > 0 && (isLast || (isDisplayed && (px - lastBadgeX >= minBadgeGap)))) {
                    lastBadgeX = px;
                    const labelStr = formatPct(pct);
                    const pillW = Math.max(Math.round(36 * uiScale), labelStr.length * badgeFont * 0.72 + Math.round(10 * uiScale));
                    const pillH = Math.round(18 * uiScale);
                    let pillX = px - pillW / 2;
                    let pillY = py - dotR - pillH - Math.round(5 * uiScale);
                    if (pillY < plotTop + 2) {
                        pillY = py + dotR + Math.round(5 * uiScale);
                    }
                    if (pillX + pillW > plotRight - 2) {
                        pillX = plotRight - pillW - 2;
                    }

                    ptGroup.appendChild(createSvgEl('rect', {
                        x: pillX, y: pillY, width: pillW, height: pillH,
                        rx: String(Math.round(5 * uiScale)),
                        fill: 'rgba(255, 255, 255, 0.94)',
                        stroke: isLast ? '#2563eb' : '#93c5fd',
                        'stroke-width': isLast ? '1.4' : '1.1'
                    }));
                    const txt = createSvgEl('text', {
                        x: pillX + pillW / 2,
                        y: pillY + Math.round(pillH * 0.72),
                        'text-anchor': 'middle',
                        'font-size': String(badgeFont),
                        'font-weight': '700',
                        'font-family': FONT_FAMILY,
                        fill: '#1e40af'
                    });
                    txt.textContent = labelStr;
                    ptGroup.appendChild(txt);
                }

                // Tooltip on S-curve tick hover
                const prevDay = idx > 0 ? Math.max(0, Math.min(curves.totalDays, Math.round(ticks[idx - 1]))) : 0;
                const intervalDelta = Math.max(0, pct - (curves.curCum[prevDay] || 0));
                ptGroup.addEventListener('mouseenter', function (ev) {
                    self._showSCurveTooltip(ev, dayIdx, pct, intervalDelta, curves.esCum[dayIdx] || 0, curves.lsCum[dayIdx] || 0);
                });
                ptGroup.addEventListener('mousemove', function (ev) { self._moveTooltip(ev); });
                ptGroup.addEventListener('mouseleave', function () { self._hideTooltip(); });

                overlayG.appendChild(ptGroup);
            });

            this.scurveLayer.appendChild(overlayG);
        }

        _renderProgressTable(cfg) {
            if (!this.showSCurve || !this.showProgressTable) return 0;
            const ticks = cfg.ticks;
            if (!ticks || ticks.length < 2) return 0;

            const self = this;
            const xOf = cfg.xOf;
            const curves = cfg.curves;
            const uiScale = cfg.uiScale;
            const rowH = Math.round(25 * uiScale);
            const tableTop = cfg.tableTop;
            const plotLeft = cfg.plotLeft;
            const plotRight = cfg.plotRight;
            const labelLeft = cfg.labelLeft;
            const baseCellFont = Math.max(9.5, Math.round(cfg.axisFontSize * 0.88));
            const dec = (this.tableDecimals === 0) ? 0 : 1;

            // When tableMergeByLabelStep is ON, columns align to displayedIndices (matching displayed text cadence
            // and ensuring the LAST column ending at maxDay is always wide and readable).
            // When OFF, every single gridStep interval gets its own column and still ALWAYS displays auto-fitted numbers!
            const groupIndices = (this.tableMergeByLabelStep && cfg.displayedIndices && cfg.displayedIndices.length >= 2)
                ? cfg.displayedIndices
                : ticks.map(function (_, i) { return i; });

            const rows = [
                { title: '區間進度 (%)', bg: '#f8fafc', color: '#334155', kind: 'delta' },
                { title: '累計進度 (%)', bg: '#eff6ff', color: '#1d4ed8', kind: 'cum' }
            ];
            const totalH = rows.length * rowH;

            // Row backgrounds & left headers
            rows.forEach(function (r, rIdx) {
                const ry = tableTop + rIdx * rowH;
                self.tableLayer.appendChild(createSvgEl('rect', {
                    x: labelLeft, y: ry,
                    width: plotRight - labelLeft, height: rowH,
                    fill: r.bg, stroke: '#cbd5e1', 'stroke-width': '1'
                }));
                const lbl = createSvgEl('text', {
                    x: plotLeft - Math.round(8 * uiScale),
                    y: ry + Math.round(rowH * 0.68),
                    'text-anchor': 'end',
                    'font-size': String(baseCellFont),
                    'font-weight': '700',
                    'font-family': FONT_FAMILY,
                    fill: r.color
                });
                lbl.textContent = r.title;
                self.tableLayer.appendChild(lbl);
            });

            // Vertical divider between row header and first interval
            this.tableLayer.appendChild(createSvgEl('line', {
                x1: plotLeft, y1: tableTop, x2: plotLeft, y2: tableTop + totalH,
                stroke: '#94a3b8', 'stroke-width': '1.2'
            }));

            // Faint sub-interval hairlines for every underlying gridStep tick
            const groupIdxSet = new Set(groupIndices);
            for (let k = 1; k < ticks.length - 1; k++) {
                if (groupIdxSet.has(k)) continue;
                const sx = xOf(ticks[k]);
                this.tableLayer.appendChild(createSvgEl('line', {
                    x1: sx, y1: tableTop, x2: sx, y2: tableTop + totalH,
                    stroke: '#e2e8f0', 'stroke-width': '0.8', 'stroke-dasharray': '2 3'
                }));
            }

            // Displayed interval columns: ALWAYS render data (auto-fitting font size so cells are never blank!)
            for (let g = 1; g < groupIndices.length; g++) {
                const idx0 = groupIndices[g - 1];
                const idx1 = groupIndices[g];
                const d0 = Math.max(0, Math.min(curves.totalDays, Math.round(ticks[idx0])));
                const d1 = Math.max(0, Math.min(curves.totalDays, Math.round(ticks[idx1])));
                const x0 = xOf(d0);
                const x1 = xOf(d1);
                const colW = Math.max(1, x1 - x0);
                const midX = (x0 + x1) / 2;
                const isLastCol = (g === groupIndices.length - 1);

                this.tableLayer.appendChild(createSvgEl('line', {
                    x1: x1, y1: tableTop, x2: x1, y2: tableTop + totalH,
                    stroke: isLastCol ? '#64748b' : '#94a3b8',
                    'stroke-width': isLastCol ? '1.3' : '1.05'
                }));

                const deltaVal = Math.max(0, (curves.curCum[d1] || 0) - (curves.curCum[d0] || 0));
                const cumVal = curves.curCum[d1] || 0;

                // Omit redundant '%' inside very tight cells (row header already states '(%)')
                const includePctSign = colW >= Math.round(42 * uiScale);
                const dStr = deltaVal.toFixed(dec) + (includePctSign ? '%' : '');
                const cStr = (Math.abs(cumVal - 100) < 0.05 ? '100' : cumVal.toFixed(dec)) + (includePctSign ? '%' : '');

                const longestLen = Math.max(dStr.length, cStr.length);
                const fittedFont = Math.max(
                    7,
                    Math.min(baseCellFont, Number(((colW - 4) / Math.max(1, longestLen * 0.62)).toFixed(1)))
                );
                const textOffsetY = Math.round(rowH * 0.5 + fittedFont * 0.36);

                const dTxt = createSvgEl('text', {
                    x: midX, y: tableTop + textOffsetY,
                    'text-anchor': 'middle',
                    'font-size': String(fittedFont),
                    'font-weight': '600',
                    'font-family': FONT_FAMILY,
                    fill: '#334155'
                });
                dTxt.textContent = dStr;
                this.tableLayer.appendChild(dTxt);

                const cTxt = createSvgEl('text', {
                    x: midX, y: tableTop + rowH + textOffsetY,
                    'text-anchor': 'middle',
                    'font-size': String(fittedFont),
                    'font-weight': '700',
                    'font-family': FONT_FAMILY,
                    fill: isLastCol ? '#1e3a8a' : '#1d4ed8'
                });
                cTxt.textContent = cStr;
                this.tableLayer.appendChild(cTxt);
            }

            return totalH;
        }

        render(autoFit) {
            this.bgLayer.innerHTML = '';
            this.gridLayer.innerHTML = '';
            this.baseLayerGroup.innerHTML = '';
            this.scurveLayer.innerHTML = '';
            this.axisLayer.innerHTML = '';
            this.tableLayer.innerHTML = '';
            this.headerLayer.innerHTML = '';

            const tasks = this._prepareTasks();
            if (!tasks.length && this.baseLayer !== 'pdm') {
                const empty = createSvgEl('text', {
                    x: 320, y: 160, 'text-anchor': 'middle', 'font-size': '15',
                    'font-family': FONT_FAMILY, fill: '#64748b'
                });
                empty.textContent = '目前尚無工項資料可繪製進度成果圖';
                this.axisLayer.appendChild(empty);
                return;
            }

            if (this.baseLayer === 'gantt') {
                this._renderGanttMode(tasks);
            } else if (this.baseLayer === 'pdm') {
                this._renderPdmMode(tasks);
            } else {
                this._renderAdmMode(tasks);
            }

            this._applyCriticalHighlight();
            const self = this;
            if (autoFit) {
                requestAnimationFrame(function () {
                    self.fitToView();
                });
            } else {
                this._applyTransform();
            }
        }

        _renderAdmMode(tasks) {
            const self = this;

            // 1. Greedy lane assignment: critical path on top, non-critical below
            const cpTasks = tasks.filter(function (t) { return t.cp; }).sort(function (a, b) { return a.es - b.es; });
            const otherTasks = tasks.filter(function (t) { return !t.cp; }).sort(function (a, b) { return a.es - b.es; });
            const lanes = [];
            const taskPos = {};

            cpTasks.forEach(function (t) {
                let placed = false;
                for (let i = 0; i < lanes.length; i++) {
                    if (t.es >= lanes[i]) {
                        lanes[i] = t.ef;
                        taskPos[t.id] = { lane: i, data: t };
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    lanes.push(t.ef);
                    taskPos[t.id] = { lane: lanes.length - 1, data: t };
                }
            });

            const cpLaneCount = lanes.length;
            otherTasks.forEach(function (t) {
                let placed = false;
                for (let i = cpLaneCount; i < lanes.length; i++) {
                    if (t.es >= lanes[i]) {
                        lanes[i] = t.ef;
                        taskPos[t.id] = { lane: i, data: t };
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    lanes.push(t.ef);
                    taskPos[t.id] = { lane: lanes.length - 1, data: t };
                }
            });

            const numLanes = Math.max(1, lanes.length);
            const minDay = 0;
            const maxTaskDay = Math.max.apply(null, tasks.map(function (t) { return t.ef; }));
            const maxDay = Math.max(1, maxTaskDay, this.targetDuration || 0);
            const totalDuration = Math.max(1, maxDay - minDay);
            const midTimeline = minDay + totalDuration / 2;

            const step = (this.gridStep === 'auto')
                ? recommendGridStep(totalDuration)
                : Math.max(1, parseInt(this.gridStep, 10) || 5);

            const rect = this.container.getBoundingClientRect();
            const viewW = Math.max(980, rect.width || 1280);
            const viewH = Math.max(460, rect.height || 580);

            const recStep = recommendGridStep(totalDuration);
            const approxFontForPad = (this.fontSize === 'auto') ? 13 : Number(this.fontSize || 13);
            const padScale = Math.max(1.0, approxFontForPad / 12);
            const padLeft = this.showSCurve && this.showProgressTable ? Math.round(118 * padScale) : Math.round(64 * padScale);
            const padRight = this.showSCurve ? Math.round(88 * padScale) : Math.round(64 * padScale);
            const fitBaseW = Math.max(820, viewW - padLeft - padRight);
            const stepRatio = recStep / step;
            const stepFactor = stepRatio >= 1
                ? Math.min(4.2, Math.pow(stepRatio, 0.55))
                : Math.max(0.55, Math.pow(stepRatio, 0.45));
            const targetGraphW = Math.max(460, fitBaseW * stepFactor * this.stretch);
            const pxPerDay = targetGraphW / totalDuration;
            const xOf = function (day) { return padLeft + (day - minDay) * pxPerDay; };

            const approxScale = Math.min((viewW - 40) / (targetGraphW + padLeft + padRight), (viewH - 40) / (numLanes * 105 + 220));
            const autoBoost = approxScale < 0.9 ? Math.min(2.0, 0.95 / Math.max(0.42, approxScale)) : 1.0;

            const fontSize = (this.fontSize === 'auto')
                ? Number((12.5 * autoBoost).toFixed(1))
                : Number(this.fontSize || 13);
            const uiScale = Math.max(1.0, fontSize / 12);
            const isCircle3 = this.nodeStyle === 'circle3';
            const nodeR = Math.round((isCircle3 ? 23 : 16) * uiScale);
            const boxW = Math.round(34 * uiScale);
            const cellH = Math.round(16 * uiScale);
            const boxH = cellH * 2;
            const boxFontSize = Math.round(10.5 * uiScale);
            const axisFontSize = Math.round(11.5 * uiScale);

            const headerH = this.showHeader ? Math.round(64 * uiScale) : 0;
            const padTop = headerH + Math.round(48 * uiScale);

            const lineH = Math.round(fontSize * 1.32);
            const charPx = fontSize * 1.05;
            const laneMaxLines = new Array(numLanes).fill(1);
            const wrappedMap = {};

            Object.keys(taskPos).forEach(function (id) {
                const info = taskPos[id];
                const t = info.data;
                const spanPx = Math.max(48, xOf(t.ef) - xOf(t.es) - nodeR * 2 - 4);
                const maxChars = Math.max(3, Math.floor(spanPx / charPx));
                const lines = wrapText(t.name, maxChars, 4);
                wrappedMap[id] = lines;
                if (lines.length > laneMaxLines[info.lane]) {
                    laneMaxLines[info.lane] = lines.length;
                }
            });

            const laneYs = [];
            let curY = padTop + Math.round(12 * uiScale);
            for (let l = 0; l < numLanes; l++) {
                const nodeTopNeed = isCircle3 ? (nodeR + 12) : (nodeR + boxH + 14);
                const topSpace = Math.max(laneMaxLines[l] * lineH + Math.round(22 * uiScale), nodeTopNeed);
                const y = curY + topSpace;
                laneYs.push(y);
                curY = y + Math.round((isCircle3 ? 40 : 34) * uiScale);
            }
            const yOf = function (lane) { return laneYs[lane]; };

            const axisTopY = padTop - Math.round(16 * uiScale);
            const axisBotY = Math.max(curY + Math.round(10 * uiScale), axisTopY + Math.round(240 * uiScale));
            const contentW = padLeft + targetGraphW + padRight;

            const ticks = this._buildTicks(minDay, maxDay, step);
            const displayedIndices = this._selectDisplayedTickIndices(ticks, xOf, axisFontSize);
            const displayedSet = new Set(displayedIndices);
            const curves = this._computeSCurves(tasks, maxDay);

            // White canvas backdrop
            const estTableH = (this.showSCurve && this.showProgressTable) ? Math.round(48 * uiScale) + Math.round(16 * uiScale) : 0;
            const padBottom = Math.round(64 * uiScale) + estTableH;
            this.contentW = contentW;
            this.contentH = axisBotY + padBottom;

            this.bgLayer.appendChild(createSvgEl('rect', {
                x: 0, y: 0, width: this.contentW, height: this.contentH, fill: '#ffffff'
            }));

            // Header + legend
            const legend = [
                { kind: 'line', color: '#ef4444', width: 2.8, label: '要徑 (TF=0)' },
                { kind: 'line', color: '#1e293b', width: 2.0, label: '非要徑' },
                { kind: 'line', color: '#94a3b8', width: 1.5, dash: '4 3', label: '相依虛線' }
            ];
            if (this.showSCurve) {
                legend.push({ kind: 'line', color: '#2563eb', width: 3.0, label: '預定 S 曲線' });
                if (this.showEnvelope) {
                    legend.push({ kind: 'line', color: '#10b981', width: 2.0, dash: '5 3', label: 'ES 最早' });
                    legend.push({ kind: 'line', color: '#f59e0b', width: 2.0, dash: '5 3', label: 'LS 最晚' });
                }
            }
            this._renderHeader(
                Math.round(24 * uiScale),
                this.contentW,
                uiScale,
                this._buildSubtitleDurationText(maxDay) + '  ｜  日期區間每 ' + step + ' 天  ｜  共 ' + tasks.length + ' 個工項',
                legend
            );

            // Top & bottom axis rules
            this.axisLayer.appendChild(createSvgEl('line', {
                x1: padLeft, y1: axisTopY, x2: xOf(maxDay), y2: axisTopY,
                stroke: '#cbd5e1', 'stroke-width': '1.2'
            }));
            this.axisLayer.appendChild(createSvgEl('line', {
                x1: padLeft, y1: axisBotY, x2: xOf(maxDay), y2: axisBotY,
                stroke: '#64748b', 'stroke-width': '1.5'
            }));

            // Subtle daily minor grid lines
            if (step > 1 && pxPerDay >= 16) {
                for (let md = Math.floor(minDay); md <= Math.ceil(maxDay); md++) {
                    if (md % step === 0) continue;
                    const mx = xOf(md);
                    self.gridLayer.appendChild(createSvgEl('line', {
                        x1: mx, y1: axisTopY, x2: mx, y2: axisBotY,
                        stroke: '#f1f5f9', 'stroke-width': '1', 'stroke-dasharray': '2 4'
                    }));
                }
            }

            // Major vertical dashed day lines + top & bottom day labels (respecting labelEveryN; last tick ALWAYS shown!)
            const lastTickIdx = ticks.length - 1;
            ticks.forEach(function (d, idx) {
                const tx = xOf(d);
                const isShown = displayedSet.has(idx);
                const isLast = idx === lastTickIdx;
                self.gridLayer.appendChild(createSvgEl('line', {
                    x1: tx, y1: axisTopY, x2: tx, y2: axisBotY,
                    stroke: isShown ? '#cbd5e1' : '#e2e8f0',
                    'stroke-width': isShown ? '1.2' : '0.9',
                    'stroke-dasharray': isShown ? '5 4' : '3 5'
                }));
                self.axisLayer.appendChild(createSvgEl('line', {
                    x1: tx, y1: axisBotY, x2: tx, y2: axisBotY + (isShown ? 6 : 3),
                    stroke: isShown ? '#64748b' : '#cbd5e1',
                    'stroke-width': isShown ? '1.4' : '1'
                }));
                if (isShown) {
                    const topLbl = createSvgEl('text', {
                        x: tx, y: axisTopY - Math.round(8 * uiScale), 'text-anchor': 'middle',
                        'font-size': String(axisFontSize), 'font-family': FONT_FAMILY,
                        fill: isLast ? '#0f172a' : '#64748b', 'font-weight': isLast ? '700' : '600'
                    });
                    topLbl.textContent = self._formatDayLabel(d, true);
                    self.axisLayer.appendChild(topLbl);

                    const botLbl = createSvgEl('text', {
                        x: tx, y: axisBotY + Math.round(20 * uiScale), 'text-anchor': 'middle',
                        'font-size': String(axisFontSize), 'font-family': FONT_FAMILY,
                        fill: isLast ? '#0f172a' : '#334155', 'font-weight': '700'
                    });
                    botLbl.textContent = self._formatDayLabel(d, false);
                    self.axisLayer.appendChild(botLbl);
                }
            });

            // Collect unique ADM event nodes
            const nodePoints = new Map();
            function upsertEventNode(day, lane, te, tl, isCp) {
                const key = day + ':' + lane;
                if (!nodePoints.has(key)) {
                    nodePoints.set(key, {
                        day: day, lane: lane, x: xOf(day), y: yOf(lane),
                        te: te, tl: tl, cp: isCp
                    });
                } else {
                    const existing = nodePoints.get(key);
                    if (te > existing.te) existing.te = te;
                    if (tl < existing.tl) existing.tl = tl;
                    if (isCp) existing.cp = true;
                }
            }

            Object.keys(taskPos).forEach(function (id) {
                const info = taskPos[id];
                const t = info.data;
                upsertEventNode(t.es, info.lane, Math.max(0, t.rawEs - 1), Math.max(0, t.rawLs - 1), t.cp);
                upsertEventNode(t.ef, info.lane, t.rawEf, t.rawLf, t.cp);
            });

            const orderedNodes = Array.from(nodePoints.values()).sort(function (a, b) {
                if (a.day !== b.day) return a.day - b.day;
                return a.lane - b.lane;
            });
            orderedNodes.forEach(function (pt, idx) { pt.nodeNo = idx + 1; });

            const dummyLayer = createSvgEl('g');
            const arrowLayer = createSvgEl('g');
            const nodeLayer = createSvgEl('g');
            this.baseLayerGroup.appendChild(dummyLayer);
            this.baseLayerGroup.appendChild(arrowLayer);
            this.baseLayerGroup.appendChild(nodeLayer);

            // Dummy dependency connectors
            Object.keys(taskPos).forEach(function (id) {
                const info = taskPos[id];
                const t = info.data;
                const y1 = yOf(info.lane);
                t.links.forEach(function (lnk) {
                    if (lnk.to === 'end' || !taskPos[lnk.to]) return;
                    const tInfo = taskPos[lnk.to];
                    const t2 = tInfo.data;
                    const y2 = yOf(tInfo.lane);
                    const x1 = xOf(t.ef);
                    const x2 = xOf(t2.es);
                    if (Math.abs(x1 - x2) < 1 && Math.abs(y1 - y2) < 1) return;

                    const isCritLink = t.cp && t2.cp;
                    const dPath = (t.ef < midTimeline)
                        ? `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`
                        : `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`;
                    dummyLayer.appendChild(createSvgEl('path', {
                        d: dPath,
                        fill: 'none',
                        stroke: '#94a3b8',
                        'stroke-width': '1.35',
                        'stroke-dasharray': '5 4',
                        class: 'adm-dummy' + (isCritLink ? ' is-critical' : ' is-noncritical')
                    }));
                });
            });

            // Activity arrows + labels
            Object.keys(taskPos).forEach(function (id) {
                const info = taskPos[id];
                const t = info.data;
                const x1 = xOf(t.es);
                const x2 = xOf(t.ef);
                const y = yOf(info.lane);
                const spanPx = Math.max(10, x2 - x1);
                const startX = x1 + Math.min(nodeR, spanPx * 0.25);
                const endX = x2 - Math.min(nodeR + 2, spanPx * 0.25);

                const g = createSvgEl('g', {
                    class: 'adm-task-group' + (t.cp ? ' is-critical' : ' is-noncritical'),
                    style: 'cursor: pointer;'
                });

                g.appendChild(createSvgEl('line', {
                    x1: x1, y1: y, x2: x2, y2: y,
                    stroke: 'transparent', 'stroke-width': '24'
                }));

                g.appendChild(createSvgEl('line', {
                    x1: startX, y1: y, x2: Math.max(startX + 4, endX), y2: y,
                    stroke: t.cp ? '#ef4444' : '#1e293b',
                    'stroke-width': String(t.cp ? (2.8 * uiScale).toFixed(1) : (1.9 * uiScale).toFixed(1)),
                    'marker-end': t.cp ? 'url(#rs-arrow-crit)' : 'url(#rs-arrow-norm)'
                }));

                const midX = (x1 + x2) / 2;
                const lines = wrappedMap[id] || [t.name];
                lines.forEach(function (line, idx) {
                    const ly = y - Math.round(10 * uiScale) - (lines.length - 1 - idx) * lineH;
                    const txt = createSvgEl('text', {
                        x: midX, y: ly, 'text-anchor': 'middle',
                        'font-size': String(fontSize), 'font-weight': '700',
                        'font-family': FONT_FAMILY,
                        fill: t.cp ? '#991b1b' : '#0f172a',
                        stroke: '#ffffff',
                        'stroke-width': String(Math.round(4 * uiScale)),
                        'stroke-linejoin': 'round',
                        'paint-order': 'stroke'
                    });
                    txt.textContent = line;
                    g.appendChild(txt);
                });

                const durTxt = createSvgEl('text', {
                    x: midX, y: y + Math.round(18 * uiScale), 'text-anchor': 'middle',
                    'font-size': String(Math.max(10, Math.round(fontSize - 1))), 'font-weight': '600',
                    'font-family': FONT_FAMILY,
                    fill: '#475569',
                    stroke: '#ffffff',
                    'stroke-width': '3',
                    'paint-order': 'stroke'
                });
                durTxt.textContent = t.duration + ' 天';
                g.appendChild(durTxt);

                g.addEventListener('mouseenter', function (ev) { self._showTaskTooltip(ev, t); });
                g.addEventListener('mousemove', function (ev) { self._moveTooltip(ev); });
                g.addEventListener('mouseleave', function () { self._hideTooltip(); });

                arrowLayer.appendChild(g);
            });

            // Circular event nodes
            orderedNodes.forEach(function (pt, idx) {
                const isCritNode = pt.cp || (pt.te === pt.tl);
                const strokeCol = isCritNode ? '#ef4444' : '#2563eb';
                const topBg = isCritNode ? '#fff1f2' : '#eff6ff';

                const ng = createSvgEl('g', {
                    class: 'adm-event-node' + (pt.cp ? ' is-critical' : ' is-noncritical')
                });

                if (isCircle3) {
                    const clipId = 'rs-c3-clip-' + idx + '-' + Math.round(pt.x);
                    const clip = createSvgEl('clipPath', { id: clipId });
                    clip.appendChild(createSvgEl('circle', { cx: pt.x, cy: pt.y, r: nodeR }));
                    ng.appendChild(clip);

                    const cInner = createSvgEl('g', { 'clip-path': `url(#${clipId})` });
                    cInner.appendChild(createSvgEl('rect', {
                        x: pt.x - nodeR, y: pt.y - nodeR, width: nodeR * 2, height: nodeR, fill: topBg
                    }));
                    cInner.appendChild(createSvgEl('rect', {
                        x: pt.x - nodeR, y: pt.y, width: nodeR * 2, height: nodeR, fill: '#ffffff'
                    }));
                    cInner.appendChild(createSvgEl('line', {
                        x1: pt.x - nodeR, y1: pt.y, x2: pt.x + nodeR, y2: pt.y,
                        stroke: strokeCol, 'stroke-width': String((1.3 * uiScale).toFixed(1))
                    }));
                    cInner.appendChild(createSvgEl('line', {
                        x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y + nodeR,
                        stroke: strokeCol, 'stroke-width': String((1.3 * uiScale).toFixed(1))
                    }));
                    ng.appendChild(cInner);

                    ng.appendChild(createSvgEl('circle', {
                        cx: pt.x, cy: pt.y, r: nodeR, fill: 'none',
                        stroke: strokeCol, 'stroke-width': String(((pt.cp ? 2 : 1.5) * uiScale).toFixed(1))
                    }));

                    const subFont = Math.max(8, Math.round(boxFontSize * 0.86));
                    const dayTxt = createSvgEl('text', {
                        x: pt.x, y: pt.y - Math.round(nodeR * 0.22), 'text-anchor': 'middle',
                        'font-size': String(boxFontSize), 'font-weight': '700', 'font-family': FONT_FAMILY,
                        fill: isCritNode ? '#b91c1c' : '#0f172a'
                    });
                    dayTxt.textContent = String(Math.round(pt.day));
                    ng.appendChild(dayTxt);

                    const esTxt = createSvgEl('text', {
                        x: pt.x - Math.round(nodeR * 0.42), y: pt.y + Math.round(nodeR * 0.56), 'text-anchor': 'middle',
                        'font-size': String(subFont), 'font-weight': '700', 'font-family': FONT_FAMILY,
                        fill: isCritNode ? '#be123c' : '#1d4ed8'
                    });
                    esTxt.textContent = String(Math.round(pt.te));
                    ng.appendChild(esTxt);

                    const lfTxt = createSvgEl('text', {
                        x: pt.x + Math.round(nodeR * 0.42), y: pt.y + Math.round(nodeR * 0.56), 'text-anchor': 'middle',
                        'font-size': String(subFont), 'font-weight': '700', 'font-family': FONT_FAMILY,
                        fill: isCritNode ? '#be123c' : '#334155'
                    });
                    lfTxt.textContent = String(Math.round(pt.tl));
                    ng.appendChild(lfTxt);
                } else {
                    const bx = pt.x - boxW / 2;
                    const by = pt.y - nodeR - boxH - 4;

                    ng.appendChild(createSvgEl('rect', {
                        x: bx, y: by, width: boxW, height: cellH,
                        fill: topBg, stroke: strokeCol, 'stroke-width': String((1.3 * uiScale).toFixed(1))
                    }));
                    ng.appendChild(createSvgEl('rect', {
                        x: bx, y: by + cellH, width: boxW, height: cellH,
                        fill: '#ffffff', stroke: strokeCol, 'stroke-width': String((1.3 * uiScale).toFixed(1))
                    }));

                    const esTxt = createSvgEl('text', {
                        x: pt.x, y: by + Math.round(cellH * 0.75), 'text-anchor': 'middle',
                        'font-size': String(boxFontSize), 'font-weight': '700', 'font-family': FONT_FAMILY,
                        fill: isCritNode ? '#be123c' : '#1d4ed8'
                    });
                    esTxt.textContent = String(Math.round(pt.te));
                    ng.appendChild(esTxt);

                    const lfTxt = createSvgEl('text', {
                        x: pt.x, y: by + cellH + Math.round(cellH * 0.75), 'text-anchor': 'middle',
                        'font-size': String(boxFontSize), 'font-weight': '700', 'font-family': FONT_FAMILY,
                        fill: isCritNode ? '#be123c' : '#334155'
                    });
                    lfTxt.textContent = String(Math.round(pt.tl));
                    ng.appendChild(lfTxt);

                    ng.appendChild(createSvgEl('circle', {
                        cx: pt.x, cy: pt.y, r: nodeR, fill: '#ffffff',
                        stroke: pt.cp ? '#ef4444' : '#334155',
                        'stroke-width': String(((pt.cp ? 2 : 1.5) * uiScale).toFixed(1))
                    }));
                    const txt = createSvgEl('text', {
                        x: pt.x, y: pt.y + Math.round(boxFontSize * 0.36), 'text-anchor': 'middle',
                        'font-size': String(boxFontSize), 'font-weight': '700', 'font-family': FONT_FAMILY,
                        fill: pt.cp ? '#b91c1c' : '#0f172a'
                    });
                    txt.textContent = String(pt.nodeNo);
                    ng.appendChild(txt);
                }
                nodeLayer.appendChild(ng);
            });

            // Aligned S-Curve Overlay on top of ADM timeline
            this._renderSCurveOverlay({
                plotLeft: xOf(minDay),
                plotRight: xOf(maxDay),
                plotTop: axisTopY,
                plotBot: axisBotY,
                xOf: xOf,
                ticks: ticks,
                displayedIndices: displayedIndices,
                curves: curves,
                uiScale: uiScale,
                axisFontSize: axisFontSize
            });

            // Optional aligned bottom interval progress table
            const tableTop = axisBotY + Math.round(30 * uiScale);
            const tableH = this._renderProgressTable({
                tableTop: tableTop,
                labelLeft: Math.round(16 * uiScale),
                plotLeft: xOf(minDay),
                plotRight: xOf(maxDay),
                xOf: xOf,
                ticks: ticks,
                displayedIndices: displayedIndices,
                curves: curves,
                uiScale: uiScale,
                axisFontSize: axisFontSize
            });

            // Footer note
            const footerY = tableH > 0 ? (tableTop + tableH + Math.round(22 * uiScale)) : (axisBotY + Math.round(44 * uiScale));
            const footerTxt = createSvgEl('text', {
                x: this.contentW / 2, y: footerY, 'text-anchor': 'middle',
                'font-size': String(Math.max(10, Math.round(axisFontSize * 0.92))),
                'font-family': FONT_FAMILY, fill: '#64748b', 'font-weight': '600'
            });
            footerTxt.textContent = isCircle3
                ? '節點三格圓：[ 上半圓: 天數 / 左下: ES 最早 / 右下: LF 最晚 ]  ｜  S 曲線已對齊 ADM 日期區間刻度'
                : '節點上方雙格：[ 上: ES 最早 / 下: LF 最晚 ]  ｜  S 曲線已對齊 ADM 日期區間刻度';
            this.axisLayer.appendChild(footerTxt);
            this.contentH = footerY + Math.round(22 * uiScale);
            this.bgLayer.firstChild.setAttribute('height', String(this.contentH));
        }

        _renderGanttMode(tasks) {
            const self = this;

            const minDay = 0;
            const maxTaskDay = Math.max.apply(null, tasks.map(function (t) { return t.ef; }));
            const maxDay = Math.max(1, maxTaskDay, this.targetDuration || 0);
            const totalDuration = Math.max(1, maxDay - minDay);

            const step = (this.gridStep === 'auto')
                ? recommendGridStep(totalDuration)
                : Math.max(1, parseInt(this.gridStep, 10) || 5);

            const rect = this.container.getBoundingClientRect();
            const viewW = Math.max(1020, rect.width || 1280);
            const viewH = Math.max(460, rect.height || 580);

            const fontSize = (this.fontSize === 'auto') ? 12.5 : Number(this.fontSize || 12.5);
            const uiScale = Math.max(0.95, fontSize / 12);
            const axisFontSize = Math.round(11.5 * uiScale);
            const rowH = Math.round(34 * uiScale);
            const barH = Math.round(16 * uiScale);
            const floatH = Math.round(22 * uiScale);

            // Left engineering table columns: [# | 工項名稱 (supports up to 30 full-width chars!) | 工期 | 權重]
            let longestNameUnits = 14;
            tasks.forEach(function (t) {
                const u = visualCharUnits(t.name);
                if (u > longestNameUnits) longestNameUnits = u;
            });
            const cappedUnits = Math.min(30, Math.max(14, Math.ceil(longestNameUnits)));
            const colIdxW = Math.round(36 * uiScale);
            const colNameW = Math.round(Math.max(200 * uiScale, cappedUnits * fontSize * 1.04 + 20));
            const colDurW = Math.round(52 * uiScale);
            const colWtW = Math.round(62 * uiScale);
            const tableW = colIdxW + colNameW + colDurW + colWtW;
            const marginLeft = Math.round(20 * uiScale);
            const plotLeft = marginLeft + tableW;
            const padRight = this.showSCurve ? Math.round(104 * uiScale) : Math.round(44 * uiScale);

            const recStep = recommendGridStep(totalDuration);
            const fitBaseW = Math.max(640, viewW - plotLeft - padRight);
            const stepRatio = recStep / step;
            const stepFactor = stepRatio >= 1
                ? Math.min(4.0, Math.pow(stepRatio, 0.55))
                : Math.max(0.55, Math.pow(stepRatio, 0.45));
            const targetGraphW = Math.max(440, fitBaseW * stepFactor * this.stretch);
            const pxPerDay = targetGraphW / totalDuration;
            const xOf = function (day) { return plotLeft + (day - minDay) * pxPerDay; };

            const headerH = this.showHeader ? Math.round(64 * uiScale) : 0;
            const colHeaderH = Math.round(32 * uiScale);
            const axisTopY = headerH + Math.round(18 * uiScale) + colHeaderH;
            const rowsTotalH = Math.max(Math.round(220 * uiScale), tasks.length * rowH);
            const axisBotY = axisTopY + rowsTotalH;

            const ticks = this._buildTicks(minDay, maxDay, step);
            const displayedIndices = this._selectDisplayedTickIndices(ticks, xOf, axisFontSize);
            const displayedSet = new Set(displayedIndices);
            const curves = this._computeSCurves(tasks, maxDay);

            this.contentW = plotLeft + targetGraphW + padRight;
            this.contentH = axisBotY + Math.round(120 * uiScale);

            // Backdrop
            this.bgLayer.appendChild(createSvgEl('rect', {
                x: 0, y: 0, width: this.contentW, height: this.contentH, fill: '#ffffff'
            }));

            // Header + Legend
            const legend = [
                { kind: 'rect', color: '#e11d48', label: '要徑工項' },
                { kind: 'rect', color: '#2563eb', label: '非要徑工項' }
            ];
            if (this.showFloat) {
                legend.push({ kind: 'rect', color: 'rgba(147,197,253,0.45)', stroke: '#60a5fa', label: '浮時區間 [ES, LF]' });
            }
            if (this.showSCurve) {
                legend.push({ kind: 'line', color: '#2563eb', width: 3.0, label: '預定 S 曲線' });
                if (this.showEnvelope) {
                    legend.push({ kind: 'line', color: '#10b981', width: 2.0, dash: '5 3', label: 'ES 最早' });
                    legend.push({ kind: 'line', color: '#f59e0b', width: 2.0, dash: '5 3', label: 'LS 最晚' });
                }
            }
            this._renderHeader(
                marginLeft,
                this.contentW,
                uiScale,
                this._buildSubtitleDurationText(maxDay) + '  ｜  日期區間每 ' + step + ' 天  ｜  共 ' + tasks.length + ' 個工項',
                legend
            );

            // Table column header bar
            const colHeaderY = axisTopY - colHeaderH;
            this.axisLayer.appendChild(createSvgEl('rect', {
                x: marginLeft, y: colHeaderY, width: tableW + targetGraphW, height: colHeaderH,
                fill: '#f1f5f9', stroke: '#cbd5e1', 'stroke-width': '1'
            }));

            const colDefs = [
                { x: marginLeft, w: colIdxW, label: '#', anchor: 'middle' },
                { x: marginLeft + colIdxW, w: colNameW, label: '工項名稱', anchor: 'start', pad: 8 },
                { x: marginLeft + colIdxW + colNameW, w: colDurW, label: '工期', anchor: 'middle' },
                { x: marginLeft + colIdxW + colNameW + colDurW, w: colWtW, label: '權重', anchor: 'middle' }
            ];
            colDefs.forEach(function (c) {
                self.axisLayer.appendChild(createSvgEl('line', {
                    x1: c.x + c.w, y1: colHeaderY, x2: c.x + c.w, y2: axisBotY,
                    stroke: '#e2e8f0', 'stroke-width': '1'
                }));
                const tx = c.anchor === 'middle' ? (c.x + c.w / 2) : (c.x + (c.pad || 6));
                const txt = createSvgEl('text', {
                    x: tx, y: colHeaderY + Math.round(colHeaderH * 0.66),
                    'text-anchor': c.anchor,
                    'font-size': String(axisFontSize), 'font-weight': '700', 'font-family': FONT_FAMILY,
                    fill: '#334155'
                });
                txt.textContent = c.label;
                self.axisLayer.appendChild(txt);
            });

            // Alternating row zebra stripes + left table data (supports up to 30 full-width chars!)
            const maxNameUnits = Math.max(12, Math.min(30, (colNameW - 16) / (fontSize * 1.02)));
            tasks.forEach(function (t, idx) {
                const ry = axisTopY + idx * rowH;
                const rowBg = (idx % 2 === 1) ? '#f8fafc' : '#ffffff';

                const rowG = createSvgEl('g', {
                    class: 'adm-task-group' + (t.cp ? ' is-critical' : ' is-noncritical'),
                    style: 'cursor: pointer;'
                });

                // Zebra background across full table + timeline
                rowG.appendChild(createSvgEl('rect', {
                    x: marginLeft, y: ry, width: tableW + targetGraphW, height: rowH,
                    fill: rowBg
                }));
                rowG.appendChild(createSvgEl('line', {
                    x1: marginLeft, y1: ry + rowH, x2: plotLeft + targetGraphW, y2: ry + rowH,
                    stroke: '#f1f5f9', 'stroke-width': '1'
                }));

                const textY = ry + Math.round(rowH * 0.65);

                // # index
                const idxTxt = createSvgEl('text', {
                    x: marginLeft + colIdxW / 2, y: textY, 'text-anchor': 'middle',
                    'font-size': String(Math.max(10, Math.round(fontSize * 0.9))),
                    'font-weight': '700', 'font-family': FONT_FAMILY,
                    fill: t.cp ? '#e11d48' : '#64748b'
                });
                idxTxt.textContent = String(idx + 1);
                rowG.appendChild(idxTxt);

                // Task name
                const nameTxt = createSvgEl('text', {
                    x: marginLeft + colIdxW + 8, y: textY, 'text-anchor': 'start',
                    'font-size': String(fontSize), 'font-weight': t.cp ? '700' : '600',
                    'font-family': FONT_FAMILY,
                    fill: t.cp ? '#9f1239' : '#0f172a'
                });
                nameTxt.textContent = truncateByVisualUnits(t.name, maxNameUnits);
                rowG.appendChild(nameTxt);

                // Duration
                const durTxt = createSvgEl('text', {
                    x: marginLeft + colIdxW + colNameW + colDurW / 2, y: textY, 'text-anchor': 'middle',
                    'font-size': String(Math.max(10, Math.round(fontSize * 0.92))),
                    'font-weight': '600', 'font-family': FONT_FAMILY, fill: '#475569'
                });
                durTxt.textContent = t.duration + 'd';
                rowG.appendChild(durTxt);

                // Weight %
                const wtTxt = createSvgEl('text', {
                    x: marginLeft + colIdxW + colNameW + colDurW + colWtW / 2, y: textY, 'text-anchor': 'middle',
                    'font-size': String(Math.max(10, Math.round(fontSize * 0.92))),
                    'font-weight': '700', 'font-family': FONT_FAMILY, fill: '#1e40af'
                });
                wtTxt.textContent = formatPct(t.unit_price);
                rowG.appendChild(wtTxt);

                // Optional [ES, LF] float track behind non-critical task bar
                if (self.showFloat && !t.cp && (t.lf - t.origEs0) > t.duration) {
                    const fx1 = xOf(t.origEs0);
                    const fx2 = xOf(t.lf);
                    rowG.appendChild(createSvgEl('rect', {
                        x: fx1, y: ry + (rowH - floatH) / 2,
                        width: Math.max(4, fx2 - fx1), height: floatH,
                        rx: '5',
                        fill: 'rgba(147, 197, 253, 0.36)',
                        stroke: '#93c5fd', 'stroke-width': '1.2'
                    }));
                }

                // Actual scheduled bar [es, ef]
                const bx1 = xOf(t.es);
                const bx2 = xOf(t.ef);
                const bw = Math.max(6, bx2 - bx1);
                const by = ry + (rowH - barH) / 2;
                rowG.appendChild(createSvgEl('rect', {
                    x: bx1, y: by, width: bw, height: barH,
                    rx: '4',
                    fill: t.cp ? '#e11d48' : '#2563eb',
                    stroke: t.cp ? '#be123c' : '#1d4ed8',
                    'stroke-width': '1'
                }));

                // Day range micro label inside or beside bar
                const barLblStr = (t.es + 1) + '~' + t.ef;
                const barFont = Math.max(9, Math.round(fontSize * 0.8));
                if (bw >= barLblStr.length * barFont * 0.72 + 8) {
                    const inTxt = createSvgEl('text', {
                        x: bx1 + bw / 2, y: by + Math.round(barH * 0.74),
                        'text-anchor': 'middle',
                        'font-size': String(barFont), 'font-weight': '700', 'font-family': FONT_FAMILY,
                        fill: '#ffffff'
                    });
                    inTxt.textContent = barLblStr;
                    rowG.appendChild(inTxt);
                }

                rowG.addEventListener('mouseenter', function (ev) { self._showTaskTooltip(ev, t); });
                rowG.addEventListener('mousemove', function (ev) { self._moveTooltip(ev); });
                rowG.addEventListener('mouseleave', function () { self._hideTooltip(); });

                self.baseLayerGroup.appendChild(rowG);
            });

            // Outer frame around Gantt grid
            this.axisLayer.appendChild(createSvgEl('rect', {
                x: marginLeft, y: colHeaderY, width: tableW + targetGraphW, height: colHeaderH + rowsTotalH,
                fill: 'none', stroke: '#94a3b8', 'stroke-width': '1.3'
            }));
            this.axisLayer.appendChild(createSvgEl('line', {
                x1: plotLeft, y1: colHeaderY, x2: plotLeft, y2: axisBotY,
                stroke: '#94a3b8', 'stroke-width': '1.4'
            }));

            // Vertical day grid lines & top/bottom day labels (respecting labelEveryN; last tick ALWAYS shown!)
            const lastTickIdx = ticks.length - 1;
            ticks.forEach(function (d, idx) {
                const tx = xOf(d);
                const isShown = displayedSet.has(idx);
                const isLast = idx === lastTickIdx;
                self.gridLayer.appendChild(createSvgEl('line', {
                    x1: tx, y1: axisTopY, x2: tx, y2: axisBotY,
                    stroke: isShown ? '#cbd5e1' : '#e2e8f0',
                    'stroke-width': isShown ? '1.1' : '0.8',
                    'stroke-dasharray': isShown ? '4 4' : '2 4'
                }));
                self.axisLayer.appendChild(createSvgEl('line', {
                    x1: tx, y1: axisBotY, x2: tx, y2: axisBotY + (isShown ? 6 : 3),
                    stroke: isShown ? '#64748b' : '#cbd5e1',
                    'stroke-width': isShown ? '1.3' : '1'
                }));
                if (isShown) {
                    const topLbl = createSvgEl('text', {
                        x: tx, y: colHeaderY + Math.round(colHeaderH * 0.66),
                        'text-anchor': 'middle',
                        'font-size': String(axisFontSize), 'font-weight': '700', 'font-family': FONT_FAMILY,
                        fill: isLast ? '#0f172a' : '#334155'
                    });
                    topLbl.textContent = self._formatDayLabel(d, true);
                    self.axisLayer.appendChild(topLbl);

                    const botLbl = createSvgEl('text', {
                        x: tx, y: axisBotY + Math.round(20 * uiScale),
                        'text-anchor': 'middle',
                        'font-size': String(axisFontSize), 'font-weight': '700', 'font-family': FONT_FAMILY,
                        fill: isLast ? '#0f172a' : '#334155'
                    });
                    botLbl.textContent = self._formatDayLabel(d, false);
                    self.axisLayer.appendChild(botLbl);
                }
            });

            // Strictly Date-Aligned S-Curve Overlay
            this._renderSCurveOverlay({
                plotLeft: xOf(minDay),
                plotRight: xOf(maxDay),
                plotTop: axisTopY,
                plotBot: axisBotY,
                xOf: xOf,
                ticks: ticks,
                displayedIndices: displayedIndices,
                curves: curves,
                uiScale: uiScale,
                axisFontSize: axisFontSize
            });

            // Optional aligned bottom interval progress table
            const tableTop = axisBotY + Math.round(28 * uiScale);
            const tableH = this._renderProgressTable({
                tableTop: tableTop,
                labelLeft: marginLeft,
                plotLeft: xOf(minDay),
                plotRight: xOf(maxDay),
                xOf: xOf,
                ticks: ticks,
                displayedIndices: displayedIndices,
                curves: curves,
                uiScale: uiScale,
                axisFontSize: axisFontSize
            });

            const footerY = tableH > 0 ? (tableTop + tableH + Math.round(22 * uiScale)) : (axisBotY + Math.round(42 * uiScale));
            const footerTxt = createSvgEl('text', {
                x: this.contentW / 2, y: footerY, 'text-anchor': 'middle',
                'font-size': String(Math.max(10, Math.round(axisFontSize * 0.92))),
                'font-family': FONT_FAMILY, fill: '#64748b', 'font-weight': '600'
            });
            footerTxt.textContent = '紅條：要徑工項（TF=0）  ｜  藍條：非要徑工項（已反映步驟 2 排程位置）  ｜  S 曲線已對齊甘特圖日期區間刻度';
            this.axisLayer.appendChild(footerTxt);
            this.contentH = footerY + Math.round(22 * uiScale);
            this.bgLayer.firstChild.setAttribute('height', String(this.contentH));
        }

        _renderPdmMode(tasks) {
            const self = this;
            const maxTaskDay = tasks.length
                ? Math.max.apply(null, tasks.map(function (t) { return t.ef; }))
                : 1;
            const maxDay = Math.max(1, maxTaskDay, this.targetDuration || 0);

            const step = (this.gridStep === 'auto')
                ? recommendGridStep(maxDay)
                : Math.max(1, parseInt(this.gridStep, 10) || 5);

            const fontSize = (this.fontSize === 'auto') ? 12.5 : Number(this.fontSize || 12.5);
            const uiScale = Math.max(0.95, fontSize / 12);
            const axisFontSize = Math.round(11.5 * uiScale);

            const aspect = (this.pdmImageW > 0 && this.pdmImageH > 0)
                ? (this.pdmImageW / this.pdmImageH)
                : (16 / 9);
            // Give wide PDM diagrams generous horizontal room so all nodes remain legible without clipping
            const basePdmW = Math.min(2000, Math.max(1150, Math.round(this.pdmImageW * 0.42)));
            const plotW = Math.round(basePdmW * Math.max(0.65, Math.min(2.5, this.stretch)));
            const plotH = Math.max(440, Math.min(860, Math.round(plotW / Math.max(1.15, Math.min(3.4, aspect)))));

            const padLeft = this.showSCurve && this.showProgressTable ? Math.round(118 * uiScale) : Math.round(48 * uiScale);
            const padRight = this.showSCurve ? Math.round(104 * uiScale) : Math.round(48 * uiScale);
            const headerH = this.showHeader ? Math.round(64 * uiScale) : 0;
            const plotTop = headerH + Math.round(32 * uiScale);
            const plotBot = plotTop + plotH;
            const plotLeft = padLeft;
            const plotRight = padLeft + plotW;

            const xOf = function (day) { return plotLeft + (day / maxDay) * plotW; };
            const ticks = this._buildTicks(0, maxDay, step);
            const displayedIndices = this._selectDisplayedTickIndices(ticks, xOf, axisFontSize);
            const displayedSet = new Set(displayedIndices);
            const curves = this._computeSCurves(tasks, maxDay);

            this.contentW = plotRight + padRight;
            this.contentH = plotBot + Math.round(120 * uiScale);

            this.bgLayer.appendChild(createSvgEl('rect', {
                x: 0, y: 0, width: this.contentW, height: this.contentH, fill: '#ffffff'
            }));

            const legend = [
                { kind: 'rect', color: '#fff1f2', stroke: '#ef4444', label: 'PDM 要徑節點' },
                { kind: 'rect', color: '#f8fafc', stroke: '#38bdf8', label: 'PDM 非要徑節點' }
            ];
            if (this.showSCurve) {
                legend.push({ kind: 'line', color: '#2563eb', width: 3.0, label: '預定 S 曲線' });
                if (this.showEnvelope) {
                    legend.push({ kind: 'line', color: '#10b981', width: 2.0, dash: '5 3', label: 'ES 最早' });
                    legend.push({ kind: 'line', color: '#f59e0b', width: 2.0, dash: '5 3', label: 'LS 最晚' });
                }
            }
            this._renderHeader(
                Math.round(24 * uiScale),
                this.contentW,
                uiScale,
                this._buildSubtitleDurationText(maxDay) + '  ｜  PDM 邏輯拓撲網圖' + (this.showSCurve ? '（疊加 S 曲線）' : ''),
                legend
            );

            // Frame border
            this.baseLayerGroup.appendChild(createSvgEl('rect', {
                x: plotLeft, y: plotTop, width: plotW, height: plotH,
                fill: '#ffffff', stroke: '#cbd5e1', 'stroke-width': '1.2', rx: '6'
            }));

            if (this.pdmImageUrl) {
                const imgPad = 12;
                const imgOp = this.showSCurve ? this.pdmOpacity : 1.0;
                const imgEl = createSvgEl('image', {
                    x: plotLeft + imgPad,
                    y: plotTop + imgPad,
                    width: plotW - imgPad * 2,
                    height: plotH - imgPad * 2,
                    preserveAspectRatio: 'xMidYMid meet',
                    opacity: String(imgOp)
                });
                imgEl.setAttributeNS('http://www.w3.org/1999/xlink', 'href', this.pdmImageUrl);
                imgEl.setAttribute('href', this.pdmImageUrl);
                this.baseLayerGroup.appendChild(imgEl);
            } else {
                const placeholder = createSvgEl('text', {
                    x: plotLeft + plotW / 2, y: plotTop + plotH / 2,
                    'text-anchor': 'middle', 'font-size': '15', 'font-weight': '600',
                    'font-family': FONT_FAMILY, fill: '#64748b'
                });
                placeholder.textContent = '正在擷取 PDM 邏輯網圖快照，請稍候或點擊「重新擷取 PDM」…';
                this.baseLayerGroup.appendChild(placeholder);
            }

            if (this.showSCurve && tasks.length > 0) {
                // Bottom X-axis for S-curve over PDM
                this.axisLayer.appendChild(createSvgEl('line', {
                    x1: plotLeft, y1: plotBot, x2: plotRight, y2: plotBot,
                    stroke: '#64748b', 'stroke-width': '1.5'
                }));

                const lastTickIdx = ticks.length - 1;
                ticks.forEach(function (d, idx) {
                    const tx = xOf(d);
                    const isShown = displayedSet.has(idx);
                    const isLast = idx === lastTickIdx;
                    self.gridLayer.appendChild(createSvgEl('line', {
                        x1: tx, y1: plotTop, x2: tx, y2: plotBot,
                        stroke: isShown ? '#cbd5e1' : '#e2e8f0',
                        'stroke-width': isShown ? '1.05' : '0.8',
                        'stroke-dasharray': isShown ? '4 5' : '2 5',
                        'stroke-opacity': isShown ? '0.72' : '0.45'
                    }));
                    self.axisLayer.appendChild(createSvgEl('line', {
                        x1: tx, y1: plotBot, x2: tx, y2: plotBot + (isShown ? 6 : 3),
                        stroke: isShown ? '#64748b' : '#cbd5e1',
                        'stroke-width': isShown ? '1.3' : '1'
                    }));
                    if (isShown) {
                        const botLbl = createSvgEl('text', {
                            x: tx, y: plotBot + Math.round(20 * uiScale), 'text-anchor': 'middle',
                            'font-size': String(axisFontSize), 'font-weight': '700', 'font-family': FONT_FAMILY,
                            fill: isLast ? '#0f172a' : '#334155'
                        });
                        botLbl.textContent = self._formatDayLabel(d, false);
                        self.axisLayer.appendChild(botLbl);
                    }
                });

                this._renderSCurveOverlay({
                    plotLeft: plotLeft,
                    plotRight: plotRight,
                    plotTop: plotTop,
                    plotBot: plotBot,
                    xOf: xOf,
                    ticks: ticks,
                    displayedIndices: displayedIndices,
                    curves: curves,
                    uiScale: uiScale,
                    axisFontSize: axisFontSize
                });
            }

            const tableTop = plotBot + Math.round(28 * uiScale);
            const tableH = this._renderProgressTable({
                tableTop: tableTop,
                labelLeft: Math.round(16 * uiScale),
                plotLeft: plotLeft,
                plotRight: plotRight,
                xOf: xOf,
                ticks: ticks,
                displayedIndices: displayedIndices,
                curves: curves,
                uiScale: uiScale,
                axisFontSize: axisFontSize
            });

            const footerY = tableH > 0 ? (tableTop + tableH + Math.round(22 * uiScale)) : (plotBot + Math.round(40 * uiScale));
            const footerTxt = createSvgEl('text', {
                x: this.contentW / 2, y: footerY, 'text-anchor': 'middle',
                'font-size': String(Math.max(10, Math.round(axisFontSize * 0.92))),
                'font-family': FONT_FAMILY, fill: '#64748b', 'font-weight': '600'
            });
            footerTxt.textContent = this.showSCurve
                ? '說明：PDM 為邏輯拓撲網圖（非時間等比例），S 曲線依總工期區間疊加顯示；可調整「底圖透明度」兼顧清晰度'
                : '說明：PDM 邏輯拓撲網圖（未疊加 S 曲線）';
            this.axisLayer.appendChild(footerTxt);
            this.contentH = footerY + Math.round(22 * uiScale);
            this.bgLayer.firstChild.setAttribute('height', String(this.contentH));
        }

        _showTaskTooltip(ev, t) {
            if (!this.tooltipEl) return;
            const badge = t.cp
                ? '<span style="background:#ffe4e6;color:#be123c;padding:1px 6px;border-radius:999px;font-size:11px;font-weight:700;">要徑 TF=0</span>'
                : '<span style="background:#dbeafe;color:#1d4ed8;padding:1px 6px;border-radius:999px;font-size:11px;font-weight:700;">浮時 +' + t.tf + ' 天</span>';
            let calLine = '';
            if (this._calendarLookup) {
                const sDt = this._getDateForDay(Math.max(1, t.es + 1));
                const eDt = this._getDateForDay(t.ef);
                const fmt = (this.calendarDateFormat === 'ymd') ? 'ymd' : 'roc';
                if (sDt && eDt) {
                    calLine = '排程日期：<strong>' + this._formatCalendarDate(sDt, fmt) + ' ～ ' + this._formatCalendarDate(eDt, fmt) + '</strong><br>';
                }
            }
            this.tooltipEl.innerHTML =
                '<div style="font-weight:700;color:#0f172a;margin-bottom:4px;">' + t.name + ' ' + badge + '</div>' +
                '<div style="font-size:12px;color:#475569;line-height:1.6;">' +
                calLine +
                '目前排程：<strong>第 ' + (t.es + 1) + ' ～ ' + t.ef + ' 天</strong>（工期 ' + t.duration + ' 天）<br>' +
                '權重比率：<strong>' + formatPct(t.unit_price) + '</strong><br>' +
                '最早 (ES~EF)：第 ' + t.rawEs + ' ～ ' + t.rawEf + ' 天<br>' +
                '最晚 (LS~LF)：第 ' + t.rawLs + ' ～ ' + t.rawLf + ' 天' +
                '</div>';
            this.tooltipEl.style.display = 'block';
            this._moveTooltip(ev);
        }

        _showSCurveTooltip(ev, day, curPct, deltaPct, esPct, lsPct) {
            if (!this.tooltipEl) return;
            let dayTitle = '第 ' + day + ' 天';
            if (this._calendarLookup) {
                const dt = this._getDateForDay(day);
                const fmt = (this.calendarDateFormat === 'ymd') ? 'ymd' : 'roc';
                if (dt) {
                    dayTitle += '（' + this._formatCalendarDate(dt, fmt) + '）';
                }
            }
            let html =
                '<div style="font-weight:700;color:#1e40af;margin-bottom:4px;">S 曲線進度 — ' + dayTitle + '</div>' +
                '<div style="font-size:12px;color:#334155;line-height:1.65;">' +
                '預定累計進度：<strong>' + curPct.toFixed(2) + '%</strong><br>' +
                '本區間新增進度：<strong>+' + deltaPct.toFixed(2) + '%</strong>';
            if (this.showEnvelope) {
                html += '<br><span style="color:#059669;">ES 最早累計：' + esPct.toFixed(2) + '%</span>'
                    + '<br><span style="color:#d97706;">LS 最晚累計：' + lsPct.toFixed(2) + '%</span>';
            }
            html += '</div>';
            this.tooltipEl.innerHTML = html;
            this.tooltipEl.style.display = 'block';
            this._moveTooltip(ev);
        }

        _moveTooltip(ev) {
            if (!this.tooltipEl || !this.container) return;
            const rect = this.container.getBoundingClientRect();
            let x = ev.clientX - rect.left + 14;
            let y = ev.clientY - rect.top + 14;
            if (x + 250 > rect.width) x = Math.max(8, x - 265);
            if (y + 130 > rect.height) y = Math.max(8, y - 135);
            this.tooltipEl.style.left = x + 'px';
            this.tooltipEl.style.top = y + 'px';
        }

        _hideTooltip() {
            if (this.tooltipEl) this.tooltipEl.style.display = 'none';
        }

        _applyTransform() {
            this.viewport.setAttribute('transform', `translate(${this.tx}, ${this.ty}) scale(${this.scale})`);
            if (this.zoomLabelEl) {
                this.zoomLabelEl.textContent = Math.round(this.scale * 100) + '%';
            }
        }

        _applyCriticalHighlight() {
            if (this.criticalOnly && this.baseLayer !== 'pdm') {
                this.svg.classList.add('sc-adm-critical-only');
            } else {
                this.svg.classList.remove('sc-adm-critical-only');
            }
        }

        _bindEvents() {
            const self = this;
            this.svg.addEventListener('mousedown', function (ev) {
                if (ev.button !== 0) return;
                self.isPanning = true;
                self.svg.classList.add('is-panning');
                self.panStart = { x: ev.clientX, y: ev.clientY, tx: self.tx, ty: self.ty };
            });
            window.addEventListener('mousemove', function (ev) {
                if (!self.isPanning) return;
                self.tx = self.panStart.tx + (ev.clientX - self.panStart.x);
                self.ty = self.panStart.ty + (ev.clientY - self.panStart.y);
                self._applyTransform();
            });
            window.addEventListener('mouseup', function () {
                if (!self.isPanning) return;
                self.isPanning = false;
                self.svg.classList.remove('is-panning');
            });
            this.svg.addEventListener('wheel', function (ev) {
                ev.preventDefault();
                const rect = self.container.getBoundingClientRect();
                const mx = ev.clientX - rect.left;
                const my = ev.clientY - rect.top;
                const factor = ev.deltaY < 0 ? 1.12 : 0.89;
                const nextScale = Math.min(self.maxScale, Math.max(self.minScale, self.scale * factor));
                const ratio = nextScale / self.scale;
                self.tx = mx - (mx - self.tx) * ratio;
                self.ty = my - (my - self.ty) * ratio;
                self.scale = nextScale;
                self._applyTransform();
            }, { passive: false });
        }

        // Public setters
        setData(nodes, links, targetDuration, autoFit) {
            this.rawNodes = Array.isArray(nodes) ? nodes : [];
            if (Array.isArray(links)) this.rawLinks = links;
            if (targetDuration !== undefined && targetDuration !== null) {
                this.targetDuration = Number(targetDuration) || 0;
            }
            this.render(Boolean(autoFit));
        }

        setBaseLayer(layer) {
            if (['adm', 'gantt', 'pdm'].indexOf(layer) === -1) return;
            this.baseLayer = layer;
            this.render(true);
        }

        setPdmSnapshot(dataUrl, width, height) {
            this.pdmImageUrl = dataUrl || '';
            if (width) this.pdmImageW = Number(width) || 1200;
            if (height) this.pdmImageH = Number(height) || 680;
            if (this.baseLayer === 'pdm') {
                this.render(true);
            }
        }

        setPdmOpacity(val) {
            this.pdmOpacity = Math.min(1.0, Math.max(0.2, Number(val) || 0.78));
            if (this.baseLayer === 'pdm') this.render(false);
        }

        setNodeStyle(style) {
            this.nodeStyle = (style === 'circle3') ? 'circle3' : 'box';
            if (this.baseLayer === 'adm') this.render(false);
        }

        setStretch(val) {
            this.stretch = Math.min(3.0, Math.max(0.6, Number(val) || 1.1));
            this.render(false);
        }

        setFontSize(val) {
            if (val === 'auto') {
                this.fontSize = 'auto';
            } else {
                this.fontSize = Math.min(48, Math.max(8, Number(val) || 13));
            }
            this.render(false);
        }

        setGridStep(stepVal) {
            this.gridStep = stepVal || 'auto';
            this.render(false);
            this.fitToView();
        }

        setCriticalOnly(enabled) {
            this.criticalOnly = Boolean(enabled);
            this._applyCriticalHighlight();
        }

        setShowFloat(enabled) {
            this.showFloat = Boolean(enabled);
            if (this.baseLayer === 'gantt') this.render(false);
        }

        setShowSCurve(enabled) {
            this.showSCurve = Boolean(enabled);
            this.render(false);
        }

        setShowEnvelope(enabled) {
            this.showEnvelope = Boolean(enabled);
            this.render(false);
        }

        setShowPctLabels(enabled) {
            this.showPctLabels = Boolean(enabled);
            this.render(false);
        }

        setShowProgressTable(enabled) {
            this.showProgressTable = Boolean(enabled);
            this.render(false);
        }

        setSCurveOpacity(val) {
            this.scurveOpacity = Math.min(1.0, Math.max(0.25, Number(val) || 0.95));
            this.render(false);
        }

        setShowHeader(enabled) {
            this.showHeader = Boolean(enabled);
            this.render(false);
        }

        setLabelEveryN(val) {
            if (val === 'auto' || val === '' || val === null || val === undefined) {
                this.labelEveryN = 'auto';
            } else {
                this.labelEveryN = Math.max(1, Math.min(200, parseInt(val, 10) || 1));
            }
            this.render(false);
        }

        setDayLabelFormat(fmt) {
            if (['full', 'short', 'num'].indexOf(fmt) === -1) return;
            this.dayLabelFormat = fmt;
            this.render(false);
        }

        setTableDecimals(dec) {
            this.tableDecimals = Number(dec) === 0 ? 0 : 1;
            this.render(false);
        }

        setTableMergeByLabelStep(enabled) {
            this.tableMergeByLabelStep = Boolean(enabled);
            this.render(false);
        }

        setStartDate(dateStr) {
            this.startDateStr = String(dateStr || '').trim();
            this.render(false);
        }

        setDurationMode(mode) {
            if (['calendar', 'workday_sun', 'workday_wknd'].indexOf(mode) === -1) return;
            this.durationMode = mode;
            this.render(false);
        }

        setCalendarDateFormat(fmt) {
            if (['md', 'roc', 'ymd'].indexOf(fmt) === -1) return;
            this.calendarDateFormat = fmt;
            this.render(false);
        }

        getEffectiveLabelEveryN() {
            return this.lastEffectiveLabelN || 1;
        }

        fitToView() {
            const rect = this.container.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const scaleX = (rect.width - 28) / Math.max(1, this.contentW);
            const scaleY = (rect.height - 24) / Math.max(1, this.contentH);
            const fit = Math.min(scaleX, scaleY);
            this.scale = Math.min(1.8, Math.max(this.minScale, fit));
            const scaledW = this.contentW * this.scale;
            const scaledH = this.contentH * this.scale;
            this.tx = (rect.width - scaledW) / 2;
            this.ty = Math.max(8, (rect.height - scaledH) / 2);
            this._applyTransform();
        }

        zoomBy(factor) {
            const rect = this.container.getBoundingClientRect();
            const cx = rect.width / 2;
            const cy = rect.height / 2;
            const nextScale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
            const ratio = nextScale / this.scale;
            this.tx = cx - (cx - this.tx) * ratio;
            this.ty = cy - (cy - this.ty) * ratio;
            this.scale = nextScale;
            this._applyTransform();
        }

        zoomIn() { this.zoomBy(1.2); }
        zoomOut() { this.zoomBy(0.83); }
        zoomReset() {
            this.scale = 1;
            const rect = this.container.getBoundingClientRect();
            this.tx = Math.max(16, (rect.width - this.contentW) / 2);
            this.ty = Math.max(16, (rect.height - this.contentH) / 2);
            this._applyTransform();
        }

        _serializeStandaloneSvg() {
            const w = Math.ceil(this.contentW);
            const h = Math.ceil(this.contentH);
            const clone = this.svg.cloneNode(true);
            clone.setAttribute('xmlns', SVG_NS);
            clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
            clone.setAttribute('width', String(w));
            clone.setAttribute('height', String(h));
            clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
            clone.removeAttribute('style');

            // Embed critical-only dimming & font styles so exported PNG/SVG/PDF is 100% WYSIWYG
            const styleEl = createSvgEl('style');
            styleEl.textContent =
                `text { font-family: ${FONT_FAMILY}; }\n` +
                `.sc-adm-critical-only .adm-task-group.is-noncritical,\n` +
                `.sc-adm-critical-only .adm-dummy.is-noncritical,\n` +
                `.sc-adm-critical-only .adm-event-node.is-noncritical { opacity: 0.14; }`;
            clone.insertBefore(styleEl, clone.firstChild);

            const vp = clone.querySelector('.rs-viewport');
            if (vp) vp.setAttribute('transform', 'translate(0,0) scale(1)');

            const xml = new XMLSerializer().serializeToString(clone);
            return { xml: xml, width: w, height: h };
        }

        exportSvg(filename) {
            const out = this._serializeStandaloneSvg();
            const blob = new Blob([out.xml], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.download = filename || '進度成果圖.svg';
            a.href = url;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        }

        exportPng(filename) {
            const out = this._serializeStandaloneSvg();
            const svgBlob = new Blob([out.xml], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);
            const img = new Image();
            img.onload = function () {
                const scale = Math.min(2, Math.max(1, Math.floor(12000 / Math.max(out.width, out.height, 1))));
                const canvas = document.createElement('canvas');
                canvas.width = out.width * scale;
                canvas.height = out.height * scale;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.scale(scale, scale);
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                canvas.toBlob(function (pngBlob) {
                    if (!pngBlob) return;
                    const a = document.createElement('a');
                    a.download = filename || '進度成果圖.png';
                    a.href = URL.createObjectURL(pngBlob);
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
                }, 'image/png');
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
            };
            img.src = url;
        }

        printChart() {
            const out = this._serializeStandaloneSvg();
            const win = window.open('', '_blank', 'width=1280,height=840');
            if (!win) return;
            win.document.open();
            win.document.write(
                '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
                (this.projectTitle || '預定進度成果圖') +
                '</title><style>' +
                '@page { size: landscape; margin: 10mm; }' +
                'body { margin: 0; padding: 12px; background: #fff; display: flex; justify-content: center; align-items: flex-start; }' +
                'svg { max-width: 100%; height: auto; }' +
                '</style></head><body>' + out.xml +
                '<script>window.onload=function(){setTimeout(function(){window.print();}, 250);};</script>' +
                '</body></html>'
            );
            win.document.close();
        }
    }

    ResultStudioCanvas.recommendGridStep = recommendGridStep;
    global.ResultStudioCanvas = ResultStudioCanvas;
})(window);
