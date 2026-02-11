interface NavigationControlsProps {
  currentIndex: number;
  totalFiles: number;
  onPrevious: () => void;
  onNext: () => void;
}

export default function NavigationControls({
  currentIndex,
  totalFiles,
  onPrevious,
  onNext,
}: NavigationControlsProps) {
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === totalFiles - 1;

  return (
    <div className="nav-controls">
      <button
        className="nav-btn"
        onClick={onPrevious}
        disabled={isFirst}
        title="Previous submission (←)"
      >
        ←
      </button>
      <span className="nav-counter">
        {currentIndex + 1} / {totalFiles}
      </span>
      <button
        className="nav-btn"
        onClick={onNext}
        disabled={isLast}
        title="Next submission (→)"
      >
        →
      </button>
    </div>
  );
}
