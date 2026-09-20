//! The field's force simulation, in Rust.
//!
//! A faithful re-implementation of the d3-force configuration this renderer
//! uses — link, many-body, collide, center, x and y — with d3's integration
//! order and its velocity-Verlet step, so a field laid out here settles where
//! the JavaScript one settles.
//!
//! Neither of the two expensive forces is computed pairwise.
//!
//! * **Many-body** walks a Barnes-Hut quadtree with the same theta d3 uses, so
//!   the cost is n log n rather than n squared. An earlier version summed
//!   every pair: exact, faster than d3 up to about a thousand nodes, and
//!   hopeless above it. The timings made that obvious — time divided by n
//!   squared was flat to within two percent at every size, which is what a
//!   quadratic looks like when you plot it.
//! * **Collide** buckets bodies into a uniform grid whose cell is the largest
//!   diameter in the field, so a colliding pair can only be in the same cell
//!   or one of the eight around it. That is still *exact* — no pair that
//!   touches is missed — it simply stops asking about pairs that cannot.
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

    /// Barnes-Hut repulsion: a distant cluster is treated as one body.
    fn force_many_body(&mut self, alpha: f64) {
        if self.n == 0 { return }
        if self.n < 48 {
            // Below this the tree costs more than the pairs it saves.
            for i in 0..self.n {
                for j in (i + 1)..self.n {
                    let (dx, dy, l) = separation(self.x[i], self.y[i], self.x[j], self.y[j]);
                    let wi = self.charge[j] * alpha / l;
                    let wj = self.charge[i] * alpha / l;
                    self.vx[i] += dx * wi;
                    self.vy[i] += dy * wi;
                    self.vx[j] -= dx * wj;
                    self.vy[j] -= dy * wj;
                }
            }
            return;
        }

        let tree = QuadTree::build(&self.x, &self.y, &self.charge);
        for i in 0..self.n {
            let (ax, ay) = tree.force_on(self.x[i], self.y[i], alpha);
            self.vx[i] += ax;
            self.vy[i] += ay;
        }
    }

    /// Exact collision resolution over a uniform grid.
    ///
    /// The cell is the largest diameter present, so two bodies that overlap
    /// are necessarily in the same cell or an adjacent one. Nothing is
    /// approximated; the pairs that cannot touch are simply never considered.
    fn force_collide(&mut self) {
        if self.n < 2 { return }
        let mut rmax = 0.0f64;
        let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for i in 0..self.n {
            let px = self.x[i] + self.vx[i];
            let py = self.y[i] + self.vy[i];
            if self.radius[i] > rmax { rmax = self.radius[i] }
            if px < x0 { x0 = px }
            if py < y0 { y0 = py }
            if px > x1 { x1 = px }
            if py > y1 { y1 = py }
        }
        let cell = (rmax * 2.0).max(1.0);
        let cols = (((x1 - x0) / cell).ceil() as usize + 1).max(1);
        let rows = (((y1 - y0) / cell).ceil() as usize + 1).max(1);

        // A grid coarser than the field is the pairwise loop again, so fall
        // back rather than pay for the buckets as well.
        if cols * rows > self.n * 8 + 64 {
            for i in 0..self.n {
                for j in (i + 1)..self.n { self.resolve(i, j) }
            }
            return;
        }

        let mut buckets: Vec<Vec<u32>> = vec![Vec::new(); cols * rows];
        for i in 0..self.n {
            let cx = (((self.x[i] + self.vx[i]) - x0) / cell) as usize;
            let cy = (((self.y[i] + self.vy[i]) - y0) / cell) as usize;
            buckets[cy.min(rows - 1) * cols + cx.min(cols - 1)].push(i as u32);
        }

        for cy in 0..rows {
            for cx in 0..cols {
                let here = &buckets[cy * cols + cx];
                if here.is_empty() { continue }
                for oy in cy..(cy + 2).min(rows) {
                    for ox in cx.saturating_sub(1)..(cx + 2).min(cols) {
                        // Each neighbouring pair of cells is visited once.
                        if oy == cy && ox < cx { continue }
                        let other = &buckets[oy * cols + ox];
                        if other.is_empty() { continue }
                        for &a in here.iter() {
                            for &b in other.iter() {
                                if oy == cy && ox == cx && b <= a { continue }
                                self.resolve(a as usize, b as usize);
                            }
                        }
                    }
                }
            }
        }
    }

    fn resolve(&mut self, i: usize, j: usize) {
        let ri = self.radius[i];
        let rj = self.radius[j];
        let r = ri + rj;
        let (ndx, ndy, l2) = separation(
            self.x[j] + self.vx[j], self.y[j] + self.vy[j],
            self.x[i] + self.vx[i], self.y[i] + self.vy[i],
        );
        let (dx, dy) = (ndx, ndy);
        if l2 >= r * r { return }
        let l = l2.sqrt();
        let push = (r - l) / l;
        // Split by area, as d3 does: the bigger body moves less.
        let share = (rj * rj) / (ri * ri + rj * rj);
        self.vx[i] += dx * push * share;
        self.vy[i] += dy * push * share;
        self.vx[j] -= dx * push * (1.0 - share);
        self.vy[j] -= dy * push * (1.0 - share);
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

/// Delta and squared distance between two bodies, with d3's floor.
///
/// Coincident bodies have no direction to separate along. d3 jiggles randomly;
/// a fixed nudge does the same job and keeps a layout reproducible.
#[inline]
fn separation(xi: f64, yi: f64, xj: f64, yj: f64) -> (f64, f64, f64) {
    let mut dx = xj - xi;
    let mut dy = yj - yi;
    if dx == 0.0 { dx = 1e-6 }
    if dy == 0.0 { dy = 1e-6 }
    let mut l = dx * dx + dy * dy;
    if l < DISTANCE_MIN_SQ { l = (DISTANCE_MIN_SQ * l).sqrt() }
    (dx, dy, l)
}

/// d3's `theta` of 0.9, squared, compared against squared distance.
const THETA_SQ: f64 = 0.81;
const NONE: u32 = u32::MAX;
/// Coincident points would subdivide for ever.
const MAX_DEPTH: u32 = 24;

struct Cell {
    kids: [u32; 4],
    /// Centre of mass and total charge of everything beneath.
    cx: f64,
    cy: f64,
    charge: f64,
    /// Side of the square this cell covers, for the theta test.
    w: f64,
    leaf: bool,
}

/// A quadtree over the bodies, summarised so a distant group can be treated as
/// one. The same approximation d3 makes, at the same theta.
struct QuadTree {
    cells: Vec<Cell>,
}

impl QuadTree {
    fn build(x: &[f64], y: &[f64], charge: &[f64]) -> QuadTree {
        let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for i in 0..x.len() {
            if x[i] < x0 { x0 = x[i] }
            if y[i] < y0 { y0 = y[i] }
            if x[i] > x1 { x1 = x[i] }
            if y[i] > y1 { y1 = y[i] }
        }
        // Square the bounds so a cell's width is one number.
        let side = (x1 - x0).max(y1 - y0).max(1e-9);
        let mut t = QuadTree { cells: Vec::with_capacity(x.len() * 2) };
        let mut idx: Vec<u32> = (0..x.len() as u32).collect();
        t.insert(&mut idx, x, y, charge, x0, y0, side, 0);
        t
    }

    /// Returns the index of the cell built for this set of bodies.
    fn insert(
        &mut self, idx: &mut [u32], x: &[f64], y: &[f64], q: &[f64],
        x0: f64, y0: f64, w: f64, depth: u32,
    ) -> u32 {
        if idx.is_empty() { return NONE }
        let me = self.cells.len() as u32;

        let (mut sx, mut sy, mut sq) = (0.0, 0.0, 0.0);
        for &i in idx.iter() {
            let c = q[i as usize];
            sx += x[i as usize] * c;
            sy += y[i as usize] * c;
            sq += c;
        }
        // Charges here are all negative and equal, so the weighted centroid is
        // well defined; guard anyway rather than divide by zero.
        let (cx, cy) = if sq.abs() > 1e-12 {
            (sx / sq, sy / sq)
        } else {
            let n = idx.len() as f64;
            (idx.iter().map(|&i| x[i as usize]).sum::<f64>() / n,
             idx.iter().map(|&i| y[i as usize]).sum::<f64>() / n)
        };

        self.cells.push(Cell { kids: [NONE; 4], cx, cy, charge: sq, w, leaf: true });
        if idx.len() == 1 || depth >= MAX_DEPTH { return me }

        let (hw, mx, my) = (w / 2.0, x0 + w / 2.0, y0 + w / 2.0);
        // Partition in place into the four quadrants.
        let mid_y = partition(idx, |i| y[i as usize] < my);
        let (top, bottom) = idx.split_at_mut(mid_y);
        let mid_tx = partition(top, |i| x[i as usize] < mx);
        let mid_bx = partition(bottom, |i| x[i as usize] < mx);
        let (tl, tr) = top.split_at_mut(mid_tx);
        let (bl, br) = bottom.split_at_mut(mid_bx);

        let k0 = self.insert(tl, x, y, q, x0, y0, hw, depth + 1);
        let k1 = self.insert(tr, x, y, q, mx, y0, hw, depth + 1);
        let k2 = self.insert(bl, x, y, q, x0, my, hw, depth + 1);
        let k3 = self.insert(br, x, y, q, mx, my, hw, depth + 1);
        let c = &mut self.cells[me as usize];
        c.kids = [k0, k1, k2, k3];
        c.leaf = false;
        me
    }

    fn force_on(&self, px: f64, py: f64, alpha: f64) -> (f64, f64) {
        let (mut ax, mut ay) = (0.0, 0.0);
        if self.cells.is_empty() { return (ax, ay) }
        let mut stack = [0u32; 128];
        let mut top = 1usize;
        stack[0] = 0;
        while top > 0 {
            top -= 1;
            let c = &self.cells[stack[top] as usize];
            let (dx, dy, l) = separation(px, py, c.cx, c.cy);
            // Far enough that the whole cell can act as one body.
            if c.leaf || (c.w * c.w / THETA_SQ) < l {
                // A leaf sitting exactly on the body is the body itself.
                if c.leaf && l <= DISTANCE_MIN_SQ && dx.abs() <= 1e-6 && dy.abs() <= 1e-6 {
                    continue;
                }
                let k = c.charge * alpha / l;
                ax += dx * k;
                ay += dy * k;
            } else {
                for &k in c.kids.iter() {
                    if k != NONE && top < stack.len() {
                        stack[top] = k;
                        top += 1;
                    }
                }
            }
        }
        (ax, ay)
    }
}

/// Hoare-style partition: entries satisfying `pred` first. Returns the split.
fn partition<F: Fn(u32) -> bool>(a: &mut [u32], pred: F) -> usize {
    let mut i = 0;
    for j in 0..a.len() {
        if pred(a[j]) {
            a.swap(i, j);
            i += 1;
        }
    }
    i
}
