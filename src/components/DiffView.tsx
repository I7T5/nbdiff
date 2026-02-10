import { useMemo } from "react";
import { diffLines, diffChars } from "diff";

interface DiffViewProps {
  leftContent: string;
  rightContent: string;
  side: "left" | "right";
}

// "modified" = line exists on both sides but with differences
type LineType = "unchanged" | "added" | "removed" | "modified";

interface Span {
  text: string;
  type: "normal" | "inserted" | "deleted";
}

interface DiffLine {
  type: LineType;
  spans: Span[];
}

/**
 * Build per-line diff data with character-level spans for modified lines.
 *
 * Strategy:
 *  1. diffLines to get block-level changes
 *  2. When a removed block is immediately followed by an added block,
 *     zip their lines 1:1. For each pair run diffChars so the viewer
 *     can highlight the exact characters that differ.
 *  3. Leftover lines (unmatched removes or adds) stay fully highlighted.
 */
function buildLines(
  leftContent: string,
  rightContent: string,
  side: "left" | "right"
): DiffLine[] {
  const changes = diffLines(leftContent, rightContent);
  const result: DiffLine[] = [];

  let i = 0;
  while (i < changes.length) {
    const c = changes[i];

    // --- unchanged block ---
    if (!c.added && !c.removed) {
      for (const line of splitBlock(c.value)) {
        result.push({ type: "unchanged", spans: [{ text: line, type: "normal" }] });
      }
      i++;
      continue;
    }

    // --- removed block possibly followed by added block ---
    if (c.removed) {
      const removedLines = splitBlock(c.value);
      let addedLines: string[] = [];

      if (i + 1 < changes.length && changes[i + 1].added) {
        addedLines = splitBlock(changes[i + 1].value);
        i += 2;
      } else {
        i++;
      }

      const pairCount = Math.min(removedLines.length, addedLines.length);

      // Paired lines → character-level diff (modified)
      for (let p = 0; p < pairCount; p++) {
        const charDiffs = diffChars(removedLines[p], addedLines[p]);

        if (side === "left") {
          const spans: Span[] = [];
          for (const d of charDiffs) {
            if (d.added) continue;
            spans.push({ text: d.value, type: d.removed ? "deleted" : "normal" });
          }
          result.push({ type: "modified", spans: ensureNonEmpty(spans) });
        } else {
          const spans: Span[] = [];
          for (const d of charDiffs) {
            if (d.removed) continue;
            spans.push({ text: d.value, type: d.added ? "inserted" : "normal" });
          }
          result.push({ type: "modified", spans: ensureNonEmpty(spans) });
        }
      }

      // Leftover removed lines (no matching add)
      if (side === "left") {
        for (let p = pairCount; p < removedLines.length; p++) {
          result.push({
            type: "removed",
            spans: [{ text: removedLines[p], type: "deleted" }],
          });
        }
      }

      // Leftover added lines (no matching remove)
      if (side === "right") {
        for (let p = pairCount; p < addedLines.length; p++) {
          result.push({
            type: "added",
            spans: [{ text: addedLines[p], type: "inserted" }],
          });
        }
      }

      continue;
    }

    // --- added block with no preceding remove ---
    if (c.added) {
      if (side === "right") {
        for (const line of splitBlock(c.value)) {
          result.push({
            type: "added",
            spans: [{ text: line, type: "inserted" }],
          });
        }
      }
      i++;
      continue;
    }

    i++;
  }

  return result;
}

/** Split a diff block value into lines, stripping the trailing newline. */
function splitBlock(value: string): string[] {
  return value.replace(/\n$/, "").split("\n");
}

/** Ensure we always have at least one span so the line renders. */
function ensureNonEmpty(spans: Span[]): Span[] {
  if (spans.length === 0 || spans.every((s) => s.text === "")) {
    return [{ text: "", type: "normal" }];
  }
  return spans;
}

export default function DiffView({ leftContent, rightContent, side }: DiffViewProps) {
  const lines = useMemo(
    () => buildLines(leftContent, rightContent, side),
    [leftContent, rightContent, side]
  );

  return (
    <div className="content">
      {lines.map((line, i) => (
        <div key={i} className={`diff-line ${line.type}`}>
          {line.spans.map((span, j) => (
            <span key={j} className={span.type !== "normal" ? `char-${span.type}` : undefined}>
              {span.text}
            </span>
          ))}
          {line.spans.every((s) => s.text === "") && "\u00A0"}
        </div>
      ))}
    </div>
  );
}
