(function () {
    const STORAGE_KEY = "portfolio-card-order";
    const section = document.querySelector(".projects");
    if (!section) return;

    const allCards = Array.from(section.querySelectorAll(".project-card"));
    const realCards = allCards.filter(c => !c.classList.contains("project-card--teaser"));
    const teaser = section.querySelector(".project-card--teaser");

    restoreOrder();

    for (const card of realCards) {
        card.setAttribute("draggable", "true");

        for (const link of card.querySelectorAll("a")) {
            link.setAttribute("draggable", "false");
        }

        card.addEventListener("dragstart", onDragStart);
        card.addEventListener("dragend", onDragEnd);
        card.addEventListener("dragover", onDragOver);
        card.addEventListener("dragenter", preventDefault);
    }

    let dragged = null;

    function onDragStart(e) {
        dragged = this;
        this.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        try {
            e.dataTransfer.setData("text/plain", this.dataset.key || "");
        } catch (_) { /* some browsers throw on empty */ }
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
            if (this.nextSibling !== dragged) {
                this.parentNode.insertBefore(dragged, this.nextSibling);
            }
        } else {
            if (this !== dragged.nextSibling) {
                this.parentNode.insertBefore(dragged, this);
            }
        }
    }

    function preventDefault(e) {
        if (dragged) e.preventDefault();
    }

    function persistOrder() {
        if (teaser && teaser.parentNode === section) {
            section.appendChild(teaser);
        }
        const keys = Array.from(section.querySelectorAll(".project-card:not(.project-card--teaser)"))
            .map(c => c.dataset.key)
            .filter(Boolean);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
        } catch (_) { /* localStorage may be unavailable */ }
    }

    function restoreOrder() {
        let saved;
        try {
            saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        } catch (_) {
            saved = null;
        }
        if (!Array.isArray(saved) || !saved.length) return;

        const byKey = new Map(realCards.map(c => [c.dataset.key, c]));
        const seen = new Set();

        for (const key of saved) {
            const card = byKey.get(key);
            if (card) {
                section.appendChild(card);
                seen.add(key);
            }
        }
        for (const card of realCards) {
            if (!seen.has(card.dataset.key)) section.appendChild(card);
        }
        if (teaser) section.appendChild(teaser);
    }
})();
