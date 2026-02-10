import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import DiffView from "./components/DiffView";

function App() {
  const [leftContent, setLeftContent] = useState<string | null>(null);
  const [rightContent, setRightContent] = useState<string | null>(null);
  const [leftFile, setLeftFile] = useState<string | null>(null);
  const [rightFile, setRightFile] = useState<string | null>(null);
  const [leftLoading, setLeftLoading] = useState(false);
  const [rightLoading, setRightLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<"left" | "right" | null>(null);

  // Track which side the cursor is on for drop targeting
  const cursorSideRef = useRef<"left" | "right">("left");

  const extractAndSet = useCallback(
    async (side: "left" | "right", filePath: string) => {
      const setLoading = side === "left" ? setLeftLoading : setRightLoading;
      const setContent = side === "left" ? setLeftContent : setRightContent;
      const setFile = side === "left" ? setLeftFile : setRightFile;

      setLoading(true);
      setError(null);

      try {
        const result = await invoke<string[]>("extract_inputs", {
          path: filePath,
        });
        const text = result
          .map((input, i) => `(* Input ${i + 1} *)\n${input}`)
          .join("\n\n");
        setContent(text);
        const name = filePath.split("/").pop() || filePath;
        setFile(name);
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

  // Listen for Tauri drag-drop events (OS-level file drops)
  useEffect(() => {
    const webview = getCurrentWebviewWindow();
    const unlisten = webview.onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        // Determine which side based on x position
        const x = event.payload.position.x;
        const midpoint = window.innerWidth / 2;
        const side = x < midpoint ? "left" : "right";
        setDragOver(side);
        cursorSideRef.current = side;
      } else if (event.payload.type === "drop") {
        setDragOver(null);
        const paths: string[] = event.payload.paths;
        const nbFile = paths.find((p) => p.endsWith(".nb"));
        if (nbFile) {
          extractAndSet(cursorSideRef.current, nbFile);
        } else {
          setError("Please drop a .nb file");
        }
      } else if (event.payload.type === "leave") {
        setDragOver(null);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [extractAndSet]);

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

        {/* Right Panel - Submission */}
        <div className="panel">
          <div className="panel-header">
            <span>
              Student Submission{" "}
              {rightFile && <span className="filename">— {rightFile}</span>}
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
                <span>Extracting inputs...</span>
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
                <div className="icon">📄</div>
                <p>Drop Student Submission here</p>
                <p className="hint">.nb files — or click to browse</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
