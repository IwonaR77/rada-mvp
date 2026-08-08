/** One pairwise voting-agreement measurement, as returned by the `term_voting_correlation` RPC. */
export type PairAgreement = { a: string; b: string; agreementPct: number };

/**
 * Output of {@link clusterByAgreement}: a leaf order and cluster
 * assignment ready to drive a matrix layout.
 */
export type ClusterResult = {
  /** Ids ordered so that same-cluster members are contiguous — use this order for both matrix axes. */
  order: string[];
  /** Cluster index (0-based, ordered by first appearance in `order`) per id. */
  clusterOf: Map<string, number>;
  clusterCount: number;
};

type Node = { members: string[]; left?: Node; right?: Node };

/**
 * Average-linkage agglomerative clustering over a sparse pairwise
 * similarity list — groups ids into 2–6 clusters (e.g. councilors into
 * voting "blocs") and returns them in an order where same-cluster members
 * sit contiguously, so a matrix built from that order shows blocs as
 * adjacent rows/columns instead of scattered ones.
 *
 * `N` is expected to be small (a council's roster, ~15–25 people), so this
 * uses a naive O(n³) implementation (recomputes all pairwise cluster
 * distances on every merge) rather than a priority-queue version — plenty
 * fast at this scale.
 *
 * @param ids - every id to place, including ones absent from `pairs`
 * @param pairs - sparse pairwise agreement percentages; any pair not
 * listed is treated as maximally dissimilar rather than ignored, so
 * missing data (e.g. below an upstream common-votes threshold) pulls ids
 * apart instead of accidentally clustering them together
 */
export function clusterByAgreement(
  ids: string[],
  pairs: PairAgreement[]
): ClusterResult {
  if (ids.length <= 1) {
    return {
      order: [...ids],
      clusterOf: new Map(ids.map((id) => [id, 0])),
      clusterCount: ids.length,
    };
  }

  const dist = new Map<string, number>();
  const key = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  for (const p of pairs) dist.set(key(p.a, p.b), 100 - p.agreementPct);

  function clusterDistance(x: Node, y: Node): number {
    let total = 0;
    let count = 0;
    for (const m1 of x.members) {
      for (const m2 of y.members) {
        const d = dist.get(key(m1, m2));
        if (d !== undefined) {
          total += d;
          count++;
        }
      }
    }
    // Unknown pairs (below the common-votes threshold upstream) default to
    // maximum distance rather than being ignored, so sparse data doesn't
    // artificially pull unrelated people together.
    return count > 0 ? total / count : 100;
  }

  let nodes: Node[] = ids.map((id) => ({ members: [id] }));
  const heights: number[] = [];
  const partitionHistory: string[][][] = [];
  let root: Node = nodes[0];

  while (nodes.length > 1) {
    let bestI = 0;
    let bestJ = 1;
    let bestD = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const d = clusterDistance(nodes[i], nodes[j]);
        if (d < bestD) {
          bestD = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    const merged: Node = {
      members: [...nodes[bestI].members, ...nodes[bestJ].members],
      left: nodes[bestI],
      right: nodes[bestJ],
    };
    nodes = nodes.filter((_, idx) => idx !== bestI && idx !== bestJ);
    nodes.push(merged);
    heights.push(bestD);
    partitionHistory.push(nodes.map((n) => [...n.members]));
    root = merged;
  }

  // Leaf order via in-order traversal of the merge tree — keeps
  // same-cluster members adjacent, which is what a matrix layout needs.
  const order: string[] = [];
  (function visit(n: Node) {
    if (!n.left || !n.right) {
      order.push(...n.members);
      return;
    }
    visit(n.left);
    visit(n.right);
  })(root);

  // Cut the tree where merging further would jump the most (the largest
  // gap between consecutive merge heights), restricted to a readable
  // 2-6 cluster range so the result stays a "which club" answer rather
  // than either one giant blob or two dozen singletons.
  const n = ids.length;
  const minClusters = Math.min(2, n);
  const maxClusters = Math.min(6, n);
  let bestCutIndex = Math.max(0, n - minClusters - 1);
  let bestGap = -1;
  for (let i = 0; i < heights.length - 1; i++) {
    const k = n - (i + 1);
    if (k < minClusters || k > maxClusters) continue;
    const gap = heights[i + 1] - heights[i];
    if (gap > bestGap) {
      bestGap = gap;
      bestCutIndex = i;
    }
  }

  const clusterMembers = partitionHistory[bestCutIndex]?.map((members) => members) ?? [[...ids]];
  // Order clusters by where their first member falls in the leaf order, so
  // cluster indices read left-to-right consistently with the matrix.
  clusterMembers.sort(
    (a, b) => order.indexOf(a[0]) - order.indexOf(b[0])
  );

  const clusterOf = new Map<string, number>();
  clusterMembers.forEach((members, clusterIndex) => {
    for (const id of members) clusterOf.set(id, clusterIndex);
  });

  return { order, clusterOf, clusterCount: clusterMembers.length };
}
