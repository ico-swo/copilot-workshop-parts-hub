/**
 * Modal form engine.
 *
 * Builds a dialog from a field descriptor list, submits it through a callback,
 * and maps the server's `error.details` back onto the matching inputs. The
 * server is the only source of validation truth; this layer never duplicates
 * a rule, it only displays what the API rejected.
 *
 * Security note: every label, option and message is written with textContent
 * or createElement. Nothing is ever assigned to innerHTML.
 */

import { ApiError } from "/api-client.js";

const overlay = document.getElementById("modal-overlay");

/* -------------------------------------------------------------- utilities */

function element(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null && value !== false) node[key] = value;
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

export function closeModal() {
  overlay.replaceChildren();
  overlay.hidden = true;
  document.body.classList.remove("modal-open");
}

function openModal(node) {
  overlay.replaceChildren(node);
  overlay.hidden = false;
  document.body.classList.add("modal-open");
  const first = node.querySelector("input, select, textarea, button");
  first?.focus();
}

overlay.addEventListener("click", (event) => {
  if (event.target === overlay) closeModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !overlay.hidden) closeModal();
});

/* ------------------------------------------------------------ field types */

function buildField(field, value) {
  const id = `field-${field.name}`;
  const wrapper = element("div", { class: `field${field.wide ? " field-wide" : ""}` });

  wrapper.append(element("label", { htmlFor: id, text: field.label }));

  let input;
  switch (field.type) {
    case "select": {
      input = element("select", { id, name: field.name });
      if (field.allowEmpty) {
        input.append(element("option", { value: "", text: field.emptyLabel ?? "— none —" }));
      }
      for (const option of field.options) {
        input.append(element("option", { value: option.value, text: option.label }));
      }
      input.value = value ?? "";
      break;
    }
    case "textarea": {
      input = element("textarea", { id, name: field.name, rows: field.rows ?? 3 });
      input.value = value ?? "";
      break;
    }
    case "checkbox": {
      input = element("input", { id, name: field.name, type: "checkbox" });
      input.checked = value ?? field.default ?? false;
      wrapper.classList.add("field-checkbox");
      break;
    }
    case "number": {
      input = element("input", { id, name: field.name, type: "number", step: "1" });
      if (field.min !== undefined) input.min = String(field.min);
      if (field.max !== undefined) input.max = String(field.max);
      input.value = value ?? "";
      break;
    }
    case "date": {
      input = element("input", { id, name: field.name, type: "date" });
      input.value = value ?? "";
      break;
    }
    default: {
      input = element("input", { id, name: field.name, type: field.type ?? "text" });
      input.value = value ?? "";
    }
  }

  if (field.readonly) {
    input.disabled = true;
    wrapper.classList.add("field-readonly");
  }
  if (field.placeholder) input.placeholder = field.placeholder;

  wrapper.append(input);
  if (field.hint) wrapper.append(element("p", { class: "field-hint", text: field.hint }));
  wrapper.append(element("p", { class: "field-error", dataset: { for: field.name } }));

  return wrapper;
}

function readValue(form, field) {
  const input = form.elements[field.name];
  if (!input) return undefined;

  if (field.type === "checkbox") return input.checked;
  const raw = input.value.trim();

  if (field.type === "number") {
    if (raw === "") return field.nullable ? null : undefined;
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? raw : parsed;
  }
  if (raw === "") return field.nullable ? null : undefined;
  return raw;
}

/* --------------------------------------------------------- error plumbing */

function clearErrors(form) {
  for (const node of form.querySelectorAll(".field-error")) node.textContent = "";
  for (const node of form.querySelectorAll(".field")) node.classList.remove("has-error");
  const banner = form.querySelector(".form-banner");
  banner.hidden = true;
  banner.textContent = "";
}

/**
 * Places each server-reported problem next to its input.
 *
 * Keys that do not match a field — including nested ones like
 * `lines[1].quantity` — fall back to the banner, so nothing is swallowed.
 */
function applyErrors(form, error) {
  const banner = form.querySelector(".form-banner");
  const unmatched = [];

  for (const [field, reason] of Object.entries(error.details ?? {})) {
    const target = form.querySelector(`.field-error[data-for="${CSS.escape(field)}"]`);
    if (target) {
      target.textContent = reason;
      target.closest(".field")?.classList.add("has-error");
    } else {
      unmatched.push(`${field} ${reason}`);
    }
  }

  const lines = [error.message, ...unmatched];
  banner.textContent = lines.join(" · ");
  banner.hidden = false;
}

/* ------------------------------------------------------------- form modal */

/**
 * Opens a modal form.
 *
 * @param {object} spec
 * @param {string} spec.title
 * @param {Array}  spec.fields    field descriptors
 * @param {object} [spec.values]  initial values, keyed by field name
 * @param {string} [spec.submitLabel]
 * @param {Function} spec.onSubmit  receives the payload, may throw ApiError
 * @param {Function} [spec.onSuccess]
 * @param {Function} [spec.extra]   renders extra content above the fields
 */
export function openForm(spec) {
  const form = element("form", { class: "modal-form", noValidate: true });

  const header = element("header", { class: "modal-header" }, [
    element("h2", { text: spec.title }),
    element("button", { type: "button", class: "icon-button", text: "✕", title: "Close", onClick: closeModal }),
  ]);

  const banner = element("p", { class: "form-banner", hidden: true });
  const grid = element("div", { class: "field-grid" });

  for (const field of spec.fields) {
    grid.append(buildField(field, spec.values?.[field.name]));
  }

  const submit = element("button", { type: "submit", class: "button primary", text: spec.submitLabel ?? "Save" });
  const footer = element("footer", { class: "modal-footer" }, [
    element("button", { type: "button", class: "button", text: "Cancel", onClick: closeModal }),
    submit,
  ]);

  const body = element("div", { class: "modal-body" }, [banner]);
  if (spec.extra) body.append(spec.extra(form));
  body.append(grid);

  form.append(header, body, footer);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors(form);
    submit.disabled = true;
    submit.textContent = "Saving…";

    try {
      const payload = {};
      for (const field of spec.fields) {
        if (field.omit) continue;
        const value = readValue(form, field);
        if (value !== undefined) payload[field.name] = value;
      }

      const result = await spec.onSubmit(payload, form);
      closeModal();
      spec.onSuccess?.(result);
    } catch (error) {
      if (error instanceof ApiError) {
        applyErrors(form, error);
      } else {
        const bannerNode = form.querySelector(".form-banner");
        bannerNode.textContent = error.message;
        bannerNode.hidden = false;
      }
    } finally {
      submit.disabled = false;
      submit.textContent = spec.submitLabel ?? "Save";
    }
  });

  openModal(element("div", { class: "modal" }, [form]));
  return form;
}

/* ------------------------------------------------------------- confirm box */

export function confirmAction({ title, message, confirmLabel = "Confirm", danger = false, onConfirm }) {
  const banner = element("p", { class: "form-banner", hidden: true });

  const button = element("button", {
    type: "button",
    class: `button ${danger ? "danger" : "primary"}`,
    text: confirmLabel,
    onClick: async () => {
      button.disabled = true;
      button.textContent = "Working…";
      try {
        await onConfirm();
        closeModal();
      } catch (error) {
        banner.textContent =
          error instanceof ApiError
            ? [error.message, ...Object.entries(error.details ?? {}).map(([k, v]) => `${k} ${v}`)].join(" · ")
            : error.message;
        banner.hidden = false;
        button.disabled = false;
        button.textContent = confirmLabel;
      }
    },
  });

  openModal(
    element("div", { class: "modal modal-narrow" }, [
      element("header", { class: "modal-header" }, [
        element("h2", { text: title }),
        element("button", { type: "button", class: "icon-button", text: "✕", onClick: closeModal }),
      ]),
      element("div", { class: "modal-body" }, [banner, element("p", { class: "confirm-message", text: message })]),
      element("footer", { class: "modal-footer" }, [
        element("button", { type: "button", class: "button", text: "Cancel", onClick: closeModal }),
        button,
      ]),
    ]),
  );
}

/* ---------------------------------------------------------- drawer / panel */

export function openDrawer({ title, subtitle, sections, actions = [] }) {
  const header = element("header", { class: "modal-header" }, [
    element("div", {}, [
      element("h2", { text: title }),
      subtitle ? element("p", { class: "modal-subtitle", text: subtitle }) : null,
    ]),
    element("button", { type: "button", class: "icon-button", text: "✕", onClick: closeModal }),
  ]);

  const body = element("div", { class: "modal-body" });
  for (const section of sections) {
    if (!section) continue;
    body.append(section);
  }

  const footer = element("footer", { class: "modal-footer modal-footer-spread" });
  for (const action of actions) {
    if (!action) continue;
    footer.append(
      element("button", {
        type: "button",
        class: `button ${action.variant ?? ""}`,
        text: action.label,
        onClick: action.onClick,
        disabled: action.disabled ?? false,
        title: action.title ?? "",
      }),
    );
  }

  openModal(element("div", { class: "modal modal-wide" }, [header, body, footer]));
}

/* ------------------------------------------------------ display primitives */

export function definitionList(entries) {
  const list = element("dl", { class: "definition-list" });
  for (const [term, value] of entries) {
    if (value === undefined || value === null || value === "") continue;
    list.append(element("dt", { text: term }), element("dd", { text: String(value) }));
  }
  return list;
}

export function sectionTitle(text) {
  return element("h3", { class: "section-title", text });
}

export { element };
