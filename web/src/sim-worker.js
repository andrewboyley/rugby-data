// Force-directed layout engine, run off the main thread so the UI never
// stalls. Receives node/link snapshots and streams positions back as
// transferable Float64Array buffers.

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3";

let sim = null;
let nodes = [];
let width = 1200;
let height = 800;
let dist = 120, str = 0.4, chg = -600, coll = 8, decay = 0.04;

function build(links, alpha) {
  if (sim) sim.stop();
  sim = forceSimulation(nodes)
    .alpha(alpha)
    .force("link", forceLink(links).id((d) => d.id)
      .distance(dist)
      .strength((l) => str * (0.4 + 0.6 * (l.w / (curMaxW || 1)))))
    .force("charge", forceManyBody().strength(chg))
    .force("x", forceX(width / 2).strength(0.15))
    .force("y", forceY(height / 2).strength(0.15))
    .force("collide", forceCollide()
      .radius((d) => coll + Math.sqrt(d.app) * 1.0)
      .iterations(3))
    .alphaDecay(decay)
    .on("tick", () => {
      if (++tickCount % 2) return;
      const pos = new Float64Array(nodes.length * 2);
      for (let i = 0; i < nodes.length; i++) {
        pos[i * 2] = nodes[i].x;
        pos[i * 2 + 1] = nodes[i].y;
      }
      self.postMessage({ type: "tick", pos }, [pos.buffer]);
    });
}

let curMaxW = 1;
let tickCount = 0;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "update") {
    dist = m.dist; str = m.str; chg = m.chg; coll = m.coll; decay = m.decay;
    nodes = m.nodes;
    curMaxW = m.curMaxW || 1;
    build(m.links, m.alpha ?? 0.3);
  } else if (m.type === "params") {
    dist = m.dist; str = m.str; chg = m.chg; coll = m.coll; decay = m.decay;
    if (!sim) return;
    sim.force("link").distance(dist)
      .strength((l) => str * (0.4 + 0.6 * (l.w / (curMaxW || 1))));
    sim.force("charge").strength(chg);
    sim.force("collide").radius((d) => coll + Math.sqrt(d.app) * 1.0);
    sim.alphaDecay(decay);
    sim.alpha(0.5).restart();
  } else if (m.type === "size") {
    width = m.width;
    height = m.height;
    if (!sim) return;
    sim.force("x").x(width / 2);
    sim.force("y").y(height / 2);
  }
};
