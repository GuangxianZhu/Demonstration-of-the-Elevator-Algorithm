/* 页面交互与动画。算法本身在 algorithms.js 里。 */
(function () {
  'use strict';

  var E = window.Elevator;
  var ALGOS = E.ALGOS;
  var ROW_H = 44;          // 与 style.css 中 --row-h 一致
  var FLOOR_TIME = 0.8;    // 移动一层所需秒数（1× 速度）
  var DOOR_TIME = 1.2;     // 开关门停靠秒数
  var TRACE_WINDOW = 40;   // 轨迹图显示最近多少秒

  var $ = function (id) { return document.getElementById(id); };

  // ---------------- 状态 ----------------
  var S;
  function freshState(N) {
    return {
      N: N,
      floor: 1,
      from: 1,
      to: 1,
      moving: false,
      progress: 0,
      dir: 0,
      target: null,
      door: 0,
      pending: [],      // { floor, t }
      served: [],       // { floor, wait, t }
      distance: 0,
      time: 0,
      lastReason: '',
      trace: [],        // { t, y }
      stops: [],        // { t, y }
      traceAcc: 0,
      autoAcc: 0,
      starveUntil: -1,
    };
  }

  var paused = false;

  // ---------------- 初始化 UI ----------------
  Object.keys(ALGOS).forEach(function (k) {
    var o = document.createElement('option');
    o.value = k;
    o.textContent = ALGOS[k].name;
    $('algo').appendChild(o);
  });
  $('algo').value = 'LOOK';

  var floorsCol = document.createElement('div');
  floorsCol.className = 'floorsCol';
  $('building').insertBefore(floorsCol, $('shaft'));

  function algo() { return $('algo').value; }
  function speed() { return parseFloat($('speed').value); }

  function buildBuilding() {
    floorsCol.innerHTML = '';
    for (var f = S.N; f >= 1; f--) {
      var row = document.createElement('div');
      row.className = 'floorRow';
      row.dataset.floor = f;
      row.innerHTML =
        '<span class="num">' + f + 'F</span>' +
        '<button type="button">呼叫</button>' +
        '<span class="lamp"></span>';
      row.querySelector('button').addEventListener('click', addRequest.bind(null, f));
      floorsCol.appendChild(row);
    }
    $('shaft').style.height = S.N * ROW_H + 'px';
  }

  function reset() {
    var N = clamp(parseInt($('floors').value, 10) || 10, 4, 20);
    $('floors').value = N;
    S = freshState(N);
    buildBuilding();
    $('log').innerHTML = '';
    log('电梯停在 1 楼，等待请求。');
    render();
  }

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  // ---------------- 请求 ----------------
  function addRequest(f) {
    if (f < 1 || f > S.N) return;
    if (S.pending.some(function (p) { return p.floor === f; })) return; // 同层已有请求，合并
    if (!S.moving && S.door <= 0 && S.floor === f && !S.pending.length) {
      // 就在这一层且空闲：直接开门
      S.pending.push({ floor: f, t: S.time });
      plan();
      return;
    }
    S.pending.push({ floor: f, t: S.time });
    log(f + ' 楼有人按了按钮。');
  }

  function randomFloor(lo, hi) {
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  // ---------------- 调度核心 ----------------
  function serveHere() {
    var f = S.floor;
    var idx = S.pending.findIndex(function (p) { return p.floor === f; });
    var req = S.pending.splice(idx, 1)[0];
    var wait = S.time - req.t;
    S.served.push({ floor: f, wait: wait, t: S.time });
    S.stops.push({ t: S.time, y: f });
    S.door = DOOR_TIME;
    log('到达 ' + f + ' 楼，开门服务（等待了 ' + wait.toFixed(1) + ' 秒）。', 'serve');
  }

  function plan() {
    if (E.canServe(algo(), S.floor, S.pending)) {
      serveHere();
      return;
    }
    var d = E.decide(algo(), S.floor, S.dir, S.pending, S.N);
    S.target = d.target;
    // 目标或方向变了才记一条，避免每经过一层都刷屏
    var key = d.target + '|' + d.dir;
    if (key !== S.lastReason) {
      log(d.reason);
      S.lastReason = key;
    }
    if (d.target === null) {
      // SCAN/LOOK 空闲时清掉方向，下次按最近的请求定方向
      S.dir = 0;
      return;
    }
    S.dir = d.dir;
    S.from = S.floor;
    S.to = S.floor + E.sign(d.target - S.floor);
    S.moving = true;
    S.progress = 0;
  }

  function step(dt) {
    S.time += dt;

    // 自动请求
    if ($('auto').checked || S.time < S.starveUntil) {
      S.autoAcc += dt;
      var every = S.time < S.starveUntil ? 1.6 : 2.5;
      while (S.autoAcc >= every) {
        S.autoAcc -= every;
        if (S.time < S.starveUntil) {
          var mid = Math.ceil(S.N / 2);
          addRequest(randomFloor(mid - 1, mid + 1));
        } else {
          addRequest(randomFloor(1, S.N));
        }
      }
    }

    if (S.door > 0) {
      S.door -= dt;
      if (S.door <= 0) { S.door = 0; S.lastReason = ''; plan(); }
    } else if (S.moving) {
      S.progress += dt / FLOOR_TIME;
      if (S.progress >= 1) {
        S.floor = S.to;
        S.moving = false;
        S.progress = 0;
        S.distance += 1;
        plan(); // 每到一层都重新决策：可能顺路停，也可能改主意
      }
    } else {
      plan();
    }

    // 轨迹采样
    S.traceAcc += dt;
    if (S.traceAcc >= 0.1) {
      S.traceAcc = 0;
      S.trace.push({ t: S.time, y: carPos() });
      while (S.trace.length && S.trace[0].t < S.time - TRACE_WINDOW) S.trace.shift();
      while (S.stops.length && S.stops[0].t < S.time - TRACE_WINDOW) S.stops.shift();
    }
  }

  function carPos() {
    return S.moving ? S.from + (S.to - S.from) * S.progress : S.floor;
  }

  // ---------------- 渲染 ----------------
  function render() {
    var pos = carPos();
    var car = $('car');
    car.style.transform = 'translateY(' + ((S.N - pos) * ROW_H + 3) + 'px)';
    car.classList.toggle('open', S.door > 0);
    $('carLabel').textContent = Math.round(pos);

    var pend = {};
    S.pending.forEach(function (p) { pend[p.floor] = p; });
    var rows = floorsCol.children;
    for (var i = 0; i < rows.length; i++) {
      var f = +rows[i].dataset.floor;
      var on = !!pend[f];
      rows[i].classList.toggle('pending', on);
      rows[i].querySelector('.lamp').textContent = on ? '等待 ' + (S.time - pend[f].t).toFixed(0) + 's' : '';
    }

    $('sFloor').textContent = Math.round(pos);
    $('sDir').textContent = (S.dir > 0 ? '↑ ' : S.dir < 0 ? '↓ ' : '') + E.dirText(S.dir);
    $('sTarget').textContent = S.target === null ? '—' : S.target + ' 楼';
    $('sDist').textContent = S.distance + ' 层';
    $('sServed').textContent = S.served.length;
    if (S.served.length) {
      var sum = 0, max = 0;
      S.served.forEach(function (s) { sum += s.wait; max = Math.max(max, s.wait); });
      $('sAvg').textContent = (sum / S.served.length).toFixed(1) + ' 秒';
      $('sMax').textContent = max.toFixed(1) + ' 秒';
    } else {
      $('sAvg').textContent = '—';
      $('sMax').textContent = '—';
    }

    var q = $('queue');
    if (!S.pending.length) {
      q.innerHTML = '<span class="empty">空</span>';
    } else {
      q.innerHTML = S.pending.map(function (p) {
        var w = S.time - p.t;
        var cls = 'chip' + (p.floor === S.target ? ' target' : '') + (w > 20 ? ' old' : '');
        return '<span class="' + cls + '"><b>' + p.floor + '</b>F · ' + w.toFixed(0) + 's</span>';
      }).join('');
    }

    renderTrace();
  }

  function renderTrace() {
    var svg = $('trace');
    var W = 600, H = 160, pad = 8;
    var t0 = S.time - TRACE_WINDOW;
    var x = function (t) { return ((t - t0) / TRACE_WINDOW) * W; };
    var y = function (f) { return H - pad - ((f - 1) / Math.max(1, S.N - 1)) * (H - 2 * pad); };
    var html = '';
    for (var f = 1; f <= S.N; f++) {
      html += '<line class="grid" x1="0" x2="' + W + '" y1="' + y(f) + '" y2="' + y(f) + '"/>';
    }
    if (S.trace.length) {
      html += '<polyline points="' + S.trace.map(function (p) {
        return x(p.t).toFixed(1) + ',' + y(p.y).toFixed(1);
      }).join(' ') + '"/>';
    }
    S.stops.forEach(function (s) {
      html += '<circle cx="' + x(s.t).toFixed(1) + '" cy="' + y(s.y).toFixed(1) + '" r="3.5"/>';
    });
    svg.innerHTML = html;
  }

  function log(msg, cls) {
    var li = document.createElement('li');
    if (cls) li.className = cls;
    li.innerHTML = '<span class="t">' + (S ? S.time.toFixed(1) : '0.0') + 's</span>' + msg;
    var ol = $('log');
    ol.appendChild(li);
    while (ol.children.length > 200) ol.removeChild(ol.firstChild);
    ol.scrollTop = ol.scrollHeight;
  }

  // ---------------- 主循环 ----------------
  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000); // 切到后台再回来时不要一下跳太多
    last = now;
    if (!paused) {
      var sim = dt * speed();
      // 拆成小步，保证高速时每一层都会被“经过”并参与决策
      var n = Math.ceil(sim / 0.02);
      for (var i = 0; i < n; i++) step(sim / n);
      render();
    }
    requestAnimationFrame(frame);
  }

  // ---------------- 事件 ----------------
  function updateAlgoDesc() {
    var a = ALGOS[algo()];
    $('algoDesc').innerHTML = '<b>' + a.name + '</b>：' + a.short +
      (a.stopOnPass ? ' 路过有请求的楼层会顺路停。' : ' 路过有请求的楼层<b>不停</b>。');
  }
  $('algo').addEventListener('change', function () {
    updateAlgoDesc();
    S.lastReason = '';
    log('切换算法为 ' + ALGOS[algo()].name + '。');
  });
  $('speed').addEventListener('input', function () { $('speedVal').textContent = speed() + '×'; });
  $('pause').addEventListener('click', function () {
    paused = !paused;
    this.textContent = paused ? '继续' : '暂停';
  });
  $('reset').addEventListener('click', reset);
  $('floors').addEventListener('change', reset);
  $('burst').addEventListener('click', function () {
    for (var i = 0; i < 5; i++) addRequest(randomFloor(1, S.N));
  });
  $('starve').addEventListener('click', function () {
    addRequest(S.N);
    S.starveUntil = S.time + 30;
    log('饥饿场景：顶楼 ' + S.N + ' 楼有人在等，接下来 30 秒中间几层会不停有人按。试试 SSTF 和 LOOK 的区别。');
  });

  // ---------------- 离线对比 ----------------
  function parseSeq() {
    return $('seq').value.split(/[\s,，、]+/).map(function (s) { return parseInt(s, 10); })
      .filter(function (x) { return !isNaN(x); });
  }

  function compare() {
    var seq = parseSeq();
    var start = parseInt($('start').value, 10) || 1;
    var N = Math.max(start, Math.max.apply(null, seq.concat([S.N])));
    var dir = parseInt($('initDir').value, 10);
    var results = Object.keys(ALGOS).map(function (k) {
      return { key: k, r: E.simulate(k, start, seq, N, dir) };
    });
    var maxDist = Math.max.apply(null, results.map(function (x) { return x.r.distance; })) || 1;
    var minDist = Math.min.apply(null, results.map(function (x) { return x.r.distance; }));

    $('compareOut').innerHTML = results.map(function (x) {
      var best = x.r.distance === minDist;
      return '<div class="cmp' + (best ? ' best' : '') + '">' +
        '<h4><span>' + ALGOS[x.key].name + '</span><span class="dist">' + x.r.distance + ' 层' + (best ? ' ✓' : '') + '</span></h4>' +
        '<div class="order">' + start + ' → ' + x.r.served.map(function (s) { return s.floor; }).join(' → ') + '</div>' +
        pathSvg(x.r, N, maxDist, 'var(--c-' + x.key + ')') +
        '<div class="bar" style="width:' + (x.r.distance / maxDist * 100) + '%;background:var(--c-' + x.key + ')"></div>' +
        '</div>';
    }).join('');

    var g = $('guess').value;
    var winners = results.filter(function (x) { return x.r.distance === minDist; }).map(function (x) { return x.key; });
    if (!g) {
      $('guessResult').textContent = '';
    } else if (winners.indexOf(g) >= 0) {
      $('guessResult').innerHTML = '🎉 猜对了！' + winners.join('、') + ' 总移动最少（' + minDist + ' 层）。';
    } else {
      $('guessResult').innerHTML = '差一点：这组请求下最少的是 ' + winners.join('、') + '（' + minDist + ' 层）。看看下面的路径图找找原因。';
    }
  }

  // 横轴 = 已移动层数（相当于时间），四张图共用同一横轴比例，长短一眼可比
  function pathSvg(r, N, maxDist, color) {
    var W = 260, H = 130, L = 22, R = 6, T = 6, B = 16;
    var x = function (s) { return L + (s / maxDist) * (W - L - R); };
    var y = function (f) { return T + ((N - f) / Math.max(1, N - 1)) * (H - T - B); };
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '">';
    var stepLbl = Math.ceil(N / 6);
    for (var f = 1; f <= N; f++) {
      out += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(f) + '" y2="' + y(f) + '" stroke-width="0.5"/>';
      if (f === 1 || f === N || f % stepLbl === 0) {
        out += '<text x="' + (L - 4) + '" y="' + (y(f) + 3) + '" text-anchor="end">' + f + '</text>';
      }
    }
    out += '<text x="' + (W - R) + '" y="' + (H - 3) + '" text-anchor="end">移动层数 →</text>';
    out += '<polyline fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" points="' +
      r.path.map(function (f, i) { return x(i).toFixed(1) + ',' + y(f).toFixed(1); }).join(' ') + '"/>';
    r.served.forEach(function (s, i) {
      out += '<circle cx="' + x(s.step).toFixed(1) + '" cy="' + y(s.floor).toFixed(1) + '" r="3" fill="' + color + '"><title>第 ' + (i + 1) + ' 个服务：' + s.floor + ' 楼</title></circle>';
    });
    out += '<circle cx="' + x(0) + '" cy="' + y(r.path[0]) + '" r="3.5" fill="none" stroke="' + color + '" stroke-width="1.5"/>';
    return out + '</svg>';
  }

  $('compare').addEventListener('click', compare);
  $('randSeq').addEventListener('click', function () {
    var arr = [];
    var n = 6 + Math.floor(Math.random() * 3);
    while (arr.length < n) {
      var f = randomFloor(1, S.N);
      if (arr.indexOf(f) < 0) arr.push(f);
    }
    $('seq').value = arr.join(', ');
    $('start').value = randomFloor(1, S.N);
  });
  $('loadSeq').addEventListener('click', function () {
    var seq = parseSeq();
    var need = Math.max.apply(null, seq.concat([parseInt($('start').value, 10) || 1, 4]));
    if (need > 20) { alert('实时模拟最多 20 层。'); return; }
    if (need > S.N) $('floors').value = need;
    reset();
    var start = parseInt($('start').value, 10) || 1;
    S.floor = S.from = S.to = start;
    S.dir = parseInt($('initDir').value, 10);
    seq.forEach(addRequest);
    log('已载入请求序列，起点 ' + start + ' 楼，初始方向' + E.dirText(S.dir) + '。');
    $('car').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // ---------------- 启动 ----------------
  reset();
  updateAlgoDesc();
  compare();
  requestAnimationFrame(frame);
})();
