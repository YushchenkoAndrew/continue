import { useEffect, useState } from "react";

/**
 * TEMPORARY diagnostic. Renders nothing while the layout is fine. When some element reaches
 * past the right edge of the view, it shows which one (outermost offenders only), so the cause
 * can be read from a screenshot without opening any devtools. Remove once the layout bug is
 * understood.
 */
function describe(el: Element): string {
  const cls = String((el as HTMLElement).className || "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(".");
  const r = el.getBoundingClientRect();
  const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28);
  return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""} [w ${Math.round(r.width)}, right ${Math.round(r.right)}] "${text}"`;
}

function scan(): string[] {
  const root = document.getElementById("root");
  if (!root) return [];
  const vw = document.documentElement.clientWidth;
  const out: string[] = [];
  const all = Array.from(root.querySelectorAll("*")).filter(
    (e) => !(e as HTMLElement).closest("[data-overflow-probe]"),
  );
  const wide = new Set<Element>(
    all.filter((e) => e.getBoundingClientRect().right > vw + 1),
  );
  const outer = Array.from(wide).filter(
    (e) => !e.parentElement || !wide.has(e.parentElement),
  );
  for (const e of outer.slice(0, 3)) out.push(`wide: ${describe(e)}`);
  for (const e of all.filter((x) => x.scrollLeft > 0).slice(0, 2)) {
    out.push(`scrolled ${Math.round(e.scrollLeft)}px: ${describe(e)}`);
  }
  if (out.length)
    out.unshift(
      `view ${vw}px, scrollWidth ${document.documentElement.scrollWidth}`,
    );
  return out;
}

export function OverflowProbe() {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    const run = () => {
      const next = scan();
      setLines((prev) => (prev.join("|") === next.join("|") ? prev : next));
    };
    run();
    const id = window.setInterval(run, 1000);
    window.addEventListener("resize", run);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", run);
    };
  }, []);
  if (!lines.length) return null;
  return (
    <div
      data-overflow-probe
      style={{
        position: "fixed",
        left: 0,
        bottom: 0,
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        zIndex: 9999,
        padding: "2px 4px",
        fontSize: 9,
        lineHeight: 1.2,
        background: "#7a1d1d",
        color: "#fff",
        overflowWrap: "anywhere",
        pointerEvents: "none",
      }}
    >
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}
