import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import DiffView from "./components/DiffView";
import NavigationControls from "./components/NavigationControls";

interface Submission {
  filename: string;
  relativePath: string;
  content: string;
  error: string | null;
}

interface BatchResult {
  files: {
    relativePath: string;
    inputs: string[];
    error: string | null;
  }[];
  totalFiles: number;
  successful: number;
  failed: number;
}

function formatInputs(inputs: string[]): string {
  return inputs.map((input, i) => `(* Input ${i + 1} *)\n${input}`).join("\n\n");
}

function App() {
  const [leftContent, setLeftContent] = useState<string | null>(null);
  const [rightContent, setRightContent] = useState<string | null>(null);
  const [leftFile, setLeftFile] = useState<string | null>(null);
  const [rightFile, setRightFile] = useState<string | null>(null);
  const [leftLoading, setLeftLoading] = useState(false);
  const [rightLoading, setRightLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<"left" | "right" | null>(null);

  // Multi-file folder state (right panel only)
  const [rightSubmissions, setRightSubmissions] = useState<Submission[] | null>(null);
  const [rightCurrentIndex, setRightCurrentIndex] = useState(0);
  const [rightIsFolder, setRightIsFolder] = useState(false);

  const cursorSideRef = useRef<"left" | "right">("left");

  // Synchronized scrolling via native passive listeners.
  // We track which panel the user is actively scrolling (via pointer/wheel)
  // and only ever sync FROM that panel, avoiding feedback-loop drift.
  const leftScrollRef = useRef<HTMLDivElement | null>(null);
  const rightScrollRef = useRef<HTMLDivElement | null>(null);
  const activePanel = useRef<"left" | "right" | null>(null);

  useEffect(() => {
    const leftEl = leftScrollRef.current;
    const rightEl = rightScrollRef.current;
    if (!leftEl || !rightEl) return;

    function syncScroll(source: HTMLDivElement, target: HTMLDivElement) {
      const maxScroll = source.scrollHeight - source.clientHeight;
      const ratio = maxScroll > 0 ? source.scrollTop / maxScroll : 0;
      const targetMax = target.scrollHeight - target.clientHeight;
      target.scrollTop = Math.round(ratio * targetMax);
    }

    const onLeftScroll = () => {
      if (activePanel.current === "left") syncScroll(leftEl, rightEl);
    };
    const onRightScroll = () => {
      if (activePanel.current === "right") syncScroll(rightEl, leftEl);
    };

    // Mark which panel the user is interacting with
    const onLeftEnter = () => { activePanel.current = "left"; };
    const onRightEnter = () => { activePanel.current = "right"; };
    const onLeftWheel = () => { activePanel.current = "left"; };
    const onRightWheel = () => { activePanel.current = "right"; };

    leftEl.addEventListener("scroll", onLeftScroll, { passive: true });
    rightEl.addEventListener("scroll", onRightScroll, { passive: true });
    leftEl.addEventListener("pointerenter", onLeftEnter);
    rightEl.addEventListener("pointerenter", onRightEnter);
    leftEl.addEventListener("wheel", onLeftWheel, { passive: true });
    rightEl.addEventListener("wheel", onRightWheel, { passive: true });

    return () => {
      leftEl.removeEventListener("scroll", onLeftScroll);
      rightEl.removeEventListener("scroll", onRightScroll);
      leftEl.removeEventListener("pointerenter", onLeftEnter);
      rightEl.removeEventListener("pointerenter", onRightEnter);
      leftEl.removeEventListener("wheel", onLeftWheel);
      rightEl.removeEventListener("wheel", onRightWheel);
    };
  });

  // Extract single file
  const extractAndSet = useCallback(
    async (side: "left" | "right", filePath: string) => {
      const setLoading = side === "left" ? setLeftLoading : setRightLoading;
      const setContent = side === "left" ? setLeftContent : setRightContent;
      const setFile = side === "left" ? setLeftFile : setRightFile;

      // If dropping single file on right, clear folder state
      if (side === "right") {
        setRightSubmissions(null);
        setRightCurrentIndex(0);
        setRightIsFolder(false);
      }

      setLoading(true);
      setError(null);

      try {
        const result = await invoke<string[]>("extract_inputs", {
          path: filePath,
        });
        setContent(formatInputs(result));
        setFile(filePath.split("/").pop() || filePath);
      } catch (e) {
        setError(`Error: ${e}`);
        setContent(null);
        setFile(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Extract all files from folder (right panel only)
  const extractBatchAndSet = useCallback(async (dirPath: string) => {
    setRightLoading(true);
    setError(null);
    setRightContent(null);
    setRightFile(null);

    try {
      const result = await invoke<BatchResult>("extract_inputs_batch", {
        path: dirPath,
      });

      if (result.files.length === 0) {
        setError("No .nb files found in folder");
        setRightLoading(false);
        return;
      }

      const submissions: Submission[] = result.files.map((file) => ({
        filename: file.relativePath.split("/").pop() || file.relativePath,
        relativePath: file.relativePath,
        content: formatInputs(file.inputs),
        error: file.error,
      }));

      setRightSubmissions(submissions);
      setRightCurrentIndex(0);
      setRightIsFolder(true);
      setRightContent(submissions[0].content);
      setRightFile(submissions[0].relativePath);
    } catch (e) {
      setError(`Batch extraction failed: ${e}`);
    } finally {
      setRightLoading(false);
    }
  }, []);

  // Update right content when navigating between submissions
  useEffect(() => {
    if (rightSubmissions && rightIsFolder) {
      const current = rightSubmissions[rightCurrentIndex];
      setRightContent(current.content);
      setRightFile(current.relativePath);
    }
  }, [rightCurrentIndex, rightSubmissions, rightIsFolder]);

  // Arrow key navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!rightIsFolder || !rightSubmissions) return;

      if (e.key === "ArrowLeft" && rightCurrentIndex > 0) {
        setRightCurrentIndex((prev) => prev - 1);
      } else if (
        e.key === "ArrowRight" &&
        rightCurrentIndex < rightSubmissions.length - 1
      ) {
        setRightCurrentIndex((prev) => prev + 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [rightIsFolder, rightSubmissions, rightCurrentIndex]);

  // Listen for Tauri drag-drop events
  useEffect(() => {
    const webview = getCurrentWebviewWindow();
    const unlisten = webview.onDragDropEvent(async (event) => {
      if (event.payload.type === "over") {
        const x = event.payload.position.x;
        const midpoint = window.innerWidth / 2;
        const side = x < midpoint ? "left" : "right";
        setDragOver(side);
        cursorSideRef.current = side;
      } else if (event.payload.type === "drop") {
        setDragOver(null);
        const paths: string[] = event.payload.paths;
        if (paths.length === 0) return;

        const firstPath = paths[0];
        const side = cursorSideRef.current;

        // Check if it's a directory (only meaningful for right panel)
        if (side === "right") {
          try {
            const isDir = await invoke<boolean>("is_directory", {
              path: firstPath,
            });
            if (isDir) {
              extractBatchAndSet(firstPath);
              return;
            }
          } catch {
            // Fall through to single file handling
          }
        }

        // Single file handling
        const nbFile = paths.find((p) => p.endsWith(".nb"));
        if (nbFile) {
          extractAndSet(side, nbFile);
        } else {
          setError("Please drop a .nb file or folder");
        }
      } else if (event.payload.type === "leave") {
        setDragOver(null);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [extractAndSet, extractBatchAndSet]);

  const handleOpenDialog = useCallback(
    async (side: "left" | "right") => {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Mathematica Notebook", extensions: ["nb"] }],
      });
      if (selected) {
        extractAndSet(side, selected as string);
      }
    },
    [extractAndSet]
  );

  const handleClear = useCallback((side: "left" | "right") => {
    if (side === "left") {
      setLeftContent(null);
      setLeftFile(null);
    } else {
      setRightContent(null);
      setRightFile(null);
      setRightSubmissions(null);
      setRightCurrentIndex(0);
      setRightIsFolder(false);
    }
  }, []);

  // Delete an input block by index from either side's content
  const handleDeleteBlock = useCallback(
    (side: "left" | "right", blockIndex: number) => {
      const content = side === "left" ? leftContent : rightContent;
      if (!content) return;

      const setContent = side === "left" ? setLeftContent : setRightContent;

      // Split content into blocks by "(* Input N *)" headers
      const blocks: { header: string; body: string }[] = [];
      const lines = content.split("\n");
      let currentBlock: { header: string; body: string } | null = null;

      for (const line of lines) {
        if (/^\(\* Input \d+ \*\)$/.test(line.trim())) {
          if (currentBlock) blocks.push(currentBlock);
          currentBlock = { header: line, body: "" };
        } else if (currentBlock) {
          currentBlock.body += (currentBlock.body ? "\n" : "") + line;
        }
      }
      if (currentBlock) blocks.push(currentBlock);

      if (blockIndex < 0 || blockIndex >= blocks.length) return;

      // Remove the block
      blocks.splice(blockIndex, 1);

      if (blocks.length === 0) {
        setContent("");
        return;
      }

      // Renumber and reassemble (trim trailing whitespace from each body
      // to avoid accumulating extra blank lines on repeated deletions)
      const newContent = blocks
        .map((block, i) => {
          return `(* Input ${i + 1} *)\n${block.body.trimEnd()}`;
        })
        .join("\n\n");

      setContent(newContent);
    },
    [leftContent, rightContent]
  );

  const showDiff = leftContent !== null && rightContent !== null;

  return (
    <div className="app">
      {error && (
        <div className="error-toast">{error}</div>
      )}
      <div className="panels">
        {/* Left Panel - Key */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">
              {leftFile ? leftFile : "Key"}
            </span>
            {leftContent !== null && (
              <button
                className="clear-btn"
                onClick={() => handleClear("left")}
              >
                Clear
              </button>
            )}
          </div>
          {/* Spacer to match NavigationControls height on right panel */}
          {rightIsFolder && rightSubmissions && showDiff && (
            <div className="nav-spacer" />
          )}
          {showDiff ? (
            <DiffView
              leftContent={leftContent}
              rightContent={rightContent}
              side="left"
              onDeleteBlock={handleDeleteBlock}
              scrollRef={leftScrollRef}
            />
          ) : leftLoading ? (
            <div className="dropzone">
              <div className="loading">
                <div className="spinner" />
                <span>Extracting inputs...</span>
              </div>
            </div>
          ) : leftContent !== null ? (
            <div className="content">
              <pre>{leftContent}</pre>
            </div>
          ) : (
            <div
              className={`dropzone empty ${dragOver === "left" ? "drag-over" : ""}`}
              onClick={() => handleOpenDialog("left")}
            >
              <div className="dropzone-label">
                <div className="icon">📄</div>
                <p>Drop Key / Solution here</p>
                <p className="hint">.nb files — or click to browse</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Submission(s) */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">
              {rightIsFolder
                ? rightFile || "Submissions"
                : rightFile
                  ? rightFile
                  : "Submission"}
            </span>
            {rightContent !== null && (
              <button
                className="clear-btn"
                onClick={() => handleClear("right")}
              >
                Clear
              </button>
            )}
          </div>
          {/* Navigation controls for folder mode */}
          {rightIsFolder && rightSubmissions && (
            <NavigationControls
              currentIndex={rightCurrentIndex}
              totalFiles={rightSubmissions.length}
              currentFile={rightSubmissions[rightCurrentIndex].relativePath}
              onPrevious={() =>
                setRightCurrentIndex((prev) => Math.max(0, prev - 1))
              }
              onNext={() =>
                setRightCurrentIndex((prev) =>
                  Math.min(rightSubmissions.length - 1, prev + 1)
                )
              }
            />
          )}
          {showDiff ? (
            <DiffView
              leftContent={leftContent}
              rightContent={rightContent}
              side="right"
              onDeleteBlock={handleDeleteBlock}
              scrollRef={rightScrollRef}
            />
          ) : rightLoading ? (
            <div className="dropzone">
              <div className="loading">
                <div className="spinner" />
                <span>
                  {rightIsFolder
                    ? "Extracting inputs from folder..."
                    : "Extracting inputs..."}
                </span>
              </div>
            </div>
          ) : rightContent !== null ? (
            <div className="content">
              <pre>{rightContent}</pre>
            </div>
          ) : (
            <div
              className={`dropzone empty ${dragOver === "right" ? "drag-over" : ""}`}
              onClick={() => handleOpenDialog("right")}
            >
              <div className="dropzone-label">
                <div className="icon">📁</div>
                <p>Drop Submission or Folder here</p>
                <p className="hint">.nb file or folder — or click to browse</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
