const CARD_CLASS = "boat-mobile-card-table";
const SCROLL_CLASS = "boat-mobile-scroll-table";

function enhanceTable(table: HTMLTableElement) {
  if (table.dataset.mobileTable === "scroll" || table.closest('[data-mobile-table="scroll"]')) {
    table.classList.add(SCROLL_CLASS);
    table.classList.remove(CARD_CLASS);
    return;
  }

  const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"))
    .map((cell) => cell.textContent?.trim() || "");
  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"));
  const hasComplexCells = rows.some((row) =>
    Array.from(row.cells).some((cell) => cell.colSpan > 1 || cell.rowSpan > 1)
  );
  const hasEditingGrid = Boolean(table.querySelector("tbody input, tbody textarea, tbody select"));

  if (!headers.length || headers.length > 8 || hasComplexCells || hasEditingGrid) {
    table.classList.add(SCROLL_CLASS);
    table.classList.remove(CARD_CLASS);
    return;
  }

  table.classList.add(CARD_CLASS);
  table.classList.remove(SCROLL_CLASS);
  rows.forEach((row) => {
    Array.from(row.cells).forEach((cell, index) => {
      const label = headers[index];
      if (label) cell.dataset.label = label;
      if (!cell.textContent?.trim() && !cell.querySelector("button, a")) cell.classList.add("boat-mobile-empty-cell");
    });
  });
}

export function observeMobileTableCards(root: HTMLElement): () => void {
  let scheduled = 0;
  const enhance = () => {
    scheduled = 0;
    root.querySelectorAll<HTMLTableElement>("table").forEach(enhanceTable);
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = window.requestAnimationFrame(enhance);
  };
  schedule();
  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    if (scheduled) window.cancelAnimationFrame(scheduled);
    root.querySelectorAll(`.${CARD_CLASS}, .${SCROLL_CLASS}`).forEach((element) => {
      element.classList.remove(CARD_CLASS, SCROLL_CLASS);
    });
  };
}
