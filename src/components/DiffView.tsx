import { useMemo, type RefObject } from "react";
import { diffLines, diffChars } from "diff";

interface DiffViewProps {
  leftContent: string;
  rightContent: string;
  side: "left" | "right";
  onDeleteBlock?: (side: "left" | "right", blockIndex: number) => void;
  selectedBlock?: { side: "left" | "right"; blockIndex: number } | null;
  onSelectBlock?: (side: "left" | "right", blockIndex: number) => void;
  hoveredBlock?: number | null;
  onHoverBlock?: (blockIndex: number | null) => void;
  showLineNumbers?: boolean;
  scrollRef?: RefObject<HTMLDivElement | null>;
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
  /** Which input block this line belongs to (all lines in block, not just header) */
  blockIndex?: number;
  /** True only for the "(* Input N *)" header line */
  isBlockHeader?: boolean;
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

  // Track block membership for the current side's content
  const sideContent = side === "left" ? leftContent : rightContent;
  const blockMembership = findBlockMembership(sideContent);

  let i = 0;
  let currentLineNum = 0; // line number in the side's own content

  while (i < changes.length) {
    const c = changes[i];

    // --- unchanged block ---
    if (!c.added && !c.removed) {
      for (const line of splitBlock(c.value)) {
        const membership = blockMembership.get(currentLineNum);
        result.push({
          type: "unchanged",
          spans: [{ text: line, type: "normal" }],
          blockIndex: membership?.blockIndex,
          isBlockHeader: membership?.isHeader,
        });
        currentLineNum++;
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
          const membership = blockMembership.get(currentLineNum);
          result.push({ type: "modified", spans: ensureNonEmpty(spans), blockIndex: membership?.blockIndex, isBlockHeader: membership?.isHeader });
          currentLineNum++;
        } else {
          const spans: Span[] = [];
          for (const d of charDiffs) {
            if (d.removed) continue;
            spans.push({ text: d.value, type: d.added ? "inserted" : "normal" });
          }
          const membership = blockMembership.get(currentLineNum);
          result.push({ type: "modified", spans: ensureNonEmpty(spans), blockIndex: membership?.blockIndex, isBlockHeader: membership?.isHeader });
          currentLineNum++;
        }
      }

      // Leftover removed lines (no matching add)
      if (side === "left") {
        for (let p = pairCount; p < removedLines.length; p++) {
          const membership = blockMembership.get(currentLineNum);
          result.push({
            type: "removed",
            spans: [{ text: removedLines[p], type: "deleted" }],
            blockIndex: membership?.blockIndex,
            isBlockHeader: membership?.isHeader,
          });
          currentLineNum++;
        }
      }

      // Leftover added lines (no matching remove)
      if (side === "right") {
        for (let p = pairCount; p < addedLines.length; p++) {
          const membership = blockMembership.get(currentLineNum);
          result.push({
            type: "added",
            spans: [{ text: addedLines[p], type: "inserted" }],
            blockIndex: membership?.blockIndex,
            isBlockHeader: membership?.isHeader,
          });
          currentLineNum++;
        }
      }

      continue;
    }

    // --- added block with no preceding remove ---
    if (c.added) {
      if (side === "right") {
        for (const line of splitBlock(c.value)) {
          const membership = blockMembership.get(currentLineNum);
          result.push({
            type: "added",
            spans: [{ text: line, type: "inserted" }],
            blockIndex: membership?.blockIndex,
            isBlockHeader: membership?.isHeader,
          });
          currentLineNum++;
        }
      }
      i++;
      continue;
    }

    i++;
  }

  return result;
}

/**
 * For each line, determine which input block it belongs to and whether it's a header.
 * Returns a map of lineNumber → { blockIndex, isHeader }.
 */
function findBlockMembership(content: string): Map<number, { blockIndex: number; isHeader: boolean }> {
  const map = new Map<number, { blockIndex: number; isHeader: boolean }>();
  const lines = content.split("\n");
  let currentBlock = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\(\* Input \d+ \*\)$/.test(lines[i].trim())) {
      currentBlock++;
      map.set(i, { blockIndex: currentBlock, isHeader: true });
    } else if (currentBlock >= 0) {
      map.set(i, { blockIndex: currentBlock, isHeader: false });
    }
  }
  return map;
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

/**
 * Group consecutive lines that share the same blockIndex into segments.
 * Lines without a blockIndex each become their own segment.
 */
function groupByBlock(lines: DiffLine[]): { blockIndex: number | undefined; lines: DiffLine[] }[] {
  const groups: { blockIndex: number | undefined; lines: DiffLine[] }[] = [];
  let current: { blockIndex: number | undefined; lines: DiffLine[] } | null = null;

  for (const line of lines) {
    if (line.blockIndex !== undefined) {
      if (current && current.blockIndex === line.blockIndex) {
        current.lines.push(line);
      } else {
        current = { blockIndex: line.blockIndex, lines: [line] };
        groups.push(current);
      }
    } else {
      current = null;
      groups.push({ blockIndex: undefined, lines: [line] });
    }
  }
  return groups;
}

export default function DiffView({ leftContent, rightContent, side, onDeleteBlock, selectedBlock, onSelectBlock, hoveredBlock, onHoverBlock, showLineNumbers, scrollRef }: DiffViewProps) {
  const lines = useMemo(
    () => buildLines(leftContent, rightContent, side),
    [leftContent, rightContent, side]
  );

  const groups = useMemo(() => groupByBlock(lines), [lines]);

  let lineNum = 0;

  const renderLine = (line: DiffLine, key: number) => {
    lineNum++;
    const num = lineNum;
    return (
      <div key={key} className={`diff-line ${line.type}`}>
        {showLineNumbers && <span className="line-number">{num}</span>}
        <span className="line-content">
          {line.spans.map((span, j) => (
            <span key={j} className={span.type !== "normal" ? `char-${span.type}` : undefined}>
              {span.text}
            </span>
          ))}
          {line.spans.every((s) => s.text === "") && "\u00A0"}
        </span>
      </div>
    );
  };

  let lineKey = 0;

  const isSelected = (blockIdx: number) =>
    selectedBlock?.side === side && selectedBlock?.blockIndex === blockIdx;

  const isHovered = (blockIdx: number) => hoveredBlock === blockIdx;

  return (
    <div className="content" ref={scrollRef}>
      {groups.map((group, gi) => {
        if (group.blockIndex !== undefined) {
          const blockIdx = group.blockIndex;
          const classes = [
            "diff-block",
            isSelected(blockIdx) ? "selected" : "",
            isHovered(blockIdx) ? "hovered" : "",
          ].filter(Boolean).join(" ");
          return (
            <div
              key={`block-${gi}`}
              className={classes}
              onClick={(e) => {
                e.stopPropagation();
                onSelectBlock?.(side, blockIdx);
              }}
              onPointerEnter={() => onHoverBlock?.(blockIdx)}
              onPointerLeave={() => onHoverBlock?.(null)}
            >
              {group.lines.map((line) => renderLine(line, lineKey++))}
            </div>
          );
        }
        return group.lines.map((line) => renderLine(line, lineKey++));
      })}
    </div>
  );
}
