// 用操作系统教材里的经典磁盘调度例子校验算法（柱面 0..199 映射到楼层 1..200）
// 起点 53，请求 98,183,37,122,14,124,65,67，初始方向向 0
// 运行：node tests/algorithms.test.js
const assert = require('assert');
const E = require('../algorithms.js');

const req = [98, 183, 37, 122, 14, 124, 65, 67].map((x) => x + 1);
const expected = { FCFS: 640, SSTF: 236, SCAN: 236, LOOK: 208 };

for (const [algo, dist] of Object.entries(expected)) {
  const r = E.simulate(algo, 54, req, 200, -1);
  assert.strictEqual(r.distance, dist, `${algo} 总距离应为 ${dist}，实际 ${r.distance}`);
  assert.strictEqual(r.served.length, req.length, `${algo} 应服务全部请求`);
  console.log(`✓ ${algo} 总移动 ${r.distance}，服务顺序 ${r.served.map((s) => s.floor - 1).join(' → ')}`);
}

// FCFS 途中不停：路过的楼层不应被提前服务
const f = E.simulate('FCFS', 1, [10, 5], 10, 0);
assert.deepStrictEqual(f.served.map((s) => s.floor), [10, 5]);
// LOOK 途中会顺路停
const l = E.simulate('LOOK', 1, [10, 5], 10, 0);
assert.deepStrictEqual(l.served.map((s) => s.floor), [5, 10]);
console.log('✓ 顺路停靠规则正确');

// ---- 带方向的外呼 ----
// 10 层楼，电梯在 1 楼向上；有人在 5 楼按 ▼、3 楼按 ▲，车里有人按了 8
const reqs = () => [
  { floor: 5, type: 'down', t: 0 },
  { floor: 3, type: 'up', t: 1 },
  { floor: 8, type: 'car', t: 2 },
];
const order = (r) => r.served.map((s) => E.label(s)).join(' ');

// LOOK：上行时 5 楼▼ 不顺路，先接 3▲、放 8，再掉头回来接 5▼
let r = E.run('LOOK', 1, reqs(), 10, 1);
assert.strictEqual(order(r), '3楼▲ 8楼(内) 5楼▼');
assert.strictEqual(r.distance, 10);
// SCAN：同样的顺序，但放完 8 楼还要扫到 10 楼才掉头
r = E.run('SCAN', 1, reqs(), 10, 1);
assert.strictEqual(order(r), '3楼▲ 8楼(内) 5楼▼');
assert.strictEqual(r.distance, 14);
// SSTF 不看方向：路过 5 楼就把想下楼的人接上了
r = E.run('SSTF', 1, reqs(), 10, 1);
assert.strictEqual(order(r), '3楼▲ 5楼▼ 8楼(内)');
// FCFS：严格按按下的顺序
r = E.run('FCFS', 1, reqs(), 10, 1);
assert.strictEqual(order(r), '5楼▼ 3楼▲ 8楼(内)');
console.log('✓ 外呼方向规则正确（LOOK/SCAN 只顺路接同方向）');

// LOOK：前方只有反方向呼叫时，走到那一层再掉头接
r = E.run('LOOK', 1, [{ floor: 6, type: 'down', t: 0 }], 10, 1);
assert.strictEqual(r.distance, 5);
// 空闲时本层有人按 ▼：直接开门，方向定为向下
const st = E.stops('LOOK', 4, 0, [{ floor: 4, type: 'down', t: 0 }], 10);
assert.strictEqual(st.serve.length, 1);
assert.strictEqual(st.dir, -1);
console.log('✓ 掉头与空闲开门正确');

// SCAN 下行路过 2 楼时那里只有 ▲：不能接，要先扫到 1 楼再回头接
const quiz = () => [
  { floor: 7, type: 'car', t: 0 },
  { floor: 6, type: 'down', t: 1 },
  { floor: 9, type: 'down', t: 2 },
  { floor: 2, type: 'up', t: 3 },
];
const expectOrder = {
  FCFS: ['7楼(内) 6楼▼ 9楼▼ 2楼▲', 14],
  SSTF: ['6楼▼ 7楼(内) 9楼▼ 2楼▲', 12],
  SCAN: ['7楼(内) 9楼▼ 6楼▼ 2楼▲', 16],
  LOOK: ['7楼(内) 9楼▼ 6楼▼ 2楼▲', 12],
};
for (const [a, [o, dist]] of Object.entries(expectOrder)) {
  const q = E.run(a, 4, quiz(), 10, 1);
  assert.strictEqual(order(q), o, a);
  assert.strictEqual(q.distance, dist, a);
}
console.log('✓ 混合外呼场景四种算法顺序正确（含 SCAN 扫到尽头再回接）');

// 随机压力测试：任何外呼/内呼组合，四种算法都必须把请求全部处理完（不卡死、不漏人）
let seed = 42;
const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % n);
for (let trial = 0; trial < 2000; trial++) {
  const N = 4 + rnd(12);
  const reqsR = [];
  const k = 1 + rnd(8);
  for (let i = 0; i < k; i++) {
    const f = 1 + rnd(N);
    const types = ['car'].concat(f < N ? ['up'] : [], f > 1 ? ['down'] : []);
    const type = types[rnd(types.length)];
    if (!reqsR.some((p) => p.floor === f && p.type === type)) reqsR.push({ floor: f, type, t: i });
  }
  const start = 1 + rnd(N);
  const dir = [-1, 0, 1][rnd(3)];
  for (const a of ['FCFS', 'SSTF', 'SCAN', 'LOOK']) {
    const q = E.run(a, start, reqsR, N, dir);
    assert.strictEqual(q.served.length, reqsR.length, `${a} 漏了请求：N=${N} start=${start} dir=${dir} ${JSON.stringify(reqsR)}`);
  }
}
console.log('✓ 2000 组随机场景全部处理完毕');
