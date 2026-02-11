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

  // Block hover state (shared across both panels by blockIndex)
  const [hoveredBlock, setHoveredBlock] = useState<number | null>(null);

  // Block selection state
  const [selectedBlock, setSelectedBlock] = useState<{ side: "left" | "right"; blockIndex: number } | null>(null);

  const handleSelectBlock = useCallback((side: "left" | "right", blockIndex: number) => {
    setSelectedBlock((prev) => {
      // Toggle off if clicking the same block
      if (prev && prev.side === side && prev.blockIndex === blockIndex) return null;
      return { side, blockIndex };
    });
  }, []);

  // Delete selected block on Delete/Backspace key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedBlock) return;
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        handleDeleteBlock(selectedBlock.side, selectedBlock.blockIndex);
        setSelectedBlock(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedBlock, handleDeleteBlock]);

  // Clear selection when clicking outside blocks
  useEffect(() => {
    const handleClick = () => setSelectedBlock(null);
    // Use capture phase so we can check if a block was clicked first
    // The block click handler calls stopPropagation, so this only fires for non-block clicks
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  // Resizable panels
  const [splitPercent, setSplitPercent] = useState(50);
  const panelsRef = useRef<HTMLDivElement | null>(null);
  const isDraggingDivider = useRef(false);

  const onDividerPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDraggingDivider.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onDividerPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingDivider.current || !panelsRef.current) return;
    const rect = panelsRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setSplitPercent(Math.max(20, Math.min(80, pct)));
  }, []);

  const onDividerPointerUp = useCallback(() => {
    isDraggingDivider.current = false;
  }, []);

  // Header expansion state: which side is expanded (null = all collapsed)
  const [expandedHeader, setExpandedHeader] = useState<"left" | "right" | null>(null);

  // Rename state
  const [editingSide, setEditingSide] = useState<"left" | "right" | null>(null);
  const [editValue, setEditValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const startRename = useCallback((side: "left" | "right") => {
    const current = side === "left" ? leftFile : rightFile;
    if (!current) return;
    setEditingSide(side);
    // Only edit the filename portion
    const filename = current.split("/").pop() || current;
    setEditValue(filename);
  }, [leftFile, rightFile]);

  const commitRename = useCallback(() => {
    if (!editingSide) return;
    const trimmed = editValue.trim();
    if (trimmed) {
      // Replace only the filename portion, keeping the path
      const current = editingSide === "left" ? leftFile : rightFile;
      if (current) {
        const parts = current.split("/");
        parts[parts.length - 1] = trimmed;
        const newPath = parts.join("/");
        if (editingSide === "left") setLeftFile(newPath);
        else setRightFile(newPath);
      }
    }
    setEditingSide(null);
  }, [editingSide, editValue, leftFile, rightFile]);

  const cancelRename = useCallback(() => {
    setEditingSide(null);
  }, []);

  // Focus rename input when it appears
  useEffect(() => {
    if (editingSide && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingSide]);

  // Auto-collapse header when clicking outside
  useEffect(() => {
    if (!expandedHeader) return;
    const handleClick = (e: MouseEvent) => {
      // Check if click is inside a panel-header
      const target = e.target as HTMLElement;
      if (target.closest(".panel-header")) return;
      setExpandedHeader(null);
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [expandedHeader]);

  const showDiff = leftContent !== null && rightContent !== null;

  /** Extract just the filename from a path */
  const getFilename = (path: string) => path.split("/").pop() || path;
  /** Check if path has directory components */
  const hasPath = (path: string) => path.includes("/");

  const renderPanelHeader = (side: "left" | "right") => {
    const file = side === "left" ? leftFile : rightFile;
    const content = side === "left" ? leftContent : rightContent;
    const placeholder = side === "left" ? "Key" : "Submission";
    const isEditing = editingSide === side;
    const isExpanded = expandedHeader === side;

    const filename = file ? getFilename(file) : null;

    return (
      <div
        className={`panel-header ${isExpanded ? "expanded" : "collapsed"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {isExpanded ? (
          <>
            <span className="panel-title" title={file || undefined}>
              {file || placeholder}
            </span>
            <div className="panel-header-actions">
              {content !== null && (
                <button
                  className="clear-btn"
                  onClick={() => handleClear(side)}
                >
                  Clear
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="panel-header-folded">
            {file && hasPath(file) ? (
              <span
                className="panel-header-ellipsis"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedHeader(side);
                }}
                title="Show full path"
              >
                .../
              </span>
            ) : null}
            {isEditing ? (
              <input
                ref={renameInputRef}
                className="rename-input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") cancelRename();
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="panel-header-filename"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  file && startRename(side);
                }}
                title={file ? "Double-click to rename" : undefined}
              >
                {filename || placeholder}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="app">
      {error && (
        <div className="error-toast">{error}</div>
      )}
      <div className="panels" ref={panelsRef}>
        {/* Left Panel - Key */}
        <div className="panel" style={{ flex: `0 0 ${splitPercent}%` }}>
          {renderPanelHeader("left")}
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
              selectedBlock={selectedBlock}
              onSelectBlock={handleSelectBlock}
              hoveredBlock={hoveredBlock}
              onHoverBlock={setHoveredBlock}
              showLineNumbers
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

        {/* Draggable divider */}
        <div
          className="panel-divider"
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={onDividerPointerUp}
        />

        {/* Right Panel - Submission(s) */}
        <div className="panel" style={{ flex: 1 }}>
          {renderPanelHeader("right")}
          {/* Navigation controls for folder mode */}
          {rightIsFolder && rightSubmissions && (
            <NavigationControls
              currentIndex={rightCurrentIndex}
              totalFiles={rightSubmissions.length}
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
              selectedBlock={selectedBlock}
              onSelectBlock={handleSelectBlock}
              hoveredBlock={hoveredBlock}
              onHoverBlock={setHoveredBlock}
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
