import { openai } from "./openai.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChecklistItem {
  id: number;
  text: string;
  sectionTitle: string;
}

export interface MatchResult {
  itemId: number;
  confidence: number;
  matchedText: string;
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function magnitude(v: number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i] * v[i];
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const magA = magnitude(a);
  const magB = magnitude(b);
  if (magA === 0 || magB === 0) return 0;
  return dotProduct(a, b) / (magA * magB);
}

// ---------------------------------------------------------------------------
// Embedding helpers
// ---------------------------------------------------------------------------

async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

async function getEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // text-embedding-3-small supports batches up to 2048 inputs
  const BATCH_SIZE = 2048;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch,
    });
    // The API returns embeddings in the same order as the input
    const sorted = response.data.sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      allEmbeddings.push(item.embedding);
    }
  }

  return allEmbeddings;
}

// ---------------------------------------------------------------------------
// Pre-compute item embeddings (call once at session start)
// ---------------------------------------------------------------------------

/**
 * Pre-compute embeddings for all checklist items.
 * The embedding text combines the section title with the item text for richer
 * semantic context (e.g. "History of presenting complaint: Ask about onset").
 */
export async function precomputeItemEmbeddings(
  items: ChecklistItem[],
): Promise<Map<number, number[]>> {
  if (items.length === 0) return new Map();

  const texts = items.map(
    (item) => `${item.sectionTitle}: ${item.text}`,
  );

  const embeddings = await getEmbeddingsBatch(texts);

  const map = new Map<number, number[]>();
  for (let i = 0; i < items.length; i++) {
    map.set(items[i].id, embeddings[i]);
  }

  return map;
}

// ---------------------------------------------------------------------------
// Stage 1: Embedding pre-filter
// ---------------------------------------------------------------------------

const SIMILARITY_THRESHOLD = 0.65;

interface Candidate {
  item: ChecklistItem;
  similarity: number;
}

async function embeddingPreFilter(
  utterance: string,
  uncheckedItems: ChecklistItem[],
  precomputedEmbeddings?: Map<number, number[]>,
): Promise<Candidate[]> {
  const utteranceEmbedding = await getEmbedding(utterance);

  let itemEmbeddingsMap: Map<number, number[]>;

  if (precomputedEmbeddings && precomputedEmbeddings.size > 0) {
    itemEmbeddingsMap = precomputedEmbeddings;
  } else {
    // Fallback: compute on the fly
    itemEmbeddingsMap = await precomputeItemEmbeddings(uncheckedItems);
  }

  const candidates: Candidate[] = [];

  for (const item of uncheckedItems) {
    const itemEmbedding = itemEmbeddingsMap.get(item.id);
    if (!itemEmbedding) continue;

    const similarity = cosineSimilarity(utteranceEmbedding, itemEmbedding);
    if (similarity >= SIMILARITY_THRESHOLD) {
      candidates.push({ item, similarity });
    }
  }

  // Sort by similarity descending
  candidates.sort((a, b) => b.similarity - a.similarity);

  // Cap at 10 candidates to keep the LLM prompt manageable
  return candidates.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Stage 2: LLM confirmation
// ---------------------------------------------------------------------------

async function llmConfirmation(
  utterance: string,
  candidates: Candidate[],
): Promise<MatchResult[]> {
  if (candidates.length === 0) return [];

  const candidateList = candidates
    .map(
      (c, i) =>
        `  ${i + 1}. [ID=${c.item.id}] (${c.item.sectionTitle}) ${c.item.text}`,
    )
    .join("\n");

  const prompt = `You are a strict OSCE checklist grader. A medical student said or did the following during an OSCE station:

STUDENT UTTERANCE / ACTION:
"${utterance}"

Below are candidate checklist items that may have been addressed. For each item, decide if the student's utterance CLEARLY demonstrates performing or asking about that item.

CANDIDATE ITEMS:
${candidateList}

RULES:
- Be CONSERVATIVE. Only confirm a match if the student clearly addressed the item.
- Partial matches are acceptable if the student addressed the core intent of the item, even with different wording.
- False negatives are much better than false positives.
- A single utterance can match zero, one, or multiple items.

Respond with ONLY a JSON array. Each element must have:
- "itemId": the item ID number
- "confidence": a number between 0.0 and 1.0
- "matchedText": a brief phrase from the utterance that matched

Only include items with confidence >= 0.7. If no items match, return an empty array [].

JSON array:`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a precise OSCE checklist grading assistant. Respond only with valid JSON arrays. No markdown, no explanation.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.1, // low temperature for consistent grading
      max_tokens: 500,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "[]";

    // Parse the JSON, stripping any markdown fences the model might add
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

    let parsed: any[];
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // If JSON parse fails, return no matches (conservative)
      return [];
    }

    if (!Array.isArray(parsed)) return [];

    // Validate and filter
    const results: MatchResult[] = [];
    const validItemIds = new Set(candidates.map((c) => c.item.id));

    for (const entry of parsed) {
      if (
        typeof entry.itemId === "number" &&
        typeof entry.confidence === "number" &&
        typeof entry.matchedText === "string" &&
        entry.confidence >= 0.7 &&
        validItemIds.has(entry.itemId)
      ) {
        results.push({
          itemId: entry.itemId,
          confidence: Math.min(1, Math.max(0, entry.confidence)),
          matchedText: entry.matchedText,
        });
      }
    }

    return results;
  } catch (error: any) {
    // On LLM failure, return no matches (conservative)
    console.error("Checklist LLM confirmation failed:", error?.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Two-stage checklist matching pipeline.
 *
 * @param utterance           - What the student said or did.
 * @param uncheckedItems      - Checklist items that have not yet been checked.
 * @param precomputedEmbeddings - Optional pre-computed embeddings map from `precomputeItemEmbeddings`.
 * @returns Array of confirmed matches with confidence scores.
 */
export async function matchUtteranceToChecklist(
  utterance: string,
  uncheckedItems: ChecklistItem[],
  precomputedEmbeddings?: Map<number, number[]>,
): Promise<MatchResult[]> {
  if (!utterance || utterance.trim().length === 0) return [];
  if (uncheckedItems.length === 0) return [];

  // Stage 1: Embedding pre-filter
  const candidates = await embeddingPreFilter(
    utterance,
    uncheckedItems,
    precomputedEmbeddings,
  );

  if (candidates.length === 0) return [];

  // Stage 2: LLM confirmation
  return llmConfirmation(utterance, candidates);
}

// ---------------------------------------------------------------------------
// Hierarchical coverage aggregation
// ---------------------------------------------------------------------------

/**
 * A minimal tree node accepted by `aggregateCoverage`. Works for any node level
 * (item, sub-item, sub-sub-item). Children is optional / may be empty for leaves.
 */
export interface ChecklistNode {
  id: number;
  children?: ChecklistNode[];
}

/** Coverage flag for a single node (leaf or internal). */
export interface NodeCoverage {
  covered: boolean;
  partial: boolean;
  confidence: number;
}

/**
 * Aggregate leaf coverage upward through the checklist tree.
 *
 * Rules (per iter7 PLAN item 3):
 *  - A leaf node (no children) takes its coverage directly from `leafCoverage`.
 *    If missing, it's treated as not covered with confidence 0.
 *  - A node with children is `covered` iff every child is `covered`.
 *  - A node with children is `partial` iff some (but not all) children are
 *    covered or partial. (`partial` never implies `covered`.)
 *  - Internal-node confidence is the mean of its children's confidences (a
 *    rough summary for the UI; not used for matching decisions).
 *
 * This is a pure function: it returns a new Map and does not mutate its inputs.
 *
 * @param roots Top-level items of the checklist. Each may have `children`
 *              which themselves may have `children` (arbitrary depth — the
 *              project uses at most 3 levels).
 * @param leafCoverage Map from itemId -> {covered, confidence}. Only leaves
 *                     should appear here; entries for internal nodes are
 *                     ignored (coverage is derived).
 * @returns Map from itemId -> NodeCoverage for EVERY node in the tree.
 */
export function aggregateCoverage(
  roots: ChecklistNode[],
  leafCoverage: Map<number, { covered: boolean; confidence: number }>,
): Map<number, NodeCoverage> {
  const out = new Map<number, NodeCoverage>();

  function visit(node: ChecklistNode): NodeCoverage {
    const children = node.children ?? [];
    if (children.length === 0) {
      // Leaf — look up direct match.
      const hit = leafCoverage.get(node.id);
      const cov: NodeCoverage = {
        covered: hit?.covered ?? false,
        partial: false,
        confidence: hit?.confidence ?? 0,
      };
      out.set(node.id, cov);
      return cov;
    }

    // Internal node — recurse into children first.
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

    const cov: NodeCoverage = {
      covered: allCovered,
      partial: someEngaged,
      confidence: avgConfidence,
    };
    out.set(node.id, cov);
    return cov;
  }

  for (const r of roots) visit(r);
  return out;
}

/**
 * Walk a checklist tree and return only its leaves.
 * A leaf is a node with no children. Order is pre-order DFS.
 */
export function collectLeafNodes(roots: ChecklistNode[]): ChecklistNode[] {
  const leaves: ChecklistNode[] = [];
  function walk(n: ChecklistNode) {
    const kids = n.children ?? [];
    if (kids.length === 0) {
      leaves.push(n);
      return;
    }
    for (const k of kids) walk(k);
  }
  for (const r of roots) walk(r);
  return leaves;
}
