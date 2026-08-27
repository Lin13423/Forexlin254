// Blocks the browser's long-press / right-click menu (Save, Share, Print, Download)
// on empty areas of the app. Text fields, editable areas and anything explicitly
// marked with data-allow-context keep their native menu.
(function () {
    const ALLOWED_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION"]);

    function isInteractiveTarget(target) {
        if (!target || target.nodeType !== 1) return false;
        if (ALLOWED_TAGS.has(target.tagName)) return true;
        if (target.isContentEditable) return true;
        return Boolean(target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-allow-context]"));
    }

    function hasTextSelection() {
        const selection = window.getSelection();
        return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
    }

    document.addEventListener("contextmenu", (event) => {
        if (isInteractiveTarget(event.target)) return;
        if (hasTextSelection()) return;
        event.preventDefault();
    });

    document.addEventListener("dragstart", (event) => {
        if (isInteractiveTarget(event.target)) return;
        event.preventDefault();
    });

    const style = document.createElement("style");
    style.textContent = `
        body { -webkit-touch-callout: none; }
        input, textarea, select, [contenteditable='true'], [data-allow-context] { -webkit-touch-callout: default; }
    `;
    (document.head || document.documentElement).appendChild(style);
})();
