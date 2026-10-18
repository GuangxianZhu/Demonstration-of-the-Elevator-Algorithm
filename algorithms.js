/*
 * 电梯调度算法（纯函数，无 DOM 依赖，浏览器和 Node 都能用）
 *
 * 约定：
 *   floor   当前所在楼层（整数，1..N）
 *   dir     当前方向：+1 向上，-1 向下，0 静止
 *   pending 未完成的请求，按到达先后排序：[{ floor, t }]
 *   N       总楼层数
 *
 * decide() 只回答“下一步往哪个楼层去”，真正的移动由调用方一层一层推进，
 * 每到一层就重新调用一次，所以途中新来的请求也能被考虑进去。
 */
(function (root) {
  'use strict';

  var ALGOS = {
    FCFS: {
      key: 'FCFS',
      name: 'FCFS 先来先服务',
      short: '谁先按谁先去，途中不停。',
      stopOnPass: false,
    },
    SSTF: {
      key: 'SSTF',
      name: 'SSTF 最短寻找优先',
      short: '每次去离自己最近的请求。',
      stopOnPass: true,
    },
    SCAN: {
      key: 'SCAN',
      name: 'SCAN 扫描（电梯算法）',
      short: '沿一个方向扫到尽头再掉头。',
      stopOnPass: true,
    },
    LOOK: {
      key: 'LOOK',
      name: 'LOOK 视察',
      short: '沿一个方向走，前方没请求就掉头。',
      stopOnPass: true,
    },
  };

  function sign(x) {
    return x > 0 ? 1 : x < 0 ? -1 : 0;
  }

  function dirText(d) {
    return d > 0 ? '向上' : d < 0 ? '向下' : '静止';
  }

  // 在方向 d 上（不含当前层）离 floor 最近的请求
  function nearestAhead(floor, d, pending) {
    var best = null;
    for (var i = 0; i < pending.length; i++) {
      var f = pending[i].floor;
      if (sign(f - floor) !== d) continue;
      if (best === null || Math.abs(f - floor) < Math.abs(best - floor)) best = f;
    }
    return best;
  }

  function nearest(floor, dir, pending) {
    var best = null;
    for (var i = 0; i < pending.length; i++) {
      var f = pending[i].floor;
      if (best === null) {
        best = f;
        continue;
      }
      var df = Math.abs(f - floor);
      var db = Math.abs(best - floor);
      // 距离相同时优先保持当前方向（静止时优先向上），减少来回折返
      if (df < db || (df === db && sign(f - floor) === (dir || 1))) best = f;
    }
    return best;
  }

  // 当前层的请求能不能顺手服务
  function canServe(algo, floor, pending) {
    if (!pending.length) return false;
    if (!ALGOS[algo].stopOnPass) return pending[0].floor === floor;
    for (var i = 0; i < pending.length; i++) if (pending[i].floor === floor) return true;
    return false;
  }

  function decide(algo, floor, dir, pending, N) {
    if (!pending.length) {
      return { target: null, dir: 0, reason: '没有请求，原地待机。' };
    }
    var t, d, ahead;

    switch (algo) {
      case 'FCFS':
        t = pending[0].floor;
        return {
          target: t,
          dir: sign(t - floor),
          reason: '最早的请求是 ' + t + ' 楼，直接过去，路过别的楼层也不停。',
        };

      case 'SSTF':
        t = nearest(floor, dir, pending);
        return {
          target: t,
          dir: sign(t - floor),
          reason: '离 ' + floor + ' 楼最近的请求是 ' + t + ' 楼（相距 ' + Math.abs(t - floor) + ' 层）。',
        };

      case 'LOOK':
        d = dir || sign(nearest(floor, dir, pending) - floor);
        ahead = nearestAhead(floor, d, pending);
        if (ahead !== null) {
          return {
            target: ahead,
            dir: d,
            reason: '保持' + dirText(d) + '，前方最近的请求是 ' + ahead + ' 楼。',
          };
        }
        d = -d;
        ahead = nearestAhead(floor, d, pending);
        return {
          target: ahead,
          dir: d,
          reason: '前方已没有请求，立刻掉头' + dirText(d) + '，去 ' + ahead + ' 楼。',
        };

      case 'SCAN': {
        d = dir || sign(nearest(floor, dir, pending) - floor);
        var end = d > 0 ? N : 1;
        ahead = nearestAhead(floor, d, pending);
        if (ahead !== null) {
          return {
            target: ahead,
            dir: d,
            reason: '保持' + dirText(d) + '，前方最近的请求是 ' + ahead + ' 楼。',
          };
        }
        if (floor !== end) {
          return {
            target: end,
            dir: d,
            reason: '前方已没有请求，但 SCAN 要扫到尽头 ' + end + ' 楼才掉头。',
          };
        }
        d = -d;
        end = d > 0 ? N : 1;
        ahead = nearestAhead(floor, d, pending);
        return {
          target: ahead !== null ? ahead : end,
          dir: d,
          reason: '到达尽头 ' + floor + ' 楼，掉头' + dirText(d) + '。',
        };
      }
    }
    throw new Error('未知算法 ' + algo);
  }

  // 离线模拟：所有请求一开始就已知，用来画对比图、算总移动距离
  function simulate(algo, start, requests, N, initDir) {
    var pending = [];
    requests.forEach(function (f, i) {
      if (f >= 1 && f <= N && !pending.some(function (p) { return p.floor === f; })) {
        pending.push({ floor: f, t: i });
      }
    });
    var floor = start;
    var dir = initDir || 0;
    var path = [floor];
    var served = []; // { floor, step }
    var guard = 0;

    while (guard++ < 10000) {
      while (canServe(algo, floor, pending)) {
        var idx = pending.findIndex(function (p) { return p.floor === floor; });
        pending.splice(idx, 1);
        served.push({ floor: floor, step: path.length - 1 });
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
    decide: decide,
    canServe: canServe,
    simulate: simulate,
    dirText: dirText,
    sign: sign,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Elevator = api;
})(this);
