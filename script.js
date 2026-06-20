(function () {
    initTabs();
    // Enhance every panel independently so each tab remembers its own order.
    document.querySelectorAll(".projects").forEach(initReorder);

    // ---------------------------------------------------------------- Tabs
    function initTabs() {
        const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
        if (!tabs.length) return;

        function activate(id, { focus = false, persist = true } = {}) {
            for (const tab of tabs) {
                const selected = tab.id === id;
                tab.setAttribute("aria-selected", selected ? "true" : "false");
                tab.classList.toggle("is-active", selected);
                tab.tabIndex = selected ? 0 : -1;
                const panel = document.getElementById(tab.getAttribute("aria-controls"));
                if (panel) panel.hidden = !selected;
                if (selected && focus) tab.focus();
            }
            if (persist) {
                try { localStorage.setItem("portfolio-active-tab", id); } catch (_) { /* ignore */ }
            }
        }

        tabs.forEach((tab, i) => {
            tab.addEventListener("click", () => activate(tab.id));
            tab.addEventListener("keydown", (e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                const dir = e.key === "ArrowRight" ? 1 : -1;
                activate(tabs[(i + dir + tabs.length) % tabs.length].id, { focus: true });
            });
        });

        // Initial tab: URL hash (#apps) > last used > first.
        const hash = location.hash.replace("#", "");
        const byHash = tabs.find(t => t.getAttribute("aria-controls") === "panel-" + hash);
        let stored = null;
        try { stored = localStorage.getItem("portfolio-active-tab"); } catch (_) { /* ignore */ }
        const valid = stored && tabs.some(t => t.id === stored) ? stored : null;
        activate((byHash && byHash.id) || valid || tabs[0].id, { persist: false });
    }

    // ----------------------------------------------------- Drag to reorder
    function initReorder(section) {
        const storageKey = "portfolio-card-order:" + (section.id || "default");
        const realCards = Array.from(section.querySelectorAll(".project-card:not(.project-card--teaser)"));
        const teaser = section.querySelector(".project-card--teaser");
        let dragged = null;

        restoreOrder();

        for (const card of realCards) {
            card.setAttribute("draggable", "true");
            for (const link of card.querySelectorAll("a")) link.setAttribute("draggable", "false");
            card.addEventListener("dragstart", onDragStart);
            card.addEventListener("dragend", onDragEnd);
            card.addEventListener("dragover", onDragOver);
            card.addEventListener("dragenter", preventDefault);
        }

        function onDragStart(e) {
            dragged = this;
            this.classList.add("is-dragging");
            e.dataTransfer.effectAllowed = "move";
            try { e.dataTransfer.setData("text/plain", this.dataset.key || ""); } catch (_) { /* ignore */ }
        }

        function onDragEnd() {
            this.classList.remove("is-dragging");
            dragged = null;
            persistOrder();
        }

        function onDragOver(e) {
            if (!dragged || dragged === this) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const rect = this.getBoundingClientRect();
            const after = e.clientY > rect.top + rect.height / 2;
            if (after) {
                if (this.nextSibling !== dragged) this.parentNode.insertBefore(dragged, this.nextSibling);
            } else if (this !== dragged.nextSibling) {
                this.parentNode.insertBefore(dragged, this);
            }
        }

        function preventDefault(e) {
            if (dragged) e.preventDefault();
        }

        function persistOrder() {
            if (teaser && teaser.parentNode === section) section.appendChild(teaser);
            const keys = Array.from(section.querySelectorAll(".project-card:not(.project-card--teaser)"))
                .map(c => c.dataset.key)
                .filter(Boolean);
            try { localStorage.setItem(storageKey, JSON.stringify(keys)); } catch (_) { /* ignore */ }
        }

        function restoreOrder() {
            let saved;
            try { saved = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch (_) { saved = null; }
            if (!Array.isArray(saved) || !saved.length) return;

            const byKey = new Map(realCards.map(c => [c.dataset.key, c]));
            const seen = new Set();
            for (const key of saved) {
                const card = byKey.get(key);
                if (card) { section.appendChild(card); seen.add(key); }
            }
            for (const card of realCards) {
                if (!seen.has(card.dataset.key)) section.appendChild(card);
            }
            if (teaser) section.appendChild(teaser);
        }
    }
})();
