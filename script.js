(function () {
    initTabs();
    initThumbnails();
    initSiteMusic();
    // Enhance every panel independently so each tab remembers its own order.
    document.querySelectorAll(".projects").forEach(initReorder);

    // ------------------------------------------------------- Background music
    // Plays the 'portfolio' preset from music.js. Autoplay rules require a
    // gesture before audio can resume, so we start on the first interaction
    // and otherwise wait for the user to click the ♪ button.
    function initSiteMusic() {
        const btn = document.getElementById("site-mute");
        if (!btn || !window.Music) return;
        let started = false;
        // Remember the user's choice to autoplay across visits.
        let allowAuto = true;
        try { allowAuto = localStorage.getItem("portfolio-music-off") !== "1"; } catch (_) {}
        function refresh() {
            const muted = window.Music.isMuted();
            btn.classList.toggle("is-muted", muted || !started);
            btn.classList.toggle("is-playing", started && !muted);
        }
        function startOnce() {
            if (started || !allowAuto) return;
            started = true;
            window.Music.start("portfolio");
            if (window.Music.isMuted()) window.Music.setMuted(false);
            refresh();
        }
        // Autoplay only after a real user gesture.
        window.addEventListener("pointerdown", startOnce, { once: true, capture: true });
        window.addEventListener("keydown", startOnce, { once: true, capture: true });
        btn.addEventListener("click", function () {
            if (!started) {
                allowAuto = true;
                try { localStorage.removeItem("portfolio-music-off"); } catch (_) {}
                startOnce();
                return;
            }
            window.Music.toggle();
            if (window.Music.isMuted()) {
                try { localStorage.setItem("portfolio-music-off", "1"); } catch (_) {}
            } else {
                try { localStorage.removeItem("portfolio-music-off"); } catch (_) {}
            }
            refresh();
        });
        refresh();
    }

    // ------------------------------------------------------- Thumbnails
    // If img/thumbs/<data-key>.jpg (or .png) exists, set --thumb on the
    // card and add .has-thumb. Otherwise the accent-gradient fallback
    // stays. Image preload swallows 404s with no console error.
    function initThumbnails() {
        const cards = document.querySelectorAll(".project-card[data-key]");
        for (const card of cards) {
            const key = card.dataset.key;
            tryExt(card, key, ["jpg", "png"], 0);
        }
    }

    function tryExt(card, key, exts, i) {
        if (i >= exts.length) return;
        const url = "img/thumbs/" + key + "." + exts[i];
        const img = new Image();
        img.onload = function () {
            card.style.setProperty("--thumb", 'url("' + url + '")');
            card.classList.add("has-thumb");
        };
        img.onerror = function () { tryExt(card, key, exts, i + 1); };
        img.src = url;
    }

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
        // Featured tile is pinned via CSS `order: -1` and excluded from drag.
        const realCardSelector = ".project-card:not(.project-card--teaser):not(.project-card--placeholder):not(.project-card--featured)";
        const realCards = Array.from(section.querySelectorAll(realCardSelector));
        const placeholders = Array.from(section.querySelectorAll(".project-card--placeholder"));
        const teaser = section.querySelector(".project-card--teaser");
        let dragged = null;

        restoreOrder();

        for (const card of realCards) {
            card.setAttribute("draggable", "true");
            for (const link of card.querySelectorAll("a")) {
                link.setAttribute("draggable", "false");
                // Stop the parent card from claiming the pointerdown as a drag
                // start — that was eating clicks on the Play CTA when the cursor
                // moved at all between mousedown and mouseup.
                link.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
                link.addEventListener("mousedown", function (e) { e.stopPropagation(); });
                link.addEventListener("dragstart", function (e) { e.preventDefault(); e.stopPropagation(); });
            }
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
            // Grid layout: insertion side is decided by horizontal position
            // within the hovered tile.
            const rect = this.getBoundingClientRect();
            const after = e.clientX > rect.left + rect.width / 2;
            if (after) {
                if (this.nextSibling !== dragged) this.parentNode.insertBefore(dragged, this.nextSibling);
            } else if (this !== dragged.nextSibling) {
                this.parentNode.insertBefore(dragged, this);
            }
        }

        function preventDefault(e) {
            if (dragged) e.preventDefault();
        }

        // Placeholders and the teaser are pinned below the real cards. After
        // any reorder we re-anchor them so they stay out of the way.
        function pinTail() {
            for (const ph of placeholders) section.appendChild(ph);
            if (teaser && teaser.parentNode === section) section.appendChild(teaser);
        }

        function persistOrder() {
            pinTail();
            const keys = Array.from(section.querySelectorAll(realCardSelector))
                .map(c => c.dataset.key)
                .filter(Boolean);
            try { localStorage.setItem(storageKey, JSON.stringify(keys)); } catch (_) { /* ignore */ }
        }

        function restoreOrder() {
            let saved;
            try { saved = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch (_) { saved = null; }
            if (!Array.isArray(saved) || !saved.length) { pinTail(); return; }

            const byKey = new Map(realCards.map(c => [c.dataset.key, c]));
            const seen = new Set();
            for (const key of saved) {
                const card = byKey.get(key);
                if (card) { section.appendChild(card); seen.add(key); }
            }
            for (const card of realCards) {
                if (!seen.has(card.dataset.key)) section.appendChild(card);
            }
            pinTail();
        }
    }
})();
