(function () {
  "use strict";

  const popovers = Array.from(document.querySelectorAll("details[data-popover]"));
  const dialogs = Array.from(document.querySelectorAll("dialog[data-dialog]"));

  const sceneKey = location.pathname.endsWith("liquid.html")
    ? "pour-spill"
    : new URLSearchParams(location.search).get("scene") === "sparks"
      ? "sparks"
      : "flow-paint";
  document.body.dataset.scene = sceneKey;
  document.querySelector(`[data-scene-link="${sceneKey}"]`)?.setAttribute("aria-current", "page");

  for (const popover of popovers) {
    popover.addEventListener("toggle", () => {
      if (!popover.open) {
        return;
      }
      for (const other of popovers) {
        if (other !== popover) {
          other.open = false;
        }
      }
    });
  }

  document.addEventListener("pointerdown", (event) => {
    for (const popover of popovers) {
      if (popover.open && !popover.contains(event.target)) {
        popover.open = false;
      }
    }
  });

  for (const button of document.querySelectorAll("[data-open-dialog]")) {
    button.addEventListener("click", () => {
      const dialog = document.getElementById(button.dataset.openDialog);
      if (dialog && !dialog.open) {
        dialog.showModal();
      }
    });
  }

  for (const dialog of dialogs) {
    dialog.addEventListener("pointerdown", (event) => {
      if (event.target === dialog) {
        dialog.close();
      }
    });
    for (const button of dialog.querySelectorAll("[data-close-dialog]")) {
      button.addEventListener("click", () => dialog.close());
    }
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    for (const popover of popovers) {
      popover.open = false;
    }
  });
})();
