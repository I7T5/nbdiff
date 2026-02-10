import { useMemo } from "react";
import { diffLines, Change } from "diff";

interface DiffViewProps {
  leftContent: string;
  rightContent: string;
  side: "left" | "right";
}

export default function DiffView({ leftContent, rightContent, side }: DiffViewProps) {
  const changes = useMemo(() => diffLines(leftContent, rightContent), [leftContent, rightContent]);

  const lines = useMemo(() => {
    const result: { text: string; type: "unchanged" | "added" | "removed" }[] = [];

    for (const change of changes) {
      const changeLines = change.value.replace(/\n$/, "").split("\n");

      if (!change.added && !change.removed) {
        for (const line of changeLines) {
          result.push({ text: line, type: "unchanged" });
        }
      } else if (change.added) {
        for (const line of changeLines) {
          result.push({ text: line, type: "added" });
        }
      } else if (change.removed) {
        for (const line of changeLines) {
          result.push({ text: line, type: "removed" });
        }
      }
    }

    return result;
  }, [changes]);

  // Left panel shows removed lines (from key), right panel shows added lines (from submission)
  const filteredLines = useMemo(() => {
    if (side === "left") {
      // Show unchanged and removed (key has these, submission doesn't)
      return lines.filter((l) => l.type === "unchanged" || l.type === "removed");
    } else {
      // Show unchanged and added (submission has these, key doesn't)
      return lines.filter((l) => l.type === "unchanged" || l.type === "added");
    }
  }, [lines, side]);

  return (
    <div className="content">
      {filteredLines.map((line, i) => (
        <div
          key={i}
          className={`diff-line ${line.type === "unchanged" ? "" : line.type}`}
        >
          {line.text || "\u00A0"}
        </div>
      ))}
    </div>
  );
}
