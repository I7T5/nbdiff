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

  const showDiff = leftContent !== null && rightContent !== null;

  return (
    <div className="app">
      <div className="header">
        <h1>NBDiff</h1>
        {error && (
          <span style={{ color: "#e06c75", fontSize: 12 }}>{error}</span>
        )}
      </div>
      <div className="panels">
        {/* Left Panel - Key */}
        <div className="panel">
          <div className="panel-header">
            <span>
              Key / Solution{" "}
              {leftFile && <span className="filename">— {leftFile}</span>}
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
          {showDiff ? (
            <DiffView
              leftContent={leftContent}
              rightContent={rightContent}
              side="left"
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
            <span>
              {rightIsFolder ? "Student Submissions" : "Student Submission"}{" "}
              {rightFile && !rightIsFolder && (
                <span className="filename">— {rightFile}</span>
              )}
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
