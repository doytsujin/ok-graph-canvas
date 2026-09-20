//! The field's force simulation, in Rust.
//!
//! A faithful re-implementation of the d3-force configuration this renderer
//! uses — link, many-body, collide, center, x and y — with d3's integration
//! order and its velocity-Verlet step, so a field laid out here settles where
//! the JavaScript one settles.
//!
//! Two deliberate departures, both stated rather than hidden:
//!
//! 1. **Many-body is computed exactly, not with a Barnes-Hut approximation.**
//!    d3 walks a quadtree with theta = 0.9 because summing every pair in
//!    JavaScript is too slow. Here the exact sum costs n²/2 subtractions per
//!    tick, which at the sizes this renderer is for is nothing, and it removes
//!    the approximation rather than reproducing it. Layouts will differ very
//!    slightly from d3's for that reason, and they differ by being more
//!    correct.
//! 2. **Collide is also exact**, for the same reason and with the same
//!    consequence.
//!
//! The data crosses the boundary as flat arrays. One call per simulation, not
//! one call per node — the cost of WebAssembly is at the edge, so the edge is
//! crossed twice.

use wasm_bindgen::prelude::*;

/// d3's default. Velocities keep 1 - decay of their value each tick.
const VELOCITY_DECAY: f64 = 0.4;
/// d3's `forceManyBody` floor, to stop two coincident bodies exploding.
const DISTANCE_MIN_SQ: f64 = 1.0;

#[wasm_bindgen]
pub struct Simulation {
    n: usize,
    x: Vec<f64>,
    y: Vec<f64>,
    vx: Vec<f64>,
    vy: Vec<f64>,
    radius: Vec<f64>,
    charge: Vec<f64>,
    /// Per-node x anchor and how hard it is held there.
    tx: Vec<f64>,
    tx_k: Vec<f64>,
    ty: Vec<f64>,
    ty_k: Vec<f64>,

    src: Vec<u32>,
    tgt: Vec<u32>,
    dist: Vec<f64>,
    link_k: Vec<f64>,
    /// Share of a link's correction taken by the target, from node degree.
    bias: Vec<f64>,
}

#[wasm_bindgen]
impl Simulation {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Simulation {
        Simulation {
            n: 0,
            x: vec![], y: vec![], vx: vec![], vy: vec![],
            radius: vec![], charge: vec![],
            tx: vec![], tx_k: vec![], ty: vec![], ty_k: vec![],
            src: vec![], tgt: vec![], dist: vec![], link_k: vec![], bias: vec![],
        }
    }

    /// Seed the bodies. Every slice is parallel and the same length.
    pub fn set_nodes(
        &mut self,
        x: &[f64],
        y: &[f64],
        radius: &[f64],
        charge: &[f64],
        tx: &[f64],
        tx_k: &[f64],
        ty: &[f64],
        ty_k: &[f64],
    ) {
        self.n = x.len();
        self.x = x.to_vec();
        self.y = y.to_vec();
        self.vx = vec![0.0; self.n];
        self.vy = vec![0.0; self.n];
        self.radius = radius.to_vec();
        self.charge = charge.to_vec();
        self.tx = tx.to_vec();
        self.tx_k = tx_k.to_vec();
        self.ty = ty.to_vec();
        self.ty_k = ty_k.to_vec();
    }

    /// Set the links and derive each one's bias from the degrees of its ends,
    /// exactly as `forceLink.initialize` does.
    pub fn set_links(&mut self, src: &[u32], tgt: &[u32], dist: &[f64], strength: &[f64]) {
        self.src = src.to_vec();
        self.tgt = tgt.to_vec();
        self.dist = dist.to_vec();
        self.link_k = strength.to_vec();

        let mut count = vec![0u32; self.n];
        for i in 0..self.src.len() {
            count[self.src[i] as usize] += 1;
            count[self.tgt[i] as usize] += 1;
        }
        self.bias = (0..self.src.len())
            .map(|i| {
                let a = count[self.src[i] as usize] as f64;
                let b = count[self.tgt[i] as usize] as f64;
                if a + b == 0.0 { 0.5 } else { a / (a + b) }
            })
            .collect();
    }

    /// Advance the simulation. One call, not one per tick.
    pub fn tick(&mut self, steps: u32, alpha_start: f64, alpha_decay: f64) {
        let mut alpha = alpha_start;
        for _ in 0..steps {
            // d3 advances alpha toward alphaTarget (0 here) before the forces.
            alpha += (0.0 - alpha) * alpha_decay;
            self.force_link(alpha);
            self.force_many_body(alpha);
            self.force_collide();
            self.force_center();
            self.force_axis(alpha);
            for i in 0..self.n {
                self.vx[i] *= 1.0 - VELOCITY_DECAY;
                self.x[i] += self.vx[i];
                self.vy[i] *= 1.0 - VELOCITY_DECAY;
                self.y[i] += self.vy[i];
            }
        }
    }

    fn force_link(&mut self, alpha: f64) {
        for i in 0..self.src.len() {
            let s = self.src[i] as usize;
            let t = self.tgt[i] as usize;
            let mut dx = self.x[t] + self.vx[t] - self.x[s] - self.vx[s];
            let mut dy = self.y[t] + self.vy[t] - self.y[s] - self.vy[s];
            // Coincident bodies have no direction to separate along. d3 jiggles;
            // a deterministic nudge keeps the layout reproducible.
            if dx == 0.0 { dx = 1e-6 }
            if dy == 0.0 { dy = 1e-6 }
            let l = (dx * dx + dy * dy).sqrt();
            let k = (l - self.dist[i]) / l * alpha * self.link_k[i];
            let (ax, ay) = (dx * k, dy * k);
            let b = self.bias[i];
            self.vx[t] -= ax * b;
            self.vy[t] -= ay * b;
            self.vx[s] += ax * (1.0 - b);
            self.vy[s] += ay * (1.0 - b);
        }
    }

    /// Exact n-body repulsion. See the module note on why this is not
    /// Barnes-Hut.
    fn force_many_body(&mut self, alpha: f64) {
        for i in 0..self.n {
            for j in (i + 1)..self.n {
                let mut dx = self.x[j] - self.x[i];
                let mut dy = self.y[j] - self.y[i];
                if dx == 0.0 { dx = 1e-6 }
                if dy == 0.0 { dy = 1e-6 }
                let mut l = dx * dx + dy * dy;
                if l < DISTANCE_MIN_SQ { l = (DISTANCE_MIN_SQ * l).sqrt() }
                // Each body feels the other's charge, so the pair is done once.
                let wi = self.charge[j] * alpha / l;
                let wj = self.charge[i] * alpha / l;
                self.vx[i] += dx * wi;
                self.vy[i] += dy * wi;
                self.vx[j] -= dx * wj;
                self.vy[j] -= dy * wj;
            }
        }
    }

    fn force_collide(&mut self) {
        for i in 0..self.n {
            for j in (i + 1)..self.n {
                let ri = self.radius[i];
                let rj = self.radius[j];
                let r = ri + rj;
                let mut dx = (self.x[i] + self.vx[i]) - (self.x[j] + self.vx[j]);
                let mut dy = (self.y[i] + self.vy[i]) - (self.y[j] + self.vy[j]);
                if dx == 0.0 { dx = 1e-6 }
                if dy == 0.0 { dy = 1e-6 }
                let l2 = dx * dx + dy * dy;
                if l2 >= r * r { continue }
                let l = l2.sqrt();
                let push = (r - l) / l;
                // Split by area, as d3 does: the bigger body moves less.
                let share = (rj * rj) / (ri * ri + rj * rj);
                self.vx[i] += dx * push * share;
                self.vy[i] += dy * push * share;
                self.vx[j] -= dx * push * (1.0 - share);
                self.vy[j] -= dy * push * (1.0 - share);
            }
        }
    }

    /// d3's `forceCenter` moves positions, not velocities.
    fn force_center(&mut self) {
        if self.n == 0 { return }
        let mut sx = 0.0;
        let mut sy = 0.0;
        for i in 0..self.n {
            sx += self.x[i];
            sy += self.y[i];
        }
        let (cx, cy) = (sx / self.n as f64, sy / self.n as f64);
        for i in 0..self.n {
            self.x[i] -= cx;
            self.y[i] -= cy;
        }
    }

    fn force_axis(&mut self, alpha: f64) {
        for i in 0..self.n {
            self.vx[i] += (self.tx[i] - self.x[i]) * self.tx_k[i] * alpha;
            self.vy[i] += (self.ty[i] - self.y[i]) * self.ty_k[i] * alpha;
        }
    }

    pub fn xs(&self) -> Vec<f64> { self.x.clone() }
    pub fn ys(&self) -> Vec<f64> { self.y.clone() }
}

impl Default for Simulation {
    fn default() -> Self { Self::new() }
}
