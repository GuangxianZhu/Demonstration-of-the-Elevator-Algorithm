/*
 * 电梯调度算法（纯函数，无 DOM 依赖，浏览器和 Node 都能用）
 *
 * 请求分两种，和真实电梯一样：
 *   外呼（厅外按钮）：{ floor, type: 'up' | 'down', t }  人在楼层，按 ▲ 或 ▼
 *   内呼（轿厢按钮）：{ floor, type: 'car', t }          人在电梯里，按目标楼层
 *
 * 约定：
 *   floor   当前所在楼层（整数，1..N）
 *   dir     当前运行方向：+1 向上，-1 向下，0 空闲
 *   pending 未完成的请求，按到达先后排序
 *   N       总楼层数
 *
 * 每到一层，调用方先问 stops()：“这一层要不要开门、接/放哪些人”，
 * 不停就再问 decide()：“下一步往哪走”。电梯一层一层推进，
 * 途中新来的请求在下一层就会被考虑进去。
 */
(function (root) {
  'use strict';

  var ALGOS = {
    FCFS: {
      key: 'FCFS',
      name: 'FCFS 先来先服务',
      short: '严格按按钮被按下的先后顺序一个一个处理，路过别的楼层也不停。',
    },
    SSTF: {
      key: 'SSTF',
      name: 'SSTF 最短寻找优先',
      short: '每次去离自己最近的请求，不管那人想上还是想下。',
    },
    SCAN: {
      key: 'SCAN',
      name: 'SCAN 扫描（电梯算法）',
      short: '沿一个方向一直走到顶层/底层再掉头；只接同方向的外呼，反方向的等回程再接。',
    },
    LOOK: {
      key: 'LOOK',
      name: 'LOOK 视察',
      short: '沿一个方向走，前方没有要处理的请求就掉头；只接同方向的外呼，反方向的等回程再接。',
    },
  };

  function sign(x) {
    return x > 0 ? 1 : x < 0 ? -1 : 0;
  }

  function dirText(d) {
    return d > 0 ? '向上' : d < 0 ? '向下' : '空闲';
  }

  function typeDir(type) {
    return type === 'up' ? 1 : type === 'down' ? -1 : 0;
  }

  function label(p) {
    return p.floor + (p.type === 'up' ? '楼▲' : p.type === 'down' ? '楼▼' : '楼(内)');
  }

  // 运行方向为 d 时，路过这个请求能不能顺路停：内呼都能，外呼要同方向
  function passable(p, d) {
    return p.type === 'car' || typeDir(p.type) === d;
  }

  function aheadOf(floor, d, pending) {
    return pending.filter(function (p) { return sign(p.floor - floor) === d; });
  }

  function closest(floor, list, dir) {
    var best = null;
    list.forEach(function (p) {
      if (best === null) { best = p; return; }
      var dp = Math.abs(p.floor - floor);
      var db = Math.abs(best.floor - floor);
      // 距离相同时优先保持当前方向（空闲时优先向上），减少来回折返
      if (dp < db || (dp === db && sign(p.floor - floor) === (dir || 1) && sign(best.floor - floor) !== (dir || 1))) best = p;
    });
    return best;
  }

  function farthest(floor, list) {
    var best = null;
    list.forEach(function (p) {
      if (best === null || Math.abs(p.floor - floor) > Math.abs(best.floor - floor)) best = p;
    });
    return best;
  }

  function endOf(d, N) {
    return d > 0 ? N : 1;
  }

  // 空闲时定方向：本层有外呼就按它的方向，否则朝最近的请求走
  function startDir(floor, dir, pending) {
    if (dir) return dir;
    for (var i = 0; i < pending.length; i++) {
      if (pending[i].floor === floor && pending[i].type !== 'car') return typeDir(pending[i].type);
    }
    var c = closest(floor, pending, 0);
    return c ? sign(c.floor - floor) : 0;
  }

  /*
   * 到达 floor 时，这一层要服务哪些请求。
   * 返回 { serve: [请求...], dir: 服务后的运行方向 }，serve 为空表示不停。
   */
  function stops(algo, floor, dir, pending, N) {
    var here = pending.filter(function (p) { return p.floor === floor; });
    if (!here.length) return { serve: [], dir: dir };

    if (algo === 'FCFS') {
      // 只有排在队首的请求恰好在这一层才停（连续几个都在这层就一起处理）
      var serve = [];
      for (var i = 0; i < pending.length && pending[i].floor === floor; i++) serve.push(pending[i]);
      return { serve: serve, dir: dir };
    }

    if (algo === 'SSTF') {
      // SSTF 不看方向：到了就全接
      return { serve: here, dir: dir };
    }

    // SCAN / LOOK：按方向区分
    var d = startDir(floor, dir, pending);
    if (d === 0) return { serve: here, dir: 0 };

    var serveNow = here.filter(function (p) { return passable(p, d); });
    var boardingSameDir = serveNow.some(function (p) { return p.type !== 'car'; });
    var rest = pending.filter(function (p) { return p.floor !== floor; });
    var nothingAhead = aheadOf(floor, d, rest).length === 0;
    // LOOK：前方没请求就能在这里掉头；SCAN：必须到了尽头才掉头
    var canTurn = nothingAhead && (algo === 'LOOK' || floor === endOf(d, N));

    if (canTurn && !boardingSameDir) {
      var opposite = here.filter(function (p) { return typeDir(p.type) === -d; });
      if (opposite.length) return { serve: serveNow.concat(opposite), dir: -d };
    }
    return { serve: serveNow, dir: d };
  }

  /*
   * 不停的时候，下一步往哪个楼层去。
   * 返回 { target, dir, reason }，target 为 null 表示待机。
   */
  function decide(algo, floor, dir, pending, N) {
    var others = pending.filter(function (p) { return p.floor !== floor; });
    if (!others.length) {
      return { target: null, dir: 0, reason: '没有请求，原地待机。' };
    }
    var t;

    if (algo === 'FCFS') {
      t = pending[0];
      return {
        target: t.floor,
        dir: sign(t.floor - floor),
        reason: '队首是 ' + label(t) + '，直接过去，路过别的楼层也不停。',
      };
    }

    if (algo === 'SSTF') {
      t = closest(floor, others, dir);
      return {
        target: t.floor,
        dir: sign(t.floor - floor),
        reason: '离 ' + floor + ' 楼最近的请求是 ' + label(t) + '，不管方向，先去那里。',
      };
    }

    // SCAN / LOOK
    var d = startDir(floor, dir, others);
    var tries = [d, -d];
    for (var k = 0; k < 2; k++) {
      var td = tries[k];
      var turn = k === 1 ? '掉头' + dirText(td) + '，' : '保持' + dirText(td) + '，';
      var ahead = aheadOf(floor, td, others);
      var end = endOf(td, N);

      if (algo === 'SCAN' && k === 0 && floor !== end && (ahead.length || others.length)) {
        // SCAN：只要还有请求，就沿当前方向一路扫到尽头
        var ps0 = ahead.filter(function (p) { return passable(p, td); });
        if (ps0.length) {
          t = closest(floor, ps0, td);
          return { target: t.floor, dir: td, reason: turn + '前方最近能顺路停的是 ' + label(t) + '。' };
        }
        return {
          target: end,
          dir: td,
          reason: '前方没有同方向的请求了，但 SCAN 要先扫到尽头 ' + end + ' 楼才掉头。',
        };
      }

      if (!ahead.length) continue;
      var ps = ahead.filter(function (p) { return passable(p, td); });
      if (ps.length) {
        t = closest(floor, ps, td);
        return { target: t.floor, dir: td, reason: turn + '前方最近能顺路停的是 ' + label(t) + '。' };
      }
      if (algo === 'SCAN') {
        return {
          target: end,
          dir: td,
          reason: turn + '前方只有反方向的呼叫，SCAN 先扫到尽头 ' + end + ' 楼再回头接。',
        };
      }
      t = farthest(floor, ahead);
      return {
        target: t.floor,
        dir: td,
        reason: turn + '前方只剩反方向的呼叫，先到最远的 ' + label(t) + '，在那里掉头接人。',
      };
    }
    return { target: null, dir: 0, reason: '没有可去的请求，原地待机。' };
  }

  // 离线模拟：乘客都已在轿厢里、按好了目标楼层（全是内呼），用来画对比图、算总移动距离
  function simulate(algo, start, floors, N, initDir) {
    var pending = [];
    floors.forEach(function (f, i) {
      if (f >= 1 && f <= N && !pending.some(function (p) { return p.floor === f; })) {
        pending.push({ floor: f, type: 'car', t: i });
      }
    });
    return run(algo, start, pending, N, initDir);
  }

  // 通用离线运行器（请求一开始就全部已知），测试也用它
  function run(algo, start, pending, N, initDir) {
    pending = pending.slice();
    var floor = start;
    var dir = initDir || 0;
    var path = [floor];
    var served = []; // { floor, type, step }
    var guard = 0;

    while (guard++ < 10000) {
      var st = stops(algo, floor, dir, pending, N);
      if (st.serve.length) {
        dir = st.dir;
        st.serve.forEach(function (p) {
          pending.splice(pending.indexOf(p), 1);
          served.push({ floor: p.floor, type: p.type, step: path.length - 1 });
        });
        continue;
      }
      var dec = decide(algo, floor, dir, pending, N);
      if (dec.target === null) break;
      dir = dec.dir;
      floor += sign(dec.target - floor);
      path.push(floor);
    }
    return { path: path, served: served, distance: path.length - 1 };
  }

  var api = {
    ALGOS: ALGOS,
    stops: stops,
    decide: decide,
    simulate: simulate,
    run: run,
    dirText: dirText,
    typeDir: typeDir,
    label: label,
    sign: sign,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Elevator = api;
})(this);
