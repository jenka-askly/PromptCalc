/**
 * Purpose: Apply deterministic safety rewrites to generated calculator artifacts before persistence.
 * Persists: None.
 * Security Risks: Handles untrusted HTML input; ensure rewrites remain static and do not loosen sandboxing.
 */

const FORM_REGEX = /<form\b/i;
const BUTTON_TYPE_REGEX = /<button(?![^>]*\btype=)([^>]*)>/gi;
const SUBMIT_PREVENTER_ID = "promptcalc-prevent-form-submit";
const SUBMIT_PREVENTER_SCRIPT = `<script id="${SUBMIT_PREVENTER_ID}">document.addEventListener('submit', e => e.preventDefault(), true);</script>`;

const injectSubmitPreventer = (artifactHtml: string): string => {
  if (artifactHtml.includes(SUBMIT_PREVENTER_ID)) {
    return artifactHtml;
  }
  if (artifactHtml.includes("</body>")) {
    return artifactHtml.replace("</body>", `${SUBMIT_PREVENTER_SCRIPT}</body>`);
  }
  return `${artifactHtml}\n${SUBMIT_PREVENTER_SCRIPT}`;
};

export const ensureFormSafety = (
  artifactHtml: string
): { html: string; containsForm: boolean } => {
  const containsForm = FORM_REGEX.test(artifactHtml);
  if (!containsForm) {
    return { html: artifactHtml, containsForm: false };
  }
  const buttonSafeHtml = artifactHtml.replace(
    BUTTON_TYPE_REGEX,
    "<button type=\"button\"$1>"
  );
  return {
    html: injectSubmitPreventer(buttonSafeHtml),
    containsForm: true,
  };
};
