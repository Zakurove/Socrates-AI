import { useCallback, useMemo, useRef, useState } from "react";

interface ItemResult {
  covered: boolean;
  confidence: number;
  /**
   * True when some but not all children of a heading/parent are covered. For a
   * leaf, always false. Derived client-side from the monotonic leaf state.
   */
  partial: boolean;
  /**
   * Verbatim span from the transcript that the LLM cited as the match.
   * Captured per leaf for audit; absent on parents (they're derived).
   */
  match?: string;
}

/**
 * Minimal tree shape accepted by the matcher. The client uses this to:
 *  - Identify which item ids are leaves (for scoring — leaves only count).
 *  - Recompute parent coverage locally from the monotonic leaf state so that
 *    a parent heading goes ✓ as soon as all of its children are covered,
 *    regardless of whether any single /check response also re-marked those
 *    children (a stateless server + flaky LLM can omit previously-covered
 *    leaves and un-derive the parent — we guard against that here).
 */
export interface ChecklistTreeNode {
  id: number;
  children?: ChecklistTreeNode[];
}

interface UseChecklistMatcherReturn {
  /** Coverage for EVERY node (leaves + parents). Parents are derived locally. */
  results: Map<number, ItemResult>;
  /**
   * Number of LEAF items currently covered. This is the true score numerator —
   * parents are headings and do not contribute points.
   */
  coveredCount: number;
  /** Total LEAF items. Score denominator. */
  totalItems: number;
  isChecking: boolean;
  runCheck: (sessionId: number, transcript: string) => Promise<void>;
  /**
   * Provide/replace the checklist tree. Call this once the station loads.
   * Without a tree, parent aggregation is skipped and totalItems is 0.
   */
  setTree: (tree: ChecklistTreeNode[]) => void;
}

interface CheckResponseItem {
  id: number;
  covered: boolean;
  confidence: number;
  partial?: boolean;
  match?: string;
}

interface CheckResponse {
  items: CheckResponseItem[];
  aggregated?: Record<
    string,
    { covered: boolean; partial: boolean; confidence: number }
  >;
  capReached?: boolean;
}

// ---------------------------------------------------------------------------
// Local aggregation — mirrors server/services/checklist-matcher.ts but runs
// against the client's monotonic leaf state. This is the source of truth for
// parent coverage in the UI and for the final score.
// ---------------------------------------------------------------------------

function aggregateParents(
  tree: ChecklistTreeNode[],
  leafState: Map<number, ItemResult>,
): Map<number, ItemResult> {
  const out = new Map<number, ItemResult>();

  function visit(node: ChecklistTreeNode): ItemResult {
    const children = node.children ?? [];
    if (children.length === 0) {
      // Leaf — take directly from the monotonic leaf state.
      const hit = leafState.get(node.id);
      const cov: ItemResult = {
        covered: hit?.covered ?? false,
        partial: false,
        confidence: hit?.confidence ?? 0,
      };
      out.set(node.id, cov);
      return cov;
    }
    const childCovs = children.map(visit);
    const coveredChildren = childCovs.filter((c) => c.covered).length;
    const engagedChildren = childCovs.filter(
      (c) => c.covered || c.partial,
    ).length;
    const allCovered =
      coveredChildren === childCovs.length && childCovs.length > 0;
    const someEngaged = engagedChildren > 0 && !allCovered;
    const avgConfidence =
      childCovs.reduce((acc, c) => acc + c.confidence, 0) / childCovs.length;
    const cov: ItemResult = {
      covered: allCovered,
      partial: someEngaged,
      confidence: avgConfidence,
    };
    out.set(node.id, cov);
    return cov;
  }

  for (const r of tree) visit(r);
  return out;
}

function collectLeafIds(tree: ChecklistTreeNode[]): number[] {
  const out: number[] = [];
  function walk(n: ChecklistTreeNode) {
    const kids = n.children ?? [];
    if (kids.length === 0) {
      out.push(n.id);
      return;
    }
    for (const k of kids) walk(k);
  }
  for (const r of tree) walk(r);
  return out;
}

export function useChecklistMatcher(): UseChecklistMatcherReturn {
  // `leafState` holds ONLY leaves — the ground truth we accept from the
  // server. Parents are derived from it in `results`.
  const [leafState, setLeafState] = useState<Map<number, ItemResult>>(
    new Map(),
  );
  const [tree, setTreeState] = useState<ChecklistTreeNode[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const isCheckingRef = useRef(false);

  const leafIds = useMemo(() => new Set(collectLeafIds(tree)), [tree]);

  const runCheck = useCallback(
    async (sessionId: number, transcript: string) => {
      // Debounce: skip if already in-flight.
      if (isCheckingRef.current) return;
      isCheckingRef.current = true;
      setIsChecking(true);

      try {
        const res = await fetch(`/api/practice/${sessionId}/check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ transcript }),
        });

        if (!res.ok) {
          // Non-fatal: just stop checking, don't throw to caller.
          return;
        }

        const data: CheckResponse = await res.json();

        if (!Array.isArray(data.items)) return;

        setLeafState((prev) => {
          const next = new Map(prev);
          for (const item of data.items) {
            // Only trust leaf entries. Parent entries from the server are
            // ignored — we re-derive parents locally from the monotonic
            // leaf state (aggregateParents below). This avoids a real bug
            // where a single /check response can mark fewer leaves than
            // prior responses and un-cover a previously-covered parent.
            //
            // When `tree` hasn't been provided yet (e.g. station is still
            // loading), `leafIds` is empty — fall back to trusting the item
            // as a leaf so the hook still works standalone.
            const isLeaf = leafIds.size === 0 || leafIds.has(item.id);
            if (!isLeaf) continue;

            const existing = next.get(item.id);
            // Monotonic: once a leaf is covered, stays covered. Confidence
            // can only increase. Prevents LLM flakiness on later checks
            // from un-covering a previously-confirmed leaf. Upgrades from
            // covered=false to covered=true are ALWAYS allowed — the
            // monotonic rule only protects the covered=true direction.
            if (existing?.covered) {
              next.set(item.id, {
                covered: true,
                confidence: Math.max(existing.confidence, item.confidence),
                partial: false,
                match: existing.match || item.match,
              });
            } else {
              next.set(item.id, {
                covered: item.covered,
                confidence: item.confidence,
                partial: false,
                match: item.match,
              });
            }
          }
          // Dev-only instrumentation (iter9 item 3): log per-leaf state
          // after the monotonic merge so Nasser can confirm that covered
          // flips from false -> true when the LLM reports it. Gated on
          // import.meta.env.DEV so prod bundles don't spam the console.
          if (import.meta.env?.DEV) {
            try {
              for (const item of data.items) {
                const isLeaf = leafIds.size === 0 || leafIds.has(item.id);
                if (!isLeaf) continue;
                const after = next.get(item.id);
                // eslint-disable-next-line no-console
                console.log(
                  `[check] leaf ${item.id} server=(covered=${item.covered}, conf=${item.confidence?.toFixed?.(2) ?? item.confidence}) -> client=(covered=${after?.covered}, conf=${after?.confidence?.toFixed?.(2) ?? after?.confidence})`,
                );
              }
            } catch {
              /* never let logging break render */
            }
          }
          return next;
        });
      } finally {
        isCheckingRef.current = false;
        setIsChecking(false);
      }
    },
    [leafIds],
  );

  // Derive the full results map (leaves + parents) from the leaf state.
  const results = useMemo(() => {
    if (tree.length === 0) {
      // No tree — just echo the leaf state so the hook works before tree
      // is provided.
      return leafState;
    }
    return aggregateParents(tree, leafState);
  }, [tree, leafState]);

  // Score: leaf-only numerator/denominator. Parents are headings.
  const totalItems = leafIds.size;
  const coveredCount = useMemo(() => {
    let n = 0;
    for (const id of Array.from(leafIds)) {
      if (leafState.get(id)?.covered) n++;
    }
    return n;
  }, [leafIds, leafState]);

  const setTree = useCallback((t: ChecklistTreeNode[]) => {
    setTreeState(t);
  }, []);

  return {
    results,
    coveredCount,
    totalItems,
    isChecking,
    runCheck,
    setTree,
  };
}
