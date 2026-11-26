/**
 * Pure Frontend Interactive Time-Scaled ADM (Arrow Diagram Method) Canvas (JS + SVG)
 * Features:
 * - Vertical dashed day grid lines with top & bottom day labels (configurable interval)
 * - User-adjustable horizontal stretch (px/day), font size, and grid step to prevent text crowding
 * - Multi-line auto-wrapping labels with adaptive lane height (no harsh truncation)
 * - Pan, wheel zoom, fit-to-view, critical-path-only highlight, hover tooltip
 */
(function (global) {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const NODE_R = 16;
    const PAD_LEFT = 56;
    const PAD_RIGHT = 64;
    const PAD_TOP = 64;
    const PAD_BOTTOM = 72;

    function createSvgEl(tag, attrs) {
        const el = document.createElementNS(SVG_NS, tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                el.setAttribute(k, attrs[k]);
            });
        }
        return el;
    }

    function wrapText(text, maxChars) {
        const str = String(text || '').trim();
        if (!str) return ['未命名'];
        const cap = Math.max(2, Math.min(18, maxChars));
        const lines = [];
        for (let i = 0; i < str.length; i += cap) {
            lines.push(str.slice(i, i + cap));
            if (lines.length === 4 && i + cap < str.length) {
                lines[3] = lines[3].slice(0, -1) + '…';
                break;
            }
        }
        return lines;
    }

    class AdmCanvas {
        constructor(options) {
            this.container = options.container;
            this.tooltipEl = options.tooltipEl || null;
            this.zoomLabelEl = options.zoomLabelEl || null;
            this.rawNodes = Array.isArray(options.nodes) ? options.nodes : [];
            this.rawLinks = Array.isArray(options.links) ? options.links : [];
            this.projectTitle = options.projectTitle || '';

            this.valueType = options.valueType || 'esef';
            this.nodeStyle = options.nodeStyle || 'box'; // 'box' | 'circle3'
            this.stretch = Number(options.stretch || 1.0); // 0.6 ~ 3.0
            this.fontSize = options.fontSize || 'auto'; // 'auto' | 11 | 13 | 16 | 20
            this.gridStep = options.gridStep || 'auto'; // 'auto' | 1 | 5 | 7 | 10 | 15 | 30
            this.criticalOnly = false;

            this.scale = 1;
            this.tx = 0;
            this.ty = 0;
            this.minScale = 0.25;
            this.maxScale = 3.2;
            this.isPanning = false;
            this.panStart = { x: 0, y: 0, tx: 0, ty: 0 };
            this.contentW = 960;
            this.contentH = 440;

            this._buildSvg();
            this._bindEvents();
            this.render(true);
        }

        _buildSvg() {
            this.container.innerHTML = '';
            this.svg = createSvgEl('svg', {
                width: '100%',
                height: '100%',
                class: 'sc-adm-svg'
            });

            const defs = createSvgEl('defs');
            const mkCrit = createSvgEl('marker', {
                id: 'adm-arrow-crit',
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
                id: 'adm-arrow-norm',
                viewBox: '0 0 10 10',
                refX: '9',
                refY: '5',
                markerWidth: '6.5',
                markerHeight: '6.5',
                orient: 'auto'
            });
            mkNorm.appendChild(createSvgEl('path', { d: 'M 0 1 L 10 5 L 0 9 z', fill: '#1e293b' }));
            defs.appendChild(mkNorm);

            this.svg.appendChild(defs);

            this.viewport = createSvgEl('g', { class: 'adm-viewport' });
            this.gridLayer = createSvgEl('g', { class: 'adm-grid-layer' });
            this.dummyLayer = createSvgEl('g', { class: 'adm-dummy-layer' });
            this.arrowLayer = createSvgEl('g', { class: 'adm-arrow-layer' });
            this.nodeLayer = createSvgEl('g', { class: 'adm-node-layer' });
            this.axisLayer = createSvgEl('g', { class: 'adm-axis-layer' });

            this.viewport.appendChild(this.gridLayer);
            this.viewport.appendChild(this.dummyLayer);
            this.viewport.appendChild(this.arrowLayer);
            this.viewport.appendChild(this.nodeLayer);
            this.viewport.appendChild(this.axisLayer);
            this.svg.appendChild(this.viewport);

            this.container.appendChild(this.svg);
        }

        _prepareTasks() {
            const vt = this.valueType;
            const linkMap = {};
            this.rawLinks.forEach(function (l) {
                const f = String(l.from);
                if (!linkMap[f]) linkMap[f] = [];
                linkMap[f].push({ to: String(l.to), mode: l.mode || 'FS' });
            });

            return this.rawNodes.map(function (n) {
                const rawEs0 = (n.rawEs0 !== undefined) ? Number(n.rawEs0) : Number(n.es || 0);
                const rawEf1 = (n.rawEf1 !== undefined) ? Math.max(1, Number(n.rawEf1)) : Math.max(1, Number(n.ef || 1));
                const rawLs0 = Number(n.ls || 0);
                const rawLf1 = Math.max(rawEf1, Number(n.lf || rawEf1));

                let s1 = Number(n.es || 0) + 1;
                let e1 = Math.max(s1, Number(n.ef || s1));
                if (vt === 'lslf') {
                    s1 = rawLs0 + 1;
                    e1 = rawLf1;
                } else if (vt === 'avg') {
                    s1 = Math.floor((rawEs0 + 1 + rawLs0 + 1) / 2);
                    e1 = Math.floor((rawEf1 + rawLf1) / 2);
                } else if (vt === 'full') {
                    s1 = rawEs0 + 1;
                    e1 = rawLf1;
                }
                if (e1 < s1) e1 = s1;

                return {
                    id: String(n.id),
                    name: n.name || '未命名工項',
                    es: s1 - 1,
                    ef: e1,
                    duration: Math.max(1, e1 - s1 + 1),
                    cp: Boolean(n.cp),
                    unit_price: Number(n.unit_price || 0),
                    rawEs: rawEs0 + 1,
                    rawEf: rawEf1,
                    rawLs: rawLs0 + 1,
                    rawLf: rawLf1,
                    tf: Math.max(0, rawLs0 - rawEs0),
                    links: linkMap[String(n.id)] || []
                };
            });
        }

        render(autoFit) {
            this.gridLayer.innerHTML = '';
            this.dummyLayer.innerHTML = '';
            this.arrowLayer.innerHTML = '';
            this.nodeLayer.innerHTML = '';
            this.axisLayer.innerHTML = '';

            const tasks = this._prepareTasks();
            if (!tasks.length) {
                const empty = createSvgEl('text', {
                    x: 240, y: 120, 'text-anchor': 'middle', 'font-size': '14', fill: '#64748b'
                });
                empty.textContent = '目前尚無工項資料可繪製 ADM 箭線圖';
                this.axisLayer.appendChild(empty);
                return;
            }

            // 1. Greedy lane assignment: critical path on top lanes, non-critical below
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
            const minDay = Math.min.apply(null, tasks.map(function (t) { return t.es; }));
            const maxDay = Math.max.apply(null, tasks.map(function (t) { return t.ef; }));
            const totalDuration = Math.max(1, maxDay - minDay);
            const midTimeline = minDay + totalDuration / 2;

            // 1.5 Determine grid step & auto-normalized horizontal width (prevents 600+ day projects from becoming 9000px wide!)
            const step = (this.gridStep === 'auto')
                ? AdmCanvas.recommendGridStep(totalDuration)
                : Math.max(1, parseInt(this.gridStep, 10) || 5);

            const rect = this.container.getBoundingClientRect();
            const viewW = Math.max(960, rect.width || 1280);
            const viewH = Math.max(420, rect.height || 560);

            // Monotonic horizontal width relative to recommended step:
            // smaller day step (e.g. 1 day) is ALWAYS strictly wider; larger day step (e.g. 30 days) is ALWAYS more compact.
            const recStep = AdmCanvas.recommendGridStep(totalDuration);
            const fitBaseW = Math.max(820, viewW - PAD_LEFT - PAD_RIGHT);
            const stepRatio = recStep / step;
            const stepFactor = stepRatio >= 1
                ? Math.min(4.2, Math.pow(stepRatio, 0.55))
                : Math.max(0.55, Math.pow(stepRatio, 0.45));
            const targetGraphW = Math.max(420, fitBaseW * stepFactor * this.stretch);
            const pxPerDay = targetGraphW / totalDuration;
            const xOf = function (day) { return PAD_LEFT + (day - minDay) * pxPerDay; };

            // Auto-boost typography & node box sizes when many lanes / wide span would otherwise shrink text on fit
            const approxScale = Math.min((viewW - 40) / (targetGraphW + PAD_LEFT + PAD_RIGHT), (viewH - 40) / (numLanes * 105 + 140));
            const autoBoost = approxScale < 0.9 ? Math.min(2.1, 0.95 / Math.max(0.42, approxScale)) : 1.0;

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

            // Pre-compute wrapped lines & adaptive lane height so multi-line labels never collide
            const lineH = Math.round(fontSize * 1.32);
            const charPx = fontSize * 1.05;
            const laneMaxLines = new Array(numLanes).fill(1);
            const wrappedMap = {};

            Object.keys(taskPos).forEach(function (id) {
                const info = taskPos[id];
                const t = info.data;
                const spanPx = Math.max(48, xOf(t.ef) - xOf(t.es) - nodeR * 2 - 4);
                const maxChars = Math.max(3, Math.floor(spanPx / charPx));
                const lines = wrapText(t.name, maxChars);
                wrappedMap[id] = lines;
                if (lines.length > laneMaxLines[info.lane]) {
                    laneMaxLines[info.lane] = lines.length;
                }
            });

            const laneYs = [];
            let curY = PAD_TOP + Math.round(12 * uiScale);
            for (let l = 0; l < numLanes; l++) {
                const nodeTopNeed = isCircle3 ? (nodeR + 12) : (nodeR + boxH + 14);
                const topSpace = Math.max(laneMaxLines[l] * lineH + Math.round(22 * uiScale), nodeTopNeed);
                const y = curY + topSpace;
                laneYs.push(y);
                curY = y + Math.round((isCircle3 ? 40 : 34) * uiScale);
            }
            const yOf = function (lane) { return laneYs[lane]; };

            const axisTopY = PAD_TOP - 20;
            const axisBotY = curY + 8;

            this.contentW = PAD_LEFT + targetGraphW + PAD_RIGHT;
            this.contentH = axisBotY + PAD_BOTTOM;

            // 2. Vertical dashed day grid lines (configurable interval + top & bottom day labels)
            const ticks = [];
            for (let d = Math.floor(minDay); d <= Math.ceil(maxDay); d += step) {
                ticks.push(d);
            }
            if (ticks[ticks.length - 1] < maxDay) ticks.push(Math.ceil(maxDay));

            // Top & bottom axis rules
            this.axisLayer.appendChild(createSvgEl('line', {
                x1: PAD_LEFT - 12, y1: axisTopY, x2: xOf(maxDay) + 20, y2: axisTopY,
                stroke: '#cbd5e1', 'stroke-width': '1.2'
            }));
            this.axisLayer.appendChild(createSvgEl('line', {
                x1: PAD_LEFT - 12, y1: axisBotY, x2: xOf(maxDay) + 20, y2: axisBotY,
                stroke: '#94a3b8', 'stroke-width': '1.5'
            }));

            const self = this;

            // Subtle daily minor vertical dashed lines when pxPerDay >= 16 and step > 1
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

            // Major vertical dashed day lines + top & bottom day labels
            ticks.forEach(function (d) {
                const tx = xOf(d);
                self.gridLayer.appendChild(createSvgEl('line', {
                    x1: tx, y1: axisTopY, x2: tx, y2: axisBotY,
                    stroke: '#cbd5e1', 'stroke-width': '1.2', 'stroke-dasharray': '5 4'
                }));
                // Top day label
                const topLbl = createSvgEl('text', {
                    x: tx, y: axisTopY - 8, 'text-anchor': 'middle',
                    'font-size': String(axisFontSize), fill: '#64748b', 'font-weight': '600'
                });
                topLbl.textContent = d + '天';
                self.axisLayer.appendChild(topLbl);

                // Bottom tick + day label
                self.axisLayer.appendChild(createSvgEl('line', {
                    x1: tx, y1: axisBotY, x2: tx, y2: axisBotY + 6,
                    stroke: '#64748b', 'stroke-width': '1.4'
                }));
                const botLbl = createSvgEl('text', {
                    x: tx, y: axisBotY + Math.round(20 * uiScale), 'text-anchor': 'middle',
                    'font-size': String(axisFontSize), fill: '#334155', 'font-weight': '700'
                });
                botLbl.textContent = '第' + d + '天';
                self.axisLayer.appendChild(botLbl);
            });

            // Footer legend
            const footerTxt = createSvgEl('text', {
                x: self.contentW / 2, y: axisBotY + Math.round(44 * uiScale), 'text-anchor': 'middle',
                'font-size': String(axisFontSize), fill: '#475569', 'font-weight': '600'
            });
            footerTxt.textContent = isCircle3
                ? '節點三格圓：[ 上半圓: 天數 / 左下: ES 最早 / 右下: LF 最晚 ]  ｜  紅線：要徑 (TF=0)   黑線：非要徑   虛線：相依邏輯'
                : '節點上方雙格：[ 上: ES 最早 / 下: LF 最晚 ]  ｜  紅線：要徑 (TF=0)   黑線：非要徑   虛線：相依邏輯';
            this.axisLayer.appendChild(footerTxt);

            // 3. Collect unique event nodes with earliest (ES/TE) & latest (LF/TL) times
            const nodePoints = new Map();
            function upsertEventNode(day, lane, te, tl, isCp) {
                const key = day + ':' + lane;
                if (!nodePoints.has(key)) {
                    nodePoints.set(key, {
                        day: day,
                        lane: lane,
                        x: xOf(day),
                        y: yOf(lane),
                        te: te,
                        tl: tl,
                        cp: isCp
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
                // Start event node: TE = rawEs - 1, TL = rawLs - 1
                upsertEventNode(t.es, info.lane, Math.max(0, t.rawEs - 1), Math.max(0, t.rawLs - 1), t.cp);
                // End event node: TE = rawEf, TL = rawLf
                upsertEventNode(t.ef, info.lane, t.rawEf, t.rawLf, t.cp);
            });

            // Assign sequential ADM event numbers (1, 2, 3...) sorted left-to-right, top-to-bottom
            const orderedNodes = Array.from(nodePoints.values()).sort(function (a, b) {
                if (a.day !== b.day) return a.day - b.day;
                return a.lane - b.lane;
            });
            orderedNodes.forEach(function (pt, idx) {
                pt.nodeNo = idx + 1;
            });

            // 4. Dashed dependency (dummy) connectors
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
                    let dPath;
                    if (t.ef < midTimeline) {
                        dPath = `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`;
                    } else {
                        dPath = `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`;
                    }
                    self.dummyLayer.appendChild(createSvgEl('path', {
                        d: dPath,
                        fill: 'none',
                        stroke: '#94a3b8',
                        'stroke-width': '1.35',
                        'stroke-dasharray': '5 4',
                        class: 'adm-dummy' + (isCritLink ? ' is-critical' : ' is-noncritical')
                    }));
                });
            });

            // 5. Activity arrows & crisp halo labels
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
                    x1: startX,
                    y1: y,
                    x2: Math.max(startX + 4, endX),
                    y2: y,
                    stroke: t.cp ? '#ef4444' : '#1e293b',
                    'stroke-width': String(t.cp ? (2.8 * uiScale).toFixed(1) : (1.9 * uiScale).toFixed(1)),
                    'marker-end': t.cp ? 'url(#adm-arrow-crit)' : 'url(#adm-arrow-norm)'
                }));

                // Multi-line wrapped name above arrow with white halo so vertical grid lines never obscure text
                const midX = (x1 + x2) / 2;
                const lines = wrappedMap[id] || [t.name];
                lines.forEach(function (line, idx) {
                    const ly = y - Math.round(10 * uiScale) - (lines.length - 1 - idx) * lineH;
                    const txt = createSvgEl('text', {
                        x: midX, y: ly, 'text-anchor': 'middle',
                        'font-size': String(fontSize), 'font-weight': '700',
                        fill: t.cp ? '#991b1b' : '#0f172a',
                        stroke: '#ffffff',
                        'stroke-width': String(Math.round(4 * uiScale)),
                        'stroke-linejoin': 'round',
                        'paint-order': 'stroke'
                    });
                    txt.textContent = line;
                    g.appendChild(txt);
                });

                // Duration label below arrow
                const durTxt = createSvgEl('text', {
                    x: midX, y: y + Math.round(18 * uiScale), 'text-anchor': 'middle',
                    'font-size': String(Math.max(10, Math.round(fontSize - 1))), 'font-weight': '600',
                    fill: '#475569',
                    stroke: '#ffffff',
                    'stroke-width': '3',
                    'paint-order': 'stroke'
                });
                durTxt.textContent = t.duration + ' 天';
                g.appendChild(durTxt);

                g.addEventListener('mouseenter', function (ev) { self._showTooltip(ev, t); });
                g.addEventListener('mousemove', function (ev) { self._moveTooltip(ev); });
                g.addEventListener('mouseleave', function () { self._hideTooltip(); });

                self.arrowLayer.appendChild(g);
            });

            // 6. Circular event nodes
            orderedNodes.forEach(function (pt, idx) {
                const isCritNode = pt.cp || (pt.te === pt.tl);
                const strokeCol = isCritNode ? '#ef4444' : '#2563eb';
                const topBg = isCritNode ? '#fff1f2' : '#eff6ff';

                const ng = createSvgEl('g', {
                    class: 'adm-event-node' + (pt.cp ? ' is-critical' : ' is-noncritical')
                });

                if (isCircle3) {
                    // 3-Sector ADM Circle: Top half = Day, Bottom-left 1/4 = ES, Bottom-right 1/4 = LF
                    const clipId = 'adm-c3-clip-' + idx + '-' + Math.round(pt.x);
                    const clip = createSvgEl('clipPath', { id: clipId });
                    clip.appendChild(createSvgEl('circle', { cx: pt.x, cy: pt.y, r: nodeR }));
                    ng.appendChild(clip);

                    const cInner = createSvgEl('g', { 'clip-path': `url(#${clipId})` });
                    // Top half soft fill
                    cInner.appendChild(createSvgEl('rect', {
                        x: pt.x - nodeR, y: pt.y - nodeR, width: nodeR * 2, height: nodeR, fill: topBg
                    }));
                    // Bottom half white fill
                    cInner.appendChild(createSvgEl('rect', {
                        x: pt.x - nodeR, y: pt.y, width: nodeR * 2, height: nodeR, fill: '#ffffff'
                    }));
                    // Horizontal diameter divider (top 1/2 vs bottom 1/2)
                    cInner.appendChild(createSvgEl('line', {
                        x1: pt.x - nodeR, y1: pt.y, x2: pt.x + nodeR, y2: pt.y,
                        stroke: strokeCol, 'stroke-width': String((1.3 * uiScale).toFixed(1))
                    }));
                    // Vertical bottom-half radius divider (bottom-left 1/4 vs bottom-right 1/4)
                    cInner.appendChild(createSvgEl('line', {
                        x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y + nodeR,
                        stroke: strokeCol, 'stroke-width': String((1.3 * uiScale).toFixed(1))
                    }));
                    ng.appendChild(cInner);

                    // Outer circle border
                    ng.appendChild(createSvgEl('circle', {
                        cx: pt.x, cy: pt.y, r: nodeR,
                        fill: 'none',
                        stroke: strokeCol,
                        'stroke-width': String(((pt.cp ? 2 : 1.5) * uiScale).toFixed(1))
                    }));

                    const subFont = Math.max(8, Math.round(boxFontSize * 0.86));
                    // Top half: Day
                    const dayTxt = createSvgEl('text', {
                        x: pt.x, y: pt.y - Math.round(nodeR * 0.22), 'text-anchor': 'middle',
                        'font-size': String(boxFontSize), 'font-weight': '700',
                        fill: isCritNode ? '#b91c1c' : '#0f172a'
                    });
                    dayTxt.textContent = String(Math.round(pt.day));
                    ng.appendChild(dayTxt);

                    // Bottom-left 1/4: ES
                    const esTxt = createSvgEl('text', {
                        x: pt.x - Math.round(nodeR * 0.42), y: pt.y + Math.round(nodeR * 0.56), 'text-anchor': 'middle',
                        'font-size': String(subFont), 'font-weight': '700',
                        fill: isCritNode ? '#be123c' : '#1d4ed8'
                    });
                    esTxt.textContent = String(Math.round(pt.te));
                    ng.appendChild(esTxt);

                    // Bottom-right 1/4: LF
                    const lfTxt = createSvgEl('text', {
                        x: pt.x + Math.round(nodeR * 0.42), y: pt.y + Math.round(nodeR * 0.56), 'text-anchor': 'middle',
                        'font-size': String(subFont), 'font-weight': '700',
                        fill: isCritNode ? '#be123c' : '#334155'
                    });
                    lfTxt.textContent = String(Math.round(pt.tl));
                    ng.appendChild(lfTxt);
                } else {
                    // Classic 2-cell [ES / LF] vertical box directly above the circle
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
                        'font-size': String(boxFontSize), 'font-weight': '700',
                        fill: isCritNode ? '#be123c' : '#1d4ed8'
                    });
                    esTxt.textContent = String(Math.round(pt.te));
                    ng.appendChild(esTxt);

                    const lfTxt = createSvgEl('text', {
                        x: pt.x, y: by + cellH + Math.round(cellH * 0.75), 'text-anchor': 'middle',
                        'font-size': String(boxFontSize), 'font-weight': '700',
                        fill: isCritNode ? '#be123c' : '#334155'
                    });
                    lfTxt.textContent = String(Math.round(pt.tl));
                    ng.appendChild(lfTxt);

                    // Event circle with sequential node number
                    ng.appendChild(createSvgEl('circle', {
                        cx: pt.x, cy: pt.y, r: nodeR,
                        fill: '#ffffff',
                        stroke: pt.cp ? '#ef4444' : '#334155',
                        'stroke-width': String((pt.cp ? 2 : 1.5) * uiScale)
                    }));
                    const txt = createSvgEl('text', {
                        x: pt.x, y: pt.y + Math.round(boxFontSize * 0.36), 'text-anchor': 'middle',
                        'font-size': String(boxFontSize), 'font-weight': '700',
                        fill: pt.cp ? '#b91c1c' : '#0f172a'
                    });
                    txt.textContent = String(pt.nodeNo);
                    ng.appendChild(txt);
                }
                self.nodeLayer.appendChild(ng);
            });

            this._applyCriticalHighlight();
            if (autoFit) {
                requestAnimationFrame(function () {
                    self.fitToView();
                });
            } else {
                this._applyTransform();
            }
        }

        _showTooltip(ev, t) {
            if (!this.tooltipEl) return;
            const badge = t.cp
                ? '<span style="background:#ffe4e6;color:#be123c;padding:1px 6px;border-radius:999px;font-size:11px;font-weight:700;">要徑 TF=0</span>'
                : '<span style="background:#dbeafe;color:#1d4ed8;padding:1px 6px;border-radius:999px;font-size:11px;font-weight:700;">浮時 +' + t.tf + ' 天</span>';
            this.tooltipEl.innerHTML =
                '<div style="font-weight:700;color:#0f172a;margin-bottom:4px;">' + t.name + ' ' + badge + '</div>' +
                '<div style="font-size:12px;color:#475569;line-height:1.6;">' +
                '工期：<strong>' + t.duration + ' 天</strong>　比率：<strong>' + t.unit_price + '%</strong><br>' +
                '最早 (ES~EF)：第 ' + t.rawEs + ' ～ ' + t.rawEf + ' 天<br>' +
                '最晚 (LS~LF)：第 ' + t.rawLs + ' ～ ' + t.rawLf + ' 天' +
                '</div>';
            this.tooltipEl.style.display = 'block';
            this._moveTooltip(ev);
        }

        _moveTooltip(ev) {
            if (!this.tooltipEl || !this.container) return;
            const rect = this.container.getBoundingClientRect();
            let x = ev.clientX - rect.left + 14;
            let y = ev.clientY - rect.top + 14;
            if (x + 240 > rect.width) x = Math.max(8, x - 255);
            if (y + 110 > rect.height) y = Math.max(8, y - 115);
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
            if (this.criticalOnly) {
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

        setData(nodes, links, autoFit) {
            this.rawNodes = Array.isArray(nodes) ? nodes : [];
            if (Array.isArray(links)) this.rawLinks = links;
            this.render(Boolean(autoFit));
        }

        setNodeStyle(style) {
            this.nodeStyle = (style === 'circle3') ? 'circle3' : 'box';
            this.render(false);
        }

        setValueType(vt) {
            this.valueType = vt || 'esef';
            this.render(true);
        }

        setStretch(val) {
            this.stretch = Math.min(3.0, Math.max(0.6, Number(val) || 1.2));
            this.render(false);
        }

        setFontSize(val) {
            if (val === 'auto') {
                this.fontSize = 'auto';
            } else {
                this.fontSize = Math.min(64, Math.max(8, Number(val) || 13));
            }
            this.render(false);
        }

        setGridStep(stepVal) {
            this.gridStep = stepVal || 'auto';
            this.render(false);
            this.fitToHeight();
        }

        setCriticalOnly(enabled) {
            this.criticalOnly = Boolean(enabled);
            this._applyCriticalHighlight();
        }

        fitToHeight() {
            const rect = this.container.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const scaleY = (rect.height - 24) / Math.max(1, this.contentH);
            this.scale = Math.min(2.2, Math.max(this.minScale, scaleY));
            const scaledW = this.contentW * this.scale;
            const scaledH = this.contentH * this.scale;
            this.tx = scaledW <= rect.width ? (rect.width - scaledW) / 2 : 16;
            this.ty = (rect.height - scaledH) / 2;
            this._applyTransform();
        }

        fitToView() {
            const rect = this.container.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const scaleX = (rect.width - 28) / Math.max(1, this.contentW);
            const scaleY = (rect.height - 24) / Math.max(1, this.contentH);
            // Prefer filling height so ADM looks bold and readable; only shrink to X if height-fit would overflow too much
            const preferred = (this.contentW * scaleY <= rect.width * 1.35) ? scaleY : Math.max(scaleX, scaleY * 0.72);
            this.scale = Math.min(2.2, Math.max(this.minScale, preferred));
            const scaledW = this.contentW * this.scale;
            const scaledH = this.contentH * this.scale;
            this.tx = scaledW <= rect.width ? (rect.width - scaledW) / 2 : 16;
            this.ty = (rect.height - scaledH) / 2;
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

        zoomIn() { this.zoomBy(1.18); }
        zoomOut() { this.zoomBy(0.84); }
        zoomReset() {
            this.scale = 1;
            const rect = this.container.getBoundingClientRect();
            this.tx = (rect.width - this.contentW) / 2;
            this.ty = (rect.height - this.contentH) / 2;
            this._applyTransform();
        }

        exportPng(filename) {
            const titlePad = this.projectTitle ? 44 : 16;
            const exportW = Math.ceil(this.contentW);
            const exportH = Math.ceil(this.contentH + titlePad);

            const clone = this.svg.cloneNode(true);
            clone.setAttribute('xmlns', SVG_NS);
            clone.setAttribute('width', String(exportW));
            clone.setAttribute('height', String(exportH));
            clone.setAttribute('viewBox', `0 0 ${exportW} ${exportH}`);
            clone.removeAttribute('class');

            // Inline font & critical-only opacity rules so standalone SVG renders identically
            const styleEl = createSvgEl('style');
            styleEl.textContent =
                'text { font-family: "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif; }' +
                (this.criticalOnly
                    ? ' .adm-task-group.is-noncritical, .adm-dummy.is-noncritical, .adm-event-node.is-noncritical { opacity: 0.14; }'
                    : '');
            clone.insertBefore(styleEl, clone.firstChild);

            // Solid white background
            const bg = createSvgEl('rect', { x: 0, y: 0, width: exportW, height: exportH, fill: '#ffffff' });
            clone.insertBefore(bg, clone.firstChild);

            // Reset viewport transform and offset down for title
            const vp = clone.querySelector('.adm-viewport');
            if (vp) {
                vp.setAttribute('transform', `translate(0, ${titlePad})`);
            }

            if (this.projectTitle) {
                const titleNode = createSvgEl('text', {
                    x: exportW / 2,
                    y: 30,
                    'text-anchor': 'middle',
                    'font-size': '18',
                    'font-weight': '700',
                    fill: '#0f172a'
                });
                titleNode.textContent = this.projectTitle + ' — ADM 箭線網圖';
                clone.appendChild(titleNode);
            }

            const svgStr = new XMLSerializer().serializeToString(clone);
            const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);

            const img = new Image();
            img.onload = function () {
                const dpr = 2; // 2x high-resolution crisp export
                const canvas = document.createElement('canvas');
                canvas.width = exportW * dpr;
                canvas.height = exportH * dpr;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.scale(dpr, dpr);
                ctx.drawImage(img, 0, 0, exportW, exportH);
                URL.revokeObjectURL(url);

                const safeName = (filename || 'ADM_箭線圖.png').replace(/[\\/:*?"<>|]/g, '_');
                canvas.toBlob(function (blob) {
                    if (!blob) return;
                    const dlUrl = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = dlUrl;
                    a.download = safeName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(function () { URL.revokeObjectURL(dlUrl); }, 1000);
                }, 'image/png');
            };
            img.src = url;
        }
    }

    AdmCanvas.recommendGridStep = function (totalDuration) {
        const d = Math.max(1, Number(totalDuration) || 1);
        if (d <= 20) return 1;
        if (d <= 60) return 5;
        if (d <= 95) return 7;
        if (d <= 160) return 10;
        if (d <= 280) return 15;
        return 30;
    };

    global.AdmCanvas = AdmCanvas;
})(window);
