"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import LeftSidebar from "./left-sidebar";
import RightSidebar from "./right-sidebar";
import ConceptionPanel from "@/components/conception/conception-panel";
import MaturationPanel from "@/components/maturation/maturation-panel";
import LandscapePanel from "@/components/landscape/landscape-panel";
import DifferentiationPanel from "@/components/differentiation/differentiation-panel";
import ShowcasePanel from "@/components/showcase/showcase-panel";
import { useWorkspace } from "@/lib/store";
import { useBootstrap } from "@/lib/hooks/use-bootstrap";

/**
 * The signature layout. Three fluidly resizable panes:
 *   Left (The Brain) 20% · Center (Socratic Helper) 45% · Right (Live Draft) 35%.
 * Widths are clamped so no pane collapses; resize state lives locally to avoid
 * any layout shift on load.
 */
export default function Triptych() {
  // Fractions of the total width. Must sum to 1.
  const [left, setLeft] = useState(0.2);
  const [right, setRight] = useState(0.35);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<null | "left" | "right">(null);
  const projectId = useWorkspace((s) => s.projectId);
  const stage = useWorkspace((s) => s.stage);

  useBootstrap();

  const onMouseDown = (which: "left" | "right") => (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = which;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    if (dragging.current === "left") {
      // Clamp left between 14% and 34%, leave room for the rest.
      setLeft(Math.min(0.34, Math.max(0.14, frac)));
    } else {
      // Right handle sits at (1 - right). Convert pointer to right fraction.
      setRight(Math.min(0.5, Math.max(0.22, 1 - frac)));
    }
  }, []);

  const onMouseUp = useCallback(() => {
    dragging.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  // A collapsed pane shrinks to a thin rail; the center (1fr) takes the rest.
  const RAIL = "44px";
  const leftCol = leftCollapsed ? RAIL : `${left * 100}%`;
  const rightCol = rightCollapsed ? RAIL : `${right * 100}%`;
  const leftDiv = leftCollapsed ? "0px" : "1px";
  const rightDiv = rightCollapsed ? "0px" : "1px";
  // Width grows with how much room the inventor frees up: both rails open → a
  // comfortable column; one collapsed → wide; both collapsed → full width.
  const collapsedCount = (leftCollapsed ? 1 : 0) + (rightCollapsed ? 1 : 0);
  const maxW =
    collapsedCount >= 2
      ? "max-w-none"
      : collapsedCount === 1
        ? "max-w-4xl"
        : "max-w-2xl";

  return (
    <div
      ref={containerRef}
      className="grid h-screen w-screen overflow-hidden bg-bg"
      style={{
        gridTemplateColumns: `${leftCol} ${leftDiv} minmax(0, 1fr) ${rightDiv} ${rightCol}`,
      }}
    >
      <LeftSidebar
        collapsed={leftCollapsed}
        onToggle={() => setLeftCollapsed((v) => !v)}
      />
      {leftCollapsed ? (
        <div />
      ) : (
        <Divider onMouseDown={onMouseDown("left")} />
      )}
      <div className="h-screen overflow-hidden bg-bg">
        {stage === "showcase" ? (
          <ShowcasePanel projectId={projectId} maxW={maxW} />
        ) : stage === "differentiation" ? (
          <DifferentiationPanel projectId={projectId} maxW={maxW} />
        ) : stage === "landscape" ? (
          <LandscapePanel projectId={projectId} maxW={maxW} />
        ) : stage === "maturation" ? (
          <MaturationPanel projectId={projectId} maxW={maxW} />
        ) : (
          <ConceptionPanel projectId={projectId} maxW={maxW} />
        )}
      </div>
      {rightCollapsed ? (
        <div />
      ) : (
        <Divider onMouseDown={onMouseDown("right")} />
      )}
      <RightSidebar
        collapsed={rightCollapsed}
        onToggle={() => setRightCollapsed((v) => !v)}
      />
    </div>
  );
}

function Divider({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="group relative cursor-col-resize bg-border"
      role="separator"
      aria-orientation="vertical"
    >
      <div className="absolute inset-y-0 -left-1 -right-1 z-10 transition-colors duration-150 ease-util group-hover:bg-accent/30" />
    </div>
  );
}
